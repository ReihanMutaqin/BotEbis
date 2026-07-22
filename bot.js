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

function getSenderTag(from) {
  if (!from) return '-';
  if (from.username) return `@${from.username}`;
  const fullName = [from.first_name, from.last_name].filter(Boolean).join(' ');
  return fullName || `User ${from.id}`;
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
Status Message: ${task.statusMessage || '-'}
Last Update Status: ${task.orderDate || task.updatedAt || '-'}
Di Update Oleh: ${task.updatedBy || '-'}
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

function getFullHelpText() {
  return `DAFTAR LENGKAP PERINTAH (COMMANDS) BOT EBIS TELKOM

🔍 PENCHARIAN & MONITORING WORK ORDER:
- /cek <order_id | STO | nama_pelanggan>
  Cek detail order atau tampilkan seluruh list order per STO.
  Contoh:
    /cek 1002476754
    /cek JTN
    /cek Toko Om Arah

- /rekap atau /status
  Lihat statistik ringkasan total order (Pending, Progress, Completed, Kendala).

- /pending
  Tampilkan seluruh daftar work order ber-status Pending.

- /kendala
  Tampilkan seluruh daftar work order ber-status Kendala.

- /teknisi <nama_teknisi>
  Cari work order yang ditugaskan ke teknisi tertentu.
  Contoh: /teknisi Hengky

📝 UPDATE STATUS & DATA WORK ORDER:
- /update <order_id> <status> <teknisi_atau_:me> <catatan>
  Update status, teknisi, dan catatan order.
  Pilihan Status: Pending, On Progress, Completed, Kendala, Cancel
  Contoh:
    /update 1002476754 Pending :me Pending jadwal
    /update 1002476754 Pending "Nama Kalian" ONT OK

- /updateteknisi <order_id> <nama_teknisi_atau_:me>
  Khusus memperbarui nama teknisi (Gunakan '-' untuk mengosongkan).
  Contoh:
    /updateteknisi 1002476754 :me
    /updateteknisi 1002476754 Nama Kalian

- /template
  Dapatkan format template copy-paste laporan update order.

👷 PENDAFTARAN & MANAJEMEN TEKNISI PER STO:
- /daftar_teknisi <STO> <Nama_Teknisi> [@Username]
  Daftarkan diri sendiri atau akun Telegram orang lain ke STO.
  Contoh:
    /daftar_teknisi JTN Nama Kalian
    /daftar_teknisi JTN Nama Kalian @Tele123

- /list_teknisi [KODE_STO]
  Lihat daftar teknisi terdaftar (semua STO atau spesifik per STO).
  Contoh:
    /list_teknisi
    /list_teknisi JTN

- /hapus_teknisi <Nama_Teknisi_atau_KODE_STO>
  Hapus pendaftaran teknisi dari sistem.
  Contoh:
    /hapus_teknisi Nama Kalian
    /hapus_teknisi JTN

⚙️ LAINNYA:
- /start : Tampilkan menu tombol navigasi utama.
- /help : Menampilkan daftar lengkap seluruh perintah ini.`;
}

function getTemplateGuideText() {
  return `TEMPLATE UPDATE WORK ORDER TEKNISI

Salin & isi template di bawah ini:

ORDER: 1001524450
STATUS: Completed
TEKNISI: Ahmad Fauzi
CATATAN: Redaman -18dBm, ONT terpasang, internet aktif

Perintah Cepat Update:
1. Pakai :me (Nama Telegram Sendiri):
/update 1002476754 Pending :me Pending jadwal

2. Pakai Nama Lengkap (Tanda Kutip):
/update 1002476754 Pending "Nama Kalian" Pending jadwal

3. Cek Full List Order per STO:
/cek JTN
/cek CWA

Gunakan /help untuk melihat seluruh daftar perintah lengkap.`;
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

function parseUpdateCommandArgs(rawArgs, sender) {
  const trimmed = rawArgs.trim();
  const firstSpace = trimmed.indexOf(' ');
  if (firstSpace === -1) return null;
  const orderId = trimmed.substring(0, firstSpace).trim();

  const remainder1 = trimmed.substring(firstSpace + 1).trim();
  const secondSpace = remainder1.indexOf(' ');
  let status = remainder1;
  let remainder2 = '';

  if (secondSpace !== -1) {
    status = remainder1.substring(0, secondSpace).trim();
    remainder2 = remainder1.substring(secondSpace + 1).trim();
  }

  let techName = '';
  let notes = '';

  if (remainder2) {
    if (remainder2.toLowerCase().startsWith(':me')) {
      const senderName = [sender.first_name, sender.last_name].filter(Boolean).join(' ') || (sender.username ? `@${sender.username}` : 'Teknisi');
      techName = senderName;
      notes = remainder2.substring(3).trim();
    } else if (remainder2.startsWith('"') || remainder2.startsWith("'")) {
      const quoteChar = remainder2[0];
      const endQuote = remainder2.indexOf(quoteChar, 1);
      if (endQuote !== -1) {
        techName = remainder2.substring(1, endQuote).trim();
        notes = remainder2.substring(endQuote + 1).trim();
      } else {
        techName = remainder2.substring(1).trim();
      }
    } else if (remainder2.startsWith('-')) {
      techName = '';
      notes = remainder2.substring(1).trim();
    } else {
      const spaceIdx = remainder2.indexOf(' ');
      if (spaceIdx === -1) {
        techName = remainder2;
        notes = '';
      } else {
        techName = remainder2.substring(0, spaceIdx).trim();
        notes = remainder2.substring(spaceIdx + 1).trim();
      }
    }
  }

  return { orderId, status, techName, notes };
}

function formatTechniciansBySTOList(techs, filterSTO = null) {
  if (techs.length === 0) {
    return filterSTO
      ? `Belum ada teknisi yang terdaftar untuk STO ${filterSTO.toUpperCase()}.\n\nDaftarkan dengan perintah: /daftar_teknisi ${filterSTO.toUpperCase()} NamaTeknisi @Username`
      : `Belum ada teknisi yang terdaftar di sistem.\n\nDaftarkan dengan perintah: /daftar_teknisi <STO> <Nama> [@Username]`;
  }

  let filtered = techs;
  if (filterSTO) {
    filtered = techs.filter(t => t.sto.toUpperCase() === filterSTO.toUpperCase());
    if (filtered.length === 0) {
      return `Belum ada teknisi yang terdaftar untuk STO ${filterSTO.toUpperCase()}.\n\nDaftarkan dengan perintah: /daftar_teknisi ${filterSTO.toUpperCase()} NamaTeknisi @Username`;
    }
  }

  const grouped = {};
  filtered.forEach(t => {
    const stoKey = (t.sto || 'UMUM').toUpperCase();
    if (!grouped[stoKey]) grouped[stoKey] = [];
    grouped[stoKey].push(t);
  });

  let text = filterSTO
    ? `DAFTAR TEKNISI TERDAFTAR STO ${filterSTO.toUpperCase()} (${filtered.length} total):\n\n`
    : `DAFTAR TEKNISI TERDAFTAR PER STO (${filtered.length} total):\n\n`;

  for (const sto in grouped) {
    text += `STO ${sto}:\n`;
    grouped[sto].forEach((t, i) => {
      text += `  ${i + 1}. ${t.name} ${t.username ? '(' + t.username + ')' : '(ID ' + t.chatId + ')'}\n`;
    });
    text += `\n`;
  }

  text += `Petunjuk:\n- Ketik /list_teknisi <STO> untuk filter STO tertentu.\n- Ketik /daftar_teknisi <STO> <Nama> [@Username] untuk mendaftarkan teknisi baru.`;
  return text;
}

// Full List Sender Helper
async function sendFullTaskList(bot, chatId, title, tasks) {
  if (!tasks || tasks.length === 0) {
    return bot.sendMessage(chatId, `Tidak ada data work order.`);
  }

  const MAX_LIMIT = 30;
  const totalCount = tasks.length;
  const displayTasks = tasks.slice(0, MAX_LIMIT);

  const CHUNK_SIZE = 10;
  const totalPages = Math.ceil(displayTasks.length / CHUNK_SIZE);

  for (let i = 0; i < displayTasks.length; i += CHUNK_SIZE) {
    const chunk = displayTasks.slice(i, i + CHUNK_SIZE);
    const currentPage = Math.floor(i / CHUNK_SIZE) + 1;

    const limitInfo = totalCount > MAX_LIMIT ? ` (Maksimal ${MAX_LIMIT} ditampilkan dari ${totalCount})` : ``;
    let msgText = `${title}${totalPages > 1 ? ` (Hal ${currentPage}/${totalPages})` : ''} - Total ${totalCount} Order${limitInfo}:\n\n`;
    const inline_keyboard = [];

    chunk.forEach((t, idx) => {
      const orderNum = i + idx + 1;
      msgText += `${orderNum}. Order: ${t.order || t.id}\n   Pelanggan: ${t.customerName || '-'}\n   Status: ${t.trackerStatus || 'Pending'} | STO: ${t.sto || '-'}\n   Teknisi: ${t.technicianName || '-'}\n   Status Resume: ${t.statusResume || '-'}\n   Status Message: ${t.statusMessage || '-'}\n   Last Update Status: ${t.orderDate || t.updatedAt || '-'}\n   Di Update Oleh: ${t.updatedBy || '-'}\n\n`;
      inline_keyboard.push([{ text: `Detail ${t.order || t.id}`, callback_data: `view:${t.id}` }]);
    });

    await bot.sendMessage(chatId, msgText, { reply_markup: { inline_keyboard } });
  }
}

function setupBotListeners(bot) {
  // Command /start & /help
  bot.onText(/\/start(?:@\w+)?/, async (msg) => {
    const chatId = msg.chat.id;
    delete userStates[chatId];
    await bot.sendMessage(chatId, getFullHelpText(), getMainMenuKeyboard());
  });

  bot.onText(/\/help(?:@\w+)?/, async (msg) => {
    const chatId = msg.chat.id;
    delete userStates[chatId];
    await bot.sendMessage(chatId, getFullHelpText());
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
Contoh: /daftar_teknisi JTN Nama Kalian

2. Daftarkan akun Telegram orang lain:
/daftar_teknisi <STO> <Nama_Teknisi> <@Username_Telegram>
Contoh: /daftar_teknisi JTN Nama Kalian @Tele123`);
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
      targetChatId = targetUsername;
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

  // Command /list_teknisi [sto] and /list_teknisi_sto [sto]
  bot.onText(/\/list_teknisi(?:_sto)?(?:@\w+)?(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    delete userStates[chatId];
    const filterSTO = match[1] ? match[1].trim() : null;

    try {
      const techs = await getAllTechnicians();
      const text = formatTechniciansBySTOList(techs, filterSTO);
      return bot.sendMessage(chatId, text);
    } catch (err) {
      return bot.sendMessage(chatId, `Gagal mengambil daftar teknisi: ${err.message}`);
    }
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
/hapus_teknisi Nama Kalian
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

Gunakan :me untuk nama Telegram kamu sendiri.
Gunakan '-' (strip) jika ingin mengosongkan.

Contoh:
/updateteknisi 1001524450 :me
/updateteknisi 1001524450 Nama Kalian`);
    }

    const parts = rawArgs.split(' ');
    const orderId = parts[0];
    let techName = parts.slice(1).join(' ');

    if (!techName) {
      return bot.sendMessage(chatId, `Silakan masukkan nama teknisi setelah nomor order.`);
    }

    if (techName.toLowerCase() === ':me') {
      techName = [msg.from.first_name, msg.from.last_name].filter(Boolean).join(' ') || (msg.from.username ? `@${msg.from.username}` : 'Teknisi');
    } else if (techName === '-') {
      techName = '';
    }

    const updater = getSenderTag(msg.from);
    return handleAssignTechnician(bot, chatId, orderId, techName, updater);
  });

  // Command /update <order_id> <status> <teknisi> <catatan>
  bot.onText(/\/update(?:@\w+)?(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    delete userStates[chatId];
    const rawArgs = match[1];
    if (!rawArgs) {
      return bot.sendMessage(chatId, `Format Perintah Update:
/update <order_id> <status> <teknisi_atau_:me> <catatan>

Contoh Pakai :me (Nama Telegram Kamu):
/update 1002476754 Pending :me Pending jadwal

Contoh Pakai Nama Lengkap (Gunakan Tanda Kutip):
/update 1002476754 Pending "Nama Kalian" Pending jadwal`);
    }

    const parsed = parseUpdateCommandArgs(rawArgs, msg.from);
    if (!parsed) {
      return bot.sendMessage(chatId, `Format tidak sesuai. Contoh: /update 1002476754 Pending :me Pending jadwal`);
    }

    const { orderId, status, techName, notes } = parsed;
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

      const updatedBy = getSenderTag(msg.from);
      const updates = {
        trackerStatus: matchedStatus,
        updatedBy: updatedBy
      };
      if (techName !== undefined && techName !== '') updates.technicianName = techName;
      if (notes) updates.notes = notes;

      await updateTask(task.id, updates);

      const updatedTask = await getTaskById(task.id);
      return bot.sendMessage(chatId, `Berhasil Memperbarui Order!\n\n${formatTaskMessage(updatedTask)}`, getTaskActionButtons(updatedTask.id));
    } catch (err) {
      console.error(err);
      return bot.sendMessage(chatId, `Terjadi kesalahan saat update order: ${err.message}`);
    }
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
        const tText = formatTechniciansBySTOList(techs);
        return bot.sendMessage(chatId, tText);
      }

      if (text === 'Cek Work Order') {
        userStates[chatId] = { action: 'awaiting_search' };
        return bot.sendMessage(chatId, 'Silakan kirimkan Nomor Order, No Internet, Nama Pelanggan, atau Kode STO (misal: JTN) yang ingin dicari:');
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
        return bot.sendMessage(chatId, getFullHelpText());
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

          const updatedBy = getSenderTag(msg.from);
          const updates = { updatedBy };

          if (parsed.status) {
            const validStatuses = ['Pending', 'On Progress', 'Completed', 'Kendala', 'Cancel'];
            const matchedStatus = validStatuses.find(s => s.toLowerCase() === parsed.status.toLowerCase());
            if (matchedStatus) updates.trackerStatus = matchedStatus;
          }
          if (parsed.technicianName) {
            if (parsed.technicianName.toLowerCase() === ':me') {
              updates.technicianName = [msg.from.first_name, msg.from.last_name].filter(Boolean).join(' ') || (msg.from.username ? `@${msg.from.username}` : 'Teknisi');
            } else if (parsed.technicianName === '-') {
              updates.technicianName = '';
            } else {
              updates.technicianName = parsed.technicianName;
            }
          }
          if (parsed.notes) updates.notes = parsed.notes;

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
        let tName = text;
        if (text.toLowerCase() === ':me') {
          tName = [msg.from.first_name, msg.from.last_name].filter(Boolean).join(' ') || (msg.from.username ? `@${msg.from.username}` : 'Teknisi');
        } else if (text === '-') {
          tName = '';
        }
        const updatedBy = getSenderTag(msg.from);
        return handleAssignTechnician(bot, chatId, state.orderId, tName, updatedBy);
      } else if (state.action === 'awaiting_note') {
        const updatedBy = getSenderTag(msg.from);
        return handleUpdateNote(bot, chatId, state.orderId, text, updatedBy);
      } else if (state.action === 'awaiting_teknisi') {
        return handleSearchTeknisi(bot, chatId, text);
      }
    }

    if (text.length >= 2) {
      return handleSearch(bot, chatId, text);
    }
  });

  bot.onText(/\/cek(?:@\w+)?(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    delete userStates[chatId];
    const queryStr = match[1];
    if (!queryStr) {
      userStates[chatId] = { action: 'awaiting_search' };
      return bot.sendMessage(chatId, 'Silakan masukkan Nomor Order, Nama Pelanggan, atau Kode STO (misal: JTN):');
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

  bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;

    await bot.answerCallbackQuery(query.id);
    const updatedBy = getSenderTag(query.from);

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
      return handleAssignAndNotifySTO(bot, chatId, orderId, updatedBy);
    }

    if (data.startsWith('st:')) {
      delete userStates[chatId];
      const [, orderId, newStatus] = data.split(':');
      try {
        const task = await getTaskById(orderId);
        if (!task) {
          return bot.sendMessage(chatId, `Order ${orderId} tidak ditemukan.`);
        }

        await updateTask(task.id, { trackerStatus: newStatus, updatedBy });
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
      return bot.sendMessage(chatId, `Ketik nama teknisi untuk order ${orderId} di chat ini (atau ketik ':me' untuk nama kamu sendiri), atau gunakan perintah:\n/updateteknisi ${orderId} :me`);
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
async function handleAssignAndNotifySTO(bot, chatId, orderId, updatedBy = '-') {
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
    await updateTask(task.id, { technicianName: techNames, trackerStatus: 'On Progress', updatedBy });

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
Di Update Oleh: ${updatedBy}

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

// Helpers / Search
async function handleSearch(bot, chatId, queryStr) {
  try {
    await bot.sendMessage(chatId, `Mencari data: ${queryStr}...`);
    const allTasks = await getAllTasks();
    const qLower = queryStr.toLowerCase();

    const stoMatches = allTasks.filter(t => t.sto && t.sto.toLowerCase() === qLower);

    if (stoMatches.length > 0) {
      return sendFullTaskList(bot, chatId, `DAFTAR FULL WORK ORDER STO ${queryStr.toUpperCase()}`, stoMatches);
    }

    const singleMatch = await getTaskById(queryStr);
    if (!singleMatch) {
      const partialSto = allTasks.filter(t =>
        (t.sto && t.sto.toLowerCase().includes(qLower)) ||
        (t.witel && t.witel.toLowerCase().includes(qLower))
      );

      if (partialSto.length > 0) {
        return sendFullTaskList(bot, chatId, `DAFTAR FULL WORK ORDER STO/WITEL`, partialSto);
      }

      return bot.sendMessage(chatId, `Work order atau STO "${queryStr}" tidak ditemukan.`);
    }

    return bot.sendMessage(chatId, formatTaskMessage(singleMatch), getTaskActionButtons(singleMatch.id));
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
        { text: `Kendala (${counts.Kendala})`, callback_data: 'filter_st:Completed' },
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

    return sendFullTaskList(bot, chatId, `Daftar Full Task Status ${status}`, filtered);
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

    return sendFullTaskList(bot, chatId, `Full Task untuk Teknisi "${techName}"`, matched);
  } catch (err) {
    return bot.sendMessage(chatId, `Gagal mencari teknisi: ${err.message}`);
  }
}

async function handleAssignTechnician(bot, chatId, orderId, techName, updatedBy = '-') {
  try {
    const task = await getTaskById(orderId);
    if (!task) {
      return bot.sendMessage(chatId, `Order ${orderId} tidak ditemukan.`);
    }

    await updateTask(task.id, { technicianName: techName, updatedBy });
    const updatedTask = await getTaskById(task.id);
    return bot.sendMessage(chatId, `Teknisi untuk order ${task.id} berhasil diubah menjadi ${techName || 'Belum ditugaskan'}!\n\n${formatTaskMessage(updatedTask)}`, getTaskActionButtons(updatedTask.id));
  } catch (err) {
    return bot.sendMessage(chatId, `Gagal menetapkan teknisi: ${err.message}`);
  }
}

async function handleUpdateNote(bot, chatId, orderId, notes, updatedBy = '-') {
  try {
    const task = await getTaskById(orderId);
    if (!task) {
      return bot.sendMessage(chatId, `Order ${orderId} tidak ditemukan.`);
    }

    await updateTask(task.id, { notes, updatedBy });
    const updatedTask = await getTaskById(task.id);
    return bot.sendMessage(chatId, `Catatan order ${task.id} berhasil diperbarui!\n\n${formatTaskMessage(updatedTask)}`, getTaskActionButtons(updatedTask.id));
  } catch (err) {
    return bot.sendMessage(chatId, `Gagal memperbarui catatan: ${err.message}`);
  }
}

module.exports = {
  setupBotListeners
};
