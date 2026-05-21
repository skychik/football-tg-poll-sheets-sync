import { ERR_SESSION_DATA_LOST } from './constants';
import {
  getPollById,
  getPollOptionById,
  type PollData,
  type PollOptionData,
} from './poll';
import { type MyContext, resetSession } from './session';

/**
 * Parse yes/no response from user text
 * Supports English (yes/y/no/n) and Russian (да/д/нет/н)
 * @returns 'yes' | 'no' | null (null if not recognized)
 */
export function parseYesNo(text: string): 'yes' | 'no' | null {
  const normalized = text.trim().toLowerCase();

  if (
    normalized === 'yes' ||
    normalized === 'y' ||
    normalized === 'да' ||
    normalized === 'д'
  ) {
    return 'yes';
  }

  if (
    normalized === 'no' ||
    normalized === 'n' ||
    normalized === 'нет' ||
    normalized === 'н'
  ) {
    return 'no';
  }

  return null;
}

/**
 * Reply with error message and reset session
 */
export async function replyErrorAndReset(
  ctx: MyContext,
  message: string,
): Promise<void> {
  await ctx.reply(message);
  resetSession(ctx.session);
}

/**
 * Require session fields to be present, reply with error if not
 * @returns true if all fields are present, false if error was sent
 */
export async function requireSessionFields(
  ctx: MyContext,
  fields: Array<keyof typeof ctx.session>,
  errorMessage: string = ERR_SESSION_DATA_LOST,
): Promise<boolean> {
  for (const field of fields) {
    const value = ctx.session[field];
    if (value === undefined || value === null) {
      await replyErrorAndReset(ctx, errorMessage);
      return false;
    }
    // Check for empty arrays
    if (Array.isArray(value) && value.length === 0) {
      await replyErrorAndReset(ctx, errorMessage);
      return false;
    }
  }
  return true;
}

/**
 * Build poll options text with vote counts
 */
export function buildPollOptionsText(pollData: PollData): string {
  let optionsText = '';
  pollData.options.forEach((option, index) => {
    const voters = pollData.votes.get(option.id) || new Set();
    optionsText += `${index + 1}. ${option.text} (${voters.size} vote${voters.size !== 1 ? 's' : ''})\n`;
  });
  return optionsText;
}

export function getPollOptionVoters(
  pollData: PollData,
  option: PollOptionData,
): Set<string> {
  return pollData.votes.get(option.id) || new Set();
}

export function buildPollVotersText(pollData: PollData): string {
  let response = `📊 Poll: "${pollData.question}"\n\n`;

  pollData.options.forEach((option, index) => {
    const normalizedOption = getPollOptionById(pollData, option.id) || option;
    const voters = getPollOptionVoters(pollData, normalizedOption);
    const voterList = Array.from(voters).join(' ');
    response += `${index + 1}. ${normalizedOption.text}: ${voterList || '(no votes)'}\n`;
  });

  return response;
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

  const pollData = await getPollById(pollId);
  if (!pollData) {
    await replyErrorAndReset(ctx, '❌ Error: poll data not found.');
    return null;
  }

  return { pollId, pollData };
}

/**
 * Build the final update result message
 */
export function buildUpdateResultMessage(
  column: string,
  updatedCount: number,
  updatedNicknames: string[],
  skippedNicknames: string[],
  notFoundNicknames: string[],
): string {
  let response = `✅ Updated ${updatedCount} record(s) in column ${column}`;

  if (updatedNicknames.length > 0) {
    response += `:\n\n`;
    response += updatedNicknames.map((n) => `• ${n}`).join('\n');
  } else {
    response += `.\n`;
  }

  if (skippedNicknames.length > 0) {
    response += `\n\n⏭️ Skipped ${skippedNicknames.length} cell(s) with existing values:\n`;
    response += skippedNicknames.map((n) => `• ${n}`).join('\n');
  }

  if (notFoundNicknames.length > 0) {
    response += `\n\n⚠️ Not found in sheet:\n`;
    response += notFoundNicknames.map((n) => `• ${n}`).join('\n');
  }

  return response;
}

/**
 * Handle API error with consistent formatting
 */
export async function handleApiError(
  ctx: MyContext,
  error: unknown,
  action: string,
  includeApiHint: boolean = true,
): Promise<void> {
  console.error(`Error ${action}:`, error);
  let message = `❌ Error ${action}: ${error instanceof Error ? error.message : 'Unknown error'}`;
  if (includeApiHint) {
    message += `\n\nCheck your Google Sheets API settings.`;
  }
  await replyErrorAndReset(ctx, message);
}
