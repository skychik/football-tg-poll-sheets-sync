import type { SheetsClient } from '../sheets/sheets-types';

export type SheetsStub = SheetsClient;

export function baseSheets(overrides: Partial<SheetsStub> = {}): SheetsStub {
  const base: SheetsStub = {
    findLastDateColumn: async () => null,
    findColumnByDateText: async () => ({ success: false, error: 'not_found' }),
    findNicknameRows: async () => new Map(),
    checkExistingValues: async () => [],
    writeZeros: async () => ({ updated: 0, notFound: [] }),
    getColumnMetadata: async () => ({}),
    writeColumnMetadata: async () => {},
  };
  return { ...base, ...overrides };
}
