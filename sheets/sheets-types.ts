export interface ExistingValue {
  nickname: string;
  value: string | number;
}

export interface ColumnMetadata {
  date?: string;
  cost?: number;
  playerCount?: number;
}

export type MoneyUserCellState = 'empty' | 'zero' | 'number';

export interface SheetsClient {
  findNicknameRows: (nicknames: string[]) => Promise<Map<string, number>>;
  checkExistingValues: (
    nicknameRows: Map<string, number>,
    column: string,
  ) => Promise<ExistingValue[]>;
  writeZeros: (
    nicknameRows: Map<string, number>,
    column: string,
    overrideExisting?: boolean,
  ) => Promise<{ updated: number; notFound: string[] }>;
  findLastDateColumn: () => Promise<{ column: string; date: string } | null>;
  findColumnByDateText: (text: string) => Promise<
    | { success: true; column: string; date: string }
    | {
        success: true;
        multiple: true;
        matches: Array<{ column: string; date: string }>;
      }
    | { success: false; error: 'not_found' }
  >;
  getColumnMetadata: (column: string) => Promise<ColumnMetadata>;
  writeColumnMetadata: (
    column: string,
    date?: string,
    cost?: number,
    playerCount?: number,
  ) => Promise<void>;
  /** e.g. `@alice` as stored in the sheet; returns sheet row or null */
  findUserRowByTg: (atUsername: string) => Promise<number | null>;
  isTelegramUsernameInSheet: (atUsername: string) => Promise<boolean>;
  /** First data row (from row 7) where both A and B are empty; null if none */
  findFirstRowWithEmptyNameAndTg: () => Promise<number | null>;
  writeRegisterRow: (
    row: number,
    displayName: string,
    atTg: string,
  ) => Promise<void>;
  getMoneyUserCellInfo: (params: {
    column: string;
    userRow: number;
  }) => Promise<{
    cell: MoneyUserCellState;
    numericValue?: number;
    /** Non-empty string if the cell is not actually numeric */
    displayText?: string;
  }>;
  isCellEmpty: (params: { column: string; row: number }) => Promise<boolean>;
  getNextDateColumnInfo: (params: {
    lastDateColumn: string;
    userRow: number;
  }) => Promise<{
    nextColumn: string;
    headerEmpty: boolean;
    userCellEmpty: boolean;
  }>;
  writeMoneyToCell: (
    column: string,
    userRow: number,
    amount: number,
  ) => Promise<void>;
}

export type SheetsClientFactory = () => Promise<SheetsClient>;
