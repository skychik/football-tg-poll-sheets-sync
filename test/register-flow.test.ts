import { beforeEach, describe, expect, test } from 'bun:test';
import type { User } from '@grammyjs/types';
import { baseSheets } from './sheet-test-stub';
import { createTelegramTestKit } from './support/create-test-bot';
import {
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

describe('/register', () => {
  test('in a group: replies with private-only message', async () => {
    const { bot, calls } = setupTestBot();
    await bot.handleUpdate(textMessageUpdateInGroup('/register'));
    expectTexts(calls, ['only in a private chat'], 'sendMessage');
  });

  test('replies when Telegram username already exists in column B', async () => {
    testKit.setSheetsClient(
      baseSheets({
        isTelegramUsernameInSheet: async () => true,
      }),
    );
    const { bot, calls } = setupTestBot();
    await bot.handleUpdate(textMessageUpdate('/register'));
    expectTexts(calls, ['already in the table'], 'sendMessage');
  });

  test('with name in command writes first empty row A/B', async () => {
    const writes: Array<{ name: string; at: string; row: number }> = [];
    testKit.setSheetsClient(
      baseSheets({
        isTelegramUsernameInSheet: async () => false,
        findFirstRowWithEmptyNameAndTg: async () => 9,
        writeRegisterRow: async (row, name, at) => {
          writes.push({ name, at, row });
        },
      }),
    );
    const { bot, calls } = setupTestBot();
    await bot.handleUpdate(textMessageUpdate('/register Alice'));
    expect(writes).toEqual([{ name: 'Alice', at: '@testuser', row: 9 }]);
    expectTexts(calls, ['Done:', 'Alice', '9'], 'sendMessage');
  });

  test('concurrent registrations serialize row allocation', async () => {
    const writes: Array<{ name: string; at: string; row: number }> = [];
    let nextRow = 9;
    const registered = new Set<string>();
    testKit.setSheetsClient(
      baseSheets({
        isTelegramUsernameInSheet: async (at) => registered.has(at),
        findFirstRowWithEmptyNameAndTg: async () => nextRow,
        writeRegisterRow: async (row, name, at) => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          writes.push({ name, at, row });
          registered.add(at);
          nextRow += 1;
        },
      }),
    );
    const { bot } = setupTestBot();
    const aliceUser: User = {
      id: 99_010,
      is_bot: false,
      first_name: 'Alice',
      username: 'alice_test',
    };
    const bobUser: User = {
      id: 99_011,
      is_bot: false,
      first_name: 'Bob',
      username: 'bob_test',
    };

    await Promise.all([
      bot.handleUpdate(textMessageUpdateWithFrom('/register Alice', aliceUser)),
      bot.handleUpdate(textMessageUpdateWithFrom('/register Bob', bobUser)),
    ]);

    expect(writes).toEqual([
      { name: 'Alice', at: '@alice_test', row: 9 },
      { name: 'Bob', at: '@bob_test', row: 10 },
    ]);
  });

  test('without name: prompt then second message completes registration', async () => {
    const writes: Array<{ name: string; at: string; row: number }> = [];
    testKit.setSheetsClient(
      baseSheets({
        isTelegramUsernameInSheet: async () => false,
        findFirstRowWithEmptyNameAndTg: async () => 10,
        writeRegisterRow: async (row, name, at) => {
          writes.push({ name, at, row });
        },
      }),
    );
    const { bot, calls } = setupTestBot();
    await bot.handleUpdate(textMessageUpdate('/register'));
    expectTexts(calls, ['name', 'column A'], 'sendMessage');
    await bot.handleUpdate(textMessageUpdate('Zoe'));
    expect(writes).toEqual([{ name: 'Zoe', at: '@testuser', row: 10 }]);
    expectTexts(calls, ['Done:', 'Zoe'], 'sendMessage');
  });

  test('errors when no free row with empty A and B', async () => {
    testKit.setSheetsClient(
      baseSheets({
        isTelegramUsernameInSheet: async () => false,
        findFirstRowWithEmptyNameAndTg: async () => null,
      }),
    );
    const { bot, calls } = setupTestBot();
    await bot.handleUpdate(textMessageUpdate('/register Carl'));
    expectTexts(calls, ['No free row'], 'sendMessage');
  });

  test('no free row after name prompt: second message also errors', async () => {
    testKit.setSheetsClient(
      baseSheets({
        isTelegramUsernameInSheet: async () => false,
        findFirstRowWithEmptyNameAndTg: async () => null,
      }),
    );
    const { bot, calls } = setupTestBot();
    await bot.handleUpdate(textMessageUpdate('/register'));
    await bot.handleUpdate(textMessageUpdate('Dana'));
    expectTexts(calls, ['No free row'], 'sendMessage');
  });

  test('after /register prompt: whitespace-only name is rejected', async () => {
    testKit.setSheetsClient(
      baseSheets({
        isTelegramUsernameInSheet: async () => false,
        findFirstRowWithEmptyNameAndTg: async () => 10,
        writeRegisterRow: async () => {},
      }),
    );
    const { bot, calls } = setupTestBot();
    await bot.handleUpdate(textMessageUpdate('/register'));
    await bot.handleUpdate(textMessageUpdate('   '));
    expectTexts(calls, ['Name cannot be empty'], 'sendMessage');
  });

  test('errors when user has no Telegram username', async () => {
    testKit.setSheetsClient(baseSheets());
    const { bot, calls } = setupTestBot();
    const userNoUsername = {
      id: 99_002,
      is_bot: false as const,
      first_name: 'NoHandle',
    };
    await bot.handleUpdate(
      textMessageUpdateWithFrom('/register', userNoUsername),
    );
    expectTexts(
      calls,
      ['Telegram username in your Telegram account'],
      'sendMessage',
    );
  });
});
