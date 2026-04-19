import type { PollStorage } from './poll-storage/poll-storage-types';
import type { SheetsClientFactory } from './sheets/sheets-types';

/**
 * Application services injected into each update context (`ctx.services`).
 */
export interface AppServices {
  pollStorage: PollStorage;
  createSheetsClient: SheetsClientFactory;
  getNextColumnLetter: (letter: string) => string;
}
