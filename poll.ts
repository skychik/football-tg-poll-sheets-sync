import type { Bot } from 'grammy';
import {
  getPollData as getStoredPollData,
  type StoredPollData,
  type StoredPollOption,
  savePollData,
} from './redis';
import type { MyContext } from './session';

const LEGACY_OPTION_ID_PREFIX = 'legacy:';
const GENERATED_OPTION_ID_PREFIX = 'generated:';

interface TelegramPollOption {
  text: string;
  persistent_id?: string;
}

interface TelegramPoll {
  id: string;
  question: string;
  options?: TelegramPollOption[];
}

interface TelegramPollAnswerUser {
  id: number;
  username?: string;
}

interface TelegramPollAnswer {
  poll_id: string;
  user?: TelegramPollAnswerUser;
  option_ids?: number[];
  option_persistent_ids?: string[];
}

export interface PollOptionData {
  id: string;
  text: string;
}

/**
 * Poll data storage for tracking votes
 */
export interface PollData {
  question: string;
  options: PollOptionData[];
  votes: Map<string, Set<string>>; // optionId -> Set of @usernames
}

function buildLegacyOptionId(index: number): string {
  return `${LEGACY_OPTION_ID_PREFIX}${index}`;
}

function isLegacyNumericVoteKey(key: string): boolean {
  return /^\d+$/.test(key);
}

function createGeneratedOptionId(index: number, text: string): string {
  return `${GENERATED_OPTION_ID_PREFIX}${index}:${encodeURIComponent(text)}`;
}

function deserializeOptions(
  options: StoredPollData['options'],
): PollOptionData[] {
  if (options.length === 0) {
    return [];
  }

  if (typeof options[0] === 'string') {
    return (options as string[]).map((text, index) => ({
      id: buildLegacyOptionId(index),
      text,
    }));
  }

  return (options as StoredPollOption[]).map((option, index) => ({
    id: option.id || createGeneratedOptionId(index, option.text),
    text: option.text,
  }));
}

function serializeVotes(
  votes: Map<string, Set<string>>,
): Record<string, string[]> {
  const serializedVotes: Record<string, string[]> = {};

  for (const [optionId, voters] of votes.entries()) {
    serializedVotes[optionId] = Array.from(voters);
  }

  return serializedVotes;
}

function deserializeVotes(
  options: StoredPollData['options'],
  serializedVotes: Record<string, string[]>,
): Map<string, Set<string>> {
  const votes = new Map<string, Set<string>>();
  const usesLegacyOptions =
    options.length > 0 && typeof options[0] === 'string';

  for (const [optionIndex, voters] of Object.entries(serializedVotes)) {
    const optionId =
      usesLegacyOptions && isLegacyNumericVoteKey(optionIndex)
        ? buildLegacyOptionId(Number(optionIndex))
        : optionIndex;
    votes.set(optionId, new Set(voters));
  }

  return votes;
}

function serializePollData(pollData: PollData): StoredPollData {
  return {
    question: pollData.question,
    options: pollData.options.map((option) => ({
      id: option.id,
      text: option.text,
    })),
    votes: serializeVotes(pollData.votes),
  };
}

async function persistPollData(
  pollId: string,
  pollData: PollData,
): Promise<void> {
  await savePollData(pollId, serializePollData(pollData));
}

function buildPollOptionsFromTelegram(
  telegramOptions: TelegramPollOption[] | undefined,
  fallbackOptions: string[],
): PollOptionData[] {
  if (!telegramOptions || telegramOptions.length === 0) {
    return fallbackOptions.map((text, index) => ({
      id: buildLegacyOptionId(index),
      text,
    }));
  }

  return telegramOptions.map((option, index) => ({
    id: option.persistent_id || createGeneratedOptionId(index, option.text),
    text: option.text,
  }));
}

function getSelectedOptionIds(
  pollData: PollData,
  pollAnswer: TelegramPollAnswer,
): string[] {
  if (
    pollAnswer.option_persistent_ids &&
    pollAnswer.option_persistent_ids.length > 0
  ) {
    return pollAnswer.option_persistent_ids.filter(
      (optionId) => optionId.length > 0,
    );
  }

  return (pollAnswer.option_ids || [])
    .map((optionIndex) => pollData.options[optionIndex]?.id)
    .filter((optionId): optionId is string => Boolean(optionId));
}

function getOptionText(pollData: PollData, optionId: string): string {
  return (
    pollData.options.find((option) => option.id === optionId)?.text || optionId
  );
}

function upsertOption(pollData: PollData, option: PollOptionData): void {
  const existingIndex = pollData.options.findIndex(
    (existingOption) => existingOption.id === option.id,
  );

  if (existingIndex === -1) {
    pollData.options.push(option);
    return;
  }

  pollData.options[existingIndex] = option;
}

async function syncPollDefinition(telegramPoll: TelegramPoll): Promise<void> {
  const pollData = await getPollById(telegramPoll.id);
  if (!pollData || !telegramPoll.options || telegramPoll.options.length === 0) {
    return;
  }

  const updatedOptions = buildPollOptionsFromTelegram(telegramPoll.options, []);
  const knownOptionIds = new Set(updatedOptions.map((option) => option.id));

  for (const option of pollData.options) {
    if (!knownOptionIds.has(option.id)) {
      updatedOptions.push(option);
    }
  }

  pollData.question = telegramPoll.question || pollData.question;
  pollData.options = updatedOptions;

  await persistPollData(telegramPoll.id, pollData);
}

export async function getPollById(pollId: string): Promise<PollData | null> {
  const storedPollData = await getStoredPollData(pollId);
  if (!storedPollData) {
    return null;
  }

  return {
    question: storedPollData.question,
    options: deserializeOptions(storedPollData.options),
    votes: deserializeVotes(storedPollData.options, storedPollData.votes),
  };
}

export function getPollOptionById(
  pollData: PollData,
  optionId: string,
): PollOptionData | undefined {
  return pollData.options.find((option) => option.id === optionId);
}

export function getPollOptionByNumber(
  pollData: PollData,
  optionNumber: number,
): PollOptionData | undefined {
  const optionIndex = optionNumber - 1;
  if (optionIndex < 0 || optionIndex >= pollData.options.length) {
    return undefined;
  }

  return pollData.options[optionIndex];
}

/**
 * Register poll command handler
 */
export function registerPollCommand(bot: Bot<MyContext>): void {
  /**
   * Poll command handler - create a trackable non-anonymous poll
   */
  bot.command('poll', async (ctx) => {
    const text = ctx.message?.text;
    if (!text) {
      await ctx.reply(
        '❌ Please provide poll question and options.\n\n' +
          'Usage: /poll Question? | Option1 | Option2 | Option3\n' +
          'Separators: | or ; or newlines',
      );
      return;
    }

    // Extract question and options (remove /poll command)
    const content = text.replace(/^\/poll\s+/i, '').trim();

    // Split by |, ;, or newlines
    const parts = content
      .split(/[|;\n]+/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);

    if (parts.length < 2) {
      await ctx.reply(
        '❌ Please provide at least a question and one option.\n\n' +
          'Usage: /poll Question? | Option1 | Option2\n' +
          'Separators: | or ; or newlines',
      );
      return;
    }

    const question = parts[0];
    const options = parts.slice(1);

    if (options.length < 1) {
      await ctx.reply('❌ Please provide at least one option.');
      return;
    }

    try {
      // Create non-anonymous poll
      const sendPoll = ctx.api.sendPoll as (
        ...args: unknown[]
      ) => Promise<{ poll?: TelegramPoll }>;
      const pollMessage = await sendPoll(ctx.chat.id, question, options, {
        is_anonymous: false,
        allows_multiple_answers: true,
        allow_adding_options: true,
      });

      // Store poll data
      const pollId = pollMessage.poll?.id;
      if (pollId) {
        await persistPollData(pollId, {
          question,
          options: buildPollOptionsFromTelegram(
            pollMessage.poll?.options,
            options,
          ),
          votes: new Map(),
        });
        console.log(
          `[POLL CREATED] Poll ID: ${pollId}, Question: "${question}", Options: ${options.join(', ')}, Chat ID: ${ctx.chat.id}, User: @${ctx.from?.username || 'unknown'}`,
        );
      }

      // In groups, delete the command message to keep chat clean
      const isGroup =
        ctx.chat.type === 'group' || ctx.chat.type === 'supergroup';
      if (isGroup) {
        try {
          await ctx.deleteMessage();
        } catch {
          // Bot might not have delete permission, ignore
        }
      } else {
        // In private chat, send confirmation
        await ctx.reply(
          '✅ Poll created! Forward it back to me to see voters or update the sheet.',
        );
      }
    } catch (error) {
      console.error('Error creating poll:', error);
      await ctx.reply(
        `❌ Error creating poll: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  });
}

export function registerPollUpdateHandler(bot: Bot<MyContext>): void {
  bot.use(async (ctx, next) => {
    const telegramPoll = (ctx.update as { poll?: TelegramPoll }).poll;
    if (telegramPoll) {
      await syncPollDefinition(telegramPoll);
      return;
    }

    await next();
  });
}

/**
 * Register poll answer handler
 */
export function registerPollAnswerHandler(bot: Bot<MyContext>): void {
  /**
   * Poll answer handler - track votes for non-anonymous polls
   */
  bot.on('poll_answer', async (ctx) => {
    console.log('[POLL ANSWER HANDLER] Received poll_answer event');

    const pollAnswer = ctx.pollAnswer as TelegramPollAnswer | undefined;
    console.log(
      '[POLL ANSWER HANDLER] pollAnswer:',
      JSON.stringify(pollAnswer, null, 2),
    );

    if (!pollAnswer) {
      console.log('[POLL ANSWER HANDLER] No pollAnswer found, exiting');
      return;
    }

    const pollId = pollAnswer.poll_id;
    console.log('[POLL ANSWER HANDLER] Poll ID:', pollId);

    const pollData = await getPollById(pollId);
    if (!pollData) {
      console.log(
        `[POLL ANSWER HANDLER] Poll ID ${pollId} not found in Redis, exiting`,
      );
      return; // Not our poll
    }

    console.log(`[POLL ANSWER HANDLER] Found poll data for ID ${pollId}:`, {
      question: pollData.question,
      options: pollData.options.map((option) => ({
        id: option.id,
        text: option.text,
      })),
      currentVotes: Array.from(pollData.votes.entries()).map(
        ([id, voters]) => ({
          optionId: id,
          optionText: getOptionText(pollData, id),
          voters: Array.from(voters),
        }),
      ),
    });

    // In poll_answer updates, user is in pollAnswer.user, not ctx.from
    const user = pollAnswer.user;
    console.log(
      '[POLL ANSWER HANDLER] User from pollAnswer:',
      user ? { id: user.id, username: user.username } : 'null',
    );

    if (!user) {
      console.log(
        '[POLL ANSWER HANDLER] No user found in pollAnswer.user, exiting',
      );
      return;
    }

    // Check if user has username property (not all user types have it)
    if (!('username' in user)) {
      console.log(
        '[POLL ANSWER HANDLER] User does not have username property, exiting',
      );
      return; // Can't track users without username
    }

    const username = (user as { username?: string }).username;
    console.log('[POLL ANSWER HANDLER] Username:', username);

    if (!username) {
      console.log('[POLL ANSWER HANDLER] Username is empty, exiting');
      return;
    }

    const usernameWithAt = `@${username}`;
    console.log('[POLL ANSWER HANDLER] Username with @:', usernameWithAt);

    // Remove user from all options first (in case they changed their vote)
    console.log(
      '[POLL ANSWER HANDLER] Removing user from all options before adding to new ones',
    );
    pollData.votes.forEach((voters, optionId: string) => {
      const hadUser = voters.has(usernameWithAt);
      voters.delete(usernameWithAt);
      if (hadUser) {
        console.log(
          `[POLL ANSWER HANDLER] Removed ${usernameWithAt} from option ${optionId} (${getOptionText(pollData, optionId)})`,
        );
      }
    });

    // Add user to selected options
    const selectedOptionIds = getSelectedOptionIds(pollData, pollAnswer);
    console.log('[POLL ANSWER HANDLER] Option IDs:', selectedOptionIds);
    if (selectedOptionIds.length > 0) {
      const selectedOptions = selectedOptionIds.map((optionId) =>
        getOptionText(pollData, optionId),
      );
      console.log(
        `[POLL ANSWER] Poll ID: ${pollId}, User: ${usernameWithAt}, Selected: ${selectedOptions.join(', ')}, Question: "${pollData.question}"`,
      );

      for (const optionId of selectedOptionIds) {
        if (!getPollOptionById(pollData, optionId)) {
          upsertOption(pollData, {
            id: optionId,
            text: `Added option (${optionId})`,
          });
        }

        if (!pollData.votes.has(optionId)) {
          pollData.votes.set(optionId, new Set());
          console.log(
            `[POLL ANSWER HANDLER] Created new vote set for option ${optionId} (${getOptionText(pollData, optionId)})`,
          );
        }
        pollData.votes.get(optionId)?.add(usernameWithAt);
        console.log(
          `[POLL ANSWER HANDLER] Added ${usernameWithAt} to option ${optionId} (${getOptionText(pollData, optionId)})`,
        );
      }

      // Log final state
      console.log(
        '[POLL ANSWER HANDLER] Final vote state:',
        Array.from(pollData.votes.entries()).map(([id, voters]) => ({
          optionId: id,
          optionText: getOptionText(pollData, id),
          voters: Array.from(voters),
        })),
      );
    } else {
      console.log(
        '[POLL ANSWER HANDLER] No option_ids provided, user removed from all options',
      );
    }

    await persistPollData(pollId, pollData);
  });
}
