import type { InlineKeyboard } from 'grammy';
import { replyErrorAndReset } from '../../bot-helpers';
import { pollOptionKeyboard } from '../../keyboards';
import { getPollById, type PollData } from '../../poll-domain';
import type { MyContext } from '../../session';
import { resetSession } from '../../session';
import { startColumnDetectionFlow } from '../../workflow/column-detection';

/**
 * Build poll options text with vote counts
 */
export function buildPollOptionsText(pollData: PollData): string {
  let optionsText = '';
  pollData.options.forEach((option, index) => {
    const voters = pollData.votes.get(index) || new Set();
    optionsText += `${index + 1}. ${option} (${voters.size} vote${voters.size !== 1 ? 's' : ''})\n`;
  });
  return optionsText;
}

/**
 * Get poll data from session or reply with error
 * @returns PollData if found, null if error was sent
 */
export async function getPollDataOrError(
  ctx: MyContext,
): Promise<{ pollId: string; pollData: PollData } | null> {
  const pollId = ctx.session.pollId;

  if (!pollId) {
    await replyErrorAndReset(
      ctx,
      '❌ Error: poll data lost. Please forward the poll again.',
    );
    return null;
  }

  const pollData = await getPollById(pollId, ctx.services.pollStorage);
  if (!pollData) {
    await replyErrorAndReset(ctx, '❌ Error: poll data not found.');
    return null;
  }

  return { pollId, pollData };
}

const OPTION_PROMPT_INTRO = 'Which option contains the attending players?\n\n';

function messageForPollOptionPrompt(pollData: PollData): string {
  return OPTION_PROMPT_INTRO + buildPollOptionsText(pollData);
}

function formatPollVotersListing(pollData: PollData): string {
  let response = `📊 Poll: "${pollData.question}"\n\n`;
  pollData.options.forEach((option, index) => {
    const voters = pollData.votes.get(index) || new Set();
    const voterList = Array.from(voters).join(' ');
    response += `${index + 1}. ${option}: ${voterList || '(no votes)'}\n`;
  });
  return response;
}

export async function enterPollOptionSelection(
  ctx: MyContext,
  pollData: PollData,
  deliver: (
    text: string,
    extra: { reply_markup: InlineKeyboard },
  ) => Promise<unknown>,
): Promise<void> {
  ctx.session.state = 'awaiting_poll_option_selection';
  const text = messageForPollOptionPrompt(pollData);
  await deliver(text, {
    reply_markup: pollOptionKeyboard(pollData.options, pollData.votes),
  });
}

/**
 * Apply a 0-based poll option index: set usernames, clear poll session fields,
 * notify the user, then start column detection. Returns false if validation failed (caller already notified).
 */
export async function applyPollOptionSelectionAndStartUpdate(
  ctx: MyContext,
  pollData: PollData,
  optionIndex: number,
  notify: (text: string) => Promise<unknown>,
): Promise<boolean> {
  if (optionIndex < 0 || optionIndex >= pollData.options.length) {
    await notify(
      `❌ Invalid option number. Please choose between 1 and ${pollData.options.length}.`,
    );
    return false;
  }

  const voters = pollData.votes.get(optionIndex) || new Set();
  const usernames = Array.from(voters);

  if (usernames.length === 0) {
    await replyErrorAndReset(ctx, '❌ No voters found for this option.');
    return false;
  }

  ctx.session.usernames = usernames;
  ctx.session.pollId = undefined;
  ctx.session.pollQuestion = undefined;

  await notify(
    `✅ Selected option: "${pollData.options[optionIndex]}"\n` +
      `👥 Attending players: ${usernames.join(' ')}`,
  );

  await startColumnDetectionFlow(ctx);
  return true;
}

export async function resetSessionAfterPollView(
  ctx: MyContext,
  pollData: PollData,
  deliver: (text: string) => Promise<unknown>,
): Promise<void> {
  await deliver(formatPollVotersListing(pollData));
  resetSession(ctx.session);
}
