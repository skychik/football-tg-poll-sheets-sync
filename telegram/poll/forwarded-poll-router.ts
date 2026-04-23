import type { Bot } from 'grammy';
import { pollIntentKeyboard } from '../../keyboards';
import { getPollById } from '../../poll-domain';
import type { MyContext } from '../../session';
import { escapeMarkdownV2, replyMarkdownV2 } from '../markdown-v2';
import {
  applyPollOptionSelectionAndStartUpdate,
  buildPollOptionsText,
  enterPollOptionSelection,
  getPollDataOrError,
  resetSessionAfterPollView,
} from './selection-flow';

/**
 * Register forwarded poll message handler (`message:poll`).
 */
export function registerForwardedPollMessageHandler(bot: Bot<MyContext>): void {
  bot.on('message:poll', async (ctx) => {
    const message = ctx.message;
    if (!message.poll) return;

    const pollId = message.poll.id;
    const pollData = await getPollById(pollId, ctx.services.pollStorage);

    if (!pollData) {
      await replyMarkdownV2(
        ctx,
        'ℹ️ This poll was *not created by me*\\. I only track polls created with */poll*\\.',
      );
      return;
    }

    if (!message.forward_origin) {
      return;
    }

    ctx.session.pollId = pollId;
    ctx.session.pollQuestion = pollData.question;
    ctx.session.state = 'awaiting_poll_intent';

    const optionsText = buildPollOptionsText(pollData);
    const qEsc = escapeMarkdownV2(pollData.question);

    await replyMarkdownV2(
      ctx,
      `📊 *Poll:* _${qEsc}_\n\n${optionsText}\n` +
        `*What would you like to do?*`,
      { reply_markup: pollIntentKeyboard() },
    );
  });
}

/**
 * Handle `awaiting_poll_intent` state (text replies).
 */
export async function handlePollIntent(
  ctx: MyContext,
  text: string,
): Promise<boolean> {
  if (ctx.session.state !== 'awaiting_poll_intent') {
    return false;
  }

  if (text === '1' || text === 'update sheet' || text === 'update') {
    const result = await getPollDataOrError(ctx);
    if (!result) return true;

    const { pollData } = result;
    await enterPollOptionSelection(ctx, pollData, async (t, extra) => {
      await ctx.reply(t, { ...extra, parse_mode: 'MarkdownV2' });
    });
    return true;
  }

  if (text === '2' || text === 'view voters' || text === 'view') {
    const result = await getPollDataOrError(ctx);
    if (!result) return true;

    const { pollData } = result;
    await resetSessionAfterPollView(ctx, pollData, (t) =>
      replyMarkdownV2(ctx, t),
    );
    return true;
  }

  await replyMarkdownV2(
    ctx,
    '❌ Please reply with *1* to *update sheet* or *2* to *view voters*\\.',
  );
  return true;
}

/**
 * Handle `awaiting_poll_option_selection` state (text replies).
 */
export async function handlePollOptionSelection(
  ctx: MyContext,
  rawText: string,
): Promise<boolean> {
  if (ctx.session.state !== 'awaiting_poll_option_selection') {
    return false;
  }

  const optionNum = parseInt(rawText, 10);

  if (Number.isNaN(optionNum) || optionNum < 1) {
    await replyMarkdownV2(ctx, '❌ Please provide a *valid option number*\\.');
    return true;
  }

  const result = await getPollDataOrError(ctx);
  if (!result) return true;

  const { pollData } = result;

  const optionIndex = optionNum - 1;
  await applyPollOptionSelectionAndStartUpdate(
    ctx,
    pollData,
    optionIndex,
    (msg) => replyMarkdownV2(ctx, msg),
  );
  return true;
}
