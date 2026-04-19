import type { Bot } from 'grammy';
import { pollIntentKeyboard } from '../../keyboards';
import { getPollById } from '../../poll-domain';
import type { MyContext } from '../../session';
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
      await ctx.reply(
        'ℹ️ This poll was not created by me. I can only track polls created with /poll command.',
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

    await ctx.reply(
      `📊 Poll: "${pollData.question}"\n\n${optionsText}\n` +
        `What would you like to do?`,
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
      await ctx.reply(t, extra);
    });
    return true;
  }

  if (text === '2' || text === 'view voters' || text === 'view') {
    const result = await getPollDataOrError(ctx);
    if (!result) return true;

    const { pollData } = result;
    await resetSessionAfterPollView(ctx, pollData, (t) => ctx.reply(t));
    return true;
  }

  await ctx.reply(
    '❌ Please reply with "1" to update sheet or "2" to view voters.',
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
    await ctx.reply('❌ Please provide a valid option number.');
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
    (msg) => ctx.reply(msg),
  );
  return true;
}
