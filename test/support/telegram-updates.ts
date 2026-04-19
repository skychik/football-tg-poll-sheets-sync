import type { CallbackQuery, Message, Update, User } from '@grammyjs/types';

export const TEST_CHAT_ID = 42_001;
export const TEST_USER_ID = 99_001;

export const testUser: User = {
  id: TEST_USER_ID,
  is_bot: false,
  first_name: 'Test',
  username: 'testuser',
};

const testPrivateChat = {
  id: TEST_CHAT_ID,
  type: 'private' as const,
  first_name: 'Test',
  username: 'testuser',
};

let updateIdCounter = 60_000;

export function resetUpdateIds(start = 60_000): void {
  updateIdCounter = start;
}

export function nextUpdateId(): number {
  return ++updateIdCounter;
}

function botCommandEntity(text: string): Message['entities'] {
  const slash = text.match(/^\/\S+/);
  if (!slash) return undefined;
  return [
    {
      type: 'bot_command',
      offset: 0,
      length: slash[0].length,
    },
  ];
}

export function textMessageUpdate(text: string): Update {
  const message: Message = {
    message_id: nextUpdateId(),
    date: Math.floor(Date.now() / 1000),
    chat: testPrivateChat,
    from: testUser,
    text,
    entities: botCommandEntity(text),
  };
  return {
    update_id: nextUpdateId(),
    message,
  };
}

export function callbackQueryUpdate(data: string, message: Message): Update {
  const cq: CallbackQuery = {
    id: `cb_${nextUpdateId()}`,
    from: testUser,
    message,
    chat_instance: '1',
    data,
  };
  return {
    update_id: nextUpdateId(),
    callback_query: cq,
  };
}

export function pollMessageUpdate(opts: {
  pollId: string;
  question: string;
  options: string[];
  forward: boolean;
}): Update {
  const poll = {
    id: opts.pollId,
    question: opts.question,
    options: opts.options.map((t) => ({
      text: t,
      voter_count: 0,
    })),
    is_closed: false,
    is_anonymous: false,
    type: 'regular' as const,
    allows_multiple_answers: true,
  };

  const message: Message & { forward_origin?: unknown } = {
    message_id: nextUpdateId(),
    date: Math.floor(Date.now() / 1000),
    chat: testPrivateChat,
    from: testUser,
    poll,
  };

  if (opts.forward) {
    message.forward_origin = {
      type: 'user',
      date: Math.floor(Date.now() / 1000),
      sender_user: {
        id: 77_001,
        is_bot: false,
        first_name: 'Other',
        username: 'other',
      },
    };
  }

  return {
    update_id: nextUpdateId(),
    message: message as Message,
  };
}
