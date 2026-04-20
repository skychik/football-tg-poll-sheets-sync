import type { Bot } from 'grammy';
import { getPollById, serializePollVotes } from '../../poll-domain';
import type { PollStorage } from '../../poll-storage/poll-storage-types';
import type { MyContext } from '../../session';

/**
 * Register `poll_answer` updates for polls tracked in storage.
 */
export function registerPollAnswerHandler(
  bot: Bot<MyContext>,
  pollStorage: PollStorage,
): void {
  bot.on('poll_answer', async (ctx) => {
    console.log('[POLL ANSWER HANDLER] Received poll_answer event');

    const pollAnswer = ctx.pollAnswer;
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

    const pollData = await getPollById(pollId, pollStorage);
    if (!pollData) {
      console.log(
        `[POLL ANSWER HANDLER] Poll ID ${pollId} not found in Redis, exiting`,
      );
      return;
    }

    console.log(`[POLL ANSWER HANDLER] Found poll data for ID ${pollId}:`, {
      question: pollData.question,
      options: pollData.options,
      currentVotes: Array.from(pollData.votes.entries()).map(
        ([id, voters]) => ({
          optionId: id,
          optionText: pollData.options[id],
          voters: Array.from(voters),
        }),
      ),
    });

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

    const username = user.username;
    console.log('[POLL ANSWER HANDLER] Username:', username);

    if (!username) {
      console.log(
        '[POLL ANSWER HANDLER] Username is undefined or empty, exiting',
      );
      return;
    }

    const usernameWithAt = `@${username}`;
    console.log('[POLL ANSWER HANDLER] Username with @:', usernameWithAt);

    console.log(
      '[POLL ANSWER HANDLER] Removing user from all options before adding to new ones',
    );
    pollData.votes.forEach((voters, optionId) => {
      const hadUser = voters.has(usernameWithAt);
      voters.delete(usernameWithAt);
      if (hadUser) {
        console.log(
          `[POLL ANSWER HANDLER] Removed ${usernameWithAt} from option ${optionId} (${pollData.options[optionId]})`,
        );
      }
    });

    console.log('[POLL ANSWER HANDLER] Option IDs:', pollAnswer.option_ids);
    if (pollAnswer.option_ids && pollAnswer.option_ids.length > 0) {
      const selectedOptions = pollAnswer.option_ids.map(
        (id) => pollData.options[id] || `Option ${id}`,
      );
      console.log(
        `[POLL ANSWER] Poll ID: ${pollId}, User: ${usernameWithAt}, Selected: ${selectedOptions.join(', ')}, Question: "${pollData.question}"`,
      );

      for (const optionId of pollAnswer.option_ids) {
        if (!pollData.votes.has(optionId)) {
          pollData.votes.set(optionId, new Set());
          console.log(
            `[POLL ANSWER HANDLER] Created new vote set for option ${optionId} (${pollData.options[optionId]})`,
          );
        }
        pollData.votes.get(optionId)?.add(usernameWithAt);
        console.log(
          `[POLL ANSWER HANDLER] Added ${usernameWithAt} to option ${optionId} (${pollData.options[optionId]})`,
        );
      }

      console.log(
        '[POLL ANSWER HANDLER] Final vote state:',
        Array.from(pollData.votes.entries()).map(([id, voters]) => ({
          optionId: id,
          optionText: pollData.options[id],
          voters: Array.from(voters),
        })),
      );
    } else {
      console.log(
        '[POLL ANSWER HANDLER] No option_ids provided, user removed from all options',
      );
    }

    await pollStorage.updatePollVotes(
      pollId,
      serializePollVotes(pollData.votes),
    );
  });
}
