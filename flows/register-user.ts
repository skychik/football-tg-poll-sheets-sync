import { handleApiError } from '../bot-helpers';
import { ERR_NO_TG_USERNAME } from '../constants';
import type { MyContext } from '../session';
import { resetSession } from '../session';
import { showMoneyColumnChoice } from './money-flow';

/**
 * /register with optional `textAfterCommand` (name after the command)
 */
export async function handleRegisterCommand(
  ctx: MyContext,
  textAfterCommand: string,
): Promise<void> {
  if (ctx.chat?.type !== 'private') {
    await ctx.reply('Use /register in a private chat with the bot.');
    return;
  }
  if (!ctx.from?.username) {
    await ctx.reply(ERR_NO_TG_USERNAME);
    return;
  }
  const atTg = `@${ctx.from.username}`;

  try {
    const sheets = await ctx.services.createSheetsClient();
    if (await sheets.isTelegramUsernameInSheet(atTg)) {
      await ctx.reply(`You are already in the table: **${atTg}**`, {
        parse_mode: 'Markdown',
      });
      return;
    }
    const name = textAfterCommand.trim();
    if (name.length > 0) {
      await doRegisterUser(ctx, name, atTg, 'standalone');
    } else {
      ctx.session.state = 'awaiting_register_name';
      ctx.session.registerAtUsername = atTg;
      ctx.session.moneyResumeAfterRegister = false;
      await ctx.reply(
        'Send the name to put in column A (I will add your @username in column B).',
      );
    }
  } catch (e) {
    await handleApiError(ctx, e, 'checking the sheet for registration');
  }
}

type RegisterMode = 'standalone' | 'from_money';

export async function doRegisterUser(
  ctx: MyContext,
  displayName: string,
  atTg: string,
  mode: RegisterMode,
): Promise<void> {
  const name = displayName.trim();
  if (name.length === 0) {
    await ctx.reply('❌ Name cannot be empty.');
    return;
  }

  try {
    const sheets = await ctx.services.createSheetsClient();
    if (await sheets.isTelegramUsernameInSheet(atTg)) {
      await ctx.reply(`You are already in the table: **${atTg}**`, {
        parse_mode: 'Markdown',
      });
      if (mode === 'from_money') {
        await showMoneyColumnChoice(ctx);
      } else {
        resetSession(ctx.session);
      }
      return;
    }
    const row = await sheets.findFirstRowWithEmptyNameAndTg();
    if (row === null) {
      await ctx.reply(
        '❌ No free row: could not find a row with empty A and B (from row 7).',
      );
      resetSession(ctx.session);
      return;
    }
    await sheets.writeRegisterRow(row, name, atTg);
    if (mode === 'from_money') {
      ctx.session.moneyResumeAfterRegister = false;
      await ctx.reply(
        `Added **${name}** / **${atTg}** at row **${row}**.\n\nContinuing with your payment…`,
        { parse_mode: 'Markdown' },
      );
      await showMoneyColumnChoice(ctx);
    } else {
      await ctx.reply(`Done: **${name}** / **${atTg}** at row **${row}**.`, {
        parse_mode: 'Markdown',
      });
      resetSession(ctx.session);
    }
  } catch (e) {
    await handleApiError(ctx, e, 'adding you to the sheet');
  }
}

export async function handleAwaitingRegisterName(
  ctx: MyContext,
  text: string,
): Promise<boolean> {
  if (ctx.session.state !== 'awaiting_register_name') {
    return false;
  }
  if (!ctx.from?.username) {
    await ctx.reply(ERR_NO_TG_USERNAME);
    resetSession(ctx.session);
    return true;
  }
  const atTg = ctx.session.registerAtUsername ?? `@${ctx.from.username}`;

  const resume = ctx.session.moneyResumeAfterRegister === true;
  const mode: RegisterMode = resume ? 'from_money' : 'standalone';

  await doRegisterUser(ctx, text, atTg, mode);
  return true;
}
