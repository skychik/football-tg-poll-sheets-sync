import { expect } from 'bun:test';
import type { RecordedApiCall } from './mock-telegram-api';

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
    .map((c) => (c.payload as { text?: string }).text ?? '');
  for (const s of substr) {
    expect(texts.some((t) => t.includes(s))).toBe(true);
  }
}
