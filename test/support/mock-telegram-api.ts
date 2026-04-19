import type { Message } from '@grammyjs/types';
import type { Bot } from 'grammy';
import { TEST_CHAT_ID } from './telegram-updates';

export type RecordedApiCall = { method: string; payload: unknown };

/**
 * Intercept Telegram API calls so tests never hit the network. Records each call and returns minimal valid responses.
 */
export function installMockTelegramApi(bot: Bot) {
  const calls: RecordedApiCall[] = [];
  let lastBotMessage: Message | undefined;
  let messageSeq = 1;

  bot.api.config.use((prev, method, payload, signal) => {
    const p = payload as Record<string, unknown>;
    calls.push({ method, payload: p });

    if (method === 'sendMessage') {
      const msg: Message = {
        message_id: messageSeq++,
        date: Math.floor(Date.now() / 1000),
        chat: {
          id: p.chat_id as number,
          type: 'private',
        },
        text: p.text as string | undefined,
        reply_markup: p.reply_markup as Message['reply_markup'],
      };
      lastBotMessage = msg;
      return Promise.resolve({ ok: true, result: msg });
    }

    if (method === 'editMessageText') {
      const msg: Message = {
        message_id: (p.message_id as number) ?? lastBotMessage?.message_id ?? 1,
        date: Math.floor(Date.now() / 1000),
        chat: {
          id: (p.chat_id as number) ?? TEST_CHAT_ID,
          type: 'private',
        },
        text: p.text as string | undefined,
        reply_markup: p.reply_markup as Message['reply_markup'],
      };
      lastBotMessage = msg;
      return Promise.resolve({ ok: true, result: msg });
    }

    if (method === 'answerCallbackQuery') {
      return Promise.resolve({ ok: true, result: true });
    }

    if (method === 'sendPoll') {
      const msg: Message = {
        message_id: messageSeq++,
        date: Math.floor(Date.now() / 1000),
        chat: {
          id: p.chat_id as number,
          type: 'private',
        },
        poll: {
          id: `poll_${messageSeq}`,
          question: p.question as string,
          options: (p.options as { text: string }[]).map((o) => ({
            text: o.text,
            voter_count: 0,
          })),
          is_closed: false,
          is_anonymous: false,
          type: 'regular',
          allows_multiple_answers: true,
        },
      };
      lastBotMessage = msg;
      return Promise.resolve({ ok: true, result: msg });
    }

    if (method === 'deleteMessage') {
      return Promise.resolve({ ok: true, result: true });
    }

    return prev(method, payload, signal);
  });

  return {
    calls,
    getLastBotMessage: () => lastBotMessage,
  };
}

export function sentTexts(calls: RecordedApiCall[]): string[] {
  return calls
    .filter((c) => c.method === 'sendMessage' || c.method === 'editMessageText')
    .map((c) => {
      const p = c.payload as { text?: string };
      return p.text ?? '';
    })
    .filter(Boolean);
}
