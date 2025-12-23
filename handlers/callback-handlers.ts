import type { Bot } from 'grammy';
import {
  buildPollOptionsText,
  getPollDataOrError,
  handleApiError,
  replyErrorAndReset,
} from '../bot-helpers';
import { ERR_SESSION_DATA_LOST } from '../constants';
import { CallbackPrefix, pollOptionKeyboard } from '../keyboards';
import type { MyContext } from '../session';
import { resetSession } from '../session';
import { initSheetsClient } from '../sheets';
import {
  checkOverridesAndWrite,
  proceedWithMetadataCollection,
  startColumnDetectionFlow,
  writeZerosAndRespond,
} from '../workflow';

/**
 * Register all callback query handlers
 */
export function registerCallbackHandlers(bot: Bot<MyContext>): void {
  // Yes/No callback handler
  bot.callbackQuery(new RegExp(`^${CallbackPrefix.YES_NO}`), async (ctx) => {
    const data = ctx.callbackQuery.data.slice(CallbackPrefix.YES_NO.length);
    await ctx.answerCallbackQuery();

    // Player count confirmation
    if (data === 'playercount:yes') {
      await handlePlayerCountYes(ctx);
      return;
    }
    if (data === 'playercount:no') {
      ctx.session.state = 'awaiting_player_count';
      await ctx.editMessageText('How many players attended the match?');
      return;
    }

    // Override confirmation
    if (data === 'override:yes') {
      await handleOverrideChoice(ctx, true);
      return;
    }
    if (data === 'override:no') {
      await handleOverrideChoice(ctx, false);
      return;
    }
  });

  // Column callback handler
  bot.callbackQuery(new RegExp(`^${CallbackPrefix.COLUMN}`), async (ctx) => {
    const data = ctx.callbackQuery.data.slice(CallbackPrefix.COLUMN.length);
    await ctx.answerCallbackQuery();

    // Use detected column
    if (data.startsWith('use:')) {
      const column = data.slice(4);
      ctx.session.targetColumn = column;
      ctx.session.isNewColumn = false;
      await ctx.editMessageText(`✅ Using column ${column}`);
      await proceedWithMetadataCollection(ctx);
      return;
    }

    // Create new column (after detection)
    if (data.startsWith('new:')) {
      const column = data.slice(4);
      ctx.session.targetColumn = column;
      ctx.session.isNewColumn = true;
      ctx.session.state = 'awaiting_date_name';
      await ctx.editMessageText(
        `📅 Please provide the date name for column ${column} (row 1):`,
      );
      return;
    }

    // Create first column (no existing columns)
    if (data.startsWith('create:')) {
      const column = data.slice(7);
      ctx.session.targetColumn = column;
      ctx.session.isNewColumn = true;
      ctx.session.state = 'awaiting_date_name';
      await ctx.editMessageText(
        `📅 Please provide the date name for column ${column} (row 1):`,
      );
      return;
    }

    // Cancel operation
    if (data === 'cancel') {
      resetSession(ctx.session);
      await ctx.editMessageText(
        '✅ Operation cancelled. Use /update to start again.',
      );
      return;
    }

    // Select from multiple matches
    if (data.startsWith('select:')) {
      const column = data.slice(7);
      ctx.session.targetColumn = column;
      ctx.session.isNewColumn = false;
      ctx.session.columnMatches = undefined;
      await ctx.editMessageText(`✅ Selected column ${column}`);
      await proceedWithMetadataCollection(ctx);
      return;
    }
  });

  // Poll intent callback handler
  bot.callbackQuery(
    new RegExp(`^${CallbackPrefix.POLL_INTENT}`),
    async (ctx) => {
      const data = ctx.callbackQuery.data.slice(
        CallbackPrefix.POLL_INTENT.length,
      );
      await ctx.answerCallbackQuery();

      if (data === 'update') {
        const result = await getPollDataOrError(ctx);
        if (!result) return;

        const { pollData } = result;
        ctx.session.state = 'awaiting_poll_option_selection';

        const optionsText = buildPollOptionsText(pollData);
        await ctx.editMessageText(
          `Which option contains the attending players?\n\n${optionsText}`,
          {
            reply_markup: pollOptionKeyboard(pollData.options, pollData.votes),
          },
        );
        return;
      }

      if (data === 'view') {
        const result = await getPollDataOrError(ctx);
        if (!result) return;

        const { pollData } = result;

        let response = `📊 Poll: "${pollData.question}"\n\n`;
        pollData.options.forEach((option, index) => {
          const voters = pollData.votes.get(index) || new Set();
          const voterList = Array.from(voters).join(' ');
          response += `${index + 1}. ${option}: ${voterList || '(no votes)'}\n`;
        });

        await ctx.editMessageText(response);
        resetSession(ctx.session);
        return;
      }
    },
  );

  // Poll option callback handler
  bot.callbackQuery(
    new RegExp(`^${CallbackPrefix.POLL_OPTION}`),
    async (ctx) => {
      const data = ctx.callbackQuery.data.slice(
        CallbackPrefix.POLL_OPTION.length,
      );
      const optionIndex = parseInt(data, 10);
      await ctx.answerCallbackQuery();

      if (Number.isNaN(optionIndex)) {
        await ctx.editMessageText('❌ Invalid option.');
        return;
      }

      const result = await getPollDataOrError(ctx);
      if (!result) return;

      const { pollData } = result;

      if (optionIndex < 0 || optionIndex >= pollData.options.length) {
        await ctx.editMessageText(
          `❌ Invalid option number. Please choose between 1 and ${pollData.options.length}.`,
        );
        return;
      }

      // Extract usernames from selected option
      const voters = pollData.votes.get(optionIndex) || new Set();
      const usernames = Array.from(voters);

      if (usernames.length === 0) {
        await replyErrorAndReset(ctx, '❌ No voters found for this option.');
        return;
      }

      // Store usernames and start main workflow
      ctx.session.usernames = usernames;
      ctx.session.pollId = undefined;
      ctx.session.pollQuestion = undefined;

      await ctx.editMessageText(
        `✅ Selected option: "${pollData.options[optionIndex]}"\n` +
          `👥 Attending players: ${usernames.join(' ')}`,
      );

      // Start column detection flow
      await startColumnDetectionFlow(ctx);
    },
  );
}

/**
 * Handle player count confirmation YES
 */
async function handlePlayerCountYes(ctx: MyContext): Promise<void> {
  if (!ctx.session.targetColumn || !ctx.session.nicknameRowsEntries) {
    await replyErrorAndReset(ctx, ERR_SESSION_DATA_LOST);
    return;
  }

  const nicknameRows = new Map<string, number>(ctx.session.nicknameRowsEntries);
  const recognizedCount = nicknameRows.size;
  ctx.session.playerCount = recognizedCount;

  await ctx.editMessageText(`✅ Player count: ${recognizedCount}`);

  try {
    const sheetsClient = await initSheetsClient();
    await sheetsClient.writeColumnMetadata(
      ctx.session.targetColumn,
      undefined,
      undefined,
      ctx.session.playerCount,
    );

    // Check for existing values and handle override
    await checkOverridesAndWrite(ctx, nicknameRows);
  } catch (error) {
    await handleApiError(
      ctx,
      error,
      'writing player count or checking overrides',
      false,
    );
  }
}

/**
 * Handle override choice (yes = overwrite, no = skip)
 */
async function handleOverrideChoice(
  ctx: MyContext,
  overwrite: boolean,
): Promise<void> {
  const columnToUse = ctx.session.column || ctx.session.targetColumn;
  if (!columnToUse || !ctx.session.nicknameRowsEntries) {
    await replyErrorAndReset(
      ctx,
      '❌ Error: session data lost. Start over with /update',
    );
    return;
  }

  const nicknameRows = new Map<string, number>(ctx.session.nicknameRowsEntries);

  const skippedNicknames: string[] =
    !overwrite && ctx.session.existingValuesEntries
      ? ctx.session.existingValuesEntries.map((ev) => ev.nickname)
      : [];

  await ctx.editMessageText(
    overwrite
      ? '✅ Will overwrite existing values'
      : '⏭️ Will skip existing values',
  );

  try {
    await writeZerosAndRespond(
      ctx,
      nicknameRows,
      columnToUse,
      overwrite,
      skippedNicknames,
    );
  } catch (error) {
    await handleApiError(ctx, error, 'updating sheet');
  }
}
