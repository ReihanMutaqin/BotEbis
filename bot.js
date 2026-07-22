const TelegramBot = require('node-telegram-bot-api');
const { 
  getAllTasks, 
  getTaskById, 
  updateTask,
  registerTechnician,
  getAllTechnicians,
  getTechniciansBySTO,
  deleteTechnician
} = require('./firebase');

// User state tracking for multi-step prompts
const userStates = {};

const MENU_BUTTONS = [
  'Cek Work Order',
  'Rekap Status',
  'Task Pending',
  'Task Kendala',
  'Cari Teknisi',
  'Daftar Teknisi STO',
  'Template Update',
  'Bantuan'
];

function isMenuButton(text) {
  return MENU_BUTTONS.includes(text.trim());
}

function formatTaskMessage(task) {
  return `DETAIL WORK ORDER EBIS
  
Order ID: ${task.order || task.id}
Pelanggan: ${task.customerName || '-'}
Alamat: ${task.address || '-'}
STO / Witel: ${task.sto || '-'} / ${task.witel || '-'}
No. Internet: ${task.internet || '-'}
Layanan: ${task.serviceType || task.paket || '-'}
Status: ${task.trackerStatus || 'Pending'}
Teknisi: ${task.technicianName || 'Belum ditugaskan'}
Catatan: ${task.notes || '-'}
Status Resume: ${task.statusResume || '-'}
Order Date: ${task.orderDate || '-'}
`;
}

function getTaskActionButtons(orderId) {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: 'Set On Progress', callback_data: `st:${orderId}:On Progress` },
          { text: 'Set Completed', callback_data: `st:${orderId}:Completed` }
        ],
        [
          { text: 'Set Kendala', callback_data: `st:${orderId}:Kendala` },
          { text: 'Set Pending', callback_data: `st:${orderId}:Pending` }
        ],
        [
          { text: 'Assign & Notif STO', callback_data: `assign_sto_notif:${orderId}` },
          { text: 'Assign Teknisi Manual', callback_data: `assign:${orderId}` }
        ],
        [
          { text: 'Ubah Catatan', callback_data: `note:${orderId}` },
          { text: 'Refresh Detail', callback_data: `refresh:${orderId}` }
        ]
      ]
    }
  };
}

function getMainMenuKeyboard() {
  return {
    reply_markup: {
      keyboard: [
        [{ text: 'Cek Work Order' }, { text: 'Rekap Status' }],
        [{ text: 'Task Pending' }, { text: 'Task Kendala' }],
        [{ text: 'Daftar Teknisi STO' }, { text: 'Template Update' }],
        [{ text: 'Bantuan' }]
      ],
      resize_keyboard: true,
      persistent: true
    }
  };
}

function getTemplateGuideText() {
  return `TEMPLATE UPDATE WORK ORDER TEKNISI

Salin & isi template di bawah ini:

ORDER: 1001524450
STATUS: Completed
TEKNISI: Ahmad Fauzi
CATATAN: Redaman -18dBm, ONT terpasang, internet aktif

Pendaftaran Teknisi STO:
1. Daftarkan diri sendiri:
/daftar_teknisi JTN Hengky Julio

2. Daftarkan orang lain:
/daftar_teknisi JTN Hengky Julio @Tele123

Hapus Teknisi Terdaftar:
/hapus_teknisi Hengky Julio`;
}

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
  bot.onText(/\/start(?:@\w+)?|\/help(?:@\w+)?/, async (msg) => {
    const chatId = msg.chat.id;
    delete userStates[chatId];
    const text = `Selamat Datang di Bot EBIS Telkom

Fitur & Perintah Bot:
- /daftar_teknisi <STO> <Nama_Teknisi> [@Username] - Daftarkan diri sendiri atau orang lain ke STO
- /hapus_teknisi <Nama_atau_STO> - Hapus pendaftaran teknisi
- /list_teknisi - Lihat daftar teknisi per STO
- /updateteknisi <order_id> <nama_teknisi> - Set nama teknisi (Gunakan '-' untuk mengosongkan)
- /update <order_id> <status> [teknisi] [catatan] - Update status order
- /cek <nomor_order> - Cek detail work order
- /rekap - Lihat ringkasan statistik order
- /pending - Lihat daftar task pending
- /kendala - Lihat daftar task kendala
- /template - Dapatkan template update data

Gunakan menu di bawah ini untuk akses cepat:`;

    await bot.sendMessage(chatId, text, getMainMenuKeyboard());
  });

  // Command /daftar_teknisi <sto> <nama> [@username]
  bot.onText(/\/daftar_teknisi(?:@\w+)?(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    delete userStates[chatId];
    const rawArgs = match[1];
    if (!rawArgs) {
      return bot.sendMessage(chatId, `Format Pendaftaran Teknisi ke STO:

1. Daftarkan diri sendiri:
/daftar_teknisi <STO> <Nama_Teknisi>
Contoh: /daftar_teknisi JTN Hengky Julio

2. Daftarkan akun Telegram orang lain:
/daftar_teknisi <STO> <Nama_Teknisi> <@Username_Telegram>
Contoh: /daftar_teknisi JTN Hengky Julio @Tele123`);
    }

    const tokens = rawArgs.trim().split(/\s+/);
    const sto = tokens[0];

    if (tokens.length < 2) {
      return bot.sendMessage(chatId, `Silakan masukkan nama teknisi setelah STO.`);
    }

    let techName = '';
    let targetUsername = '';
    let targetChatId = chatId;

    const lastToken = tokens[tokens.length - 1];
    if (lastToken.startsWith('@')) {
      targetUsername = lastToken;
      techName = tokens.slice(1, tokens.length - 1).join(' ');
      targetChatId = targetUsername; // store username handle for tagging
    } else {
      techName = tokens.slice(1).join(' ');
      targetUsername = msg.from.username ? `@${msg.from.username}` : '';
      targetChatId = chatId;
    }

    if (!techName) {
      return bot.sendMessage(chatId, `Silakan masukkan nama teknisi dengan benar.`);
    }

    await registerTechnician(targetChatId, targetUsername, techName, sto);

    return bot.sendMessage(chatId, `Berhasil Terdaftar!
Nama: ${techName}
STO: ${sto.toUpperCase()}
Telegram: ${targetUsername || 'ID ' + targetChatId}

Setiap ada order baru di STO ${sto.toUpperCase()}, bot dapat melakukan tag & notifikasi langsung ke ${targetUsername || techName}.`);
  });

  // Command /hapus_teknisi <query>
  bot.onText(/\/hapus_teknisi(?:@\w+)?(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    delete userStates[chatId];
    const queryStr = match[1];
    if (!queryStr) {
      return bot.sendMessage(chatId, `Format Hapus Pendaftaran Teknisi:
/hapus_teknisi <Nama_Teknisi_atau_KODE_STO>

Contoh:
/hapus_teknisi Hengky Julio
/hapus_teknisi JTN`);
    }

    try {
      const { deletedCount, matched } = await deleteTechnician(queryStr.trim());
      if (deletedCount === 0) {
        return bot.sendMessage(chatId, `Tidak ditemukan pendaftaran teknisi dengan kata kunci "${queryStr}".`);
      }

      const names = matched.map(m => `${m.name} (STO ${m.sto})`).join(', ');
      return bot.sendMessage(chatId, `BERHASIL MENGHAPUS TEKNISI!\n\nTeknisi dihapus (${deletedCount}):\n${names}`);
    } catch (err) {
      return bot.sendMessage(chatId, `Gagal menghapus teknisi: ${err.message}`);
    }
  });

  // Command /list_teknisi
  bot.onText(/\/list_teknisi(?:@\w+)?/, async (msg) => {
    const chatId = msg.chat.id;
    delete userStates[chatId];
    try {
      const techs = await getAllTechnicians();
      if (techs.length === 0) {
        return bot.sendMessage(chatId, `Belum ada teknisi yang terdaftar per STO.\nDaftarkan dengan perintah: /daftar_teknisi <STO> <Nama>`);
      }

      let text = `DAFTAR TEKNISI TERDAFTAR PER STO (${techs.length} total):\n\n`;
      techs.forEach((t, i) => {
        text += `${i + 1}. ${t.name} (STO: ${t.sto})\n   Telegram: ${t.username ? t.username : 'ID ' + t.chatId}\n\n`;
      });

      return bot.sendMessage(chatId, text);
    } catch (err) {
      return bot.sendMessage(chatId, `Gagal mengambil daftar teknisi: ${err.message}`);
    }
  });

  // Command /template
  bot.onText(/\/template(?:@\w+)?/, async (msg) => {
    delete userStates[msg.chat.id];
    return bot.sendMessage(msg.chat.id, getTemplateGuideText());
  });

  // Command /updateteknisi <order_id> <nama_teknisi>
  bot.onText(/\/updateteknisi(?:@\w+)?(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    delete userStates[chatId];
    const rawArgs = match[1];
    if (!rawArgs) {
      return bot.sendMessage(chatId, `Format Perintah Update Teknisi:
/updateteknisi <order_id> <nama_teknisi>

Gunakan '-' (strip) jika ingin menghapus/mengosongkan teknisi.

Contoh:
/updateteknisi 1001524450 Ahmad Fauzi
/updateteknisi 1001524450 -`);
    }

    const parts = rawArgs.split(' ');
    const orderId = parts[0];
    let techName = parts.slice(1).join(' ');

    if (!techName) {
      return bot.sendMessage(chatId, `Silakan masukkan nama teknisi setelah nomor order.`);
    }

    if (techName === '-') techName = '';

    return handleAssignTechnician(bot, chatId, orderId, techName);
  });

  // Handle Text Messages & Menu Buttons
  bot.on('message', async (msg) => {
    if (!msg.text || msg.text.startsWith('/')) return;
    const chatId = msg.chat.id;
    const text = msg.text.trim();

    if (isMenuButton(text)) {
      delete userStates[chatId];

      if (text === 'Template Update') {
        return bot.sendMessage(chatId, getTemplateGuideText());
      }

      if (text === 'Daftar Teknisi STO') {
        const techs = await getAllTechnicians();
        if (techs.length === 0) {
          return bot.sendMessage(chatId, `Belum ada teknisi yang terdaftar per STO.\nDaftarkan dengan perintah: /daftar_teknisi <STO> <Nama>`);
        }

        let tText = `DAFTAR TEKNISI TERDAFTAR PER STO (${techs.length} total):\n\n`;
        techs.forEach((t, i) => {
          tText += `${i + 1}. ${t.name} (STO: ${t.sto})\n   Telegram: ${t.username ? t.username : 'ID ' + t.chatId}\n\n`;
        });
        return bot.sendMessage(chatId, tText);
      }

      if (text === 'Cek Work Order') {
        userStates[chatId] = { action: 'awaiting_search' };
        return bot.sendMessage(chatId, 'Silakan kirimkan Nomor Order, No Internet, atau Nama Pelanggan yang ingin dicari:');
      }

      if (text === 'Rekap Status') {
        return handleRekap(bot, chatId);
      }

      if (text === 'Task Pending') {
        return handleTaskListByStatus(bot, chatId, 'Pending');
      }

      if (text === 'Task Kendala') {
        return handleTaskListByStatus(bot, chatId, 'Kendala');
      }

      if (text === 'Cari Teknisi') {
        userStates[chatId] = { action: 'awaiting_teknisi' };
        return bot.sendMessage(chatId, 'Masukkan nama teknisi yang ingin dicari:');
      }

      if (text === 'Bantuan') {
        return bot.sendMessage(chatId, `Panduan Penggunaan Bot EBIS Telkom

1. Pendaftaran STO:
   - Diri sendiri: /daftar_teknisi JTN Hengky Julio
   - Orang lain: /daftar_teknisi JTN Hengky Julio @Tele123
2. Hapus Teknisi STO: /hapus_teknisi Hengky Julio
3. Assign & Notif: Klik "Assign & Notif STO" di detail order.
4. Cek Order: Kirim nomor order (misal: 1001524450)
5. Hapus Teknisi dari Order: /updateteknisi 1001524450 -

Untuk bantuan tambahan, hubungi Administrator EBIS.`);
      }
    }

    // Template Auto-Parse Check
    if (text.toUpperCase().includes('ORDER:')) {
      delete userStates[chatId];
      const parsed = parseTemplateMessage(text);
      if (parsed && parsed.orderId) {
        try {
          await bot.sendMessage(chatId, `Memproses update dari template untuk order ${parsed.orderId}...`);
          const task = await getTaskById(parsed.orderId);
          if (!task) {
            return bot.sendMessage(chatId, `Order ID ${parsed.orderId} tidak ditemukan di database.`);
          }

          const updates = {};
          if (parsed.status) {
            const validStatuses = ['Pending', 'On Progress', 'Completed', 'Kendala', 'Cancel'];
            const matchedStatus = validStatuses.find(s => s.toLowerCase() === parsed.status.toLowerCase());
            if (matchedStatus) updates.trackerStatus = matchedStatus;
          }
          if (parsed.technicianName) updates.technicianName = parsed.technicianName === '-' ? '' : parsed.technicianName;
          if (parsed.notes) updates.notes = parsed.notes;

          if (Object.keys(updates).length === 0) {
            return bot.sendMessage(chatId, `Tidak ada data yang diperbarui. Pastikan menyantumkan STATUS, TEKNISI, atau CATATAN.`);
          }

          await updateTask(task.id, updates);
          const updatedTask = await getTaskById(task.id);
          return bot.sendMessage(chatId, `ORDER BERHASIL DIPERBARUI DARI TEMPLATE!\n\n${formatTaskMessage(updatedTask)}`, getTaskActionButtons(updatedTask.id));
        } catch (err) {
          return bot.sendMessage(chatId, `Terjadi kesalahan saat memproses template: ${err.message}`);
        }
      }
    }

    if (userStates[chatId]) {
      const state = userStates[chatId];
      delete userStates[chatId];

      if (state.action === 'awaiting_search') {
        return handleSearch(bot, chatId, text);
      } else if (state.action === 'awaiting_assign') {
        const tName = text === '-' ? '' : text;
        return handleAssignTechnician(bot, chatId, state.orderId, tName);
      } else if (state.action === 'awaiting_note') {
        return handleUpdateNote(bot, chatId, state.orderId, text);
      } else if (state.action === 'awaiting_teknisi') {
        return handleSearchTeknisi(bot, chatId, text);
      }
    }

    if (text.length >= 3) {
      return handleSearch(bot, chatId, text);
    }
  });

  bot.onText(/\/cek(?:@\w+)?(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    delete userStates[chatId];
    const queryStr = match[1];
    if (!queryStr) {
      userStates[chatId] = { action: 'awaiting_search' };
      return bot.sendMessage(chatId, 'Silakan masukkan Nomor Order atau Nama Pelanggan:');
    }
    return handleSearch(bot, chatId, queryStr.trim());
  });

  bot.onText(/\/rekap(?:@\w+)?|\/status(?:@\w+)?/, async (msg) => {
    delete userStates[msg.chat.id];
    return handleRekap(bot, msg.chat.id);
  });

  bot.onText(/\/pending(?:@\w+)?/, async (msg) => {
    delete userStates[msg.chat.id];
    return handleTaskListByStatus(bot, msg.chat.id, 'Pending');
  });

  bot.onText(/\/kendala(?:@\w+)?/, async (msg) => {
    delete userStates[msg.chat.id];
    return handleTaskListByStatus(bot, msg.chat.id, 'Kendala');
  });

  bot.onText(/\/teknisi(?:@\w+)?(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    delete userStates[chatId];
    const techName = match[1];
    if (!techName) {
      userStates[chatId] = { action: 'awaiting_teknisi' };
      return bot.sendMessage(chatId, 'Masukkan nama teknisi yang ingin dicari:');
    }
    return handleSearchTeknisi(bot, chatId, techName.trim());
  });

  bot.onText(/\/update(?:@\w+)?(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    delete userStates[chatId];
    const rawArgs = match[1];
    if (!rawArgs) {
      return bot.sendMessage(chatId, `Format Perintah Update:
/update <order_id> <status> [teknisi] [catatan]

Pilihan Status: Pending, On Progress, Completed, Kendala, Cancel

Contoh:
/update 1001524450 Completed Budi "Selesai diinstal"`);
    }

    const parts = rawArgs.split(' ');
    const orderId = parts[0];
    const status = parts[1];
    let tech = parts[2] || '';
    if (tech === '-') tech = '';
    const notes = parts.slice(3).join(' ') || '';

    const validStatuses = ['Pending', 'On Progress', 'Completed', 'Kendala', 'Cancel'];
    const matchedStatus = validStatuses.find(s => s.toLowerCase() === status?.toLowerCase());

    if (!matchedStatus) {
      return bot.sendMessage(chatId, `Status ${status} tidak valid! Pilihan: Pending, On Progress, Completed, Kendala, Cancel`);
    }

    try {
      const task = await getTaskById(orderId);
      if (!task) {
        return bot.sendMessage(chatId, `Work order ${orderId} tidak ditemukan.`);
      }

      const updates = { trackerStatus: matchedStatus };
      if (tech !== undefined) updates.technicianName = tech;
      if (notes) updates.notes = notes;

      await updateTask(task.id, updates);

      const updatedTask = await getTaskById(task.id);
      return bot.sendMessage(chatId, `Berhasil Memperbarui Order!\n\n${formatTaskMessage(updatedTask)}`, getTaskActionButtons(updatedTask.id));
    } catch (err) {
      console.error(err);
      return bot.sendMessage(chatId, `Terjadi kesalahan saat update order: ${err.message}`);
    }
  });

  bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;

    await bot.answerCallbackQuery(query.id);

    if (data === 'show_rekap') {
      delete userStates[chatId];
      return handleRekap(bot, chatId);
    }

    if (data.startsWith('filter_st:')) {
      delete userStates[chatId];
      const status = data.split(':')[1];
      return handleTaskListByStatus(bot, chatId, status);
    }

    if (data.startsWith('view:')) {
      delete userStates[chatId];
      const orderId = data.split(':')[1];
      const task = await getTaskById(orderId);
      if (task) {
        return bot.sendMessage(chatId, formatTaskMessage(task), getTaskActionButtons(task.id));
      }
    }

    if (data.startsWith('assign_sto_notif:')) {
      delete userStates[chatId];
      const orderId = data.split(':')[1];
      return handleAssignAndNotifySTO(bot, chatId, orderId);
    }

    if (data.startsWith('st:')) {
      delete userStates[chatId];
      const [, orderId, newStatus] = data.split(':');
      try {
        const task = await getTaskById(orderId);
        if (!task) {
          return bot.sendMessage(chatId, `Order ${orderId} tidak ditemukan.`);
        }

        await updateTask(task.id, { trackerStatus: newStatus });
        const updatedTask = await getTaskById(task.id);

        try {
          await bot.editMessageText(`Status diperbarui menjadi ${newStatus}!\n\n${formatTaskMessage(updatedTask)}`, {
            chat_id: chatId,
            message_id: query.message.message_id,
            ...getTaskActionButtons(updatedTask.id)
          });
        } catch (e) {
          await bot.sendMessage(chatId, `Status diperbarui menjadi ${newStatus}!\n\n${formatTaskMessage(updatedTask)}`, getTaskActionButtons(updatedTask.id));
        }
      } catch (err) {
        bot.sendMessage(chatId, `Gagal update: ${err.message}`);
      }
    }

    if (data.startsWith('assign:')) {
      const orderId = data.split(':')[1];
      userStates[chatId] = { action: 'awaiting_assign', orderId };
      return bot.sendMessage(chatId, `Ketik nama teknisi untuk order ${orderId} di chat ini (atau ketik '-' untuk mengosongkan), atau gunakan perintah:\n/updateteknisi ${orderId} NamaTeknisi`);
    }

    if (data.startsWith('note:')) {
      const orderId = data.split(':')[1];
      userStates[chatId] = { action: 'awaiting_note', orderId };
      return bot.sendMessage(chatId, `Ketik catatan baru untuk order ${orderId} di chat ini:`);
    }

    if (data.startsWith('refresh:')) {
      delete userStates[chatId];
      const orderId = data.split(':')[1];
      const task = await getTaskById(orderId);
      if (task) {
        try {
          await bot.editMessageText(formatTaskMessage(task), {
            chat_id: chatId,
            message_id: query.message.message_id,
            ...getTaskActionButtons(task.id)
          });
        } catch (e) {
          // ignore
        }
      }
    }
  });
}

// Assign & Notify Technician by STO
async function handleAssignAndNotifySTO(bot, chatId, orderId) {
  try {
    const task = await getTaskById(orderId);
    if (!task) {
      return bot.sendMessage(chatId, `Order ${orderId} tidak ditemukan.`);
    }

    const taskSTO = task.sto || '';
    if (!taskSTO) {
      return bot.sendMessage(chatId, `Order ${orderId} tidak memiliki data STO.`);
    }

    const matchedTechs = await getTechniciansBySTO(taskSTO);
    if (matchedTechs.length === 0) {
      return bot.sendMessage(chatId, `Belum ada teknisi yang terdaftar untuk STO ${taskSTO}.\n\nSilakan daftarkan teknisi STO ${taskSTO} dengan perintah:\n/daftar_teknisi ${taskSTO} NamaTeknisi @Username`);
    }

    const techNames = matchedTechs.map(t => `${t.name} (${t.username || 'NoUsername'})`).join(', ');
    await updateTask(task.id, { technicianName: techNames, trackerStatus: 'On Progress' });

    const updatedTask = await getTaskById(task.id);

    let notifyResults = [];
    let tagsToMention = [];

    for (const tech of matchedTechs) {
      if (tech.username) {
        tagsToMention.push(tech.username);
      }
      try {
        const targetId = tech.chatId.startsWith('@') ? tech.chatId : tech.chatId;
        const notifyMsg = `NOTIFIKASI WORK ORDER BARU (STO ${taskSTO})

Order ID: ${updatedTask.id}
Pelanggan: ${updatedTask.customerName || '-'}
Alamat: ${updatedTask.address || '-'}
Layanan: ${updatedTask.serviceType || '-'}
Status: On Progress

Silakan segera ditindaklanjuti!`;

        await bot.sendMessage(targetId, notifyMsg, getTaskActionButtons(updatedTask.id));
        notifyResults.push(`- ${tech.name} (${tech.username || 'Direct Message'}): BERHASIL TERSAMPALKAN`);
      } catch (dmErr) {
        notifyResults.push(`- ${tech.name} (${tech.username || 'ID ' + tech.chatId}): Di-tag di Grup (${tech.username || 'Pesan terkirim ke grup'})`);
      }
    }

    const mentionsText = tagsToMention.length > 0 ? `\n\nTag Teknisi: ${tagsToMention.join(' ')}` : '';

    const resultMsg = `ORDER BERHASIL DI-ASSIGN BERDASARKAN STO ${taskSTO}!

Teknisi Ditugaskan: ${techNames}${mentionsText}

Status Notifikasi:
${notifyResults.join('\n')}

${formatTaskMessage(updatedTask)}`;

    return bot.sendMessage(chatId, resultMsg, getTaskActionButtons(updatedTask.id));
  } catch (err) {
    return bot.sendMessage(chatId, `Gagal assign STO & Notif: ${err.message}`);
  }
}

// Helpers
async function handleSearch(bot, chatId, queryStr) {
  try {
    await bot.sendMessage(chatId, `Mencari order: ${queryStr}...`);
    const task = await getTaskById(queryStr);
    if (!task) {
      return bot.sendMessage(chatId, `Work order dengan kata kunci "${queryStr}" tidak ditemukan.`);
    }

    return bot.sendMessage(chatId, formatTaskMessage(task), getTaskActionButtons(task.id));
  } catch (err) {
    return bot.sendMessage(chatId, `Error saat pencarian: ${err.message}`);
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

    const text = `REKAPITULASI STATUS WORK ORDER EBIS
    
Total Order: ${counts.Total}
Pending: ${counts.Pending}
On Progress: ${counts['On Progress']}
Completed: ${counts.Completed}
Kendala: ${counts.Kendala}
Cancel: ${counts.Cancel}

Klik tombol di bawah untuk melihat daftar spesifik:`;

    const inline_keyboard = [
      [
        { text: `Pending (${counts.Pending})`, callback_data: 'filter_st:Pending' },
        { text: `Progress (${counts['On Progress']})`, callback_data: 'filter_st:On Progress' }
      ],
      [
        { text: `Kendala (${counts.Kendala})`, callback_data: 'filter_st:Kendala' },
        { text: `Completed (${counts.Completed})`, callback_data: 'filter_st:Completed' }
      ]
    ];

    return bot.sendMessage(chatId, text, { reply_markup: { inline_keyboard } });
  } catch (err) {
    return bot.sendMessage(chatId, `Gagal mengambil data rekap: ${err.message}`);
  }
}

async function handleTaskListByStatus(bot, chatId, status) {
  try {
    const tasks = await getAllTasks();
    const filtered = tasks.filter(t => (t.trackerStatus || 'Pending').toLowerCase() === status.toLowerCase());

    if (filtered.length === 0) {
      return bot.sendMessage(chatId, `Tidak ada task dengan status ${status}.`);
    }

    const limited = filtered.slice(0, 10);
    let msgText = `Daftar Task Status ${status} (${filtered.length} total):\n\n`;

    const inline_keyboard = [];
    limited.forEach((t, i) => {
      msgText += `${i + 1}. ${t.order || t.id} - ${t.customerName || 'Cust'}\nAlamat/STO: ${t.sto || '-'}\n\n`;
      inline_keyboard.push([{ text: `Detail ${t.order || t.id}`, callback_data: `view:${t.id}` }]);
    });

    if (filtered.length > 10) {
      msgText += `...dan ${filtered.length - 10} order lainnya.`;
    }

    return bot.sendMessage(chatId, msgText, { reply_markup: { inline_keyboard } });
  } catch (err) {
    return bot.sendMessage(chatId, `Gagal memuat daftar task: ${err.message}`);
  }
}

async function handleSearchTeknisi(bot, chatId, techName) {
  try {
    const tasks = await getAllTasks();
    const matched = tasks.filter(t => t.technicianName && t.technicianName.toLowerCase().includes(techName.toLowerCase()));

    if (matched.length === 0) {
      return bot.sendMessage(chatId, `Tidak ada task yang ditugaskan ke teknisi "${techName}".`);
    }

    let msgText = `Task untuk Teknisi "${techName}" (${matched.length} total):\n\n`;
    const inline_keyboard = [];

    matched.slice(0, 10).forEach((t, i) => {
      msgText += `${i + 1}. ${t.order || t.id} [${t.trackerStatus || 'Pending'}]\nPelanggan: ${t.customerName || '-'}\nAlamat: ${t.address || '-'}\n\n`;
      inline_keyboard.push([{ text: `Detail ${t.order || t.id}`, callback_data: `view:${t.id}` }]);
    });

    return bot.sendMessage(chatId, msgText, { reply_markup: { inline_keyboard } });
  } catch (err) {
    return bot.sendMessage(chatId, `Gagal mencari teknisi: ${err.message}`);
  }
}

async function handleAssignTechnician(bot, chatId, orderId, techName) {
  try {
    const task = await getTaskById(orderId);
    if (!task) {
      return bot.sendMessage(chatId, `Order ${orderId} tidak ditemukan.`);
    }

    await updateTask(task.id, { technicianName: techName });
    const updatedTask = await getTaskById(task.id);
    return bot.sendMessage(chatId, `Teknisi untuk order ${task.id} berhasil diubah menjadi ${techName || 'Belum ditugaskan'}!\n\n${formatTaskMessage(updatedTask)}`, getTaskActionButtons(updatedTask.id));
  } catch (err) {
    return bot.sendMessage(chatId, `Gagal menetapkan teknisi: ${err.message}`);
  }
}

async function handleUpdateNote(bot, chatId, orderId, notes) {
  try {
    const task = await getTaskById(orderId);
    if (!task) {
      return bot.sendMessage(chatId, `Order ${orderId} tidak ditemukan.`);
    }

    await updateTask(task.id, { notes });
    const updatedTask = await getTaskById(task.id);
    return bot.sendMessage(chatId, `Catatan order ${task.id} berhasil diperbarui!\n\n${formatTaskMessage(updatedTask)}`, getTaskActionButtons(updatedTask.id));
  } catch (err) {
    return bot.sendMessage(chatId, `Gagal memperbarui catatan: ${err.message}`);
  }
}

module.exports = {
  setupBotListeners
};
