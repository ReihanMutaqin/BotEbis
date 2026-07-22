require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');

const token = process.env.TELEGRAM_BOT_TOKEN;
const webhookUrl = process.argv[2];

if (!token) {
  console.error('❌ TELEGRAM_BOT_TOKEN belum diset di file .env');
  process.exit(1);
}

if (!webhookUrl) {
  console.log('📌 Penggunaan: node set_webhook.js <URL_HOSTING_KAMU>');
  console.log('   Contoh: node set_webhook.js https://ebis-bot.vercel.app');
  process.exit(1);
}

const bot = new TelegramBot(token);

const fullWebhookUrl = webhookUrl.endsWith('/') 
  ? `${webhookUrl}api/webhook` 
  : `${webhookUrl}/api/webhook`;

bot.setWebHook(fullWebhookUrl)
  .then(() => {
    console.log(`✅ Webhook berhasil dipasang ke: ${fullWebhookUrl}`);
  })
  .catch((err) => {
    console.error(`❌ Gagal memasang webhook: ${err.message}`);
  });
