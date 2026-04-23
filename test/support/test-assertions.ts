import { expect } from 'bun:test';
import type { RecordedApiCall } from './mock-telegram-api';

/**
 * Normalize Telegram MarkdownV2 text to plain readable text for stable tests.
 */
export function normalizeTelegramText(text: string): string {
  return text
    .replace(/\\([_*[\]()~`>#+=|{}.!-])/g, '$1')
    .replace(/[*_~`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function expectTexts(
  calls: RecordedApiCall[],
  substr: string[],
  method: 'sendMessage' | 'editMessageText' | 'both' = 'both',
) {
  const texts = calls
    .filter((c) =>
      method === 'both'
        ? c.method === 'sendMessage' || c.method === 'editMessageText'
        : c.method === method,
    )
    .map((c) =>
      normalizeTelegramText((c.payload as { text?: string }).text ?? ''),
    );
  for (const s of substr) {
    const needle = normalizeTelegramText(s);
    expect(texts.some((t) => t.includes(needle))).toBe(true);
  }
}
