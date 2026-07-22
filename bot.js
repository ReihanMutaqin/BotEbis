const TelegramBot = require('node-telegram-bot-api');
const { getAllTasks, getTaskById, updateTask } = require('./firebase');

// User state tracking for multi-step prompts
const userStates = {};

function formatTaskMessage(task) {
  const statusEmoji = {
    'Pending': '⏳',
    'On Progress': '🚀',
    'Completed': '✅',
    'Kendala': '⚠️',
    'Cancel': '❌'
  }[task.trackerStatus] || '📌';

  return `📋 *DETAIL WORK ORDER EBIS*
  
🆔 *Order ID*: \`${task.order || task.id}\`
👤 *Pelanggan*: ${task.customerName || '-'}
📍 *Alamat*: ${task.address || '-'}
🏬 *STO / Witel*: ${task.sto || '-'} / ${task.witel || '-'}
🌐 *No. Internet*: \`${task.internet || '-'}\`
🛠️ *Layanan*: ${task.serviceType || task.paket || '-'}
Status: ${statusEmoji} *${task.trackerStatus || 'Pending'}*
👷 *Teknisi*: ${task.technicianName || '_Belum ditugaskan_'}
📝 *Catatan*: ${task.notes || '-'}
ℹ️ *Status Resume*: \`${task.statusResume || '-'}\`
🕒 *Order Date*: ${task.orderDate || '-'}
`;
}

function getTaskActionButtons(orderId) {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '🚀 Set On Progress', callback_data: `st:${orderId}:On Progress` },
          { text: '✅ Set Completed', callback_data: `st:${orderId}:Completed` }
        ],
        [
          { text: '⚠️ Set Kendala', callback_data: `st:${orderId}:Kendala` },
          { text: '⏳ Set Pending', callback_data: `st:${orderId}:Pending` }
        ],
        [
          { text: '👨‍🔧 Assign Teknisi', callback_data: `assign:${orderId}` },
          { text: '📝 Ubah Catatan', callback_data: `note:${orderId}` }
        ],
        [
          { text: '🔄 Refresh Detail', callback_data: `refresh:${orderId}` },
          { text: '📊 Rekap Utama', callback_data: `show_rekap` }
        ]
      ]
    }
  };
}

function getMainMenuKeyboard() {
  return {
    reply_markup: {
      keyboard: [
        [{ text: '🔍 Cek Work Order' }, { text: '📊 Rekap Status' }],
        [{ text: '⏳ Task Pending' }, { text: '⚠️ Task Kendala' }],
        [{ text: '👨‍🔧 Cari Teknisi' }, { text: '📋 Template Update' }],
        [{ text: '💡 Bantuan' }]
      ],
      resize_keyboard: true,
      persistent: true
    }
  };
}

// Template generator text
function getTemplateGuideText() {
  return `📋 *TEMPLATE UPDATE WORK ORDER TEKNISI*

Kamu bisa memperbarui data order secara cepat dengan menyalin & mengisi template di bawah ini:

\`\`\`text
ORDER: 17841691101644df
STATUS: Completed
TEKNISI: Ahmad Fauzi
CATATAN: Redaman -18dBm, ONT terpasang, internet aktif
\`\`\`

*Pilihan Status:*
• \`Completed\` (Selesai Pasang / Perbaikan)
• \`On Progress\` (Sedang Dikerjakan)
• \`Kendala\` (Ada Kendala Lapangan)
• \`Pending\` (Menunggu Teknisi)
• \`Cancel\` (Batal)

💡 *Tips:* Cukup salin teks di atas, ubah datanya, dan kirimkan langsung ke bot ini! Bot akan membaca & memperbarui database secara otomatis.`;
}

// Template parser helper
function parseTemplateMessage(text) {
  const lines = text.split('\n');
  const data = {};

  lines.forEach(line => {
    const colonIndex = line.indexOf(':');
    if (colonIndex !== -1) {
      const key = line.substring(0, colonIndex).trim().toUpperCase();
      const val = line.substring(colonIndex + 1).trim();

      if (key === 'ORDER' || key === 'ORDER ID' || key === 'NO ORDER' || key === 'ID') {
        data.orderId = val;
      } else if (key === 'STATUS' || key === 'STATUS TRACKER' || key === 'STATE') {
        data.status = val;
      } else if (key === 'TEKNISI' || key === 'NAMA TEKNISI' || key === 'TEK') {
        data.technicianName = val;
      } else if (key === 'CATATAN' || key === 'KETERANGAN' || key === 'NOTE' || key === 'NOTES') {
        data.notes = val;
      }
    }
  });

  return data.orderId ? data : null;
}

function setupBotListeners(bot) {
  // Command /start & /help
  bot.onText(/\/start|\/help/, async (msg) => {
    const chatId = msg.chat.id;
    const text = `👋 *Selamat Datang di Bot EBIS Telkom!*

Bot ini terhubung langsung secara real-time dengan aplikasi web *EBIS Teknisi*.

*Fitur & Perintah Bot:*
🔹 /template - Dapatkan template update data teknisi
🔹 /updateteknisi <order_id> <nama_teknisi> - Set nama teknisi
🔹 /update <order_id> <status> [teknisi] [catatan] - Update status order
🔹 /cek <nomor_order> - Cek detail work order
🔹 /rekap - Lihat ringkasan statistik order
🔹 /pending - Lihat daftar task pending
🔹 /kendala - Lihat daftar task kendala
🔹 /teknisi <nama> - Cari order berdasarkan nama teknisi

Gunakan menu di bawah ini untuk akses cepat:`;

    await bot.sendMessage(chatId, text, { 
      parse_mode: 'Markdown',
      ...getMainMenuKeyboard() 
    });
  });

  // Command /template
  bot.onText(/\/template/, async (msg) => {
    return bot.sendMessage(msg.chat.id, getTemplateGuideText(), { parse_mode: 'Markdown' });
  });

  // Command /updateteknisi <order_id> <nama_teknisi>
  bot.onText(/\/updateteknisi(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const rawArgs = match[1];
    if (!rawArgs) {
      return bot.sendMessage(chatId, `⚠️ *Format Perintah Update Teknisi:*
\`/updateteknisi <order_id> <nama_teknisi>\`

_Contoh:_
\`/updateteknisi 1784169110 Ahmad Fauzi\``, { parse_mode: 'Markdown' });
    }

    const parts = rawArgs.split(' ');
    const orderId = parts[0];
    const techName = parts.slice(1).join(' ');

    if (!techName) {
      return bot.sendMessage(chatId, `❌ Silakan masukkan nama teknisi setelah nomor order.`, { parse_mode: 'Markdown' });
    }

    return handleAssignTechnician(bot, chatId, orderId, techName);
  });

  // Handle Text Messages & Template Auto-Parsing
  bot.on('message', async (msg) => {
    if (!msg.text || msg.text.startsWith('/')) return;
    const chatId = msg.chat.id;
    const text = msg.text.trim();

    // Template Auto-Parse Check (If text contains ORDER:)
    if (text.toUpperCase().includes('ORDER:')) {
      const parsed = parseTemplateMessage(text);
      if (parsed && parsed.orderId) {
        try {
          await bot.sendMessage(chatId, `⚙️ Memproses update dari template untuk order \`${parsed.orderId}\`...`, { parse_mode: 'Markdown' });
          const task = await getTaskById(parsed.orderId);
          if (!task) {
            return bot.sendMessage(chatId, `❌ Order ID \`${parsed.orderId}\` tidak ditemukan di database.`, { parse_mode: 'Markdown' });
          }

          const updates = {};
          if (parsed.status) {
            const validStatuses = ['Pending', 'On Progress', 'Completed', 'Kendala', 'Cancel'];
            const matchedStatus = validStatuses.find(s => s.toLowerCase() === parsed.status.toLowerCase());
            if (matchedStatus) updates.trackerStatus = matchedStatus;
          }
          if (parsed.technicianName) updates.technicianName = parsed.technicianName;
          if (parsed.notes) updates.notes = parsed.notes;

          if (Object.keys(updates).length === 0) {
            return bot.sendMessage(chatId, `⚠️ Tidak ada data yang diperbarui. Pastikan menyantumkan STATUS, TEKNISI, atau CATATAN.`);
          }

          await updateTask(task.id, updates);
          const updatedTask = await getTaskById(task.id);
          return bot.sendMessage(chatId, `✅ *ORDER BERHASIL DIPERBARUI DARI TEMPLATE!*\n\n${formatTaskMessage(updatedTask)}`, {
            parse_mode: 'Markdown',
            ...getTaskActionButtons(updatedTask.id)
          });
        } catch (err) {
          return bot.sendMessage(chatId, `❌ Terjadi kesalahan saat memproses template: ${err.message}`);
        }
      }
    }

    // Check if user is in a state
    if (userStates[chatId]) {
      const state = userStates[chatId];
      delete userStates[chatId];

      if (state.action === 'awaiting_search') {
        return handleSearch(bot, chatId, text);
      } else if (state.action === 'awaiting_assign') {
        return handleAssignTechnician(bot, chatId, state.orderId, text);
      } else if (state.action === 'awaiting_note') {
        return handleUpdateNote(bot, chatId, state.orderId, text);
      } else if (state.action === 'awaiting_teknisi') {
        return handleSearchTeknisi(bot, chatId, text);
      }
    }

    if (text === '📋 Template Update') {
      return bot.sendMessage(chatId, getTemplateGuideText(), { parse_mode: 'Markdown' });
    }

    if (text === '🔍 Cek Work Order') {
      userStates[chatId] = { action: 'awaiting_search' };
      return bot.sendMessage(chatId, '🔍 Silakan kirimkan *Nomor Order*, *No Internet*, atau *Nama Pelanggan* yang ingin dicari:', { parse_mode: 'Markdown' });
    }

    if (text === '📊 Rekap Status') {
      return handleRekap(bot, chatId);
    }

    if (text === '⏳ Task Pending') {
      return handleTaskListByStatus(bot, chatId, 'Pending');
    }

    if (text === '⚠️ Task Kendala') {
      return handleTaskListByStatus(bot, chatId, 'Kendala');
    }

    if (text === '👨‍🔧 Cari Teknisi') {
      userStates[chatId] = { action: 'awaiting_teknisi' };
      return bot.sendMessage(chatId, '👨‍🔧 Masukkan nama teknisi yang ingin dicari:', { parse_mode: 'Markdown' });
    }

    if (text === '💡 Bantuan') {
      return bot.sendMessage(chatId, `💡 *Panduan Penggunaan Bot EBIS Telkom*

1. *Cek Work Order*: Kirimkan nomor order secara langsung di chat (misal: \`17841691101644df\`)
2. *Template Update*: Salin format dari \`/template\` lalu isi & kirim ke chat ini.
3. *Update Status*: Klik tombol interaktif pada detail order untuk mengubah status ke *On Progress*, *Completed*, atau *Kendala*.
4. *Perintah cepat*:
   • \`/updateteknisi 1784... Nama Teknisi\`
   • \`/update 1784... Completed Agus "Pekerjaan Selesai"\`

Untuk bantuan tambahan, hubungi Administrator EBIS.`, { parse_mode: 'Markdown' });
    }

    // Default text input fallback: attempt to search order directly if text looks like order/name
    if (text.length >= 3) {
      return handleSearch(bot, chatId, text);
    }
  });

  // Command /cek <order_id>
  bot.onText(/\/cek(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const queryStr = match[1];
    if (!queryStr) {
      userStates[chatId] = { action: 'awaiting_search' };
      return bot.sendMessage(chatId, '🔍 Silakan masukkan *Nomor Order* atau *Nama Pelanggan*:', { parse_mode: 'Markdown' });
    }
    return handleSearch(bot, chatId, queryStr.trim());
  });

  // Command /rekap
  bot.onText(/\/rekap|\/status/, async (msg) => {
    return handleRekap(bot, msg.chat.id);
  });

  // Command /pending
  bot.onText(/\/pending/, async (msg) => {
    return handleTaskListByStatus(bot, msg.chat.id, 'Pending');
  });

  // Command /kendala
  bot.onText(/\/kendala/, async (msg) => {
    return handleTaskListByStatus(bot, msg.chat.id, 'Kendala');
  });

  // Command /teknisi <nama>
  bot.onText(/\/teknisi(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const techName = match[1];
    if (!techName) {
      userStates[chatId] = { action: 'awaiting_teknisi' };
      return bot.sendMessage(chatId, '👨‍🔧 Masukkan nama teknisi yang ingin dicari:', { parse_mode: 'Markdown' });
    }
    return handleSearchTeknisi(bot, chatId, techName.trim());
  });

  // Command /update <order_id> <status> [teknisi] [catatan]
  bot.onText(/\/update(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const rawArgs = match[1];
    if (!rawArgs) {
      return bot.sendMessage(chatId, `⚠️ *Format Perintah Update:*
\`/update <order_id> <status> [teknisi] [catatan]\`

Pilihan Status: \`Pending\`, \`On Progress\`, \`Completed\`, \`Kendala\`, \`Cancel\`

_Contoh:_
\`/update 1784169110 Completed Budi "Selesai diinstal"\``, { parse_mode: 'Markdown' });
    }

    const parts = rawArgs.split(' ');
    const orderId = parts[0];
    const status = parts[1];
    const tech = parts[2] || '';
    const notes = parts.slice(3).join(' ') || '';

    const validStatuses = ['Pending', 'On Progress', 'Completed', 'Kendala', 'Cancel'];
    const matchedStatus = validStatuses.find(s => s.toLowerCase() === status?.toLowerCase());

    if (!matchedStatus) {
      return bot.sendMessage(chatId, `❌ Status *${status}* tidak valid! Pilihan: ${validStatuses.join(', ')}`, { parse_mode: 'Markdown' });
    }

    try {
      const task = await getTaskById(orderId);
      if (!task) {
        return bot.sendMessage(chatId, `❌ Work order \`${orderId}\` tidak ditemukan.`, { parse_mode: 'Markdown' });
      }

      const updates = { trackerStatus: matchedStatus };
      if (tech) updates.technicianName = tech;
      if (notes) updates.notes = notes;

      await updateTask(task.id, updates);

      const updatedTask = await getTaskById(task.id);
      return bot.sendMessage(chatId, `✅ *Berhasil Memperbarui Order!*\n\n${formatTaskMessage(updatedTask)}`, {
        parse_mode: 'Markdown',
        ...getTaskActionButtons(updatedTask.id)
      });
    } catch (err) {
      console.error(err);
      return bot.sendMessage(chatId, `❌ Terjadi kesalahan saat update order: ${err.message}`);
    }
  });

  // Handle Callback Queries (Inline Keyboards)
  bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;

    await bot.answerCallbackQuery(query.id);

    if (data === 'show_rekap') {
      return handleRekap(bot, chatId);
    }

    if (data.startsWith('filter_st:')) {
      const status = data.split(':')[1];
      return handleTaskListByStatus(bot, chatId, status);
    }

    if (data.startsWith('view:')) {
      const orderId = data.split(':')[1];
      const task = await getTaskById(orderId);
      if (task) {
        return bot.sendMessage(chatId, formatTaskMessage(task), {
          parse_mode: 'Markdown',
          ...getTaskActionButtons(task.id)
        });
      }
    }

    if (data.startsWith('st:')) {
      const [, orderId, newStatus] = data.split(':');
      try {
        const task = await getTaskById(orderId);
        if (!task) {
          return bot.sendMessage(chatId, `❌ Order \`${orderId}\` tidak ditemukan.`, { parse_mode: 'Markdown' });
        }

        await updateTask(task.id, { trackerStatus: newStatus });
        const updatedTask = await getTaskById(task.id);

        try {
          await bot.editMessageText(`✅ *Status diperbarui menjadi ${newStatus}!*\n\n${formatTaskMessage(updatedTask)}`, {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: 'Markdown',
            ...getTaskActionButtons(updatedTask.id)
          });
        } catch (e) {
          await bot.sendMessage(chatId, `✅ *Status diperbarui menjadi ${newStatus}!*\n\n${formatTaskMessage(updatedTask)}`, {
            parse_mode: 'Markdown',
            ...getTaskActionButtons(updatedTask.id)
          });
        }
      } catch (err) {
        bot.sendMessage(chatId, `❌ Gagal update: ${err.message}`);
      }
    }

    if (data.startsWith('assign:')) {
      const orderId = data.split(':')[1];
      userStates[chatId] = { action: 'awaiting_assign', orderId };
      return bot.sendMessage(chatId, `👨‍🔧 Masukkan *Nama Teknisi* untuk order \`${orderId}\`:`, { parse_mode: 'Markdown' });
    }

    if (data.startsWith('note:')) {
      const orderId = data.split(':')[1];
      userStates[chatId] = { action: 'awaiting_note', orderId };
      return bot.sendMessage(chatId, `📝 Masukkan *Catatan Baru* untuk order \`${orderId}\`:`, { parse_mode: 'Markdown' });
    }

    if (data.startsWith('refresh:')) {
      const orderId = data.split(':')[1];
      const task = await getTaskById(orderId);
      if (task) {
        try {
          await bot.editMessageText(formatTaskMessage(task), {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: 'Markdown',
            ...getTaskActionButtons(task.id)
          });
        } catch (e) {
          // ignore unchanged content error
        }
      }
    }
  });
}

// Helper Implementations
async function handleSearch(bot, chatId, queryStr) {
  try {
    await bot.sendMessage(chatId, `🔎 Mencari order: *${queryStr}*...`, { parse_mode: 'Markdown' });
    const task = await getTaskById(queryStr);
    if (!task) {
      return bot.sendMessage(chatId, `❌ Work order dengan kata kunci *"${queryStr}"* tidak ditemukan.`, { parse_mode: 'Markdown' });
    }

    return bot.sendMessage(chatId, formatTaskMessage(task), {
      parse_mode: 'Markdown',
      ...getTaskActionButtons(task.id)
    });
  } catch (err) {
    return bot.sendMessage(chatId, `❌ Error saat pencarian: ${err.message}`);
  }
}

async function handleRekap(bot, chatId) {
  try {
    const tasks = await getAllTasks();
    const counts = {
      Total: tasks.length,
      Pending: 0,
      'On Progress': 0,
      Completed: 0,
      Kendala: 0,
      Cancel: 0
    };

    tasks.forEach(t => {
      const st = t.trackerStatus || 'Pending';
      if (counts[st] !== undefined) counts[st]++;
      else counts.Pending++;
    });

    const text = `📊 *REKAPITULASI STATUS WORK ORDER EBIS*
    
📦 *Total Order*: \`${counts.Total}\`
⏳ *Pending*: \`${counts.Pending}\`
🚀 *On Progress*: \`${counts['On Progress']}\`
✅ *Completed*: \`${counts.Completed}\`
⚠️ *Kendala*: \`${counts.Kendala}\`
❌ *Cancel*: \`${counts.Cancel}\`

Klik tombol di bawah untuk melihat daftar spesifik:`;

    const inline_keyboard = [
      [
        { text: `⏳ Pending (${counts.Pending})`, callback_data: 'filter_st:Pending' },
        { text: `🚀 Progress (${counts['On Progress']})`, callback_data: 'filter_st:On Progress' }
      ],
      [
        { text: `⚠️ Kendala (${counts.Kendala})`, callback_data: 'filter_st:Kendala' },
        { text: `✅ Completed (${counts.Completed})`, callback_data: 'filter_st:Completed' }
      ]
    ];

    return bot.sendMessage(chatId, text, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard }
    });
  } catch (err) {
    return bot.sendMessage(chatId, `❌ Gagal mengambil data rekap: ${err.message}`);
  }
}

async function handleTaskListByStatus(bot, chatId, status) {
  try {
    const tasks = await getAllTasks();
    const filtered = tasks.filter(t => (t.trackerStatus || 'Pending').toLowerCase() === status.toLowerCase());

    if (filtered.length === 0) {
      return bot.sendMessage(chatId, `ℹ️ Tidak ada task dengan status *${status}*.`, { parse_mode: 'Markdown' });
    }

    const limited = filtered.slice(0, 10);
    let msgText = `📋 *Daftar Task Status ${status}* (${filtered.length} total):\n\n`;

    const inline_keyboard = [];
    limited.forEach((t, i) => {
      msgText += `${i + 1}. *${t.order || t.id}* - ${t.customerName || 'Cust'}\n📍 ${t.sto || '-'}\n\n`;
      inline_keyboard.push([{ text: `🔎 Detail ${t.order || t.id}`, callback_data: `view:${t.id}` }]);
    });

    if (filtered.length > 10) {
      msgText += `_...dan ${filtered.length - 10} order lainnya._`;
    }

    return bot.sendMessage(chatId, msgText, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard }
    });
  } catch (err) {
    return bot.sendMessage(chatId, `❌ Gagal memuat daftar task: ${err.message}`);
  }
}

async function handleSearchTeknisi(bot, chatId, techName) {
  try {
    const tasks = await getAllTasks();
    const matched = tasks.filter(t => t.technicianName && t.technicianName.toLowerCase().includes(techName.toLowerCase()));

    if (matched.length === 0) {
      return bot.sendMessage(chatId, `👨‍🔧 Tidak ada task yang ditugaskan ke teknisi *"${techName}"*.`, { parse_mode: 'Markdown' });
    }

    let msgText = `👨‍🔧 *Task untuk Teknisi "${techName}"* (${matched.length} total):\n\n`;
    const inline_keyboard = [];

    matched.slice(0, 10).forEach((t, i) => {
      msgText += `${i + 1}. *${t.order || t.id}* [${t.trackerStatus || 'Pending'}]\n👤 ${t.customerName || '-'}\n📍 ${t.address || '-'}\n\n`;
      inline_keyboard.push([{ text: `🔎 Detail ${t.order || t.id}`, callback_data: `view:${t.id}` }]);
    });

    return bot.sendMessage(chatId, msgText, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard }
    });
  } catch (err) {
    return bot.sendMessage(chatId, `❌ Gagal mencari teknisi: ${err.message}`);
  }
}

async function handleAssignTechnician(bot, chatId, orderId, techName) {
  try {
    const task = await getTaskById(orderId);
    if (!task) {
      return bot.sendMessage(chatId, `❌ Order \`${orderId}\` tidak ditemukan.`, { parse_mode: 'Markdown' });
    }

    await updateTask(task.id, { technicianName: techName });
    const updatedTask = await getTaskById(task.id);
    return bot.sendMessage(chatId, `✅ Teknisi untuk order \`${task.id}\` berhasil diubah menjadi *${techName}*!\n\n${formatTaskMessage(updatedTask)}`, {
      parse_mode: 'Markdown',
      ...getTaskActionButtons(updatedTask.id)
    });
  } catch (err) {
    return bot.sendMessage(chatId, `❌ Gagal menetapkan teknisi: ${err.message}`);
  }
}

async function handleUpdateNote(bot, chatId, orderId, notes) {
  try {
    const task = await getTaskById(orderId);
    if (!task) {
      return bot.sendMessage(chatId, `❌ Order \`${orderId}\` tidak ditemukan.`, { parse_mode: 'Markdown' });
    }

    await updateTask(task.id, { notes });
    const updatedTask = await getTaskById(task.id);
    return bot.sendMessage(chatId, `✅ Catatan order \`${task.id}\` berhasil diperbarui!\n\n${formatTaskMessage(updatedTask)}`, {
      parse_mode: 'Markdown',
      ...getTaskActionButtons(updatedTask.id)
    });
  } catch (err) {
    return bot.sendMessage(chatId, `❌ Gagal memperbarui catatan: ${err.message}`);
  }
}

module.exports = {
  setupBotListeners
};
