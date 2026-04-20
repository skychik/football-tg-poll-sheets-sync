import type { Bot } from 'grammy';
import { replyErrorAndReset } from '../../bot-helpers';
import { ERR_SESSION_DATA_LOST } from '../../constants';
import {
  finalizeOverrideWrite,
  persistPlayerCountToSheetAndCheckOverrides,
} from '../../flows/update-write-actions';
import { CallbackPrefix } from '../../keyboards';
import type { MyContext, SessionData } from '../../session';
import { resetSession } from '../../session';
import { proceedWithMetadataCollection } from '../../workflow/metadata-flow';

function clearColumnScopedSessionFields(session: SessionData): void {
  session.dateName = undefined;
  session.cost = undefined;
  session.playerCount = undefined;
  session.column = undefined;
  session.nicknameRowsEntries = undefined;
  session.existingValuesEntries = undefined;
  session.columnMatches = undefined;
}

/**
 * Register callback_query handlers for sheet update workflow (column + yes/no).
 */
export function registerUpdateCallbackHandlers(bot: Bot<MyContext>): void {
  bot.callbackQuery(new RegExp(`^${CallbackPrefix.YES_NO}`), async (ctx) => {
    const data = ctx.callbackQuery.data.slice(CallbackPrefix.YES_NO.length);
    await ctx.answerCallbackQuery();

    if (data === 'playercount:yes') {
      await handlePlayerCountYes(ctx);
      return;
    }
    if (data === 'playercount:no') {
      ctx.session.state = 'awaiting_player_count';
      await ctx.editMessageText('How many players attended the match?');
      return;
    }

    if (data === 'override:yes') {
      await handleOverrideChoice(ctx, true);
      return;
    }
    if (data === 'override:no') {
      await handleOverrideChoice(ctx, false);
      return;
    }
  });

  bot.callbackQuery(new RegExp(`^${CallbackPrefix.COLUMN}`), async (ctx) => {
    const data = ctx.callbackQuery.data.slice(CallbackPrefix.COLUMN.length);
    await ctx.answerCallbackQuery();

    if (data.startsWith('use:')) {
      const column = data.slice(4);
      clearColumnScopedSessionFields(ctx.session);
      ctx.session.targetColumn = column;
      ctx.session.isNewColumn = false;
      await ctx.editMessageText(`✅ Using column ${column}`);
      await proceedWithMetadataCollection(ctx);
      return;
    }

    if (data.startsWith('new:')) {
      const column = data.slice(4);
      clearColumnScopedSessionFields(ctx.session);
      ctx.session.targetColumn = column;
      ctx.session.isNewColumn = true;
      ctx.session.state = 'awaiting_date_name';
      await ctx.editMessageText(
        `📅 Please provide the date name for column ${column} (row 1):`,
      );
      return;
    }

    if (data.startsWith('create:')) {
      const column = data.slice(7);
      clearColumnScopedSessionFields(ctx.session);
      ctx.session.targetColumn = column;
      ctx.session.isNewColumn = true;
      ctx.session.state = 'awaiting_date_name';
      await ctx.editMessageText(
        `📅 Please provide the date name for column ${column} (row 1):`,
      );
      return;
    }

    if (data === 'cancel') {
      resetSession(ctx.session);
      await ctx.editMessageText(
        '✅ Operation cancelled. Use /update to start again.',
      );
      return;
    }

    if (data.startsWith('select:')) {
      const column = data.slice(7);
      clearColumnScopedSessionFields(ctx.session);
      ctx.session.targetColumn = column;
      ctx.session.isNewColumn = false;
      await ctx.editMessageText(`✅ Selected column ${column}`);
      await proceedWithMetadataCollection(ctx);
      return;
    }
  });
}

async function handlePlayerCountYes(ctx: MyContext): Promise<void> {
  if (!ctx.session.targetColumn || !ctx.session.nicknameRowsEntries) {
    await replyErrorAndReset(ctx, ERR_SESSION_DATA_LOST);
    return;
  }

  const nicknameRows = new Map<string, number>(ctx.session.nicknameRowsEntries);
  const recognizedCount = nicknameRows.size;
  ctx.session.playerCount = recognizedCount;

  await ctx.editMessageText(`✅ Player count: ${recognizedCount}`);

  await persistPlayerCountToSheetAndCheckOverrides(ctx, nicknameRows);
}

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

  await ctx.editMessageText(
    overwrite
      ? '✅ Will overwrite existing values'
      : '⏭️ Will skip existing values',
  );

  await finalizeOverrideWrite(ctx, nicknameRows, overwrite);
}
