import { handleApiError } from '../bot-helpers';
import { SHEET_DATA_FIRST_COLUMN } from '../constants';
import {
  columnConfirmationKeyboard,
  newColumnChoiceKeyboard,
} from '../keyboards';
import type { MyContext } from '../session';
import { escapeMarkdownV2, replyMarkdownV2 } from '../telegram/markdown-v2';

/**
 * Start the column detection flow
 * Used by /update command and poll option selection
 */
export async function startColumnDetectionFlow(ctx: MyContext): Promise<void> {
  await replyMarkdownV2(ctx, '⏳ *Detecting last date column*\\.\\.\\.');

  try {
    const sheetsClient = await ctx.services.createSheetsClient();
    const lastDateColumn = await sheetsClient.findLastDateColumn();

    if (!lastDateColumn) {
      const first = escapeMarkdownV2(SHEET_DATA_FIRST_COLUMN);
      await replyMarkdownV2(
        ctx,
        `❌ *No date columns found\\.* Create column *${first}*?`,
        { reply_markup: newColumnChoiceKeyboard(SHEET_DATA_FIRST_COLUMN) },
      );
      ctx.session.state = 'awaiting_new_column_choice';
      ctx.session.targetColumn = SHEET_DATA_FIRST_COLUMN;
      ctx.session.isNewColumn = true;
      return;
    }

    ctx.session.detectedColumn = lastDateColumn.column;
    ctx.session.targetColumn = lastDateColumn.column;
    ctx.session.state = 'awaiting_column_confirmation';

    const nextColumn = ctx.services.getNextColumnLetter(lastDateColumn.column);
    const detCol = escapeMarkdownV2(lastDateColumn.column);
    const detDate = escapeMarkdownV2(lastDateColumn.date);
    await replyMarkdownV2(
      ctx,
      `📅 I detected column *${detCol}* \\(${detDate}\\)\\.\n\n` +
        `Choose an option below, or type a column letter \\(e\\.g\\., F\\) or *date text* to search:`,
      {
        reply_markup: columnConfirmationKeyboard(
          lastDateColumn.column,
          nextColumn,
        ),
      },
    );
  } catch (error) {
    await handleApiError(ctx, error, 'detecting column');
  }
}
