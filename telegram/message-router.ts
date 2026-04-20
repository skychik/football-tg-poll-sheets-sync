import type { Bot } from 'grammy';
import {
  handleColumnConfirmation,
  handleColumnSelection,
  handleCost,
  handleDateName,
  handleNewColumnChoice,
} from '../flows/column-handlers';
import {
  handleOverrideConfirmation,
  handlePlayerCount,
  handlePlayerCountConfirmation,
  handleUsernames,
} from '../flows/sheet-handlers';
import type { MyContext } from '../session';
import {
  handlePollIntent,
  handlePollOptionSelection,
  registerForwardedPollMessageHandler,
} from './poll/forwarded-poll-router';

/**
 * Register message handlers: forwarded polls and text state routing.
 */
export function registerMessageRouter(bot: Bot<MyContext>): void {
  registerForwardedPollMessageHandler(bot);

  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text.trim().toLowerCase();
    const rawText = ctx.message.text.trim();

    if (await handlePollIntent(ctx, text)) return;
    if (await handlePollOptionSelection(ctx, rawText)) return;

    if (ctx.chat.type !== 'private') return;

    if (await handleColumnConfirmation(ctx, text)) return;
    if (await handleColumnSelection(ctx, rawText)) return;
    if (await handleNewColumnChoice(ctx, text)) return;
    if (await handleDateName(ctx, rawText)) return;
    if (await handleCost(ctx, text)) return;

    if (await handleUsernames(ctx, rawText)) return;
    if (await handlePlayerCountConfirmation(ctx, text)) return;
    if (await handlePlayerCount(ctx, text)) return;
    if (await handleOverrideConfirmation(ctx, text)) return;

    await ctx.reply('👋 Use /start to begin updating a column.');
  });
}
