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
const valuesBatchUpdateMock = mock(async () => ({
  data: {},
}));

const sheetsMock = mock(() => ({
  spreadsheets: {
    values: {
      get: valuesGetMock,
      batchUpdate: valuesBatchUpdateMock,
    },
  },
}));

class MockJWT {}

const originalSheets = google.sheets;
const originalJwt = google.auth.JWT;
let previousSpreadsheetId: string | undefined;
let previousServiceAccountEmail: string | undefined;
let previousPrivateKey: string | undefined;

function resetValuesGetMock(): void {
  (valuesGetMock as { mockClear?: () => void }).mockClear?.();
  (valuesBatchUpdateMock as { mockClear?: () => void }).mockClear?.();
}

function restoreEnvVar(name: string, previousValue: string | undefined): void {
  if (previousValue === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = previousValue;
  }
}

describe('createGoogleSheetsClient / findFirstRowWithEmptyNameAndTg', () => {
  beforeEach(() => {
    currentValues = [];
    previousSpreadsheetId = process.env.SPREADSHEET_ID;
    previousServiceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    previousPrivateKey = process.env.GOOGLE_PRIVATE_KEY;
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
    restoreEnvVar('SPREADSHEET_ID', previousSpreadsheetId);
    restoreEnvVar('GOOGLE_SERVICE_ACCOUNT_EMAIL', previousServiceAccountEmail);
    restoreEnvVar('GOOGLE_PRIVATE_KEY', previousPrivateKey);
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

  test('listPlayers reads names and optional normalized nicknames', async () => {
    currentValues = [
      ['Alice', 'alice'],
      ['Boris', '@boris'],
      ['Name Only', ''],
      ['', ''],
    ];
    const client = await createGoogleSheetsClient();
    const players = await client.listPlayers();

    expect(players).toEqual([
      { row: SHEET_DATA_FIRST_ROW, name: 'Alice', nickname: '@alice' },
      { row: SHEET_DATA_FIRST_ROW + 1, name: 'Boris', nickname: '@boris' },
      { row: SHEET_DATA_FIRST_ROW + 2, name: 'Name Only' },
    ]);
  });

  test('writeRegisterRow writes blank nickname when caller passes empty string', async () => {
    const client = await createGoogleSheetsClient();
    await client.writeRegisterRow(12, 'Name Only', '');

    expect(valuesBatchUpdateMock).toHaveBeenCalledWith({
      spreadsheetId: 'test-sheet-id',
      requestBody: {
        valueInputOption: 'RAW',
        data: [
          {
            range: `'${SHEET_NAME}'!${SHEET_NAME_COLUMN}12`,
            values: [['Name Only']],
          },
          {
            range: `'${SHEET_NAME}'!${SHEET_NICKNAME_COLUMN}12`,
            values: [['']],
          },
        ],
      },
    });
  });
});
