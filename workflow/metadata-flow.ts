import { handleApiError, replyErrorAndReset } from '../bot-helpers';
import { ERR_TARGET_COLUMN_NOT_SET } from '../constants';
import type { MyContext } from '../session';
import { proceedWithPlayerCountCheck } from './player-count-flow';

/**
 * Helper function to proceed with metadata collection and then usernames
 */
export async function proceedWithMetadataCollection(
  ctx: MyContext,
): Promise<void> {
  if (!ctx.session.targetColumn) {
    await replyErrorAndReset(ctx, ERR_TARGET_COLUMN_NOT_SET);
    return;
  }

  try {
    const sheetsClient = await ctx.services.createSheetsClient();
    const metadata = await sheetsClient.getColumnMetadata(
      ctx.session.targetColumn,
    );

    // Check date (row 1)
    if (!metadata.date) {
      ctx.session.state = 'awaiting_date_name';
      await ctx.reply(
        `📅 Column ${ctx.session.targetColumn} has no date name.\n\nPlease provide the date name for row 1:`,
      );
      return;
    }
    ctx.session.dateName = metadata.date;

    // Check cost (row 2)
    if (metadata.cost === undefined) {
      ctx.session.state = 'awaiting_cost';
      await ctx.reply(
        `💰 Column ${ctx.session.targetColumn} has no cost specified.\n\nPlease provide the field cost for row 2:`,
      );
      return;
    }
    ctx.session.cost = metadata.cost;

    // Store player count if it exists, but don't ask for it yet
    if (metadata.playerCount !== undefined) {
      ctx.session.playerCount = metadata.playerCount;
    }

    // Check if usernames are already set (from poll)
    if (ctx.session.usernames && ctx.session.usernames.length > 0) {
      await proceedWithPlayerCountCheck(ctx);
      return;
    }

    // All metadata complete, ask for usernames
    ctx.session.state = 'awaiting_usernames';
    let metadataMsg =
      `✅ Column ${ctx.session.targetColumn} metadata:\n` +
      `• Date: ${ctx.session.dateName}\n` +
      `• Cost: ${ctx.session.cost}\n`;
    if (ctx.session.playerCount !== undefined) {
      metadataMsg += `• Players: ${ctx.session.playerCount}\n`;
    }
    metadataMsg += `\nNow send me the list of usernames who will attend (with or without @, separated by spaces or commas):`;
    await ctx.reply(metadataMsg);
  } catch (error) {
    await handleApiError(ctx, error, 'checking column metadata');
  }
}
