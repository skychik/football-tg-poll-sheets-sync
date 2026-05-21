import type { SheetsClient } from '../sheets/sheets-types';

export type SheetsStub = SheetsClient;

export function baseSheets(overrides: Partial<SheetsStub> = {}): SheetsStub {
  const base: SheetsStub = {
    listPlayers: async () => [],
    findLastDateColumn: async () => null,
    findColumnByDateText: async () => ({ success: false, error: 'not_found' }),
    findNicknameRows: async () => new Map(),
    checkExistingValues: async () => [],
    writeZeros: async () => ({ updated: 0, notFound: [] }),
    getColumnMetadata: async () => ({}),
    writeColumnMetadata: async () => {},
    findUserRowByTg: async () => null,
    isTelegramUsernameInSheet: async () => false,
    findFirstRowWithEmptyNameAndTg: async () => null,
    writeRegisterRow: async () => {},
    getMoneyUserCellInfo: async () => ({ cell: 'empty' }),
    isCellEmpty: async () => true,
    getNextDateColumnInfo: async () => ({
      nextColumn: 'G',
      headerEmpty: true,
      userCellEmpty: true,
    }),
    writeMoneyToCell: async () => {},
  };
  return { ...base, ...overrides };
}
