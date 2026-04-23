import { buildUpdateResultMessage, replyErrorAndReset } from '../bot-helpers';
import { ERR_TARGET_COLUMN_NOT_SET } from '../constants';
import { overrideConfirmationKeyboard } from '../keyboards';
import type { MyContext } from '../session';
import { resetSession } from '../session';
import { escapeMarkdownV2, replyMarkdownV2 } from '../telegram/markdown-v2';

function briefErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

async function notifySheetUpdateFailure(
  ctx: MyContext,
  error: unknown,
  logLabel: string,
): Promise<void> {
  console.error(`[${logLabel}]`, error);
  resetSession(ctx.session);
  await replyMarkdownV2(
    ctx,
    `❌ *Failed to update sheet:* ${escapeMarkdownV2(briefErrorMessage(error))}`,
  );
}

/**
 * Check for existing values and either write directly or ask for override confirmation
 * Shared logic between player count confirmation and direct write flows
 */
export async function checkOverridesAndWrite(
  ctx: MyContext,
  nicknameRows: Map<string, number>,
): Promise<void> {
  const column = ctx.session.targetColumn;
  if (!column) {
    await replyErrorAndReset(ctx, ERR_TARGET_COLUMN_NOT_SET);
    return;
  }

  try {
    const sheetsClient = await ctx.services.createSheetsClient();

    const existingValues = await sheetsClient.checkExistingValues(
      nicknameRows,
      column,
    );

    if (existingValues.length > 0) {
      ctx.session.column = column;
      ctx.session.nicknameRowsEntries = Array.from(nicknameRows.entries());
      ctx.session.existingValuesEntries = existingValues;
      ctx.session.state = 'awaiting_override_confirmation';

      const colEsc = escapeMarkdownV2(column);
      let message = `⚠️ These users already have values in column *${colEsc}*:\n\n`;
      existingValues.forEach((ev) => {
        message += `• ${escapeMarkdownV2(ev.nickname)}: ${escapeMarkdownV2(String(ev.value))}\n`;
      });
      message += `\n*What would you like to do?*`;

      await replyMarkdownV2(ctx, message, {
        reply_markup: overrideConfirmationKeyboard(),
      });
    } else {
      await writeZerosAndRespond(ctx, nicknameRows, column, true, []);
    }
  } catch (error) {
    await notifySheetUpdateFailure(ctx, error, 'checkOverridesAndWrite');
  }
}

/**
 * Write zeros to sheet and send response message
 * Common logic for final write step
 */
export async function writeZerosAndRespond(
  ctx: MyContext,
  nicknameRows: Map<string, number>,
  column: string,
  overrideExisting: boolean,
  skippedNicknames: string[],
): Promise<void> {
  await replyMarkdownV2(ctx, '⏳ *Updating sheet*\\.\\.\\.');

  try {
    const sheetsClient = await ctx.services.createSheetsClient();

    console.log(
      `[SHEET UPDATE] Column: ${column}, Users: ${Array.from(nicknameRows.keys()).join(', ')}, Override: ${overrideExisting}, Skipped: ${skippedNicknames.join(', ') || 'none'}, Chat ID: ${ctx.chat?.id || 'unknown'}, User: @${ctx.from?.username || 'unknown'}`,
    );

    const result = await sheetsClient.writeZeros(
      nicknameRows,
      column,
      overrideExisting,
    );

    console.log(
      `[SHEET UPDATE COMPLETE] Column: ${column}, Updated: ${result.updated}, Not found: ${result.notFound.length}`,
    );

    const allFoundNicknames = Array.from(nicknameRows.keys());
    const updatedNicknames = allFoundNicknames.filter(
      (n) => !skippedNicknames.includes(n),
    );
    const notFoundNicknames = ctx.session.usernames.filter(
      (u) => !allFoundNicknames.includes(u),
    );

    const response = buildUpdateResultMessage(
      column,
      result.updated,
      updatedNicknames,
      skippedNicknames,
      notFoundNicknames,
    );

    await replyMarkdownV2(ctx, response);
    resetSession(ctx.session);
  } catch (error) {
    await notifySheetUpdateFailure(ctx, error, 'writeZerosAndRespond');
  }
}
