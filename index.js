require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const { setupBotListeners, sendBroadcastReminder } = require('./bot');
const { updateTask } = require('./firebase');

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  console.error("❌ ERROR: TELEGRAM_BOT_TOKEN tidak ditemukan di file .env!");
  process.exit(1);
}

const app = express();
app.use(express.json());

// Enable CORS for web app triggers
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

const isVercel = process.env.VERCEL || process.env.NOW_BUILDER;
let bot = new TelegramBot(token, { polling: !isVercel });
setupBotListeners(bot);

// Reminder Endpoint for Vercel Cron & Manual Trigger
app.all('/api/reminder', async (req, res) => {
  try {
    console.log('⏰ Triggering reminder broadcast via /api/reminder endpoint...');
    const result = await sendBroadcastReminder(bot);
    return res.status(200).json({
      status: 'success',
      message: `Reminder terkirim ke ${result.successCount} dari ${result.total || 0} pengguna Telegram`,
      details: result
    });
  } catch (err) {
    console.error('Error executing reminder API:', err);
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

// Endpoint untuk menerima webhook dari Google Sheets (Two-Way Sync)
app.post('/api/sync-from-sheets', async (req, res) => {
  try {
    const data = req.body;
    if (!data || !data.orderId) {
      return res.status(400).json({ success: false, message: 'Missing orderId' });
    }

    const { orderId, trackerStatus, notes, technicianName } = data;
    const updates = {};
    if (trackerStatus) updates.trackerStatus = trackerStatus;
    if (notes !== undefined) updates.notes = notes;
    if (technicianName !== undefined) updates.technicianName = technicianName;
    updates.updatedBy = 'Google Sheets Auto Sync';

    const success = await updateTask(orderId, updates);
    
    if (success) {
      res.status(200).json({ success: true, message: `Task ${orderId} updated successfully from Google Sheets.` });
    } else {
      res.status(404).json({ success: false, message: `Task ${orderId} not found.` });
    }
  } catch (error) {
    console.error("Error processing sync from sheets:", error);
    res.status(500).json({ success: false, error: error.toString() });
  }
});

if (isVercel) {
  // Webhook Mode untuk Vercel Serverless
  app.post(`/api/webhook`, async (req, res) => {
    try {
      if (req.body && (req.body.message || req.body.callback_query)) {
        bot.processUpdate(req.body);
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
  // Long Polling Mode untuk Lokal (dengan local scheduler jam 07:30 WIB)
  console.log('🤖 EBIS Telegram Bot dimulai dalam mode Polling (Lokal)...');

  let lastReminderDate = '';
  setInterval(async () => {
    const now = new Date();
    const wibHours = (now.getUTCHours() + 7) % 24;
    const wibMinutes = now.getUTCMinutes();
    const todayDate = now.toISOString().split('T')[0];

    if (wibHours === 7 && wibMinutes === 30 && lastReminderDate !== todayDate) {
      lastReminderDate = todayDate;
      console.log('⏰ Triggering local scheduled morning reminder broadcast at 07:30 WIB...');
      await sendBroadcastReminder(bot);
    }
  }, 60000);

  app.get('*', (req, res) => {
    res.send('🤖 EBIS Telegram Bot Status: Active (Polling Mode)');
  });

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`🚀 Bot EBIS aktif & server berjalan pada port ${PORT}`);
  });
}

module.exports = app;
