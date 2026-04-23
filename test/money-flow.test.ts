import { beforeEach, describe, expect, test } from 'bun:test';
import type { Message, User } from '@grammyjs/types';
import {
  ERR_MONEY_CELL_CHANGED_SINCE_READ,
  MONEY_MAX_AMOUNT,
  SHEET_MONEY_REMAINING_ROW,
} from '../constants';
import { parseAmountFromString } from '../flows/money-flow';
import { baseSheets } from './sheet-test-stub';
import { createTelegramTestKit } from './support/create-test-bot';
import {
  callbackQueryUpdate,
  textMessageUpdate,
  textMessageUpdateInGroup,
  textMessageUpdateWithFrom,
} from './support/telegram-updates';
import { expectTexts } from './support/test-assertions';

const testKit = createTelegramTestKit();
const { setupTestBot } = testKit;

beforeEach(() => {
  testKit.reset();
});

describe('/money', () => {
  test('in a group: replies with private-only message and does not start flow', async () => {
    const { bot, calls } = setupTestBot();
    await bot.handleUpdate(textMessageUpdateInGroup('/money 500'));
    expectTexts(calls, ['only in a private chat'], 'sendMessage');
  });

  test('/money 0 replies incorrect value', async () => {
    const { bot, calls } = setupTestBot();
    await bot.handleUpdate(textMessageUpdate('/money 0'));
    expectTexts(calls, ['incorrect'], 'sendMessage');
  });

  test('/money 20001 replies incorrect value', async () => {
    const { bot, calls } = setupTestBot();
    await bot.handleUpdate(textMessageUpdate('/money 20001'));
    expectTexts(calls, ['incorrect'], 'sendMessage');
  });

  test('/money 500: zero cell, row4 nonempty -> write without row4 confirm', async () => {
    const writes: Array<{ c: string; r: number; a: number }> = [];
    testKit.setSheetsClient(
      baseSheets({
        findUserRowByTg: async () => 7,
        findLastDateColumn: async () => ({ column: 'F', date: '12 Apr' }),
        getNextDateColumnInfo: async () => ({
          nextColumn: 'G',
          headerEmpty: true,
          userCellEmpty: true,
        }),
        getMoneyUserCellInfo: async () => ({ cell: 'zero' }),
        isCellEmpty: async (p) => {
          if (p.row === SHEET_MONEY_REMAINING_ROW) return false;
          return true;
        },
        writeMoneyToCell: async (c, r, a) => {
          writes.push({ c, r, a });
        },
      }),
    );
    const { bot, calls, getLastBotMessage } = setupTestBot();
    await bot.handleUpdate(textMessageUpdate('/money 500'));
    const colMsg = getLastBotMessage();
    await bot.handleUpdate(
      callbackQueryUpdate('mn:col:last', colMsg as Message),
    );
    expect(writes).toEqual([{ c: 'F', r: 7, a: 500 }]);
    expectTexts(calls, ['wrote', '500', 'F'], 'sendMessage');
  });

  test('final write: aborts if cell changed after pre-read (no clobber)', async () => {
    const writes: Array<{ c: string; r: number; a: number }> = [];
    let readCount = 0;
    testKit.setSheetsClient(
      baseSheets({
        findUserRowByTg: async () => 7,
        findLastDateColumn: async () => ({ column: 'F', date: '12 Apr' }),
        getNextDateColumnInfo: async () => ({
          nextColumn: 'G',
          headerEmpty: true,
          userCellEmpty: true,
        }),
        getMoneyUserCellInfo: async () => {
          readCount += 1;
          if (readCount === 1) {
            return { cell: 'zero' };
          }
          return { cell: 'number', numericValue: 9, displayText: '9' };
        },
        isCellEmpty: async (p) => {
          if (p.row === SHEET_MONEY_REMAINING_ROW) return false;
          return true;
        },
        writeMoneyToCell: async (c, r, a) => {
          writes.push({ c, r, a });
        },
      }),
    );
    const { bot, calls, getLastBotMessage } = setupTestBot();
    await bot.handleUpdate(textMessageUpdate('/money 500'));
    const colMsg = getLastBotMessage();
    await bot.handleUpdate(
      callbackQueryUpdate('mn:col:last', colMsg as Message),
    );
    expect(writes).toEqual([]);
    expectTexts(calls, [ERR_MONEY_CELL_CHANGED_SINCE_READ], 'sendMessage');
  });

  test('/money 500: empty cell -> add anyway -> write', async () => {
    const writes: Array<{ c: string; r: number; a: number }> = [];
    testKit.setSheetsClient(
      baseSheets({
        findUserRowByTg: async () => 7,
        findLastDateColumn: async () => ({ column: 'F', date: '12 Apr' }),
        getNextDateColumnInfo: async () => ({
          nextColumn: 'G',
          headerEmpty: true,
          userCellEmpty: true,
        }),
        getMoneyUserCellInfo: async () => ({ cell: 'empty' }),
        isCellEmpty: async (p) => {
          if (p.row === SHEET_MONEY_REMAINING_ROW) return false;
          return p.column === 'F' && p.row === 7;
        },
        writeMoneyToCell: async (c, r, a) => {
          writes.push({ c, r, a });
        },
      }),
    );
    const { bot, getLastBotMessage } = setupTestBot();
    await bot.handleUpdate(textMessageUpdate('/money 500'));
    const colMsg = getLastBotMessage();
    await bot.handleUpdate(
      callbackQueryUpdate('mn:col:last', colMsg as Message),
    );
    const addMsg = getLastBotMessage();
    await bot.handleUpdate(callbackQueryUpdate('mn:em:yes', addMsg as Message));
    expect(writes).toEqual([{ c: 'F', r: 7, a: 500 }]);
  });

  test('/money: user not in sheet -> name -> column choice', async () => {
    let inSheet = false;
    testKit.setSheetsClient(
      baseSheets({
        findUserRowByTg: async () => (inSheet ? 8 : null),
        isTelegramUsernameInSheet: async () => inSheet,
        findFirstRowWithEmptyNameAndTg: async () => 8,
        writeRegisterRow: async () => {
          inSheet = true;
        },
        findLastDateColumn: async () => ({ column: 'F', date: '12 Apr' }),
        getNextDateColumnInfo: async () => ({
          nextColumn: 'G',
          headerEmpty: true,
          userCellEmpty: true,
        }),
        getMoneyUserCellInfo: async () => ({ cell: 'zero' }),
        isCellEmpty: async (p) => p.row !== SHEET_MONEY_REMAINING_ROW,
        writeMoneyToCell: async () => {},
      }),
    );
    const { bot, calls, getLastBotMessage } = setupTestBot();
    await bot.handleUpdate(textMessageUpdate('/money 300'));
    expectTexts(calls, ['not in the table', 'name'], 'sendMessage');
    await bot.handleUpdate(textMessageUpdate('Pavel'));
    expectTexts(calls, ['Added', 'Pavel', '300'], 'sendMessage');
    expect(getLastBotMessage()?.text).toMatch(/Where should I write/);
  });

  test('plain 100 in private starts /money', async () => {
    const { bot, getLastBotMessage } = setupTestBot();
    testKit.setSheetsClient(
      baseSheets({
        findUserRowByTg: async () => 7,
        findLastDateColumn: async () => ({ column: 'F', date: '12 Apr' }),
        getNextDateColumnInfo: async () => ({
          nextColumn: 'G',
          headerEmpty: true,
          userCellEmpty: true,
        }),
        getMoneyUserCellInfo: async () => ({ cell: 'zero' }),
        isCellEmpty: async (p) => p.row !== SHEET_MONEY_REMAINING_ROW,
        writeMoneyToCell: async () => {},
      }),
    );
    await bot.handleUpdate(textMessageUpdate('100'));
    expect(getLastBotMessage()?.text).toMatch(/100/);
  });

  test('nonzero cell -> replace confirm -> row4 not empty -> write', async () => {
    const writes: Array<unknown> = [];
    testKit.setSheetsClient(
      baseSheets({
        findUserRowByTg: async () => 7,
        findLastDateColumn: async () => ({ column: 'F', date: '12 Apr' }),
        getNextDateColumnInfo: async () => ({
          nextColumn: 'G',
          headerEmpty: true,
          userCellEmpty: true,
        }),
        getMoneyUserCellInfo: async () => ({
          cell: 'number',
          numericValue: 50,
        }),
        isCellEmpty: async (p) => p.row !== SHEET_MONEY_REMAINING_ROW,
        writeMoneyToCell: async (...a) => {
          writes.push(a);
        },
      }),
    );
    const { bot, getLastBotMessage } = setupTestBot();
    await bot.handleUpdate(textMessageUpdate('/money 25'));
    const m1 = getLastBotMessage();
    await bot.handleUpdate(callbackQueryUpdate('mn:col:last', m1 as Message));
    const m2 = getLastBotMessage();
    await bot.handleUpdate(callbackQueryUpdate('mn:rp:yes', m2 as Message));
    expect(writes.length).toBe(1);
  });

  test('next column: date header not empty -> error and flow ends', async () => {
    testKit.setSheetsClient(
      baseSheets({
        findUserRowByTg: async () => 7,
        findLastDateColumn: async () => ({ column: 'F', date: '12 Apr' }),
        getNextDateColumnInfo: async () => ({
          nextColumn: 'G',
          headerEmpty: false,
          userCellEmpty: true,
        }),
        getMoneyUserCellInfo: async () => ({ cell: 'zero' }),
        isCellEmpty: async (p) => p.row === SHEET_MONEY_REMAINING_ROW,
        writeMoneyToCell: async () => {},
      }),
    );
    const { bot, calls, getLastBotMessage } = setupTestBot();
    await bot.handleUpdate(textMessageUpdate('/money 100'));
    const col = getLastBotMessage();
    await bot.handleUpdate(callbackQueryUpdate('mn:col:next', col as Message));
    expectTexts(calls, ['not free: the date cell'], 'sendMessage');
  });

  test('next column: your cell in next column is not empty -> error', async () => {
    testKit.setSheetsClient(
      baseSheets({
        findUserRowByTg: async () => 7,
        findLastDateColumn: async () => ({ column: 'F', date: '12 Apr' }),
        getNextDateColumnInfo: async () => ({
          nextColumn: 'G',
          headerEmpty: true,
          userCellEmpty: false,
        }),
        getMoneyUserCellInfo: async () => ({ cell: 'zero' }),
        isCellEmpty: async () => true,
        writeMoneyToCell: async () => {},
      }),
    );
    const { bot, calls, getLastBotMessage } = setupTestBot();
    await bot.handleUpdate(textMessageUpdate('/money 100'));
    const col = getLastBotMessage();
    await bot.handleUpdate(callbackQueryUpdate('mn:col:next', col as Message));
    expectTexts(calls, ['is not empty. I will not overwrite'], 'sendMessage');
  });

  test('next column: valid -> writes to next column (G)', async () => {
    const writes: Array<{ c: string; r: number; a: number }> = [];
    testKit.setSheetsClient(
      baseSheets({
        findUserRowByTg: async () => 7,
        findLastDateColumn: async () => ({ column: 'F', date: '12 Apr' }),
        getNextDateColumnInfo: async () => ({
          nextColumn: 'G',
          headerEmpty: true,
          userCellEmpty: true,
        }),
        getMoneyUserCellInfo: async (params) => {
          expect(params.column).toBe('G');
          expect(params.userRow).toBe(7);
          return { cell: 'zero' as const };
        },
        isCellEmpty: async (p) => {
          if (p.row === SHEET_MONEY_REMAINING_ROW) return false;
          return true;
        },
        writeMoneyToCell: async (c, r, a) => {
          writes.push({ c, r, a });
        },
      }),
    );
    const { bot, calls, getLastBotMessage } = setupTestBot();
    await bot.handleUpdate(textMessageUpdate('/money 600'));
    const colMsg = getLastBotMessage();
    await bot.handleUpdate(
      callbackQueryUpdate('mn:col:next', colMsg as Message),
    );
    expect(writes).toEqual([{ c: 'G', r: 7, a: 600 }]);
    expectTexts(calls, ['wrote', '600', 'G'], 'sendMessage');
  });

  test('zero cell and row4 empty -> row4 confirm -> write', async () => {
    const writes: Array<{ c: string; r: number; a: number }> = [];
    testKit.setSheetsClient(
      baseSheets({
        findUserRowByTg: async () => 7,
        findLastDateColumn: async () => ({ column: 'F', date: '12 Apr' }),
        getNextDateColumnInfo: async () => ({
          nextColumn: 'G',
          headerEmpty: true,
          userCellEmpty: true,
        }),
        getMoneyUserCellInfo: async () => ({ cell: 'zero' }),
        isCellEmpty: async (p) => p.row === SHEET_MONEY_REMAINING_ROW,
        writeMoneyToCell: async (c, r, a) => {
          writes.push({ c, r, a });
        },
      }),
    );
    const { bot, getLastBotMessage } = setupTestBot();
    await bot.handleUpdate(textMessageUpdate('/money 400'));
    const m0 = getLastBotMessage();
    await bot.handleUpdate(callbackQueryUpdate('mn:col:last', m0 as Message));
    const m1 = getLastBotMessage();
    expect(m1?.text).toMatch(/row 4|empty/i);
    await bot.handleUpdate(callbackQueryUpdate('mn:r4:yes', m1 as Message));
    expect(writes).toEqual([{ c: 'F', r: 7, a: 400 }]);
  });

  test('nonzero: replace then row4 empty -> r4:yes -> write', async () => {
    const writes: Array<{ c: string; r: number; a: number }> = [];
    testKit.setSheetsClient(
      baseSheets({
        findUserRowByTg: async () => 7,
        findLastDateColumn: async () => ({ column: 'F', date: '12 Apr' }),
        getNextDateColumnInfo: async () => ({
          nextColumn: 'G',
          headerEmpty: true,
          userCellEmpty: true,
        }),
        getMoneyUserCellInfo: async () => ({
          cell: 'number',
          numericValue: 10,
        }),
        isCellEmpty: async (p) => p.row === SHEET_MONEY_REMAINING_ROW,
        writeMoneyToCell: async (c, r, a) => {
          writes.push({ c, r, a });
        },
      }),
    );
    const { bot, getLastBotMessage } = setupTestBot();
    await bot.handleUpdate(textMessageUpdate('/money 15'));
    await bot.handleUpdate(
      callbackQueryUpdate('mn:col:last', getLastBotMessage() as Message),
    );
    await bot.handleUpdate(
      callbackQueryUpdate('mn:rp:yes', getLastBotMessage() as Message),
    );
    await bot.handleUpdate(
      callbackQueryUpdate('mn:r4:yes', getLastBotMessage() as Message),
    );
    expect(writes).toEqual([{ c: 'F', r: 7, a: 15 }]);
  });

  test('replace confirm cancel -> no write', async () => {
    const writes: unknown[] = [];
    testKit.setSheetsClient(
      baseSheets({
        findUserRowByTg: async () => 7,
        findLastDateColumn: async () => ({ column: 'F', date: '12 Apr' }),
        getNextDateColumnInfo: async () => ({
          nextColumn: 'G',
          headerEmpty: true,
          userCellEmpty: true,
        }),
        getMoneyUserCellInfo: async () => ({
          cell: 'number',
          numericValue: 1,
        }),
        isCellEmpty: async () => true,
        writeMoneyToCell: async (...a) => {
          writes.push(a);
        },
      }),
    );
    const { bot, calls, getLastBotMessage } = setupTestBot();
    await bot.handleUpdate(textMessageUpdate('/money 9'));
    await bot.handleUpdate(
      callbackQueryUpdate('mn:col:last', getLastBotMessage() as Message),
    );
    await bot.handleUpdate(
      callbackQueryUpdate('mn:rp:no', getLastBotMessage() as Message),
    );
    expect(writes).toEqual([]);
    expectTexts(calls, ['Cancelled.'], 'sendMessage');
  });

  test('empty cell: cancel add -> no write', async () => {
    const writes: unknown[] = [];
    testKit.setSheetsClient(
      baseSheets({
        findUserRowByTg: async () => 7,
        findLastDateColumn: async () => ({ column: 'F', date: '12 Apr' }),
        getNextDateColumnInfo: async () => ({
          nextColumn: 'G',
          headerEmpty: true,
          userCellEmpty: true,
        }),
        getMoneyUserCellInfo: async () => ({ cell: 'empty' }),
        isCellEmpty: async (p) =>
          p.column === 'F' && p.row === SHEET_MONEY_REMAINING_ROW,
        writeMoneyToCell: async (...a) => {
          writes.push(a);
        },
      }),
    );
    const { bot, calls, getLastBotMessage } = setupTestBot();
    await bot.handleUpdate(textMessageUpdate('/money 500'));
    await bot.handleUpdate(
      callbackQueryUpdate('mn:col:last', getLastBotMessage() as Message),
    );
    await bot.handleUpdate(
      callbackQueryUpdate('mn:em:no', getLastBotMessage() as Message),
    );
    expect(writes).toEqual([]);
    expectTexts(calls, ['Cancelled.'], 'sendMessage');
  });

  test('row4 confirm: cancel -> no write', async () => {
    const writes: unknown[] = [];
    testKit.setSheetsClient(
      baseSheets({
        findUserRowByTg: async () => 7,
        findLastDateColumn: async () => ({ column: 'F', date: '12 Apr' }),
        getNextDateColumnInfo: async () => ({
          nextColumn: 'G',
          headerEmpty: true,
          userCellEmpty: true,
        }),
        getMoneyUserCellInfo: async () => ({ cell: 'zero' }),
        isCellEmpty: async (p) => p.row === SHEET_MONEY_REMAINING_ROW,
        writeMoneyToCell: async (...a) => {
          writes.push(a);
        },
      }),
    );
    const { bot, calls, getLastBotMessage } = setupTestBot();
    await bot.handleUpdate(textMessageUpdate('/money 1'));
    await bot.handleUpdate(
      callbackQueryUpdate('mn:col:last', getLastBotMessage() as Message),
    );
    await bot.handleUpdate(
      callbackQueryUpdate('mn:r4:no', getLastBotMessage() as Message),
    );
    expect(writes).toEqual([]);
    expectTexts(calls, ['Cancelled.'], 'sendMessage');
  });

  test('no date columns: cannot start column step', async () => {
    testKit.setSheetsClient(
      baseSheets({
        findUserRowByTg: async () => 7,
        findLastDateColumn: async () => null,
        writeMoneyToCell: async () => {},
      }),
    );
    const { bot, calls } = setupTestBot();
    await bot.handleUpdate(textMessageUpdate('/money 50'));
    expectTexts(calls, ['No date columns found'], 'sendMessage');
  });

  test('/money then non-numeric amount replies incorrect', async () => {
    testKit.setSheetsClient(
      baseSheets({
        findUserRowByTg: async () => 7,
        findLastDateColumn: async () => ({ column: 'F', date: '12 Apr' }),
        getNextDateColumnInfo: async () => ({
          nextColumn: 'G',
          headerEmpty: true,
          userCellEmpty: true,
        }),
        getMoneyUserCellInfo: async () => ({ cell: 'zero' }),
        isCellEmpty: async () => true,
        writeMoneyToCell: async () => {},
      }),
    );
    const { bot, calls } = setupTestBot();
    await bot.handleUpdate(textMessageUpdate('/money'));
    await bot.handleUpdate(textMessageUpdate('not a number'));
    expectTexts(calls, ['incorrect'], 'sendMessage');
  });

  test('user without username cannot use /money with amount', async () => {
    testKit.setSheetsClient(baseSheets());
    const { bot, calls } = setupTestBot();
    const noUsername: User = {
      id: 99_002,
      is_bot: false,
      first_name: 'No',
    };
    await bot.handleUpdate(textMessageUpdateWithFrom('/money 10', noUsername));
    expectTexts(
      calls,
      ['Telegram username in your Telegram account'],
      'sendMessage',
    );
  });

  test('button-only state: free text nudges to use buttons or /cancel', async () => {
    testKit.setSheetsClient(
      baseSheets({
        findUserRowByTg: async () => 7,
        findLastDateColumn: async () => ({ column: 'F', date: '12 Apr' }),
        getNextDateColumnInfo: async () => ({
          nextColumn: 'G',
          headerEmpty: true,
          userCellEmpty: true,
        }),
        getMoneyUserCellInfo: async () => ({ cell: 'zero' }),
        isCellEmpty: async () => true,
        writeMoneyToCell: async () => {},
      }),
    );
    const { bot, calls } = setupTestBot();
    await bot.handleUpdate(textMessageUpdate('/money 88'));
    await bot.handleUpdate(textMessageUpdate('hello without buttons'));
    expectTexts(calls, ['Use the inline buttons'], 'sendMessage');
  });

  test('stale col:last after /cancel is rejected', async () => {
    testKit.setSheetsClient(
      baseSheets({
        findUserRowByTg: async () => 7,
        findLastDateColumn: async () => ({ column: 'F', date: '12 Apr' }),
        getNextDateColumnInfo: async () => ({
          nextColumn: 'G',
          headerEmpty: true,
          userCellEmpty: true,
        }),
        getMoneyUserCellInfo: async () => ({ cell: 'zero' }),
        isCellEmpty: async () => true,
        writeMoneyToCell: async () => {},
      }),
    );
    const { bot, calls, getLastBotMessage } = setupTestBot();
    await bot.handleUpdate(textMessageUpdate('/money 33'));
    const colMsg = getLastBotMessage() as Message;
    await bot.handleUpdate(textMessageUpdate('/cancel'));
    await bot.handleUpdate(callbackQueryUpdate('mn:col:last', colMsg));
    expectTexts(calls, ['out of date', '/money again'], 'sendMessage');
  });

  test('plain number in a group is ignored (no money flow)', async () => {
    const { bot, calls } = setupTestBot();
    testKit.setSheetsClient(
      baseSheets({
        findUserRowByTg: async () => 7,
        findLastDateColumn: async () => ({ column: 'F', date: '12 Apr' }),
        getMoneyUserCellInfo: async () => ({ cell: 'zero' }),
        isCellEmpty: async () => true,
        writeMoneyToCell: async () => {},
      }),
    );
    await bot.handleUpdate(textMessageUpdateInGroup('200'));
    const sent = calls.filter(
      (c) => c.method === 'sendMessage' && c.payload && 'text' in c.payload,
    ) as { payload: { text?: string } }[];
    const moneyHints = sent.filter((c) =>
      c.payload.text?.toLowerCase().includes('write'),
    );
    expect(moneyHints.length).toBe(0);
  });
});

describe('parseAmountFromString', () => {
  test('rejects trailing junk (no longer accepted as parseFloat prefix)', () => {
    expect(parseAmountFromString('100usd')).toBeNull();
  });

  test('rejects malformed decimals', () => {
    expect(parseAmountFromString('12.3.4')).toBeNull();
  });

  test('rejects scientific notation', () => {
    expect(parseAmountFromString('1e2')).toBeNull();
  });

  test('accepts integer and decimal strings in range', () => {
    expect(parseAmountFromString('500')).toBe(500);
    expect(parseAmountFromString(String(MONEY_MAX_AMOUNT))).toBe(MONEY_MAX_AMOUNT);
    expect(parseAmountFromString('1.5')).toBe(1.5);
  });
});
