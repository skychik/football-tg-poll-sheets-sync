import type { Message } from '@grammyjs/types';
import type { Bot } from 'grammy';
import { InMemoryPollStorage } from '../../poll-storage/in-memory-poll-storage';
import type { MyContext } from '../../session';
import { getNextColumnLetter } from '../../sheets/sheet-columns';
import { createBot } from '../../telegram/create-bot';
import { baseSheets, type SheetsStub } from '../sheet-test-stub';
import {
  installMockTelegramApi,
  type RecordedApiCall,
} from './mock-telegram-api';
import { resetUpdateIds } from './telegram-updates';

const testBotInfo = {
  id: 1,
  is_bot: true,
  first_name: 'TestBot',
  username: 'testfootballbot',
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
};

export function createTelegramTestKit() {
  const pollStorage = new InMemoryPollStorage();
  let sheetsClient: SheetsStub = baseSheets();

  return {
    pollStorage,
    reset(): void {
      pollStorage.clear();
      resetUpdateIds();
      sheetsClient = baseSheets();
    },
    setSheetsClient(next: SheetsStub): void {
      sheetsClient = next;
    },
    setupTestBot(): {
      bot: Bot<MyContext>;
      calls: RecordedApiCall[];
      getLastBotMessage: () => Message | undefined;
    } {
      const bot = createBot(
        '000000:TEST',
        { botInfo: testBotInfo },
        {
          pollStorage,
          createSheetsClient: async () => sheetsClient,
          getNextColumnLetter,
        },
      );
      const { calls, getLastBotMessage } = installMockTelegramApi(bot);
      return { bot, calls, getLastBotMessage };
    },
  };
}
