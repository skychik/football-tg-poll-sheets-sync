import { handleApiError } from '../bot-helpers';
import { ERR_NO_TG_USERNAME } from '../constants';
import type { MyContext } from '../session';
import { resetSession } from '../session';
import { escapeMarkdownV2, replyMarkdownV2 } from '../telegram/markdown-v2';
import { showMoneyColumnChoice } from './money-flow';

let registerWriteMutex: Promise<void> = Promise.resolve();

async function withRegisterWriteMutex<T>(fn: () => Promise<T>): Promise<T> {
  const previous = registerWriteMutex;
  let release!: () => void;
  registerWriteMutex = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await fn();
  } finally {
    release();
  }
}

/**
 * /register with optional `textAfterCommand` (name after the command)
 */
export async function handleRegisterCommand(
  ctx: MyContext,
  textAfterCommand: string,
): Promise<void> {
  if (ctx.chat?.type !== 'private') {
    await replyMarkdownV2(
      ctx,
      'Use */register* in a *private chat* with the bot\\.',
    );
    return;
  }
  if (!ctx.from?.username) {
    await replyMarkdownV2(ctx, ERR_NO_TG_USERNAME);
    return;
  }
  const atTg = `@${ctx.from.username}`;

  try {
    const sheets = await ctx.services.createSheetsClient();
    const existingRow = await sheets.findUserRowByTg(atTg);
    if (existingRow !== null) {
      await replyMarkdownV2(
        ctx,
        `You are already in the table: *${escapeMarkdownV2(atTg)}* at row *${existingRow}*\\.`,
      );
      return;
    }
    const name = textAfterCommand.trim();
    if (name.length > 0) {
      await doRegisterUser(ctx, name, atTg, 'standalone');
    } else {
      ctx.session.state = 'awaiting_register_name';
      ctx.session.registerAtUsername = atTg;
      ctx.session.moneyResumeAfterRegister = false;
      await replyMarkdownV2(
        ctx,
        'Send the *name* to put in column *A* \\(I will add your *@username* in column *B*\\)\\.',
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
    await replyMarkdownV2(ctx, '❌ *Name* cannot be empty\\.');
    return;
  }

  try {
    const sheets = await ctx.services.createSheetsClient();
    const registration = await withRegisterWriteMutex(async () => {
      const existingRow = await sheets.findUserRowByTg(atTg);
      if (existingRow !== null) {
        return { status: 'exists' as const, row: existingRow };
      }
      const row = await sheets.findFirstRowWithEmptyNameAndTg();
      if (row === null) {
        return { status: 'no_free_row' as const };
      }
      await sheets.writeRegisterRow(row, name, atTg);
      return { status: 'created' as const, row };
    });

    if (registration.status === 'exists') {
      await replyMarkdownV2(
        ctx,
        `You are already in the table: *${escapeMarkdownV2(atTg)}* at row *${registration.row}*\\.`,
      );
      if (mode === 'from_money') {
        await showMoneyColumnChoice(ctx);
      } else {
        resetSession(ctx.session);
      }
      return;
    }
    if (registration.status === 'no_free_row') {
      await replyMarkdownV2(
        ctx,
        '❌ *No free row:* could not find a row with empty *A* and *B* \\(from row *7*\\)\\.',
      );
      resetSession(ctx.session);
      return;
    }

    const row = registration.row;
    if (mode === 'from_money') {
      ctx.session.moneyResumeAfterRegister = false;
      await replyMarkdownV2(
        ctx,
        `✅ Added *${escapeMarkdownV2(name)}* / *${escapeMarkdownV2(atTg)}* at row *${row}*\\.\n\nContinuing with your payment\\.\\.\\.`,
      );
      await showMoneyColumnChoice(ctx);
    } else {
      await replyMarkdownV2(
        ctx,
        `✅ *Done:* ${escapeMarkdownV2(name)} / ${escapeMarkdownV2(atTg)} at row *${row}*\\.`,
      );
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
    await replyMarkdownV2(ctx, ERR_NO_TG_USERNAME);
    resetSession(ctx.session);
    return true;
  }
  const atTg = ctx.session.registerAtUsername ?? `@${ctx.from.username}`;

  const resume = ctx.session.moneyResumeAfterRegister === true;
  const mode: RegisterMode = resume ? 'from_money' : 'standalone';

  await doRegisterUser(ctx, text, atTg, mode);
  return true;
}
