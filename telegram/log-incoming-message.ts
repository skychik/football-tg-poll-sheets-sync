import type { MyContext } from '../session';

/**
 * Log a user message (text, poll, or other) for observability.
 */
export function logIncomingMessage(ctx: MyContext): void {
  const msg = ctx.message;
  if (!msg) return;

  const from = ctx.from;
  const chat = ctx.chat;
  let detail: string;
  if (msg.text != null) {
    const t = msg.text;
    detail =
      t.length > 400
        ? `text_len=${t.length} text_preview=${JSON.stringify(`${t.slice(0, 400)}…`)}`
        : `text=${JSON.stringify(t)}`;
  } else if (msg.poll) {
    detail = `poll=${JSON.stringify(msg.poll.question)}`;
  } else {
    detail = 'content=non_text';
  }
  console.log(
    `[MESSAGE] update_id=${ctx.update.update_id} chat_id=${chat.id} chat_type=${chat.type} from_id=${from?.id ?? ''} from_username=${from?.username ?? ''} ${detail}`,
  );
}
