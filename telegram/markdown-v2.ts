import type { MyContext } from '../session';

/**
 * Escape user- or sheet-derived text for Telegram `parse_mode: MarkdownV2`.
 * Static message text can use escaped punctuation in the source; anything
 * interpolated should pass through this first (including inside `*...*` bold).
 *
 * @see https://core.telegram.org/bots/api#markdownv2-style
 */
export function escapeMarkdownV2(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
}

/** Bold span; `inner` is escaped. */
export function mdBold(inner: string): string {
  return `*${escapeMarkdownV2(inner)}*`;
}

/** Italic span; `inner` is escaped. */
export function mdItalic(inner: string): string {
  return `_${escapeMarkdownV2(inner)}_`;
}

export const PARSE_MARKDOWN_V2 = { parse_mode: 'MarkdownV2' as const };

/**
 * Send a MarkdownV2 reply. `parse_mode` is always MarkdownV2 (wins over `other`).
 */
export async function replyMarkdownV2(
  ctx: MyContext,
  text: string,
  other?: Parameters<MyContext['reply']>[1],
): Promise<ReturnType<MyContext['reply']>> {
  return ctx.reply(text, {
    ...other,
    parse_mode: 'MarkdownV2',
  } as Parameters<MyContext['reply']>[1]);
}

/**
 * Edit message text as MarkdownV2 (callback / inline flows).
 */
export async function editMessageMarkdownV2(
  ctx: MyContext,
  text: string,
  other?: Parameters<MyContext['editMessageText']>[1],
): Promise<ReturnType<MyContext['editMessageText']>> {
  return ctx.editMessageText(text, {
    ...other,
    parse_mode: 'MarkdownV2',
  } as Parameters<MyContext['editMessageText']>[1]);
}
