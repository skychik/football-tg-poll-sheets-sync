import type { AppServices } from '../../app-services';
import { InMemoryPollStorage } from '../../poll-storage/in-memory-poll-storage';
import type { MyContext, SessionData } from '../../session';
import { getNextColumnLetter } from '../../sheets/sheet-columns';
import type { SheetsStub } from '../sheet-test-stub';

export function emptySession(): SessionData {
  return {
    state: 'idle',
    usernames: [],
  };
}

export type MinimalWorkflowContextOptions = {
  /**
   * Defaults to identity (`letter => letter`) for isolated workflow tests.
   * Use real `getNextColumnLetter` from sheet-columns when testing flows that depend on column math.
   */
  getNextColumnLetter?: AppServices['getNextColumnLetter'];
};

/**
 * Minimal `MyContext` for unit-style workflow tests (reply capture only, no full grammy Context).
 */
export function makeMinimalWorkflowContext(
  sessionPatch: Partial<SessionData> & { targetColumn?: string },
  sheets: SheetsStub,
  options: MinimalWorkflowContextOptions = {},
): { ctx: MyContext; replies: string[] } {
  const replies: string[] = [];
  const session: SessionData = {
    ...emptySession(),
    ...sessionPatch,
  };
  const services: AppServices = {
    pollStorage: new InMemoryPollStorage(),
    createSheetsClient: async () => sheets,
    getNextColumnLetter:
      options.getNextColumnLetter ?? ((letter: string) => letter),
  };
  const ctx = {
    session,
    reply: async (text: string) => {
      replies.push(text);
    },
    services,
  } as unknown as MyContext;
  return { ctx, replies };
}

/** Same as {@link makeMinimalWorkflowContext} with production column-letter behavior. */
export function makeMinimalWorkflowContextWithRealColumnLetters(
  sessionPatch: Partial<SessionData> & { targetColumn?: string },
  sheets: SheetsStub,
): { ctx: MyContext; replies: string[] } {
  return makeMinimalWorkflowContext(sessionPatch, sheets, {
    getNextColumnLetter,
  });
}
