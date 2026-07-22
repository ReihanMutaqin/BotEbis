require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const { setupBotListeners } = require('./bot');

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  console.error("❌ ERROR: TELEGRAM_BOT_TOKEN tidak ditemukan di file .env!");
  process.exit(1);
}

const app = express();
app.use(express.json());

const isVercel = process.env.VERCEL || process.env.NOW_BUILDER;
let bot;

if (isVercel) {
  // Webhook Mode untuk Vercel Serverless
  bot = new TelegramBot(token);
  setupBotListeners(bot);

  app.post(`/api/webhook`, async (req, res) => {
    try {
      if (req.body && (req.body.message || req.body.callback_query)) {
        bot.processUpdate(req.body);
        // Tahan execution window Vercel selama 1.5 detik agar query Firestore & sendMessage selesai terkirim
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
    } catch (err) {
      console.error('Error processing webhook:', err);
    }
    res.status(200).send('OK');
  });

  app.get('*', (req, res) => {
    res.send('🤖 EBIS Telegram Bot Webhook Active!');
  });
} else {
  // Long Polling Mode untuk Lokal
  console.log('🤖 EBIS Telegram Bot dimulai dalam mode Polling (Lokal)...');
  bot = new TelegramBot(token, { polling: true });
  setupBotListeners(bot);

  app.get('*', (req, res) => {
    res.send('🤖 EBIS Telegram Bot Status: Active (Polling Mode)');
  });

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`🚀 Bot EBIS aktif & server berjalan pada port ${PORT}`);
  });
}

module.exports = app;
