import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { google } from 'googleapis';
import {
  SHEET_DATA_FIRST_ROW,
  SHEET_NAME,
  SHEET_NAME_COLUMN,
  SHEET_NICKNAME_COLUMN,
} from '../constants';
import { createGoogleSheetsClient } from '../sheets/google-sheets-client';

const EXPECTED_NAME_TG_RANGE = `'${SHEET_NAME}'!${SHEET_NAME_COLUMN}${SHEET_DATA_FIRST_ROW}:${SHEET_NICKNAME_COLUMN}`;

let currentValues: unknown[][] = [];

const valuesGetMock = mock(async () => ({
  data: { values: currentValues },
}));

const sheetsMock = mock(() => ({
  spreadsheets: {
    values: {
      get: valuesGetMock,
    },
  },
}));

class MockJWT {
  constructor(_opts: unknown) {}
}

const originalSheets = google.sheets;
const originalJwt = google.auth.JWT;

function resetValuesGetMock(): void {
  (valuesGetMock as { mockClear?: () => void }).mockClear?.();
}

describe('createGoogleSheetsClient / findFirstRowWithEmptyNameAndTg', () => {
  beforeEach(() => {
    currentValues = [];
    process.env.SPREADSHEET_ID = 'test-sheet-id';
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'bot@example.com';
    process.env.GOOGLE_PRIVATE_KEY =
      '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----';
    google.sheets = sheetsMock as typeof google.sheets;
    google.auth.JWT = MockJWT as typeof google.auth.JWT;
    resetValuesGetMock();
  });

  afterEach(() => {
    google.sheets = originalSheets;
    google.auth.JWT = originalJwt;
    delete process.env.SPREADSHEET_ID;
    delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    delete process.env.GOOGLE_PRIVATE_KEY;
  });

  test('no rows in response -> first data row (append here when sheet is empty in range)', async () => {
    currentValues = [];
    const client = await createGoogleSheetsClient();
    const row = await client.findFirstRowWithEmptyNameAndTg();
    expect(row).toBe(SHEET_DATA_FIRST_ROW);
  });

  test('fully populated block (no A+B empty) -> next row after returned block (trailing empty rows omitted by API)', async () => {
    currentValues = [
      ['Alice', '@alice'],
      ['Bob', '@bob'],
    ];
    const client = await createGoogleSheetsClient();
    const row = await client.findFirstRowWithEmptyNameAndTg();
    expect(row).toBe(SHEET_DATA_FIRST_ROW + currentValues.length);
    expect(valuesGetMock).toHaveBeenCalledWith({
      spreadsheetId: 'test-sheet-id',
      range: EXPECTED_NAME_TG_RANGE,
    });
  });

  test('empty A/B pair inside fetched block -> first such row', async () => {
    currentValues = [
      ['Alice', '@alice'],
      ['', ''],
      ['Bob', '@bob'],
    ];
    const client = await createGoogleSheetsClient();
    const row = await client.findFirstRowWithEmptyNameAndTg();
    expect(row).toBe(SHEET_DATA_FIRST_ROW + 1);
    expect(valuesGetMock).toHaveBeenCalledWith({
      spreadsheetId: 'test-sheet-id',
      range: EXPECTED_NAME_TG_RANGE,
    });
  });

  test('whitespace-only A and B count as an empty pair', async () => {
    currentValues = [['  ', '\t']];
    const client = await createGoogleSheetsClient();
    const row = await client.findFirstRowWithEmptyNameAndTg();
    expect(row).toBe(SHEET_DATA_FIRST_ROW);
  });

  test('only column A set (B missing) is not a free row -> row after the block', async () => {
    currentValues = [['Alice']];
    const client = await createGoogleSheetsClient();
    const row = await client.findFirstRowWithEmptyNameAndTg();
    expect(row).toBe(SHEET_DATA_FIRST_ROW + 1);
  });
});
