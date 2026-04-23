import { handleApiError, replyErrorAndReset } from '../bot-helpers';
import {
  ERR_MONEY_VALUE,
  ERR_NO_TG_USERNAME,
  ERR_SESSION_DATA_LOST,
  MONEY_MAX_AMOUNT,
  SHEET_MONEY_REMAINING_ROW,
} from '../constants';
import {
  moneyColumnKeyboard,
  moneyEmptyCellKeyboard,
  moneyReplaceKeyboard,
  moneyRow4Keyboard,
} from '../keyboards';
import type { MyContext } from '../session';
import { resetSession } from '../session';

/**
 * Start `/money` or plain-number flow: only call when you want a full reset of money state first.
 */
export function resetForNewMoneySession(ctx: MyContext): void {
  const s = ctx.session;
  s.moneyAmount = undefined;
  s.moneyResumeAfterRegister = undefined;
  s.moneyWriteColumn = undefined;
  s.moneyUserSheetRow = undefined;
  s.moneyLastDateColumn = undefined;
  s.moneyLastDateText = undefined;
  s.moneyNextColumn = undefined;
  s.moneyTgKey = undefined;
  s.moneyOldCellValue = undefined;
  s.state = 'idle';
}

function validateMoneyAmount(n: number): boolean {
  return Number.isFinite(n) && n > 0 && n <= MONEY_MAX_AMOUNT;
}

/** Must match the shape accepted for bare-number messages and `/money` amount text. */
const MONEY_AMOUNT_TEXT_PATTERN = /^\d+(\.\d+)?$/;

export function parseAmountFromString(raw: string): number | null {
  const t = raw.trim();
  if (t === '' || !MONEY_AMOUNT_TEXT_PATTERN.test(t)) {
    return null;
  }
  const n = parseFloat(t);
  if (!validateMoneyAmount(n)) {
    return null;
  }
  return n;
}

/**
 * /money without amount, or after reset.
 */
export async function beginMoneyCommand(ctx: MyContext): Promise<void> {
  if (ctx.chat?.type !== 'private') {
    await ctx.reply('This command only works in a private chat with the bot.');
    return;
  }
  resetForNewMoneySession(ctx);
  if (!ctx.from?.username) {
    await ctx.reply(ERR_NO_TG_USERNAME);
    return;
  }
  ctx.session.moneyTgKey = `@${ctx.from.username}`;
  ctx.session.state = 'awaiting_money_amount';
  await ctx.reply(
    'How much? Send a number between 1 and 20,000 (this replaces your cell in the sheet).',
  );
}

/**
 * /money 500: amount in same message.
 */
export async function startMoneyWithParsedAmount(
  ctx: MyContext,
  amount: number,
  resetFirst: boolean = true,
): Promise<void> {
  if (ctx.chat?.type !== 'private') {
    await ctx.reply('This only works in private chat.');
    return;
  }
  if (!ctx.from?.username) {
    await ctx.reply(ERR_NO_TG_USERNAME);
    return;
  }
  if (!validateMoneyAmount(amount)) {
    await ctx.reply(ERR_MONEY_VALUE);
    return;
  }
  if (resetFirst) {
    resetForNewMoneySession(ctx);
  }
  ctx.session.moneyTgKey = `@${ctx.from.username}`;
  await continueMoneyAfterAmount(ctx, amount);
}

export async function handleAwaitingMoneyAmount(
  ctx: MyContext,
  text: string,
): Promise<boolean> {
  if (ctx.session.state !== 'awaiting_money_amount') {
    return false;
  }
  if (!ctx.from?.username) {
    await ctx.reply(ERR_NO_TG_USERNAME);
    resetSession(ctx.session);
    return true;
  }
  const n = parseAmountFromString(text);
  if (n === null) {
    await ctx.reply(ERR_MONEY_VALUE);
    return true;
  }
  ctx.session.moneyTgKey = `@${ctx.from.username}`;
  await continueMoneyAfterAmount(ctx, n);
  return true;
}

/**
 * Plain positive number in private chat, idle state.
 */
export async function tryHandleBareMoneyNumber(
  ctx: MyContext,
  raw: string,
): Promise<boolean> {
  if (ctx.session.state !== 'idle' || ctx.chat?.type !== 'private') {
    return false;
  }
  const n = parseAmountFromString(raw);
  if (n === null) {
    return false;
  }
  if (!ctx.from?.username) {
    return false;
  }
  await startMoneyWithParsedAmount(ctx, n, true);
  return true;
}

async function continueMoneyAfterAmount(
  ctx: MyContext,
  amount: number,
): Promise<void> {
  ctx.session.moneyAmount = amount;
  const atKey = ctx.session.moneyTgKey ?? `@${ctx.from?.username ?? ''}`;

  try {
    const sheets = await ctx.services.createSheetsClient();
    const row = await sheets.findUserRowByTg(atKey);
    if (row !== null) {
      await showMoneyColumnChoice(ctx);
      return;
    }
    // Not in sheet: register first
    ctx.session.moneyResumeAfterRegister = true;
    ctx.session.registerAtUsername = atKey;
    ctx.session.state = 'awaiting_register_name';
    await ctx.reply(
      `You are not in the table yet, so I cannot find your row.\n\n` +
        `Send the name to put in column A (I will add @${ctx.from?.username} in column B).`,
    );
  } catch (e) {
    await handleApiError(ctx, e, 'looking up your row');
  }
}

export async function showMoneyColumnChoice(ctx: MyContext): Promise<void> {
  if (!ctx.session.moneyAmount) {
    await replyErrorAndReset(
      ctx,
      'Session lost. Start again with /money or send a number.',
    );
    return;
  }
  const atKey = ctx.session.moneyTgKey ?? `@${ctx.from?.username ?? ''}`;
  if (!atKey) {
    await ctx.reply(ERR_NO_TG_USERNAME);
    resetSession(ctx.session);
    return;
  }

  try {
    const sheets = await ctx.services.createSheetsClient();
    const last = await sheets.findLastDateColumn();
    if (!last) {
      await ctx.reply(
        '❌ No date columns found in the sheet. Use /update first.',
      );
      resetSession(ctx.session);
      return;
    }
    const row = await sheets.findUserRowByTg(atKey);
    if (row === null) {
      await ctx.reply('❌ Still cannot find your row. Try /register first.');
      resetSession(ctx.session);
      return;
    }

    const next = ctx.services.getNextColumnLetter(last.column);
    ctx.session.moneyUserSheetRow = row;
    ctx.session.moneyLastDateColumn = last.column;
    ctx.session.moneyLastDateText = last.date;
    ctx.session.moneyNextColumn = next;
    ctx.session.state = 'awaiting_money_column_choice';

    await ctx.reply(
      `You want to write **${ctx.session.moneyAmount}** (replaces your cell).\n\n` +
        `Last date column: **${last.column}** — ${last.date}\n` +
        `Next column: **${next}** (must have empty date header and empty cell in your row)\n\n` +
        `Where should I write?`,
      {
        parse_mode: 'Markdown',
        reply_markup: moneyColumnKeyboard(last.column, last.date, next),
      },
    );
  } catch (e) {
    await handleApiError(ctx, e, 'preparing money flow');
  }
}

async function runPreWriteFromColumn(
  ctx: MyContext,
  column: string,
): Promise<void> {
  const s = ctx.session;
  const row = s.moneyUserSheetRow;
  const amount = s.moneyAmount;
  if (row == null || amount == null) {
    await replyErrorAndReset(ctx, ERR_SESSION_DATA_LOST);
    return;
  }
  s.moneyWriteColumn = column;

  try {
    const sheets = await ctx.services.createSheetsClient();
    const info = await sheets.getMoneyUserCellInfo({ column, userRow: row });
    const row4Empty = await sheets.isCellEmpty({
      column,
      row: SHEET_MONEY_REMAINING_ROW,
    });

    s.moneyOldCellValue =
      info.displayText ??
      (info.numericValue != null ? String(info.numericValue) : '');

    if (info.cell === 'number') {
      s.state = 'awaiting_money_replace_confirm';
      const display =
        info.displayText ??
        (info.numericValue != null ? String(info.numericValue) : '?');
      await ctx.reply(
        `This cell already has: **${display}**\n\n` +
          `I will **replace** it with **${amount}**. OK?`,
        {
          parse_mode: 'Markdown',
          reply_markup: moneyReplaceKeyboard(),
        },
      );
      return;
    }
    if (info.cell === 'empty') {
      s.state = 'awaiting_money_not_in_poll_confirm';
      await ctx.reply(
        `Your cell in column **${column}** is **empty** — you may not have been in the poll for this day (or the wrong column).\n\n` +
          `Add **${amount}** here anyway?`,
        {
          parse_mode: 'Markdown',
          reply_markup: moneyEmptyCellKeyboard(),
        },
      );
      return;
    }
    // 'zero' — or treat as 0
    if (!row4Empty) {
      await doMoneyWrite(ctx);
    } else {
      s.state = 'awaiting_money_row4_confirm';
      await ctx.reply(
        'Column row 4 (remaining to collect) is **empty** — the group may have finished collecting, or the column is not set up.\n\n' +
          `Write **${amount}** anyway?`,
        {
          parse_mode: 'Markdown',
          reply_markup: moneyRow4Keyboard(),
        },
      );
    }
  } catch (e) {
    await handleApiError(ctx, e, 'reading your money cell');
  }
}

export async function onMoneyCallbackColumnLast(ctx: MyContext): Promise<void> {
  const c = ctx.session.moneyLastDateColumn;
  if (!c || ctx.session.state !== 'awaiting_money_column_choice') {
    await replyErrorAndReset(
      ctx,
      'This button is out of date. Use /money again.',
    );
    return;
  }
  await runPreWriteFromColumn(ctx, c);
}

export async function onMoneyCallbackColumnNext(ctx: MyContext): Promise<void> {
  const s = ctx.session;
  if (s.state !== 'awaiting_money_column_choice' || !s.moneyNextColumn) {
    await replyErrorAndReset(
      ctx,
      'This button is out of date. Use /money again.',
    );
    return;
  }
  const lastCol = s.moneyLastDateColumn;
  const row = s.moneyUserSheetRow;
  if (!lastCol || row == null) {
    await replyErrorAndReset(ctx, 'Session data lost. Use /money again.');
    return;
  }

  try {
    const sheets = await ctx.services.createSheetsClient();
    const nextInfo = await sheets.getNextDateColumnInfo({
      lastDateColumn: lastCol,
      userRow: row,
    });
    if (!nextInfo.headerEmpty) {
      await ctx.reply(
        `❌ Next column **${nextInfo.nextColumn}** is not free: the date cell (row 1) is not empty. Pick another time or add a new column in the sheet.`,
        { parse_mode: 'Markdown' },
      );
      resetSession(s);
      return;
    }
    if (!nextInfo.userCellEmpty) {
      await ctx.reply(
        `❌ Your cell in column **${nextInfo.nextColumn}** is not empty. I will not overwrite it.`,
        { parse_mode: 'Markdown' },
      );
      resetSession(s);
      return;
    }
    await runPreWriteFromColumn(ctx, nextInfo.nextColumn);
  } catch (e) {
    await handleApiError(ctx, e, 'checking next column');
  }
}

export async function onMoneyReplaceCallback(
  ctx: MyContext,
  ok: boolean,
): Promise<void> {
  if (ctx.session.state !== 'awaiting_money_replace_confirm') {
    return;
  }
  if (!ok) {
    await ctx.reply('Cancelled.');
    resetSession(ctx.session);
    return;
  }
  const col = ctx.session.moneyWriteColumn;
  const row = ctx.session.moneyUserSheetRow;
  if (!col || row == null) {
    await replyErrorAndReset(ctx, 'Session lost. Use /money again.');
    return;
  }
  try {
    const sheets = await ctx.services.createSheetsClient();
    const row4Empty = await sheets.isCellEmpty({
      column: col,
      row: SHEET_MONEY_REMAINING_ROW,
    });
    if (!row4Empty) {
      await doMoneyWrite(ctx);
    } else {
      ctx.session.state = 'awaiting_money_row4_confirm';
      await ctx.reply(
        'Column row 4 (remaining to collect) is **empty** — the group may have finished collecting.\n\n' +
          `Write **${ctx.session.moneyAmount}** anyway?`,
        {
          parse_mode: 'Markdown',
          reply_markup: moneyRow4Keyboard(),
        },
      );
    }
  } catch (e) {
    await handleApiError(ctx, e, 'checking row 4');
  }
}

export async function onMoneyEmptyPollCallback(
  ctx: MyContext,
  writeAnyway: boolean,
): Promise<void> {
  if (ctx.session.state !== 'awaiting_money_not_in_poll_confirm') {
    return;
  }
  if (!writeAnyway) {
    await ctx.reply('Cancelled.');
    resetSession(ctx.session);
    return;
  }
  const col = ctx.session.moneyWriteColumn;
  const row = ctx.session.moneyUserSheetRow;
  if (!col || row == null) {
    await replyErrorAndReset(ctx, 'Session lost. Use /money again.');
    return;
  }
  try {
    const sheets = await ctx.services.createSheetsClient();
    const row4Empty = await sheets.isCellEmpty({
      column: col,
      row: SHEET_MONEY_REMAINING_ROW,
    });
    if (!row4Empty) {
      await doMoneyWrite(ctx);
    } else {
      ctx.session.state = 'awaiting_money_row4_confirm';
      await ctx.reply(
        'Row 4 in this column is **empty** (collection may be complete). Write **' +
          String(ctx.session.moneyAmount) +
          '** anyway?',
        {
          parse_mode: 'Markdown',
          reply_markup: moneyRow4Keyboard(),
        },
      );
    }
  } catch (e) {
    await handleApiError(ctx, e, 'checking row 4');
  }
}

export async function onMoneyRow4Callback(
  ctx: MyContext,
  writeAnyway: boolean,
): Promise<void> {
  if (ctx.session.state !== 'awaiting_money_row4_confirm') {
    return;
  }
  if (!writeAnyway) {
    await ctx.reply('Cancelled.');
    resetSession(ctx.session);
    return;
  }
  await doMoneyWrite(ctx);
}

/**
 * Replies and returns true if the user should not type freeform text in this state.
 */
export function isMoneyButtonsOnlyState(ctx: MyContext): boolean {
  const st = ctx.session.state;
  return (
    st === 'awaiting_money_column_choice' ||
    st === 'awaiting_money_replace_confirm' ||
    st === 'awaiting_money_not_in_poll_confirm' ||
    st === 'awaiting_money_row4_confirm'
  );
}

export async function tryHandleMoneyBlockedPlainText(
  ctx: MyContext,
): Promise<boolean> {
  if (!isMoneyButtonsOnlyState(ctx) || !ctx.message?.text) {
    return false;
  }
  if (ctx.message.text.trim().startsWith('/')) {
    return false;
  }
  await ctx.reply('Use the inline buttons, or send /cancel to stop.');
  return true;
}

export async function doMoneyWrite(ctx: MyContext): Promise<void> {
  const s = ctx.session;
  const col = s.moneyWriteColumn;
  const row = s.moneyUserSheetRow;
  const amount = s.moneyAmount;
  if (!col || row == null || amount == null) {
    await replyErrorAndReset(ctx, 'Session lost. Use /money again.');
    return;
  }
  try {
    const sheets = await ctx.services.createSheetsClient();
    await sheets.writeMoneyToCell(col, row, amount);
    await ctx.reply(
      `Done: wrote **${amount}** to column **${col}** row **${row}** (replaced the cell).`,
      { parse_mode: 'Markdown' },
    );
  } catch (e) {
    await handleApiError(ctx, e, 'writing to the sheet');
    return;
  }
  resetSession(s);
}
