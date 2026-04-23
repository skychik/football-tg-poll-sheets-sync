import type { Bot } from 'grammy';
import {
  onMoneyCallbackColumnLast,
  onMoneyCallbackColumnNext,
  onMoneyEmptyPollCallback,
  onMoneyReplaceCallback,
  onMoneyRow4Callback,
} from '../../flows/money-flow';
import { CallbackPrefix } from '../../keyboards';
import type { MyContext } from '../../session';
import { editMessageMarkdownV2 } from '../markdown-v2';

/** Best-effort UI update; must not block money-flow state transitions. */
async function tryEditMessageText(
  ctx: MyContext,
  text: string,
  other?: object,
): Promise<void> {
  try {
    await editMessageMarkdownV2(ctx, text, other);
  } catch {
    // Message may be too old, already edited, or deleted.
  }
}

/**
 * Inline callbacks for /money (prefix `mn:`).
 */
export function registerMoneyCallbackHandlers(bot: Bot<MyContext>): void {
  bot.callbackQuery(new RegExp(`^${CallbackPrefix.MONEY}`), async (ctx) => {
    const data = ctx.callbackQuery.data.slice(CallbackPrefix.MONEY.length);
    await ctx.answerCallbackQuery();

    if (data === 'col:last') {
      await tryEditMessageText(ctx, 'Using last date column');
      await onMoneyCallbackColumnLast(ctx);
      return;
    }
    if (data === 'col:next') {
      await tryEditMessageText(ctx, 'Using next column');
      await onMoneyCallbackColumnNext(ctx);
      return;
    }
    if (data === 'rp:yes' || data === 'rp:no') {
      if (data === 'rp:yes') {
        await tryEditMessageText(
          ctx,
          '*Confirmed:* replace with new amount',
          {},
        );
      }
      await onMoneyReplaceCallback(ctx, data === 'rp:yes');
      return;
    }
    if (data === 'em:yes' || data === 'em:no') {
      if (data === 'em:yes') {
        await tryEditMessageText(ctx, 'Will add in this cell', {});
      }
      await onMoneyEmptyPollCallback(ctx, data === 'em:yes');
      return;
    }
    if (data === 'r4:yes' || data === 'r4:no') {
      if (data === 'r4:yes') {
        await tryEditMessageText(ctx, 'Will write to sheet', {});
      }
      await onMoneyRow4Callback(ctx, data === 'r4:yes');
      return;
    }
  });
}
