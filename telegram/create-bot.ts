import { Bot, type BotConfig, session } from 'grammy';
import type { AppServices } from '../app-services';
import type { MyContext, SessionData } from '../session';
import { registerMoneyCallbackHandlers } from './callbacks/money-callbacks';
import { registerPlayerCallbackHandlers } from './callbacks/player-callbacks';
import { registerPollCallbackHandlers } from './callbacks/poll-callbacks';
import { registerUpdateCallbackHandlers } from './callbacks/update-callbacks';
import { registerCommands } from './commands';
import { logIncomingMessage } from './log-incoming-message';
import { registerMessageRouter } from './message-router';
import { registerPollAnswerHandler } from './poll/answer-handler';

/**
 * Thin runtime surface for long-polling production (`handleUpdate` is only used in tests).
 */
export type TelegramApp = Pick<Bot<MyContext>, 'handleUpdate' | 'start'>;

export function asTelegramApp(bot: Bot<MyContext>): TelegramApp {
  return bot;
}

/**
 * Build the bot with all middleware and handlers. Does not call `start()`.
 */
export function createBot(
  token: string,
  options: BotConfig<MyContext> | undefined,
  services: AppServices,
): Bot<MyContext> {
  const bot = new Bot<MyContext>(token, options);

  bot.use(
    session({
      initial: (): SessionData => ({
        state: 'idle',
        usernames: [],
        detectedColumn: undefined,
        targetColumn: undefined,
        isNewColumn: undefined,
        dateName: undefined,
        cost: undefined,
        playerCount: undefined,
        column: undefined,
        nicknameRowsEntries: undefined,
        existingValuesEntries: undefined,
        pollId: undefined,
        pollQuestion: undefined,
        pollReconciliationActive: undefined,
        pollSelectedUsernames: undefined,
        pollRemainingUsernames: undefined,
        pollResolvedAttendeesEntries: undefined,
        pollRemovedUsernames: undefined,
        pollRosterEntries: undefined,
        pollSearchResults: undefined,
        pollSearchPage: undefined,
        pollUnknownQueries: undefined,
        pollPendingPlayer: undefined,
        pollPendingNewName: undefined,
        pollPendingNewNickname: undefined,
        columnMatches: undefined,
        moneyAmount: undefined,
        moneyResumeAfterRegister: undefined,
        moneyWriteColumn: undefined,
        moneyUserSheetRow: undefined,
        moneyLastDateColumn: undefined,
        moneyLastDateText: undefined,
        moneyNextColumn: undefined,
        moneyTgKey: undefined,
        moneyOldCellValue: undefined,
        registerAtUsername: undefined,
      }),
    }),
  );

  bot.use(async (ctx, next) => {
    ctx.services = services;
    await next();
  });

  bot.use(async (ctx, next) => {
    logIncomingMessage(ctx);
    await next();
  });

  registerCommands(bot, services.pollStorage);
  registerPollAnswerHandler(bot, services.pollStorage);
  registerPollCallbackHandlers(bot);
  registerPlayerCallbackHandlers(bot);
  registerMoneyCallbackHandlers(bot);
  registerUpdateCallbackHandlers(bot);
  registerMessageRouter(bot);

  bot.catch((err) => {
    const ctx = err.ctx;
    console.error(`Error while handling update ${ctx.update.update_id}:`);
    const e = err.error;
    if (e instanceof Error) {
      console.error('Error details:', e.message);
    }
  });

  return bot;
}
