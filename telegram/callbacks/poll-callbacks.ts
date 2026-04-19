import type { Bot } from 'grammy';
import { CallbackPrefix } from '../../keyboards';
import type { MyContext } from '../../session';
import {
  applyPollOptionSelectionAndStartUpdate,
  enterPollOptionSelection,
  getPollDataOrError,
  resetSessionAfterPollView,
} from '../poll/selection-flow';

/**
 * Register callback_query handlers for poll intent and poll option keyboards.
 */
export function registerPollCallbackHandlers(bot: Bot<MyContext>): void {
  bot.callbackQuery(
    new RegExp(`^${CallbackPrefix.POLL_INTENT}`),
    async (ctx) => {
      const data = ctx.callbackQuery.data.slice(
        CallbackPrefix.POLL_INTENT.length,
      );
      await ctx.answerCallbackQuery();

      if (data === 'update') {
        const result = await getPollDataOrError(ctx);
        if (!result) return;

        const { pollData } = result;
        await enterPollOptionSelection(ctx, pollData, async (text, extra) => {
          await ctx.editMessageText(text, extra);
        });
        return;
      }

      if (data === 'view') {
        const result = await getPollDataOrError(ctx);
        if (!result) return;

        const { pollData } = result;
        await resetSessionAfterPollView(ctx, pollData, (t) =>
          ctx.editMessageText(t),
        );
        return;
      }
    },
  );

  bot.callbackQuery(
    new RegExp(`^${CallbackPrefix.POLL_OPTION}`),
    async (ctx) => {
      const data = ctx.callbackQuery.data.slice(
        CallbackPrefix.POLL_OPTION.length,
      );
      const optionIndex = parseInt(data, 10);
      await ctx.answerCallbackQuery();

      if (Number.isNaN(optionIndex)) {
        await ctx.editMessageText('❌ Invalid option.');
        return;
      }

      const result = await getPollDataOrError(ctx);
      if (!result) return;

      const { pollData } = result;

      await applyPollOptionSelectionAndStartUpdate(
        ctx,
        pollData,
        optionIndex,
        (msg) => ctx.editMessageText(msg),
      );
    },
  );
}
