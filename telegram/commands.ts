import type { Bot } from 'grammy';
import { MSG_USE_UPDATE_AGAIN } from '../constants';
import type { PollStorage } from '../poll-storage/poll-storage-types';
import type { MyContext } from '../session';
import { resetSession } from '../session';
import { startColumnDetectionFlow } from '../workflow/column-detection';

const POLL_USAGE_REPLY =
  '❌ Please provide poll question and options.\n\n' +
  'Usage: /poll Question? | Option1 | Option2 | Option3\n' +
  'Separators: | or ; or newlines';

/**
 * Register all slash command handlers (including `/poll`).
 */
export function registerCommands(
  bot: Bot<MyContext>,
  pollStorage: PollStorage,
): void {
  bot.command('start', async (ctx) => {
    await ctx.reply(
      `👋 Welcome to Football Poll Sheets Sync Bot!\n\n` +
        `📖 Commands:\n` +
        `• /poll - Create a trackable poll\n` +
        `• /update - Update Google Sheet with attending players\n` +
        `• /help - Show this help\n` +
        `• /cancel or /abort - Cancel current operation\n\n` +
        `💡 Tip: Forward a poll created by this bot to see voters or update the sheet!`,
    );
  });

  bot.command('help', async (ctx) => {
    await ctx.reply(
      `📖 Help:\n\n` +
        `• /poll - Create a trackable poll\n` +
        `• /update - Update Google Sheet with attending players\n` +
        `• /help - Show this help\n` +
        `• /cancel or /abort - Cancel current operation\n\n` +
        `The bot will guide you through updating a column step by step.`,
    );
  });

  bot.command('update', async (ctx) => {
    resetSession(ctx.session);
    await startColumnDetectionFlow(ctx);
  });

  bot.command('cancel', async (ctx) => {
    resetSession(ctx.session);
    await ctx.reply(`✅ Operation cancelled. ${MSG_USE_UPDATE_AGAIN}`);
  });

  bot.command('abort', async (ctx) => {
    resetSession(ctx.session);
    await ctx.reply(`✅ Operation aborted. ${MSG_USE_UPDATE_AGAIN}`);
  });

  bot.command('poll', async (ctx) => {
    const text = ctx.message?.text;
    if (!text) {
      await ctx.reply(POLL_USAGE_REPLY);
      return;
    }

    const content = text.replace(/^\/poll(?:@\w+)?\b/i, '').trim();
    if (content === '') {
      await ctx.reply(POLL_USAGE_REPLY);
      return;
    }

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

    try {
      const pollMessage = await ctx.api.sendPoll(
        ctx.chat.id,
        question,
        options,
        {
          is_anonymous: false,
          allows_multiple_answers: true,
        },
      );

      const pollId = pollMessage.poll?.id;
      if (pollId) {
        await pollStorage.savePollData(pollId, {
          question,
          options,
          votes: {},
        });
        console.log(
          `[POLL CREATED] Poll ID: ${pollId}, Question: "${question}", Options: ${options.join(', ')}, Chat ID: ${ctx.chat.id}, User: @${ctx.from?.username || 'unknown'}`,
        );
      }

      const isGroup =
        ctx.chat.type === 'group' || ctx.chat.type === 'supergroup';
      if (isGroup) {
        try {
          await ctx.deleteMessage();
        } catch {
          // Bot might not have delete permission, ignore
        }
      } else {
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
