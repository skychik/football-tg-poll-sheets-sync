import type { Bot } from 'grammy';
import {
  buildPollOptionsText,
  buildPollVotersText,
  getPollDataOrError,
  replyErrorAndReset,
} from '../bot-helpers';
import { pollIntentKeyboard, pollOptionKeyboard } from '../keyboards';
import { getPollById, getPollOptionByNumber } from '../poll';
import type { MyContext } from '../session';
import { resetSession } from '../session';
import { startColumnDetectionFlow } from '../workflow';

/**
 * Register forwarded poll message handler
 */
export function registerPollMessageHandler(bot: Bot<MyContext>): void {
  bot.on('message:poll', async (ctx) => {
    const message = ctx.message;
    if (!message.poll) return;

    const pollId = message.poll.id;
    const pollData = await getPollById(pollId);

    if (!pollData) {
      await ctx.reply(
        'ℹ️ This poll was not created by me. I can only track polls created with /poll command.',
      );
      return;
    }

    // Check if this is a forwarded message
    if (!message.forward_origin) {
      return;
    }

    // Store poll info in session
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
 * Handle awaiting_poll_intent state
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
    ctx.session.state = 'awaiting_poll_option_selection';

    const optionsText = buildPollOptionsText(pollData);

    await ctx.reply(
      `Which option contains the attending players?\n\n${optionsText}`,
      { reply_markup: pollOptionKeyboard(pollData) },
    );
    return true;
  }

  if (text === '2' || text === 'view voters' || text === 'view') {
    const result = await getPollDataOrError(ctx);
    if (!result) return true;

    const { pollData } = result;
    await ctx.reply(buildPollVotersText(pollData));
    resetSession(ctx.session);
    return true;
  }

  await ctx.reply(
    '❌ Please reply with "1" to update sheet or "2" to view voters.',
  );
  return true;
}

/**
 * Handle awaiting_poll_option_selection state
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
  const selectedOption = getPollOptionByNumber(pollData, optionNum);
  if (!selectedOption) {
    await ctx.reply(
      `❌ Invalid option number. Please choose between 1 and ${pollData.options.length}.`,
    );
    return true;
  }

  // Extract usernames from selected option
  const voters = pollData.votes.get(selectedOption.id) || new Set();
  const usernames = Array.from(voters);

  if (usernames.length === 0) {
    await replyErrorAndReset(ctx, '❌ No voters found for this option.');
    return true;
  }

  // Store usernames and start main workflow
  ctx.session.usernames = usernames;
  ctx.session.pollId = undefined;
  ctx.session.pollQuestion = undefined;

  await ctx.reply(
    `✅ Selected option: "${selectedOption.text}"\n` +
      `👥 Attending players: ${usernames.join(' ')}`,
  );

  // Start column detection flow
  await startColumnDetectionFlow(ctx);
  return true;
}
