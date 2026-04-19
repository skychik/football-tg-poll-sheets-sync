import { createBot } from './create-bot';
import { createProductionServices } from './services';
import { asTelegramApp } from './telegram-app';

// Bun automatically loads .env files, so no additional setup needed

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!BOT_TOKEN) {
  throw new Error('TELEGRAM_BOT_TOKEN environment variable is required');
}

const services = createProductionServices();
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
