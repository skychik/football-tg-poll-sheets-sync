import { beforeEach, describe, expect, test } from 'bun:test';
import { createTelegramTestKit } from './support/create-test-bot';
import { textMessageUpdate } from './support/telegram-updates';
import { expectTexts } from './support/test-assertions';

const testKit = createTelegramTestKit();

beforeEach(() => {
  testKit.reset();
});

describe('/poll command', () => {
  test('bare /poll (no space) replies with usage, not insufficient-parts error', async () => {
    const { bot, calls } = testKit.setupTestBot();
    await bot.handleUpdate(textMessageUpdate('/poll'));

    expectTexts(
      calls,
      ['Please provide poll question', 'Usage: /poll'],
      'sendMessage',
    );
    const texts = calls
      .filter((c) => c.method === 'sendMessage')
      .map((c) => String((c.payload as { text?: string }).text ?? ''));
    expect(
      texts.some((t) => t.includes('at least a question and one option')),
    ).toBe(false);
  });

  test('/poll@botname strips mention and creates poll', async () => {
    const { bot, calls } = testKit.setupTestBot();
    await bot.handleUpdate(
      textMessageUpdate('/poll@testfootballbot Kickoff? | Sat | Sun'),
    );

    const sendPoll = calls.find((c) => c.method === 'sendPoll');
    expect(sendPoll).toBeDefined();
    if (sendPoll === undefined) {
      throw new Error('expected sendPoll call');
    }
    const payload = sendPoll.payload as {
      question: string;
      options: { text: string }[];
    };
    expect(payload.question).toBe('Kickoff?');
    expect(payload.options.map((o) => o.text)).toEqual(['Sat', 'Sun']);
  });
});
