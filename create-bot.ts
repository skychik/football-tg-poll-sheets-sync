import { Bot, type BotConfig, session } from 'grammy';
import { registerCommands } from './commands';
import { registerMessageHandlers } from './handlers';
import { registerCallbackHandlers } from './handlers/callback-handlers';
import { registerPollAnswerHandler, registerPollCommand } from './poll';
import type { AppServices } from './services';
import type { MyContext, SessionData } from './session';

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
        columnMatches: undefined,
      }),
    }),
  );

  bot.use(async (ctx, next) => {
    ctx.services = services;
    await next();
  });

  registerCommands(bot);
  registerPollCommand(bot, services.pollStorage);
  registerPollAnswerHandler(bot, services.pollStorage);
  registerCallbackHandlers(bot);
  registerMessageHandlers(bot);

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
