import { beforeEach, describe, expect, test } from 'bun:test';
import type { Message } from '@grammyjs/types';
import { baseSheets } from './sheet-test-stub';
import { createTelegramTestKit } from './support/create-test-bot';
import { sentTexts } from './support/mock-telegram-api';
import {
  callbackQueryUpdate,
  pollMessageUpdate,
  textMessageUpdate,
} from './support/telegram-updates';
import { expectTexts, normalizeTelegramText } from './support/test-assertions';

const testKit = createTelegramTestKit();
const { pollStorage: testPollStorage, setupTestBot } = testKit;

function buttonTexts(message: Message | undefined): string[] {
  return (
    message?.reply_markup?.inline_keyboard
      ?.flatMap((row) => row.map((button) => button.text))
      .filter(Boolean) ?? []
  );
}

beforeEach(() => {
  testKit.reset();
});

describe('Telegram scenario tests', () => {
  test('Scenario 1: /update detects column F and asks for usernames after Use F', async () => {
    testKit.setSheetsClient(
      baseSheets({
        findLastDateColumn: async () => ({ column: 'F', date: '12 Apr' }),
        getColumnMetadata: async () => ({ date: '12 Apr', cost: 700 }),
      }),
    );

    const { bot, calls, getLastBotMessage } = setupTestBot();

    await bot.handleUpdate(textMessageUpdate('/update'));
    expectTexts(calls, ['⏳ Detecting last date column', 'column F', '12 Apr']);

    const confirmMsg = getLastBotMessage();
    expect(confirmMsg).toBeDefined();

    await bot.handleUpdate(
      callbackQueryUpdate('col:use:F', confirmMsg as Message),
    );

    expectTexts(calls, [
      'Using column F',
      'Now send the list of Telegram usernames',
    ]);
    const all = sentTexts(calls).map(normalizeTelegramText);
    expect(all.some((t) => t.includes('Column F metadata'))).toBe(true);
  });

  test('Scenario 2: no date columns -> create first column flow', async () => {
    testKit.setSheetsClient(
      baseSheets({
        findLastDateColumn: async () => null,
      }),
    );

    const { bot, calls, getLastBotMessage } = setupTestBot();

    await bot.handleUpdate(textMessageUpdate('/update'));
    expectTexts(calls, ['No date columns found', 'Create column']);

    const keyboardMsg = getLastBotMessage();
    await bot.handleUpdate(
      callbackQueryUpdate('col:create:F', keyboardMsg as Message),
    );

    expectTexts(
      calls,
      ['Please provide the date name for column F'],
      'editMessageText',
    );
  });

  test('Scenario 3: usernames -> player count confirmation', async () => {
    testKit.setSheetsClient(
      baseSheets({
        findLastDateColumn: async () => ({ column: 'F', date: '12 Apr' }),
        getColumnMetadata: async () => ({ date: '12 Apr', cost: 700 }),
        findNicknameRows: async (nicknames) => {
          const m = new Map<string, number>();
          let row = 7;
          for (const n of nicknames) {
            m.set(n, row++);
          }
          return m;
        },
      }),
    );

    const { bot, calls, getLastBotMessage } = setupTestBot();

    await bot.handleUpdate(textMessageUpdate('/update'));
    const confirmMsg = getLastBotMessage();
    await bot.handleUpdate(
      callbackQueryUpdate('col:use:F', confirmMsg as Message),
    );

    await bot.handleUpdate(textMessageUpdate('@alice @bob'));

    expectTexts(calls, [
      '⏳ Checking sheet',
      '2 recognized Telegram username',
      'Is 2 the attendance count',
    ]);
  });

  test('Scenario 4: confirm player count -> existing values -> override prompt', async () => {
    testKit.setSheetsClient(
      baseSheets({
        findLastDateColumn: async () => ({ column: 'F', date: '12 Apr' }),
        getColumnMetadata: async () => ({ date: '12 Apr', cost: 700 }),
        findNicknameRows: async () =>
          new Map([
            ['@alice', 7],
            ['@bob', 8],
          ]),
        checkExistingValues: async () => [{ nickname: '@alice', value: 5 }],
        writeColumnMetadata: async () => {},
      }),
    );

    const { bot, calls, getLastBotMessage } = setupTestBot();

    await bot.handleUpdate(textMessageUpdate('/update'));
    await bot.handleUpdate(
      callbackQueryUpdate('col:use:F', getLastBotMessage() as Message),
    );
    await bot.handleUpdate(textMessageUpdate('@alice @bob'));
    await bot.handleUpdate(textMessageUpdate('yes'));

    expectTexts(calls, ['already have values', '@alice']);
  });

  test('Scenario 5: override skip -> summary with skipped users', async () => {
    testKit.setSheetsClient(
      baseSheets({
        findLastDateColumn: async () => ({ column: 'F', date: '12 Apr' }),
        getColumnMetadata: async () => ({ date: '12 Apr', cost: 700 }),
        findNicknameRows: async () =>
          new Map([
            ['@alice', 7],
            ['@bob', 8],
          ]),
        checkExistingValues: async () => [{ nickname: '@alice', value: 5 }],
        writeColumnMetadata: async () => {},
        writeZeros: async (_rows, _col, overrideExisting) => ({
          updated: overrideExisting ? 2 : 1,
          notFound: [],
        }),
      }),
    );

    const { bot, calls, getLastBotMessage } = setupTestBot();

    await bot.handleUpdate(textMessageUpdate('/update'));
    await bot.handleUpdate(
      callbackQueryUpdate('col:use:F', getLastBotMessage() as Message),
    );
    await bot.handleUpdate(textMessageUpdate('@alice @bob'));
    await bot.handleUpdate(textMessageUpdate('yes'));
    await bot.handleUpdate(textMessageUpdate('no'));

    expectTexts(calls, ['Updated 1 record(s)', 'Skipped']);
    const joined = sentTexts(calls).join('\n');
    expect(joined.includes('@alice') || joined.includes('alice')).toBe(true);
  });

  test('Scenario 6: forwarded poll -> update -> option 1 -> column detection', async () => {
    await testPollStorage.savePollData('poll_tracked_1', {
      question: 'When?',
      options: ['Mon', 'Tue'],
      votes: { '0': ['@alice', '@bob'] },
    });

    testKit.setSheetsClient(
      baseSheets({
        findLastDateColumn: async () => ({ column: 'F', date: '12 Apr' }),
        getColumnMetadata: async () => ({ date: '12 Apr', cost: 700 }),
      }),
    );

    const { bot, calls } = setupTestBot();

    await bot.handleUpdate(
      pollMessageUpdate({
        pollId: 'poll_tracked_1',
        question: 'When?',
        options: ['Mon', 'Tue'],
        forward: true,
      }),
    );

    expectTexts(calls, ['What would you like to do']);

    await bot.handleUpdate(textMessageUpdate('1'));

    expectTexts(calls, ['Which option contains the attendees']);

    await bot.handleUpdate(textMessageUpdate('1'));

    expectTexts(calls, [
      'Selected option',
      '@alice',
      'Detecting last date column',
    ]);
  });

  test('Scenario 7: forwarded poll not in Redis -> rejection', async () => {
    const { bot, calls } = setupTestBot();

    await bot.handleUpdate(
      pollMessageUpdate({
        pollId: 'unknown_poll',
        question: 'X?',
        options: ['A'],
        forward: true,
      }),
    );

    expectTexts(calls, ['not created by me', '/poll']);
  });

  test('poll reconciliation removes no-shows before writing', async () => {
    await testPollStorage.savePollData('poll_reconcile_remove', {
      question: 'When?',
      options: ['Play'],
      votes: { '0': ['@alice', '@bob', '@carl'] },
    });

    const writes: Array<{ rows: Array<[string, number]>; count?: number }> = [];
    testKit.setSheetsClient(
      baseSheets({
        findLastDateColumn: async () => ({ column: 'F', date: '12 Apr' }),
        getColumnMetadata: async () => ({
          date: '12 Apr',
          cost: 700,
          playerCount: 99,
        }),
        findNicknameRows: async (nicknames) =>
          new Map(
            nicknames.map(
              (nickname, index) => [nickname, 7 + index] as [string, number],
            ),
          ),
        listPlayers: async () => [],
        writeColumnMetadata: async (_column, _date, _cost, playerCount) => {
          writes.push({ rows: [], count: playerCount });
        },
        writeZeros: async (rows) => {
          writes.push({ rows: Array.from(rows.entries()) });
          return { updated: rows.size, notFound: [] };
        },
      }),
    );

    const { bot, calls, getLastBotMessage } = setupTestBot();
    await bot.handleUpdate(
      pollMessageUpdate({
        pollId: 'poll_reconcile_remove',
        question: 'When?',
        options: ['Play'],
        forward: true,
      }),
    );
    await bot.handleUpdate(textMessageUpdate('1'));
    await bot.handleUpdate(textMessageUpdate('1'));
    await bot.handleUpdate(
      callbackQueryUpdate('col:use:F', getLastBotMessage() as Message),
    );
    await bot.handleUpdate(textMessageUpdate('2'));
    await bot.handleUpdate(
      callbackQueryUpdate('pl:rm:@bob', getLastBotMessage() as Message),
    );
    expect(calls.some((call) => call.method === 'deleteMessage')).toBe(true);
    await bot.handleUpdate(
      callbackQueryUpdate('pl:rmdone', getLastBotMessage() as Message),
    );

    expectTexts(calls, [
      'attendance count',
      'Remove voters',
      'Updated 2 record',
    ]);
    expect(writes).toContainEqual({ rows: [], count: 2 });
    expect(writes).toContainEqual({
      rows: [
        ['@alice', 7],
        ['@carl', 8],
      ],
    });
  });

  test('poll reconciliation adds existing players from paginated roster search', async () => {
    await testPollStorage.savePollData('poll_reconcile_existing', {
      question: 'When?',
      options: ['Play'],
      votes: { '0': ['@alice'] },
    });

    const rowsWritten: Array<[string, number]>[] = [];
    testKit.setSheetsClient(
      baseSheets({
        findLastDateColumn: async () => ({ column: 'F', date: '12 Apr' }),
        getColumnMetadata: async () => ({ date: '12 Apr', cost: 700 }),
        findNicknameRows: async (nicknames) =>
          new Map(nicknames.map((n, i) => [n, 7 + i] as [string, number])),
        listPlayers: async () => [
          { row: 7, name: 'Alice', nickname: '@alice' },
          { row: 8, name: 'Ivan One', nickname: '@ivan1' },
          { row: 9, name: 'Ivan Two', nickname: '@ivan2' },
          { row: 10, name: 'Ivan Three', nickname: '@ivan3' },
          { row: 11, name: 'Ivan Four', nickname: '@ivan4' },
          { row: 12, name: 'Ivan Five', nickname: '@ivan5' },
          { row: 13, name: 'Ivan Six', nickname: '@ivan6' },
        ],
        writeZeros: async (rows) => {
          rowsWritten.push(Array.from(rows.entries()));
          return { updated: rows.size, notFound: [] };
        },
      }),
    );

    const { bot, calls, getLastBotMessage } = setupTestBot();
    await bot.handleUpdate(
      pollMessageUpdate({
        pollId: 'poll_reconcile_existing',
        question: 'When?',
        options: ['Play'],
        forward: true,
      }),
    );
    await bot.handleUpdate(textMessageUpdate('1'));
    await bot.handleUpdate(textMessageUpdate('1'));
    await bot.handleUpdate(
      callbackQueryUpdate('col:use:F', getLastBotMessage() as Message),
    );
    await bot.handleUpdate(textMessageUpdate('2'));
    const checklistMessage = getLastBotMessage() as Message;
    const deletesBeforeAdd = calls.filter(
      (call) => call.method === 'deleteMessage',
    ).length;
    await bot.handleUpdate(
      callbackQueryUpdate('pl:addmissing', checklistMessage),
    );
    expect(buttonTexts(checklistMessage)).toContain('Remove @alice');
    expect(calls.filter((call) => call.method === 'deleteMessage').length).toBe(
      deletesBeforeAdd,
    );
    expect(buttonTexts(getLastBotMessage())).toEqual([
      '🔎 Add existing player',
      '➕ Add new player',
    ]);
    await bot.handleUpdate(textMessageUpdate('ivan'));
    await bot.handleUpdate(
      callbackQueryUpdate('pl:sp:1', getLastBotMessage() as Message),
    );
    await bot.handleUpdate(
      callbackQueryUpdate('pl:pick:5', getLastBotMessage() as Message),
    );
    await bot.handleUpdate(
      callbackQueryUpdate(
        'pl:confirm-existing:yes',
        getLastBotMessage() as Message,
      ),
    );
    expect(buttonTexts(getLastBotMessage())).toContain('Remove @alice');
    expect(buttonTexts(getLastBotMessage())).toContain('✅ Confirm attendees');
    await bot.handleUpdate(
      callbackQueryUpdate('pl:rmdone', getLastBotMessage() as Message),
    );

    expectTexts(calls, [
      'Pick the attendee',
      'page 2/2',
      'Ivan Six',
      'Updated 2 record',
    ]);
    expect(rowsWritten.at(-1)).toEqual([
      ['@alice', 7],
      ['@ivan6', 13],
    ]);
  });

  test('poll reconciliation can create name-only and username attendees', async () => {
    await testPollStorage.savePollData('poll_reconcile_create', {
      question: 'When?',
      options: ['Play'],
      votes: { '0': ['@alice'] },
    });

    const created: Array<{ row: number; name: string; nickname?: string }> = [];
    let nextRow = 20;
    let writeRows: Array<[string, number]> = [];
    testKit.setSheetsClient(
      baseSheets({
        findLastDateColumn: async () => ({ column: 'F', date: '12 Apr' }),
        getColumnMetadata: async () => ({ date: '12 Apr', cost: 700 }),
        findNicknameRows: async (nicknames) =>
          new Map(nicknames.map((n, i) => [n, 7 + i] as [string, number])),
        listPlayers: async () => [
          { row: 7, name: 'Alice', nickname: '@alice' },
        ],
        findFirstRowWithEmptyNameAndTg: async () => nextRow,
        writeRegisterRow: async (row, name, nickname) => {
          created.push({ row, name, nickname });
          nextRow += 1;
        },
        writeZeros: async (rows) => {
          writeRows = Array.from(rows.entries());
          return { updated: rows.size, notFound: [] };
        },
      }),
    );

    const { bot, calls, getLastBotMessage } = setupTestBot();
    await bot.handleUpdate(
      pollMessageUpdate({
        pollId: 'poll_reconcile_create',
        question: 'When?',
        options: ['Play'],
        forward: true,
      }),
    );
    await bot.handleUpdate(textMessageUpdate('1'));
    await bot.handleUpdate(textMessageUpdate('1'));
    await bot.handleUpdate(
      callbackQueryUpdate('col:use:F', getLastBotMessage() as Message),
    );
    await bot.handleUpdate(textMessageUpdate('3'));
    const checklistMessage = getLastBotMessage() as Message;
    await bot.handleUpdate(
      callbackQueryUpdate('pl:addmissing', checklistMessage),
    );
    await bot.handleUpdate(
      callbackQueryUpdate('pl:addnew', getLastBotMessage() as Message),
    );
    await bot.handleUpdate(textMessageUpdate('Pavel NoNick'));
    await bot.handleUpdate(
      callbackQueryUpdate('pl:confirm-new:yes', getLastBotMessage() as Message),
    );
    expect(created).toEqual([]);
    await bot.handleUpdate(
      callbackQueryUpdate('pl:addmissing', checklistMessage),
    );
    expect(normalizeTelegramText(getLastBotMessage()?.text ?? '')).toContain(
      'Pavel NoNick',
    );
    await bot.handleUpdate(
      callbackQueryUpdate('pl:addnew', getLastBotMessage() as Message),
    );
    await bot.handleUpdate(textMessageUpdate('Sergey Handle @sergey_handle'));
    await bot.handleUpdate(
      callbackQueryUpdate('pl:confirm-new:yes', getLastBotMessage() as Message),
    );
    expect(buttonTexts(getLastBotMessage())).toContain('Remove @alice');
    expect(buttonTexts(getLastBotMessage())).toContain('✅ Confirm attendees');
    await bot.handleUpdate(
      callbackQueryUpdate('pl:rmdone', getLastBotMessage() as Message),
    );

    expectTexts(calls, [
      'Telegram: none',
      '@sergey_handle',
      'Updated 3 record',
    ]);
    expect(created).toEqual([
      { row: 20, name: 'Pavel NoNick', nickname: '' },
      { row: 21, name: 'Sergey Handle', nickname: '@sergey_handle' },
    ]);
    expect(writeRows).toEqual([
      ['@alice', 7],
      ['Pavel NoNick', 20],
      ['@sergey_handle', 21],
    ]);
  });

  test('poll reconciliation checks full possible existing player list before creating', async () => {
    await testPollStorage.savePollData('poll_reconcile_create_existing', {
      question: 'When?',
      options: ['Play'],
      votes: { '0': ['@alice'] },
    });

    const created: Array<{ row: number; name: string; nickname?: string }> = [];
    let writeRows: Array<[string, number]> = [];
    testKit.setSheetsClient(
      baseSheets({
        findLastDateColumn: async () => ({ column: 'F', date: '12 Apr' }),
        getColumnMetadata: async () => ({ date: '12 Apr', cost: 700 }),
        findNicknameRows: async () => new Map([['@alice', 7]]),
        listPlayers: async () => [
          { row: 7, name: 'Alice', nickname: '@alice' },
          { row: 8, name: 'Boris Good', nickname: '@boris_good' },
          { row: 9, name: 'Boris Better', nickname: '@boris_better' },
          { row: 10, name: 'Boris Fast', nickname: '@boris_fast' },
          { row: 11, name: 'Boris Left', nickname: '@boris_left' },
          { row: 12, name: 'Boris Right', nickname: '@boris_right' },
          { row: 13, name: 'Boris Last', nickname: '@boris_last' },
        ],
        findFirstRowWithEmptyNameAndTg: async () => 20,
        writeRegisterRow: async (row, name, nickname) => {
          created.push({ row, name, nickname });
        },
        writeZeros: async (rows) => {
          writeRows = Array.from(rows.entries());
          return { updated: rows.size, notFound: [] };
        },
      }),
    );

    const { bot, calls, getLastBotMessage } = setupTestBot();
    await bot.handleUpdate(
      pollMessageUpdate({
        pollId: 'poll_reconcile_create_existing',
        question: 'When?',
        options: ['Play'],
        forward: true,
      }),
    );
    await bot.handleUpdate(textMessageUpdate('1'));
    await bot.handleUpdate(textMessageUpdate('1'));
    await bot.handleUpdate(
      callbackQueryUpdate('col:use:F', getLastBotMessage() as Message),
    );
    await bot.handleUpdate(textMessageUpdate('2'));
    await bot.handleUpdate(
      callbackQueryUpdate('pl:addmissing', getLastBotMessage() as Message),
    );
    await bot.handleUpdate(
      callbackQueryUpdate('pl:addnew', getLastBotMessage() as Message),
    );
    await bot.handleUpdate(textMessageUpdate('Boris Unknown @boris'));
    expectTexts(calls, ['Possible existing players', 'page 1/2']);
    expect(buttonTexts(getLastBotMessage())).toContain('Next ▶️');
    await bot.handleUpdate(
      callbackQueryUpdate('pl:cmp:1', getLastBotMessage() as Message),
    );
    expectTexts(calls, ['page 2/2']);
    expect(buttonTexts(getLastBotMessage())).toContain(
      'Boris Last / @boris_last',
    );
    await bot.handleUpdate(
      callbackQueryUpdate('pl:pick:5', getLastBotMessage() as Message),
    );
    await bot.handleUpdate(
      callbackQueryUpdate(
        'pl:confirm-existing:yes',
        getLastBotMessage() as Message,
      ),
    );
    await bot.handleUpdate(
      callbackQueryUpdate('pl:rmdone', getLastBotMessage() as Message),
    );

    expectTexts(calls, ['Possible existing players', 'Boris Last']);
    expect(created).toEqual([]);
    expect(writeRows).toEqual([
      ['@alice', 7],
      ['@boris_last', 13],
    ]);
  });

  test('poll reconciliation carries unknown voter username into creation', async () => {
    await testPollStorage.savePollData('poll_reconcile_unknown_voter', {
      question: 'When?',
      options: ['Play'],
      votes: { '0': ['@alice', '@new_voter'] },
    });

    const created: Array<{ row: number; name: string; nickname?: string }> = [];
    let writeRows: Array<[string, number]> = [];
    testKit.setSheetsClient(
      baseSheets({
        findLastDateColumn: async () => ({ column: 'F', date: '12 Apr' }),
        getColumnMetadata: async () => ({ date: '12 Apr', cost: 700 }),
        findNicknameRows: async (nicknames) =>
          new Map(
            nicknames
              .filter((n) => n === '@alice')
              .map((n) => [n, 7] as [string, number]),
          ),
        listPlayers: async () => [
          { row: 7, name: 'Alice', nickname: '@alice' },
        ],
        findFirstRowWithEmptyNameAndTg: async () => 20,
        writeRegisterRow: async (row, name, nickname) => {
          created.push({ row, name, nickname });
        },
        writeZeros: async (rows) => {
          writeRows = Array.from(rows.entries());
          return { updated: rows.size, notFound: [] };
        },
      }),
    );

    const { bot, calls, getLastBotMessage } = setupTestBot();
    await bot.handleUpdate(
      pollMessageUpdate({
        pollId: 'poll_reconcile_unknown_voter',
        question: 'When?',
        options: ['Play'],
        forward: true,
      }),
    );
    await bot.handleUpdate(textMessageUpdate('1'));
    await bot.handleUpdate(textMessageUpdate('1'));
    await bot.handleUpdate(
      callbackQueryUpdate('col:use:F', getLastBotMessage() as Message),
    );
    await bot.handleUpdate(textMessageUpdate('2'));
    await bot.handleUpdate(
      callbackQueryUpdate('pl:rmdone', getLastBotMessage() as Message),
    );
    await bot.handleUpdate(
      callbackQueryUpdate('pl:addnew', getLastBotMessage() as Message),
    );
    await bot.handleUpdate(textMessageUpdate('New Voter'));
    await bot.handleUpdate(
      callbackQueryUpdate('pl:confirm-new:yes', getLastBotMessage() as Message),
    );
    await bot.handleUpdate(
      callbackQueryUpdate('pl:rmdone', getLastBotMessage() as Message),
    );

    expectTexts(calls, ['@new_voter', 'Updated 2 record']);
    expect(created).toEqual([
      { row: 20, name: 'New Voter', nickname: '@new_voter' },
    ]);
    expect(writeRows).toEqual([
      ['@alice', 7],
      ['@new_voter', 20],
    ]);
  });

  test('poll reconciliation no-match screen allows another search', async () => {
    await testPollStorage.savePollData('poll_reconcile_retry', {
      question: 'When?',
      options: ['Play'],
      votes: { '0': ['@alice'] },
    });

    let writeRows: Array<[string, number]> = [];
    testKit.setSheetsClient(
      baseSheets({
        findLastDateColumn: async () => ({ column: 'F', date: '12 Apr' }),
        getColumnMetadata: async () => ({ date: '12 Apr', cost: 700 }),
        findNicknameRows: async () => new Map([['@alice', 7]]),
        listPlayers: async () => [
          { row: 7, name: 'Alice', nickname: '@alice' },
          { row: 8, name: 'Boris Good', nickname: '@boris' },
        ],
        writeZeros: async (rows) => {
          writeRows = Array.from(rows.entries());
          return { updated: rows.size, notFound: [] };
        },
      }),
    );

    const { bot, calls, getLastBotMessage } = setupTestBot();
    await bot.handleUpdate(
      pollMessageUpdate({
        pollId: 'poll_reconcile_retry',
        question: 'When?',
        options: ['Play'],
        forward: true,
      }),
    );
    await bot.handleUpdate(textMessageUpdate('1'));
    await bot.handleUpdate(textMessageUpdate('1'));
    await bot.handleUpdate(
      callbackQueryUpdate('col:use:F', getLastBotMessage() as Message),
    );
    await bot.handleUpdate(textMessageUpdate('2'));
    await bot.handleUpdate(
      callbackQueryUpdate('pl:addmissing', getLastBotMessage() as Message),
    );
    await bot.handleUpdate(textMessageUpdate('zzzz'));
    await bot.handleUpdate(
      callbackQueryUpdate('pl:retry', getLastBotMessage() as Message),
    );
    await bot.handleUpdate(textMessageUpdate('boris'));
    await bot.handleUpdate(
      callbackQueryUpdate('pl:pick:0', getLastBotMessage() as Message),
    );
    await bot.handleUpdate(
      callbackQueryUpdate(
        'pl:confirm-existing:yes',
        getLastBotMessage() as Message,
      ),
    );
    await bot.handleUpdate(
      callbackQueryUpdate('pl:rmdone', getLastBotMessage() as Message),
    );

    expectTexts(calls, ['No matches', 'Try another query', 'Boris Good']);
    expect(writeRows).toEqual([
      ['@alice', 7],
      ['@boris', 8],
    ]);
  });

  test('poll reconciliation still shows override prompt after resolving attendees', async () => {
    await testPollStorage.savePollData('poll_reconcile_override', {
      question: 'When?',
      options: ['Play'],
      votes: { '0': ['@alice'] },
    });

    testKit.setSheetsClient(
      baseSheets({
        findLastDateColumn: async () => ({ column: 'F', date: '12 Apr' }),
        getColumnMetadata: async () => ({ date: '12 Apr', cost: 700 }),
        findNicknameRows: async () => new Map([['@alice', 7]]),
        listPlayers: async () => [],
        checkExistingValues: async () => [{ nickname: '@alice', value: 5 }],
      }),
    );

    const { bot, calls, getLastBotMessage } = setupTestBot();
    await bot.handleUpdate(
      pollMessageUpdate({
        pollId: 'poll_reconcile_override',
        question: 'When?',
        options: ['Play'],
        forward: true,
      }),
    );
    await bot.handleUpdate(textMessageUpdate('1'));
    await bot.handleUpdate(textMessageUpdate('1'));
    await bot.handleUpdate(
      callbackQueryUpdate('col:use:F', getLastBotMessage() as Message),
    );
    await bot.handleUpdate(textMessageUpdate('1'));
    await bot.handleUpdate(
      callbackQueryUpdate('pl:rmdone', getLastBotMessage() as Message),
    );

    expectTexts(calls, ['already have values', '@alice']);
  });
});
