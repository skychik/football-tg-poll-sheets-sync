export interface ExistingValue {
  nickname: string;
  value: string | number;
}

export interface ColumnMetadata {
  date?: string;
  cost?: number;
  playerCount?: number;
}

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
}

export type SheetsClientFactory = () => Promise<SheetsClient>;
