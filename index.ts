import type { AppServices } from './app-services';
import { InMemoryPollStorage } from './poll-storage/in-memory-poll-storage';
import { IoredisPollStorage } from './poll-storage/redis-poll-storage';
import type { PollStorage } from './poll-storage/poll-storage-types';
import { createGoogleSheetsClient } from './sheets/google-sheets-client';
import { getNextColumnLetter } from './sheets/sheet-columns';
import { asTelegramApp, createBot } from './telegram/create-bot';

// Bun automatically loads .env files, so no additional setup needed

function createPollStorage(): PollStorage {
  if (process.env.POLL_STORAGE === 'memory') {
    console.log('📦 Poll storage: in-memory (POLL_STORAGE=memory)');
    return new InMemoryPollStorage();
  }
  if (process.env.REDIS_URL) {
    return new IoredisPollStorage();
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'REDIS_URL is required in production, or set POLL_STORAGE=memory only for non-persistent dev.',
    );
  }
  console.warn(
    '📦 Poll storage: in-memory (no REDIS_URL). Polls are lost on restart; set REDIS_URL for Redis.',
  );
  return new InMemoryPollStorage();
}

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!BOT_TOKEN) {
  throw new Error('TELEGRAM_BOT_TOKEN environment variable is required');
}

const services: AppServices = {
  pollStorage: createPollStorage(),
  createSheetsClient: createGoogleSheetsClient,
  getNextColumnLetter,
};
const bot = createBot(BOT_TOKEN, undefined, services);
const app = asTelegramApp(bot);

console.log('🤖 Bot starting...');
services.pollStorage
  .ensureReady()
  .then(() => app.start())
  .then(() => {
    console.log('✅ Bot is running!');
  })
  .catch((error) => {
    console.error('❌ Failed to start bot:', error);
    process.exit(1);
  });
