import { beforeEach, describe, expect, test } from 'bun:test';
import type { Message } from '@grammyjs/types';
import { baseSheets } from './sheet-test-stub';
import { createTelegramTestKit } from './support/create-test-bot';
import {
  callbackQueryUpdate,
  pollMessageUpdate,
  textMessageUpdate,
} from './support/telegram-updates';
import { expectTexts } from './support/test-assertions';

const testKit = createTelegramTestKit();
const { pollStorage: testPollStorage, setupTestBot } = testKit;

beforeEach(() => {
  testKit.reset();
});

describe('callback query handlers', () => {
  test('col:new:G asks for date name for new column', async () => {
    testKit.setSheetsClient(
      baseSheets({
        findLastDateColumn: async () => ({ column: 'F', date: '12 Apr' }),
      }),
    );

    const { bot, calls, getLastBotMessage } = setupTestBot();
    await bot.handleUpdate(textMessageUpdate('/update'));
    const msg = getLastBotMessage();
    expect(msg).toBeDefined();

    await bot.handleUpdate(callbackQueryUpdate('col:new:G', msg as Message));

    expectTexts(
      calls,
      ['Please provide the date name for column G'],
      'editMessageText',
    );
  });

  test('col:cancel aborts first-column flow', async () => {
    testKit.setSheetsClient(
      baseSheets({
        findLastDateColumn: async () => null,
      }),
    );

    const { bot, calls, getLastBotMessage } = setupTestBot();
    await bot.handleUpdate(textMessageUpdate('/update'));
    const msg = getLastBotMessage();

    await bot.handleUpdate(callbackQueryUpdate('col:cancel', msg as Message));

    expectTexts(calls, ['Operation cancelled', '/update'], 'editMessageText');
  });

  test('col:select:H after multiple date matches proceeds to metadata', async () => {
    testKit.setSheetsClient(
      baseSheets({
        findLastDateColumn: async () => ({ column: 'F', date: '12 Apr' }),
        findColumnByDateText: async () => ({
          success: true,
          multiple: true,
          matches: [
            { column: 'H', date: 'Apr A' },
            { column: 'I', date: 'May B' },
          ],
        }),
        getColumnMetadata: async () => ({ date: 'Apr A', cost: 100 }),
      }),
    );

    const { bot, calls, getLastBotMessage } = setupTestBot();
    await bot.handleUpdate(textMessageUpdate('/update'));
    await bot.handleUpdate(textMessageUpdate('multi'));

    const pickMsg = getLastBotMessage();
    expect(pickMsg).toBeDefined();

    await bot.handleUpdate(
      callbackQueryUpdate('col:select:H', pickMsg as Message),
    );

    expectTexts(calls, ['Selected column H'], 'editMessageText');
    expectTexts(calls, [
      'Column H metadata',
      'Now send the list of Telegram usernames',
    ]);
  });

  test('yn:playercount:no asks for manual attendance count', async () => {
    testKit.setSheetsClient(
      baseSheets({
        findLastDateColumn: async () => ({ column: 'F', date: '12 Apr' }),
        getColumnMetadata: async () => ({ date: '12 Apr', cost: 700 }),
        findNicknameRows: async () => new Map([['@alice', 7]]),
      }),
    );

    const { bot, calls, getLastBotMessage } = setupTestBot();
    await bot.handleUpdate(textMessageUpdate('/update'));
    await bot.handleUpdate(
      callbackQueryUpdate('col:use:F', getLastBotMessage() as Message),
    );
    await bot.handleUpdate(textMessageUpdate('@alice'));

    const confirmMsg = getLastBotMessage();
    await bot.handleUpdate(
      callbackQueryUpdate('yn:playercount:no', confirmMsg as Message),
    );

    expectTexts(
      calls,
      ['What was the attendance count for the match?'],
      'editMessageText',
    );
  });

  test('yn:playercount:yes completes write when no existing cells', async () => {
    testKit.setSheetsClient(
      baseSheets({
        findLastDateColumn: async () => ({ column: 'F', date: '12 Apr' }),
        getColumnMetadata: async () => ({ date: '12 Apr', cost: 700 }),
        findNicknameRows: async () => new Map([['@alice', 7]]),
        checkExistingValues: async () => [],
        writeColumnMetadata: async () => {},
        writeZeros: async () => ({ updated: 1, notFound: [] }),
      }),
    );

    const { bot, calls, getLastBotMessage } = setupTestBot();
    await bot.handleUpdate(textMessageUpdate('/update'));
    await bot.handleUpdate(
      callbackQueryUpdate('col:use:F', getLastBotMessage() as Message),
    );
    await bot.handleUpdate(textMessageUpdate('@alice'));

    const confirmMsg = getLastBotMessage();
    await bot.handleUpdate(
      callbackQueryUpdate('yn:playercount:yes', confirmMsg as Message),
    );

    expectTexts(calls, ['Updating sheet', 'Updated 1 record']);
  });

  test('yn:override:yes overwrites existing cells', async () => {
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

    const overrideMsg = getLastBotMessage();
    await bot.handleUpdate(
      callbackQueryUpdate('yn:override:yes', overrideMsg as Message),
    );

    expectTexts(calls, ['Will overwrite existing values'], 'editMessageText');
    expectTexts(calls, ['Updated 2 record']);
  });

  test('yn:override:no skips existing and completes', async () => {
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

    const overrideMsg = getLastBotMessage();
    await bot.handleUpdate(
      callbackQueryUpdate('yn:override:no', overrideMsg as Message),
    );

    expectTexts(calls, ['Will skip existing values'], 'editMessageText');
    expectTexts(calls, ['Updated 1 record', 'Skipped']);
  });

  test('poll intent pi:update shows option keyboard', async () => {
    await testPollStorage.savePollData('poll_cb_1', {
      question: 'When?',
      options: ['Mon', 'Tue'],
      votes: { '0': ['@a'] },
    });

    testKit.setSheetsClient(
      baseSheets({
        findLastDateColumn: async () => ({ column: 'F', date: '12 Apr' }),
      }),
    );

    const { bot, calls, getLastBotMessage } = setupTestBot();

    await bot.handleUpdate(
      pollMessageUpdate({
        pollId: 'poll_cb_1',
        question: 'When?',
        options: ['Mon', 'Tue'],
        forward: true,
      }),
    );

    const intentMsg = getLastBotMessage();
    await bot.handleUpdate(
      callbackQueryUpdate('pi:update', intentMsg as Message),
    );

    expectTexts(calls, ['Which option contains the attendees']);
  });

  test('poll intent pi:view shows voters and resets session', async () => {
    await testPollStorage.savePollData('poll_cb_view', {
      question: 'When?',
      options: ['Mon', 'Tue'],
      votes: { '0': ['@alice', '@bob'] },
    });

    const { bot, calls, getLastBotMessage } = setupTestBot();

    await bot.handleUpdate(
      pollMessageUpdate({
        pollId: 'poll_cb_view',
        question: 'When?',
        options: ['Mon', 'Tue'],
        forward: true,
      }),
    );

    const intentMsg = getLastBotMessage();
    await bot.handleUpdate(
      callbackQueryUpdate('pi:view', intentMsg as Message),
    );

    expectTexts(calls, ['Poll:', 'Mon:', '@alice'], 'editMessageText');
  });

  test('poll option po:0 via callback runs column detection', async () => {
    await testPollStorage.savePollData('poll_cb_opt', {
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

    const { bot, calls, getLastBotMessage } = setupTestBot();

    await bot.handleUpdate(
      pollMessageUpdate({
        pollId: 'poll_cb_opt',
        question: 'When?',
        options: ['Mon', 'Tue'],
        forward: true,
      }),
    );

    await bot.handleUpdate(
      callbackQueryUpdate('pi:update', getLastBotMessage() as Message),
    );

    const optionsMsg = getLastBotMessage();
    await bot.handleUpdate(callbackQueryUpdate('po:0', optionsMsg as Message));

    expectTexts(calls, ['Selected option', 'Detecting last date column']);
  });

  test('poll option po:abc is invalid', async () => {
    await testPollStorage.savePollData('poll_cb_bad', {
      question: 'When?',
      options: ['Mon'],
      votes: { '0': ['@a'] },
    });

    const { bot, calls, getLastBotMessage } = setupTestBot();

    await bot.handleUpdate(
      pollMessageUpdate({
        pollId: 'poll_cb_bad',
        question: 'When?',
        options: ['Mon'],
        forward: true,
      }),
    );

    await bot.handleUpdate(
      callbackQueryUpdate('pi:update', getLastBotMessage() as Message),
    );

    await bot.handleUpdate(
      callbackQueryUpdate('po:abc', getLastBotMessage() as Message),
    );

    expectTexts(calls, ['Invalid option'], 'editMessageText');
  });

  test('poll option po:5 out of range', async () => {
    await testPollStorage.savePollData('poll_cb_range', {
      question: 'When?',
      options: ['Mon', 'Tue'],
      votes: { '0': ['@a'], '1': ['@b'] },
    });

    const { bot, calls, getLastBotMessage } = setupTestBot();

    await bot.handleUpdate(
      pollMessageUpdate({
        pollId: 'poll_cb_range',
        question: 'When?',
        options: ['Mon', 'Tue'],
        forward: true,
      }),
    );

    await bot.handleUpdate(
      callbackQueryUpdate('pi:update', getLastBotMessage() as Message),
    );

    await bot.handleUpdate(
      callbackQueryUpdate('po:5', getLastBotMessage() as Message),
    );

    expectTexts(
      calls,
      ['Invalid option number', 'between 1 and 2'],
      'editMessageText',
    );
  });

  test('poll option with no voters errors', async () => {
    await testPollStorage.savePollData('poll_cb_empty', {
      question: 'When?',
      options: ['Mon', 'Tue'],
      votes: { '0': [] },
    });

    const { bot, calls, getLastBotMessage } = setupTestBot();

    await bot.handleUpdate(
      pollMessageUpdate({
        pollId: 'poll_cb_empty',
        question: 'When?',
        options: ['Mon', 'Tue'],
        forward: true,
      }),
    );

    await bot.handleUpdate(
      callbackQueryUpdate('pi:update', getLastBotMessage() as Message),
    );

    await bot.handleUpdate(
      callbackQueryUpdate('po:0', getLastBotMessage() as Message),
    );

    expectTexts(calls, ['No voters found for this option']);
  });
});
