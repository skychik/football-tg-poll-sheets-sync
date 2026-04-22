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

/**
 * Inline callbacks for /money (prefix `mn:`).
 */
export function registerMoneyCallbackHandlers(bot: Bot<MyContext>): void {
  bot.callbackQuery(new RegExp(`^${CallbackPrefix.MONEY}`), async (ctx) => {
    const data = ctx.callbackQuery.data.slice(CallbackPrefix.MONEY.length);
    await ctx.answerCallbackQuery();

    if (data === 'col:last') {
      await ctx.editMessageText('✅ Using last date column');
      await onMoneyCallbackColumnLast(ctx);
      return;
    }
    if (data === 'col:next') {
      await ctx.editMessageText('✅ Using next column');
      await onMoneyCallbackColumnNext(ctx);
      return;
    }
    if (data === 'rp:yes' || data === 'rp:no') {
      if (data === 'rp:yes') {
        await ctx.editMessageText('✅ Confirmed: replace with new amount', {});
      } else {
        await ctx.editMessageText('❌ Cancelled', {});
      }
      await onMoneyReplaceCallback(ctx, data === 'rp:yes');
      return;
    }
    if (data === 'em:yes' || data === 'em:no') {
      if (data === 'em:yes') {
        await ctx.editMessageText('✅ Will add in this cell', {});
      } else {
        await ctx.editMessageText('❌ Cancelled', {});
      }
      await onMoneyEmptyPollCallback(ctx, data === 'em:yes');
      return;
    }
    if (data === 'r4:yes' || data === 'r4:no') {
      if (data === 'r4:yes') {
        await ctx.editMessageText('✅ Will write to sheet', {});
      } else {
        await ctx.editMessageText('❌ Cancelled', {});
      }
      await onMoneyRow4Callback(ctx, data === 'r4:yes');
      return;
    }
  });
}
