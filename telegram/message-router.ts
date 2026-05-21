import type { Bot } from 'grammy';
import {
  handleColumnConfirmation,
  handleColumnSelection,
  handleCost,
  handleDateName,
  handleNewColumnChoice,
} from '../flows/column-handlers';
import {
  handleAwaitingMoneyAmount,
  tryHandleBareMoneyNumber,
  tryHandleMoneyBlockedPlainText,
} from '../flows/money-flow';
import {
  handleNewAttendeeInput,
  handlePollAttendanceCount,
  handlePollMissingQuery,
  handlePollNoShowReviewText,
} from '../flows/poll-reconciliation';
import { handleAwaitingRegisterName } from '../flows/register-user';
import {
  handleOverrideConfirmation,
  handlePlayerCount,
  handlePlayerCountConfirmation,
  handleUsernames,
} from '../flows/sheet-handlers';
import type { MyContext } from '../session';
import { replyMarkdownV2 } from './markdown-v2';
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
    if (await handlePollAttendanceCount(ctx, rawText)) return;
    if (await handlePollNoShowReviewText(ctx)) return;
    if (await handlePollMissingQuery(ctx, rawText)) return;
    if (await handleNewAttendeeInput(ctx, rawText)) return;

    if (ctx.chat.type !== 'private') return;

    if (await tryHandleMoneyBlockedPlainText(ctx)) return;
    if (await handleAwaitingRegisterName(ctx, rawText)) return;
    if (await handleAwaitingMoneyAmount(ctx, rawText)) return;
    if (await tryHandleBareMoneyNumber(ctx, rawText)) return;

    if (await handleColumnConfirmation(ctx, text)) return;
    if (await handleColumnSelection(ctx, rawText)) return;
    if (await handleNewColumnChoice(ctx, text)) return;
    if (await handleDateName(ctx, rawText)) return;
    if (await handleCost(ctx, text)) return;

    if (await handleUsernames(ctx, rawText)) return;
    if (await handlePlayerCountConfirmation(ctx, text)) return;
    if (await handlePlayerCount(ctx, text)) return;
    if (await handleOverrideConfirmation(ctx, text)) return;

    await replyMarkdownV2(ctx, '👋 Use */help* to see what I can do\\.');
  });
}
