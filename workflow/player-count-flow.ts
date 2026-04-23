import { handleApiError, replyErrorAndReset } from '../bot-helpers';
import { playerCountConfirmationKeyboard } from '../keyboards';
import type { MyContext } from '../session';
import { resetSession } from '../session';
import { escapeMarkdownV2, replyMarkdownV2 } from '../telegram/markdown-v2';
import { checkOverridesAndWrite } from './write-flow';

/**
 * Helper function to process usernames and check player count
 */
export async function proceedWithPlayerCountCheck(
  ctx: MyContext,
): Promise<void> {
  if (
    !ctx.session.targetColumn ||
    !ctx.session.usernames ||
    ctx.session.usernames.length === 0
  ) {
    await replyErrorAndReset(
      ctx,
      '❌ *Error:* missing usernames or target column\\. Start over with /update',
    );
    return;
  }

  await replyMarkdownV2(ctx, '⏳ *Checking sheet*\\.\\.\\.');

  try {
    const sheetsClient = await ctx.services.createSheetsClient();
    const nicknameRows = await sheetsClient.findNicknameRows(
      ctx.session.usernames,
    );

    if (nicknameRows.size === 0) {
      const sent = ctx.session.usernames.map(escapeMarkdownV2).join(', ');
      await replyMarkdownV2(
        ctx,
        '❌ *No matches found* in the sheet\\.\n\n' +
          `*Sent usernames:* ${sent}\n\n` +
          'Check that usernames in the sheet \\(column B\\) match the ones you sent\\.',
      );
      resetSession(ctx.session);
      return;
    }

    // Check if player count needs to be set
    if (ctx.session.playerCount === undefined) {
      const recognizedCount = nicknameRows.size;
      ctx.session.state = 'awaiting_player_count_confirmation';
      await replyMarkdownV2(
        ctx,
        `👥 I found *${recognizedCount}* recognized username\\(s\\)\\.\n\n` +
          `Is *${recognizedCount}* the *total* number of players who attended?`,
        { reply_markup: playerCountConfirmationKeyboard(recognizedCount) },
      );
      ctx.session.nicknameRowsEntries = Array.from(nicknameRows.entries());
      return;
    }

    // Player count already set, proceed to override check
    await checkOverridesAndWrite(ctx, nicknameRows);
  } catch (error) {
    await handleApiError(ctx, error, 'processing usernames');
  }
}
