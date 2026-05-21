import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { JWT } from 'google-auth-library';
import { google } from 'googleapis';
import {
  SHEET_COST_ROW,
  SHEET_DATA_FIRST_COLUMN,
  SHEET_DATA_FIRST_ROW,
  SHEET_DATE_ROW,
  SHEET_EXCLUDE_COLUMN_PATTERN,
  SHEET_NAME,
  SHEET_NAME_COLUMN,
  SHEET_NICKNAME_COLUMN,
  SHEET_PLAYER_COUNT_ROW,
} from '../constants';
import {
  columnLetterToIndex,
  getNextColumnLetter,
  indexToColumnLetter,
} from './sheet-columns';
import type {
  ColumnMetadata,
  ExistingValue,
  MoneyUserCellState,
  PlayerRosterEntry,
  SheetsClient,
} from './sheets-types';

const SHEETS_API_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

function requireSpreadsheetId(): string {
  const id = process.env.SPREADSHEET_ID;
  if (!id) {
    throw new Error('SPREADSHEET_ID environment variable is required');
  }
  return id;
}

/**
 * Build a Google Sheets API client (service account). Reads `SPREADSHEET_ID` when invoked, not at import time.
 */
export async function createGoogleSheetsClient(): Promise<SheetsClient> {
  const SPREADSHEET_ID = requireSpreadsheetId();
  let auth: JWT;

  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON_PATH) {
    const jsonPath = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_PATH;
    if (!existsSync(jsonPath)) {
      throw new Error(`Service account JSON file not found: ${jsonPath}`);
    }
    auth = new google.auth.JWT({
      keyFile: jsonPath,
      scopes: [SHEETS_API_SCOPE],
    });
  } else {
    const possibleFiles = [
      'cosmic-flux-383910-d8f7992822ad.json',
      'service-account-key.json',
      'google-credentials.json',
      'credentials.json',
    ];

    let jsonPath: string | undefined;
    for (const file of possibleFiles) {
      const fullPath = join(process.cwd(), file);
      if (existsSync(fullPath)) {
        try {
          const content = JSON.parse(readFileSync(fullPath, 'utf8'));
          if (content.type === 'service_account' && content.private_key) {
            jsonPath = fullPath;
            break;
          }
        } catch {
          // continue
        }
      }
    }

    if (jsonPath) {
      auth = new google.auth.JWT({
        keyFile: jsonPath,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });
    } else {
      const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
      const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');

      if (!email || !key) {
        throw new Error(
          'Missing Google Service Account credentials. Provide one of:\n' +
            '  - GOOGLE_SERVICE_ACCOUNT_JSON_PATH environment variable pointing to JSON file\n' +
            '  - A service account JSON file in the project directory\n' +
            '  - Both GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY environment variables',
        );
      }

      if (
        !key.includes('BEGIN PRIVATE KEY') ||
        !key.includes('END PRIVATE KEY')
      ) {
        throw new Error(
          'Invalid private key format. The private key should include BEGIN PRIVATE KEY and END PRIVATE KEY markers.',
        );
      }

      auth = new google.auth.JWT({
        email,
        key,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });
    }
  }

  const sheets = google.sheets({ version: 'v4', auth });

  async function listPlayers(): Promise<PlayerRosterEntry[]> {
    const range = `'${SHEET_NAME}'!${SHEET_NAME_COLUMN}${SHEET_DATA_FIRST_ROW}:${SHEET_NICKNAME_COLUMN}`;
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range,
    });

    const rows = response.data.values || [];
    const players: PlayerRosterEntry[] = [];

    rows.forEach((row, index) => {
      const name = row[0] == null ? '' : String(row[0]).trim();
      const nicknameRaw = row[1] == null ? '' : String(row[1]).trim();
      if (!name && !nicknameRaw) return;

      const nickname = nicknameRaw
        ? `@${nicknameRaw.replace(/^@+/, '')}`
        : undefined;
      players.push({
        row: SHEET_DATA_FIRST_ROW + index,
        name,
        nickname,
      });
    });

    return players;
  }

  async function findNicknameRows(
    nicknames: string[],
  ): Promise<Map<string, number>> {
    const normalizedNicknames = new Map<string, string>();
    nicknames.forEach((nick) => {
      const normalized = nick.replace(/^@/, '').toLowerCase();
      normalizedNicknames.set(normalized, nick);
    });

    const range = `${SHEET_NICKNAME_COLUMN}${SHEET_DATA_FIRST_ROW}:${SHEET_NICKNAME_COLUMN}`;
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range,
    });

    const rows = response.data.values || [];
    const nicknameToRow = new Map<string, number>();

    rows.forEach((row, index) => {
      if (row[0]) {
        const sheetNickname = String(row[0]).replace(/^@/, '').toLowerCase();
        const originalNickname = normalizedNicknames.get(sheetNickname);
        if (originalNickname) {
          const actualRow = SHEET_DATA_FIRST_ROW + index;
          nicknameToRow.set(originalNickname, actualRow);
        }
      }
    });

    return nicknameToRow;
  }

  async function checkExistingValues(
    nicknameRows: Map<string, number>,
    column: string,
  ): Promise<ExistingValue[]> {
    if (nicknameRows.size === 0) {
      return [];
    }

    const ranges: string[] = [];
    nicknameRows.forEach((row) => {
      ranges.push(`'${SHEET_NAME}'!${column}${row}`);
    });

    const response = await sheets.spreadsheets.values.batchGet({
      spreadsheetId: SPREADSHEET_ID,
      ranges,
    });

    const existingValues: ExistingValue[] = [];
    const rowsArray = Array.from(nicknameRows.entries());

    response.data.valueRanges?.forEach((valueRange, index) => {
      const [nickname, _row] = rowsArray[index];
      const values = valueRange.values || [];

      if (values.length > 0 && values[0] && values[0].length > 0) {
        const cellValue = values[0][0];
        if (
          cellValue !== null &&
          cellValue !== undefined &&
          String(cellValue).trim() !== ''
        ) {
          existingValues.push({
            nickname,
            value: cellValue,
          });
        }
      }
    });

    return existingValues;
  }

  async function writeZeros(
    nicknameRows: Map<string, number>,
    column: string,
    overrideExisting: boolean = true,
  ): Promise<{ updated: number; notFound: string[] }> {
    if (nicknameRows.size === 0) {
      return { updated: 0, notFound: [] };
    }

    let rowsToUpdate = nicknameRows;
    if (!overrideExisting) {
      const existingValues = await checkExistingValues(nicknameRows, column);
      const existingNicknames = new Set(
        existingValues.map((ev) => ev.nickname),
      );

      rowsToUpdate = new Map<string, number>();
      nicknameRows.forEach((row, nickname) => {
        if (!existingNicknames.has(nickname)) {
          rowsToUpdate.set(nickname, row);
        }
      });
    }

    if (rowsToUpdate.size === 0) {
      return { updated: 0, notFound: [] };
    }

    const updates: Array<{ range: string; values: (string | number)[][] }> = [];

    rowsToUpdate.forEach((row, _nickname) => {
      const range = `'${SHEET_NAME}'!${column}${row}`;
      updates.push({
        range,
        values: [[0]],
      });
    });

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        valueInputOption: 'RAW',
        data: updates,
      },
    });

    const updated = rowsToUpdate.size;
    const notFound: string[] = [];

    return { updated, notFound };
  }

  async function findLastDateColumn(): Promise<{
    column: string;
    date: string;
  } | null> {
    let lastDateColumn: { column: string; date: string } | null = null;

    const range = `'${SHEET_NAME}'!${SHEET_DATA_FIRST_COLUMN}${SHEET_DATE_ROW}:ZZ${SHEET_DATE_ROW}`;
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range,
    });

    const values = response.data.values?.[0] || [];

    for (let i = 0; i < values.length; i++) {
      const value = values[i];
      const prevIndex = i - 1;
      const prevValue = values[prevIndex];
      if (value == null || value === undefined || String(value).trim() === '') {
        const columnIndex =
          columnLetterToIndex(SHEET_DATA_FIRST_COLUMN) + prevIndex;
        const columnLetter = indexToColumnLetter(columnIndex);
        lastDateColumn = {
          column: columnLetter,
          date: String(prevValue).trim(),
        };
        break;
      }
    }

    return lastDateColumn;
  }

  async function findColumnByDateText(text: string): Promise<
    | { success: true; column: string; date: string }
    | {
        success: true;
        multiple: true;
        matches: Array<{ column: string; date: string }>;
      }
    | { success: false; error: 'not_found' }
  > {
    const searchText = text.trim().toLowerCase();
    if (!searchText) {
      return { success: false, error: 'not_found' };
    }

    const range = `'${SHEET_NAME}'!${SHEET_DATA_FIRST_COLUMN}${SHEET_DATE_ROW}:ZZ${SHEET_DATE_ROW}`;
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range,
    });

    const values = response.data.values?.[0] || [];
    const matches: Array<{ column: string; date: string }> = [];

    for (let i = 0; i < values.length; i++) {
      const value = values[i];
      if (
        value !== null &&
        value !== undefined &&
        String(value).trim() !== ''
      ) {
        const cellValue = String(value).trim();
        if (SHEET_EXCLUDE_COLUMN_PATTERN.test(cellValue)) {
          continue;
        }
        if (cellValue.toLowerCase().includes(searchText)) {
          const columnIndex = columnLetterToIndex(SHEET_DATA_FIRST_COLUMN) + i;
          const columnLetter = indexToColumnLetter(columnIndex);
          matches.push({
            column: columnLetter,
            date: cellValue,
          });
        }
      }
    }

    if (matches.length === 0) {
      return { success: false, error: 'not_found' };
    }

    if (matches.length > 1) {
      matches.sort((a, b) => {
        const indexA = columnLetterToIndex(a.column);
        const indexB = columnLetterToIndex(b.column);
        return indexB - indexA;
      });
      return {
        success: true,
        multiple: true,
        matches,
      };
    }

    return {
      success: true,
      column: matches[0].column,
      date: matches[0].date,
    };
  }

  async function getColumnMetadata(column: string): Promise<ColumnMetadata> {
    const range = `'${SHEET_NAME}'!${column}${SHEET_DATE_ROW}:${column}${SHEET_PLAYER_COUNT_ROW}`;
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range,
    });

    const rows = response.data.values || [];
    const metadata: ColumnMetadata = {};

    if (
      rows[0] &&
      rows[0][0] !== null &&
      rows[0][0] !== undefined &&
      String(rows[0][0]).trim() !== ''
    ) {
      metadata.date = String(rows[0][0]).trim();
    }

    if (
      rows[1] &&
      rows[1][0] !== null &&
      rows[1][0] !== undefined &&
      String(rows[1][0]).trim() !== ''
    ) {
      const costValue = rows[1][0];
      const costNum =
        typeof costValue === 'number'
          ? costValue
          : parseFloat(String(costValue));
      if (!Number.isNaN(costNum)) {
        metadata.cost = costNum;
      }
    }

    if (
      rows[2] &&
      rows[2][0] !== null &&
      rows[2][0] !== undefined &&
      String(rows[2][0]).trim() !== ''
    ) {
      const countValue = rows[2][0];
      const countNum =
        typeof countValue === 'number'
          ? countValue
          : parseInt(String(countValue), 10);
      if (!Number.isNaN(countNum)) {
        metadata.playerCount = countNum;
      }
    }

    return metadata;
  }

  async function writeColumnMetadata(
    column: string,
    date?: string,
    cost?: number,
    playerCount?: number,
  ): Promise<void> {
    const updates: Array<{ range: string; values: (string | number)[][] }> = [];

    if (date !== undefined) {
      updates.push({
        range: `'${SHEET_NAME}'!${column}${SHEET_DATE_ROW}`,
        values: [[date]],
      });
    }

    if (cost !== undefined) {
      updates.push({
        range: `'${SHEET_NAME}'!${column}${SHEET_COST_ROW}`,
        values: [[cost]],
      });
    }

    if (playerCount !== undefined) {
      updates.push({
        range: `'${SHEET_NAME}'!${column}${SHEET_PLAYER_COUNT_ROW}`,
        values: [[playerCount]],
      });
    }

    if (updates.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
          valueInputOption: 'RAW',
          data: updates,
        },
      });
    }
  }

  function parseCellToMoneyInfo(val: unknown): {
    cell: MoneyUserCellState;
    numericValue?: number;
    displayText?: string;
  } {
    if (val === null || val === undefined || String(val).trim() === '') {
      return { cell: 'empty' };
    }
    const s = String(val).trim();
    const n = typeof val === 'number' ? val : parseFloat(s);
    if (Number.isNaN(n)) {
      return { cell: 'number', displayText: s };
    }
    if (n === 0) {
      return { cell: 'zero' };
    }
    return { cell: 'number', numericValue: n, displayText: s };
  }

  async function findUserRowByTg(atUsername: string): Promise<number | null> {
    const m = await findNicknameRows([atUsername]);
    const row = m.get(atUsername);
    return row ?? null;
  }

  async function isTelegramUsernameInSheet(
    atUsername: string,
  ): Promise<boolean> {
    return (await findUserRowByTg(atUsername)) !== null;
  }

  async function findFirstRowWithEmptyNameAndTg(): Promise<number | null> {
    const range = `'${SHEET_NAME}'!${SHEET_NAME_COLUMN}${SHEET_DATA_FIRST_ROW}:${SHEET_NICKNAME_COLUMN}`;
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range,
    });
    const rows = response.data.values || [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] || [];
      const a = row[0];
      const b = row[1];
      const aEmpty = a == null || String(a).trim() === '';
      const bEmpty = b == null || String(b).trim() === '';
      if (aEmpty && bEmpty) {
        return SHEET_DATA_FIRST_ROW + i;
      }
    }
    // Google Sheets omits trailing fully empty rows from values.get, so if the
    // fetched block is full the next free row is immediately after it.
    return SHEET_DATA_FIRST_ROW + rows.length;
  }

  async function writeRegisterRow(
    row: number,
    displayName: string,
    atTg?: string,
  ): Promise<void> {
    const data = [
      {
        range: `'${SHEET_NAME}'!${SHEET_NAME_COLUMN}${row}`,
        values: [[displayName]],
      },
    ];
    if (atTg !== undefined) {
      data.push({
        range: `'${SHEET_NAME}'!${SHEET_NICKNAME_COLUMN}${row}`,
        values: [[atTg]],
      });
    }

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        valueInputOption: 'RAW',
        data,
      },
    });
  }

  async function getMoneyUserCellInfo(params: {
    column: string;
    userRow: number;
  }): Promise<{
    cell: MoneyUserCellState;
    numericValue?: number;
    displayText?: string;
  }> {
    const range = `'${SHEET_NAME}'!${params.column}${params.userRow}`;
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range,
    });
    const v = response.data.values?.[0]?.[0];
    return parseCellToMoneyInfo(v);
  }

  async function isCellEmpty(params: {
    column: string;
    row: number;
  }): Promise<boolean> {
    const range = `'${SHEET_NAME}'!${params.column}${params.row}`;
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range,
    });
    const v = response.data.values?.[0]?.[0];
    return v == null || String(v).trim() === '';
  }

  async function getNextDateColumnInfo(params: {
    lastDateColumn: string;
    userRow: number;
  }): Promise<{
    nextColumn: string;
    headerEmpty: boolean;
    userCellEmpty: boolean;
  }> {
    const nextColumn = getNextColumnLetter(params.lastDateColumn);
    const [headerRes, userRes] = await Promise.all([
      sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `'${SHEET_NAME}'!${nextColumn}${SHEET_DATE_ROW}`,
      }),
      sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `'${SHEET_NAME}'!${nextColumn}${params.userRow}`,
      }),
    ]);
    const hv = headerRes.data.values?.[0]?.[0];
    const uv = userRes.data.values?.[0]?.[0];
    return {
      nextColumn,
      headerEmpty: hv == null || String(hv).trim() === '',
      userCellEmpty: uv == null || String(uv).trim() === '',
    };
  }

  async function writeMoneyToCell(
    column: string,
    userRow: number,
    amount: number,
  ): Promise<void> {
    const range = `'${SHEET_NAME}'!${column}${userRow}`;
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        valueInputOption: 'RAW',
        data: [{ range, values: [[amount]] }],
      },
    });
  }

  return {
    listPlayers,
    findNicknameRows,
    checkExistingValues,
    writeZeros,
    findLastDateColumn,
    findColumnByDateText,
    getColumnMetadata,
    writeColumnMetadata,
    findUserRowByTg,
    isTelegramUsernameInSheet,
    findFirstRowWithEmptyNameAndTg,
    writeRegisterRow,
    getMoneyUserCellInfo,
    isCellEmpty,
    getNextDateColumnInfo,
    writeMoneyToCell,
  };
}
