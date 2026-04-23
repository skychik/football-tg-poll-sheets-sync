import { handleApiError, replyErrorAndReset } from '../bot-helpers';
import { ERR_TARGET_COLUMN_NOT_SET } from '../constants';
import type { MyContext } from '../session';
import { escapeMarkdownV2, replyMarkdownV2 } from '../telegram/markdown-v2';
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
      const tc = escapeMarkdownV2(ctx.session.targetColumn);
      await replyMarkdownV2(
        ctx,
        `📅 Column *${tc}* has *no date name*\\.\n\nPlease provide the date name for row *1*:`,
      );
      return;
    }
    ctx.session.dateName = metadata.date;

    // Check cost (row 2)
    if (metadata.cost === undefined) {
      ctx.session.state = 'awaiting_cost';
      const tc2 = escapeMarkdownV2(ctx.session.targetColumn);
      await replyMarkdownV2(
        ctx,
        `💰 Column *${tc2}* has *no cost* specified\\.\n\nPlease provide the field cost for row *2*:`,
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
    const tc3 = escapeMarkdownV2(ctx.session.targetColumn);
    const dn = escapeMarkdownV2(ctx.session.dateName ?? '');
    const cost = escapeMarkdownV2(String(ctx.session.cost));
    let metadataMsg =
      `Column *${tc3}* *metadata:*\n` +
      `• *Date:* ${dn}\n` +
      `• *Cost:* ${cost}\n`;
    if (ctx.session.playerCount !== undefined) {
      metadataMsg += `• *Players:* ${escapeMarkdownV2(String(ctx.session.playerCount))}\n`;
    }
    metadataMsg += `\nNow send the list of *usernames* who will attend \\(with or without @, separated by spaces or commas\\):`;
    await replyMarkdownV2(ctx, metadataMsg);
  } catch (error) {
    await handleApiError(ctx, error, 'checking column metadata');
  }
}
