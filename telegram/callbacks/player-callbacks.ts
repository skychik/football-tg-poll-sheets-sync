import type { Bot } from 'grammy';
import { handlePlayerCallback } from '../../flows/poll-reconciliation';
import { CallbackPrefix } from '../../keyboards';
import type { MyContext } from '../../session';

export function registerPlayerCallbackHandlers(bot: Bot<MyContext>): void {
  bot.callbackQuery(new RegExp(`^${CallbackPrefix.PLAYER}`), async (ctx) => {
    const data = ctx.callbackQuery.data.slice(CallbackPrefix.PLAYER.length);
    await ctx.answerCallbackQuery();
    await handlePlayerCallback(ctx, data);
  });
}
