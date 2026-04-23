import { handleApiError, replyErrorAndReset } from '../bot-helpers';
import {
  ERR_MONEY_BUTTON_OUTDATED,
  ERR_MONEY_CELL_CHANGED_SINCE_READ,
  ERR_MONEY_SESSION_LOST,
  ERR_MONEY_SESSION_LOST_RESTART,
  ERR_MONEY_VALUE,
  ERR_NO_TG_USERNAME,
  ERR_SESSION_DATA_LOST,
  MONEY_MAX_AMOUNT,
  MSG_CANCELLED,
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
import type { MoneyUserCellState } from '../sheets/sheets-types';
import { escapeMarkdownV2, replyMarkdownV2 } from '../telegram/markdown-v2';

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

/**
 * Stable fingerprint of the money cell (empty vs zero vs number + values) for
 * pre-write vs re-read checks. Replaces a legacy display string that could not
 * distinguish e.g. empty from zero.
 */
function moneyCellReadSnapshot(info: {
  cell: MoneyUserCellState;
  numericValue?: number;
  displayText?: string;
}): string {
  return JSON.stringify({
    c: info.cell,
    t: info.displayText ?? null,
    n:
      info.numericValue !== undefined && !Number.isNaN(info.numericValue)
        ? info.numericValue
        : null,
  });
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
    await replyMarkdownV2(
      ctx,
      'This command only works in a *private chat* with the bot\\.',
    );
    return;
  }
  resetForNewMoneySession(ctx);
  if (!ctx.from?.username) {
    await replyMarkdownV2(ctx, ERR_NO_TG_USERNAME);
    return;
  }
  ctx.session.moneyTgKey = `@${ctx.from.username}`;
  ctx.session.state = 'awaiting_money_amount';
  await replyMarkdownV2(
    ctx,
    '*How much* did you pay? Send the amount as a *number*\\.',
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
    await replyMarkdownV2(ctx, 'This only works in *private chat*\\.');
    return;
  }
  if (!ctx.from?.username) {
    await replyMarkdownV2(ctx, ERR_NO_TG_USERNAME);
    return;
  }
  if (!validateMoneyAmount(amount)) {
    await replyMarkdownV2(ctx, ERR_MONEY_VALUE);
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
    await replyMarkdownV2(ctx, ERR_NO_TG_USERNAME);
    resetSession(ctx.session);
    return true;
  }
  const n = parseAmountFromString(text);
  if (n === null) {
    await replyMarkdownV2(ctx, ERR_MONEY_VALUE);
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
    const un = escapeMarkdownV2(ctx.from?.username ?? '');
    await replyMarkdownV2(
      ctx,
      `You are *not in the table* yet, so I cannot find your row\\.\n\n` +
        `Send the name to put in column *A* \\(I will add *@${un}* in column *B*\\)\\.`,
    );
  } catch (e) {
    await handleApiError(ctx, e, 'looking up your row');
  }
}

export async function showMoneyColumnChoice(ctx: MyContext): Promise<void> {
  if (!ctx.session.moneyAmount) {
    await replyErrorAndReset(ctx, ERR_MONEY_SESSION_LOST_RESTART);
    return;
  }
  const atKey = ctx.session.moneyTgKey ?? `@${ctx.from?.username ?? ''}`;
  if (!atKey) {
    await replyMarkdownV2(ctx, ERR_NO_TG_USERNAME);
    resetSession(ctx.session);
    return;
  }

  try {
    const sheets = await ctx.services.createSheetsClient();
    const last = await sheets.findLastDateColumn();
    if (!last) {
      await replyMarkdownV2(
        ctx,
        '❌ *No date columns* found in the sheet\\. Use */update* first\\.',
      );
      resetSession(ctx.session);
      return;
    }
    const row = await sheets.findUserRowByTg(atKey);
    if (row === null) {
      await replyMarkdownV2(
        ctx,
        '❌ Still cannot find your row\\. Try */register* first\\.',
      );
      resetSession(ctx.session);
      return;
    }

    const next = ctx.services.getNextColumnLetter(last.column);
    ctx.session.moneyUserSheetRow = row;
    ctx.session.moneyLastDateColumn = last.column;
    ctx.session.moneyLastDateText = last.date;
    ctx.session.moneyNextColumn = next;
    ctx.session.state = 'awaiting_money_column_choice';

    const amt = ctx.session.moneyAmount;
    if (amt == null) {
      await replyErrorAndReset(ctx, ERR_SESSION_DATA_LOST);
      return;
    }
    await replyMarkdownV2(
      ctx,
      `When did you pay *${escapeMarkdownV2(String(amt))}*?` +
        '\\.\n\n' +
        `*Last date column:* *${escapeMarkdownV2(last.column)}* — ${escapeMarkdownV2(last.date)}\n` +
        `*Next column:* *${escapeMarkdownV2(next)}* \\(must have empty date header and empty cell in your row\\)\n\n` +
        `*Where should I write?*`,
      {
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

    s.moneyOldCellValue = moneyCellReadSnapshot(info);

    if (info.cell === 'number') {
      s.state = 'awaiting_money_replace_confirm';
      const display =
        info.displayText ??
        (info.numericValue != null ? String(info.numericValue) : '?');
      await replyMarkdownV2(
        ctx,
        `This cell already has: *${escapeMarkdownV2(display)}*\n\n` +
          `I will *replace* it with *${escapeMarkdownV2(String(amount))}*\\. OK?`,
        {
          reply_markup: moneyReplaceKeyboard(),
        },
      );
      return;
    }
    if (info.cell === 'empty') {
      s.state = 'awaiting_money_not_in_poll_confirm';
      await replyMarkdownV2(
        ctx,
        `Your cell in column *${escapeMarkdownV2(column)}* is *empty* — you may not have been in the poll for this day \\(or the wrong column\\)\\.\n\n` +
          `Add *${escapeMarkdownV2(String(amount))}* here anyway?`,
        {
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
      await replyMarkdownV2(
        ctx,
        `Column row 4 \\(remaining to collect\\) is *empty* — the group may have finished collecting, or the column is not set up\\.\n\n` +
          `Write *${escapeMarkdownV2(String(amount))}* anyway?`,
        {
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
    await replyErrorAndReset(ctx, ERR_MONEY_BUTTON_OUTDATED);
    return;
  }
  await runPreWriteFromColumn(ctx, c);
}

export async function onMoneyCallbackColumnNext(ctx: MyContext): Promise<void> {
  const s = ctx.session;
  if (s.state !== 'awaiting_money_column_choice' || !s.moneyNextColumn) {
    await replyErrorAndReset(ctx, ERR_MONEY_BUTTON_OUTDATED);
    return;
  }
  const lastCol = s.moneyLastDateColumn;
  const row = s.moneyUserSheetRow;
  if (!lastCol || row == null) {
    await replyErrorAndReset(ctx, ERR_MONEY_SESSION_LOST);
    return;
  }

  try {
    const sheets = await ctx.services.createSheetsClient();
    const nextInfo = await sheets.getNextDateColumnInfo({
      lastDateColumn: lastCol,
      userRow: row,
    });
    if (!nextInfo.headerEmpty) {
      await replyMarkdownV2(
        ctx,
        `❌ *Next column* *${escapeMarkdownV2(nextInfo.nextColumn)}* is not free: the date cell \\(row *1*\\) is not empty\\. Pick another time or add a new column in the sheet\\.`,
      );
      resetSession(s);
      return;
    }
    if (!nextInfo.userCellEmpty) {
      await replyMarkdownV2(
        ctx,
        `❌ Your cell in column *${escapeMarkdownV2(nextInfo.nextColumn)}* is not empty\\. I will *not* overwrite it\\.`,
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
    await replyMarkdownV2(ctx, MSG_CANCELLED);
    resetSession(ctx.session);
    return;
  }
  const col = ctx.session.moneyWriteColumn;
  const row = ctx.session.moneyUserSheetRow;
  if (!col || row == null) {
    await replyErrorAndReset(ctx, ERR_MONEY_SESSION_LOST);
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
      const wAmt = ctx.session.moneyAmount;
      if (wAmt == null) {
        await replyErrorAndReset(ctx, ERR_SESSION_DATA_LOST);
        return;
      }
      await replyMarkdownV2(
        ctx,
        `Column row 4 \\(remaining to collect\\) is *empty* — the group may have finished collecting\\.\n\n` +
          `Write *${escapeMarkdownV2(String(wAmt))}* anyway?`,
        {
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
    await replyMarkdownV2(ctx, MSG_CANCELLED);
    resetSession(ctx.session);
    return;
  }
  const col = ctx.session.moneyWriteColumn;
  const row = ctx.session.moneyUserSheetRow;
  if (!col || row == null) {
    await replyErrorAndReset(ctx, ERR_MONEY_SESSION_LOST);
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
      const wAmt2 = ctx.session.moneyAmount;
      if (wAmt2 == null) {
        await replyErrorAndReset(ctx, ERR_SESSION_DATA_LOST);
        return;
      }
      await replyMarkdownV2(
        ctx,
        `Row *4* in this column is *empty* \\(collection may be complete\\)\\. Write *${escapeMarkdownV2(String(wAmt2))}* anyway?`,
        {
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
    await replyMarkdownV2(ctx, MSG_CANCELLED);
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
  await replyMarkdownV2(
    ctx,
    'Use the *inline buttons*, or send */cancel* to stop\\.',
  );
  return true;
}

export async function doMoneyWrite(ctx: MyContext): Promise<void> {
  const s = ctx.session;
  const col = s.moneyWriteColumn;
  const row = s.moneyUserSheetRow;
  const amount = s.moneyAmount;
  if (!col || row == null || amount == null) {
    await replyErrorAndReset(ctx, ERR_MONEY_SESSION_LOST);
    return;
  }
  if (s.moneyOldCellValue === undefined) {
    await replyErrorAndReset(ctx, ERR_MONEY_SESSION_LOST);
    return;
  }
  const expected = s.moneyOldCellValue;
  try {
    const sheets = await ctx.services.createSheetsClient();
    // Re-check against last read: Sheet API has no per-cell compare-and-swap; we
    // avoid clobbering if another process changed the cell after confirmation.
    const now = await sheets.getMoneyUserCellInfo({
      column: col,
      userRow: row,
    });
    if (moneyCellReadSnapshot(now) !== expected) {
      await replyErrorAndReset(ctx, ERR_MONEY_CELL_CHANGED_SINCE_READ);
      return;
    }
    await sheets.writeMoneyToCell(col, row, amount);
    await replyMarkdownV2(
      ctx,
      `✅ *Done:* wrote *${escapeMarkdownV2(String(amount))}* to column *${escapeMarkdownV2(col)}* row *${escapeMarkdownV2(String(row))}*\\.`,
    );
  } catch (e) {
    await handleApiError(ctx, e, 'writing to the sheet');
    return;
  }
  resetSession(s);
}
