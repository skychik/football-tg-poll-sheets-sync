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

    expectTexts(calls, ['Using column F', 'Now send the list of usernames']);
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
      '2 recognized username',
      'Is 2 the total',
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

    expectTexts(calls, ['Which option contains the attending players']);

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
});
