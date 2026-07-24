// Sync update with EBIS Web App v2
const TelegramBot = require('node-telegram-bot-api');
const {
  getAllTasks,
  getTaskById,
  updateTask,
  registerTechnician,
  getAllTechnicians,
  getTechniciansBySTO,
  deleteTechnician,
  saveChatUser,
  unregisterChatUser,
  setUserWitel,
  getAllRecipientChatIds,
  getAllRecipientProfiles,
  getAdminAuth,
  updateAdminAuth,
  addOrUpdateAdminUser,
  getAllAdminUsers,
  deleteAdminUser
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

function isAuthorizedAdmin(from) {
  if (!from) return false;
  const isIdMatch = String(from.id) === '902544604';
  const isUsernameMatch = from.username && (
    from.username.toLowerCase() === 'rei219' || 
    from.username.toLowerCase() === 'reih'
  );
  return isIdMatch || isUsernameMatch;
}

function isMenuButton(text) {
  return MENU_BUTTONS.includes(text.trim());
}

function getSenderTag(from) {
  if (!from) return '-';
  if (from.username) return `@${from.username}`;
  const fullName = [from.first_name, from.last_name].filter(Boolean).join(' ');
  return fullName || `User ${from.id}`;
}

function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function extractOrderIdFromText(text) {
  if (!text) return null;
  const matchOrder = text.match(/order\s+(?:ID\s+)?(?:<code>)?(\w+)(?:<\/code>)?/i);
  if (matchOrder && matchOrder[1]) {
    return matchOrder[1].replace(/[^a-zA-Z0-9_-]/g, '');
  }
  const matchNum = text.match(/\b(100\d{7})\b/);
  if (matchNum) {
    return matchNum[1];
  }
  return null;
}

function getStatusBadge(status) {
  const st = (status || '').toLowerCase();
  if (st.includes('complete') || st.includes('selesai')) return '<b>Completed</b>';
  if (st.includes('progress') || st.includes('jalan')) return '<b>On Progress</b>';
  if (st.includes('kendala') || st.includes('issue')) return '<b>Kendala</b>';
  if (st.includes('cancel') || st.includes('batal')) return '<b>Cancel</b>';
  return '<b>Pending</b>';
}

function buildPromptForMissingFields(task, statusName) {
  const missingFields = [];
  if (!task.woId || task.woId === '-') missingFields.push('WO ID: WO123456');
  if (!task.nik || task.nik === '-') missingFields.push('NIK: 12345678');

  const stLower = (statusName || '').toLowerCase();
  if (!task.notes || task.notes === '-') {
    if (stLower === 'kendala') {
      missingFields.push('CATATAN: Alasan kendala...');
    } else if (stLower === 'pending') {
      missingFields.push('CATATAN: Alasan pending...');
    } else if (stLower === 'completed') {
      missingFields.push('CATATAN: Selesai, redaman OK...');
    } else {
      missingFields.push('CATATAN: Keterangan / progres...');
    }
  } else {
    missingFields.push('CATATAN: Update catatan...');
  }

  const promptCode = `<pre>${missingFields.join('\n')}</pre>`;

  return `<b>Status order <code>${escapeHtml(task.id)}</code> diubah menjadi ${escapeHtml(statusName)}.</b>\n\n` +
    `💡 <i>Tip: Sentuh (tap) kotak di bawah ini untuk otomatis menyalin format, lalu tempel (paste) dan lengkapi datanya:</i>\n\n` +
    `${promptCode}`;
}

function formatTaskMessage(task) {
  const orderId = escapeHtml(task.order || task.id);
  const woId = escapeHtml(task.woId || '-');
  const nik = escapeHtml(task.nik || '-');
  const customer = escapeHtml(task.customerName || '-');
  const address = escapeHtml(task.address || '-');
  const sto = escapeHtml(task.sto || '-');
  const witel = escapeHtml(task.witel || '-');
  const internet = escapeHtml(task.internet || '-');
  const service = escapeHtml(task.serviceType || task.paket || '-');
  const badge = getStatusBadge(task.trackerStatus);
  const tech = escapeHtml(task.technicianName || 'Belum ditugaskan');
  const notes = escapeHtml(task.notes || '-');
  const resume = escapeHtml(task.statusResume || '-');
  const statusMsg = escapeHtml(task.statusMessage || '-');
  const lastUpdate = escapeHtml(task.orderDate || task.updatedAt || '-');
  const updatedBy = escapeHtml(task.updatedBy || '-');

  return `<b>DETAIL WORK ORDER EBIS</b>
─────────────────────────
<b>Order ID:</b> <code>${orderId}</code>
<b>WO ID:</b> <code>${woId}</code>
<b>NIK Teknisi:</b> <code>${nik}</code>
<b>Pelanggan:</b> ${customer}
<b>Alamat:</b> ${address}
<b>STO / Witel:</b> <code>${sto}</code> / <code>${witel}</code>
<b>No. Internet:</b> <code>${internet}</code>
<b>Layanan:</b> ${service}
<b>Status:</b> ${badge}
<b>Teknisi:</b> <code>${tech}</code>
<b>Catatan:</b> ${notes}
<b>Status Resume:</b> ${resume}
<b>Status Message:</b> ${statusMsg}
<b>Last Update:</b> <i>${lastUpdate}</i>
<b>Di Update Oleh:</b> ${updatedBy}
─────────────────────────`;
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
  return `<b>DAFTAR LENGKAP PERINTAH BOT EBIS TELKOM</b>
═════════════════════════

<b>PENCARIAN & MONITORING WORK ORDER:</b>
• <code>/cek &lt;order_id | STO | nama_pelanggan&gt; [status]</code>
  <i>Cek detail order atau tampilkan daftar order per STO (bisa difilter status: completed, on, pending, kendala, cancel).</i>
  <i>Contoh:</i>
    <code>/cek 1002476754</code>
    <code>/cek JTN</code>
    <code>/cek JTN completed</code>
    <code>/cek JTN on</code>
    <code>/cek JTN pending</code>
    <code>/cek JTN kendala</code>
    <code>/cek JTN cancel</code>

• <code>/rekap</code> atau <code>/status</code>
  <i>Lihat statistik ringkasan total order.</i>

• <code>/pending</code>
  <i>Tampilkan daftar order ber-status Pending.</i>

• <code>/kendala</code>
  <i>Tampilkan daftar order ber-status Kendala.</i>

• <code>/teknisi &lt;nama_teknisi&gt;</code>
  <i>Cari order yang ditugaskan ke teknisi tertentu.</i>
  <i>Contoh:</i> <code>/teknisi Hengky</code>

─────────────────────────
<b>UPDATE STATUS & DATA WORK ORDER:</b>
• <code>/update &lt;order_id&gt; &lt;status&gt; &lt;teknisi|:me&gt; &lt;catatan&gt;</code>
  <i>Update status, teknisi, dan catatan order.</i>
  <i>Pilihan Status: Pending, On Progress, Completed, Kendala, Cancel</i>
  <i>Contoh:</i>
    <code>/update 1002476754 Pending :me Pending jadwal</code>
    <code>/update 1002476754 Pending "Nama Kalian" ONT OK</code>

• <code>/updateteknisi &lt;order_id&gt; &lt;nama_teknisi|:me&gt;</code>
  <i>Khusus memperbarui nama teknisi (Gunakan '-' untuk mengosongkan).</i>
  <i>Contoh:</i>
    <code>/updateteknisi 1002476754 :me</code>

• <code>/template</code>
  <i>Template copy-paste laporan update.</i>

─────────────────────────
<b>PENDAFTARAN & MANAJEMEN TEKNISI PER STO:</b>
• <code>/daftar_teknisi &lt;STO&gt; &lt;Nama_Teknisi&gt; [@Username]</code>
  <i>Daftarkan teknisi ke STO.</i>
  <i>Contoh:</i> <code>/daftar_teknisi JTN Nama Kalian @Tele123</code>

• <code>/list_teknisi [KODE_STO]</code>
  <i>Lihat daftar teknisi terdaftar. Contoh:</i> <code>/list_teknisi JTN</code>

• <code>/hapus_teknisi &lt;Nama|KODE_STO&gt;</code>
  <i>Hapus teknisi. Contoh:</i> <code>/hapus_teknisi JTN</code>

─────────────────────────
<b>LAINNYA:</b>
• <code>/start</code> : <i>Tampilkan menu navigasi utama.</i>
• <code>/help</code> : <i>Tampilkan daftar lengkap perintah ini.</i>`;
}

function getTemplateGuideText() {
  return `<b>TEMPLATE UPDATE WORK ORDER TEKNISI</b>
─────────────────────────
💡 <i>Tip: Sentuh (tap) kotak di bawah ini untuk otomatis menyalin format, lalu paste saat update:</i>

<pre>ORDER: 1001524450
WO ID: WO123456
NIK: 12345678
STATUS: On Progress
TEKNISI: Ahmad Fauzi
CATATAN: Penarikan kabel OK, proses terminasi</pre>

─────────────────────────
<b>Perintah Cepat Update:</b>
1. Pakai <code>:me</code> (Nama Telegram Sendiri):
<code>/update 1002476754 Pending :me Pending jadwal</code>

2. Pakai Nama Lengkap (Tanda Kutip):
<code>/update 1002476754 Pending "Nama Kalian" Pending jadwal</code>

3. Cek List Order per STO & Status:
<code>/cek JTN</code>
<code>/cek JTN completed</code>
<code>/cek JTN on</code>

<i>Gunakan <code>/help</code> untuk melihat seluruh daftar perintah lengkap.</i>`;
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
      } else if (key === 'WO' || key === 'WO ID' || key === 'WOID' || key === 'NO WO') {
        data.woId = val;
      } else if (key === 'NIK' || key === 'NIK TEKNISI' || key === 'NIK TEK') {
        data.nik = val;
      } else if (key === 'STATUS' || key === 'STATUS TRACKER' || key === 'STATE') {
        data.status = val;
      } else if (key === 'TEKNISI' || key === 'NAMA TEKNISI' || key === 'TEK') {
        data.technicianName = val;
      } else if (key === 'CATATAN' || key === 'KETERANGAN' || key === 'NOTE' || key === 'NOTES') {
        data.notes = val;
      }
    }
  });

  return (data.orderId || data.woId || data.nik || data.status || data.technicianName || data.notes) ? data : null;
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
      ? `<b>Belum ada teknisi yang terdaftar untuk STO ${escapeHtml(filterSTO.toUpperCase())}.</b>\n\nDaftarkan dengan: <code>/daftar_teknisi ${escapeHtml(filterSTO.toUpperCase())} NamaTeknisi @Username</code>`
      : `<b>Belum ada teknisi yang terdaftar di sistem.</b>\n\nDaftarkan dengan: <code>/daftar_teknisi &lt;STO&gt; &lt;Nama&gt; [@Username]</code>`;
  }

  let filtered = techs;
  if (filterSTO) {
    filtered = techs.filter(t => t.sto.toUpperCase() === filterSTO.toUpperCase());
    if (filtered.length === 0) {
      return `<b>Belum ada teknisi yang terdaftar untuk STO ${escapeHtml(filterSTO.toUpperCase())}.</b>\n\nDaftarkan dengan: <code>/daftar_teknisi ${escapeHtml(filterSTO.toUpperCase())} NamaTeknisi @Username</code>`;
    }
  }

  const grouped = {};
  filtered.forEach(t => {
    const stoKey = (t.sto || 'UMUM').toUpperCase();
    if (!grouped[stoKey]) grouped[stoKey] = [];
    grouped[stoKey].push(t);
  });

  let text = filterSTO
    ? `<b>DAFTAR TEKNISI TERDAFTAR STO ${escapeHtml(filterSTO.toUpperCase())}</b> (${filtered.length} total):\n─────────────────────────\n\n`
    : `<b>DAFTAR TEKNISI TERDAFTAR PER STO</b> (${filtered.length} total):\n─────────────────────────\n\n`;

  for (const sto in grouped) {
    text += `<b>STO ${escapeHtml(sto)}:</b>\n`;
    grouped[sto].forEach((t, i) => {
      const uName = t.username ? `(<code>${escapeHtml(t.username)}</code>)` : `(ID <code>${escapeHtml(t.chatId)}</code>)`;
      text += `  ${i + 1}. <b>${escapeHtml(t.name)}</b> ${uName}\n`;
    });
    text += `\n`;
  }

  text += `─────────────────────────\n` +
    `<i>Petunjuk:</i>\n` +
    `• Ketik <code>/list_teknisi &lt;STO&gt;</code> untuk filter STO.\n` +
    `• Ketik <code>/daftar_teknisi &lt;STO&gt; &lt;Nama&gt; [@Username]</code> untuk mendaftarkan teknisi baru.`;
  return text;
}

// Paginated List Sender Helper (5 items per page with inline edit navigation)
async function sendPaginatedTaskList(bot, chatId, title, tasks, page = 1, filterType = '', filterQuery = '', messageId = null) {
  if (!tasks || tasks.length === 0) {
    const emptyMsg = `<b>Tidak ada data work order.</b>`;
    if (messageId) {
      return bot.editMessageText(emptyMsg, { chat_id: chatId, message_id: messageId, parse_mode: 'HTML' }).catch(() => bot.sendMessage(chatId, emptyMsg, { parse_mode: 'HTML' }));
    }
    return bot.sendMessage(chatId, emptyMsg, { parse_mode: 'HTML' });
  }

  const PAGE_SIZE = 5;
  const totalCount = tasks.length;
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  let currentPage = Math.max(1, Math.min(page, totalPages));
  const startIdx = (currentPage - 1) * PAGE_SIZE;
  const endIdx = startIdx + PAGE_SIZE;
  const pageTasks = tasks.slice(startIdx, endIdx);

  let msgText = `<b>${escapeHtml(title)}</b>\n` +
    `<i>Hal ${currentPage}/${totalPages} • Total ${totalCount} Order (5 order/hal)</i>\n` +
    `─────────────────────────\n\n`;

  const inline_keyboard = [];
  let detailRow = [];

  pageTasks.forEach((t, idx) => {
    const orderNum = startIdx + idx + 1;
    const orderId = escapeHtml(t.order || t.id);
    const woId = escapeHtml(t.woId || '-');
    const nik = escapeHtml(t.nik || '-');
    const cust = escapeHtml(t.customerName || '-');
    const sto = escapeHtml(t.sto || '-');
    const badge = getStatusBadge(t.trackerStatus);
    const tech = escapeHtml(t.technicianName || '-');
    const resume = escapeHtml(t.statusResume || '-');
    const statusMsg = escapeHtml(t.statusMessage || '-');
    const lastUpd = escapeHtml(t.orderDate || t.updatedAt || '-');
    const upBy = escapeHtml(t.updatedBy || '-');

    msgText += `<b>${orderNum}.</b> Order: <code>${orderId}</code>\n` +
      `   Pelanggan: <b>${cust}</b>\n` +
      `   WO ID: <code>${woId}</code> | NIK: <code>${nik}</code>\n` +
      `   Status: ${badge} | STO: <code>${sto}</code>\n` +
      `   Teknisi: <code>${tech}</code>\n` +
      `   Status Resume: ${resume}\n` +
      `   Status Message: ${statusMsg}\n` +
      `   Last Update Status: <i>${lastUpd}</i>\n` +
      `   Di Update Oleh: ${upBy}\n\n`;

    detailRow.push({ text: `Detail ${orderId}`, callback_data: `view:${t.id}` });
    if (detailRow.length === 2) {
      inline_keyboard.push(detailRow);
      detailRow = [];
    }
  });

  if (detailRow.length > 0) {
    inline_keyboard.push(detailRow);
  }

  // Navigation Row: [ < Prev ] [ 1/24 ] [ Next > ]
  if (totalPages > 1 && filterType && filterQuery) {
    const safeQuery = String(filterQuery).substring(0, 35);
    const navRow = [];

    if (currentPage > 1) {
      navRow.push({ text: '< Prev', callback_data: `pg:${filterType}:${safeQuery}:${currentPage - 1}` });
    } else {
      navRow.push({ text: 'Prev', callback_data: 'noop' });
    }

    navRow.push({ text: `${currentPage}/${totalPages}`, callback_data: 'noop' });

    if (currentPage < totalPages) {
      navRow.push({ text: 'Next >', callback_data: `pg:${filterType}:${safeQuery}:${currentPage + 1}` });
    } else {
      navRow.push({ text: 'Next', callback_data: 'noop' });
    }

    inline_keyboard.push(navRow);
  }

  const options = { parse_mode: 'HTML', reply_markup: { inline_keyboard } };

  if (messageId) {
    try {
      return await bot.editMessageText(msgText, { chat_id: chatId, message_id: messageId, ...options });
    } catch (err) {
      if (err.message && err.message.includes('message is not modified')) return;
      return await bot.sendMessage(chatId, msgText, options);
    }
  } else {
    return await bot.sendMessage(chatId, msgText, options);
  }
}

async function checkUserSTOAccess(from, chatId, taskSTO) {
  if (!taskSTO || taskSTO.trim() === '' || taskSTO.trim() === '-') return { allowed: true, mySTO: 'ALL ACCESS' };

  const admins = await getAllAdminUsers();
  if (from && from.username) {
    const username = from.username.toLowerCase();
    if (username === 'rei219' || admins.some(a => a.username.toLowerCase() === username)) {
      return { allowed: true, mySTO: 'ALL ACCESS' }; 
    }
  }

  const techs = await getAllTechnicians();
  const cleanUser = from && from.username ? from.username.toLowerCase() : '';
  const myTech = techs.find(t => {
    const tUser = t.username ? String(t.username).replace(/^@/, '').trim().toLowerCase() : '';
    const tChatId = t.chatId ? String(t.chatId).trim() : '';
    return (cleanUser && tUser === cleanUser) || (tChatId === String(chatId));
  });

  if (!myTech) return { allowed: false, mySTO: 'TIDAK TERDAFTAR' };
  
  const mySTO = (myTech.sto || '').toUpperCase().trim();
  const tSTO = (taskSTO || '').toUpperCase().trim();

  if (!mySTO || mySTO === '-') return { allowed: false, mySTO: 'TIDAK ADA STO' };

  if (mySTO === tSTO) return { allowed: true, mySTO };
  return { allowed: false, mySTO };
}

function setupBotListeners(bot) {
  const originalOnText = bot.onText.bind(bot);
  bot.onText = function (regexp, callback) {
    originalOnText(regexp, async (msg, match) => {
      const allowedCommands = ['/start', '/help', '/daftar_teknisi', '/myid', '/regis', '/unregis', '/listadmin', '/listdev'];
      const isAllowed = allowedCommands.some(cmd => regexp.source.includes(cmd.replace('/', '\\/')));
      
      if (isAllowed) return callback(msg, match);

      const chatIdStr = String(msg.chat.id);
      let isAuthorized = false;

      const admins = await getAllAdminUsers();
      if (msg.from && msg.from.username) {
        const username = msg.from.username.toLowerCase();
        if (username === 'rei219' || admins.some(a => a.username.toLowerCase() === username)) {
          isAuthorized = true;
        }
      }

      if (!isAuthorized) {
        const techs = await getAllTechnicians();
        const cleanUser = msg.from && msg.from.username ? msg.from.username.toLowerCase() : '';
        isAuthorized = techs.some(t => {
          const tUser = t.username ? String(t.username).replace(/^@/, '').trim().toLowerCase() : '';
          const tChatId = t.chatId ? String(t.chatId).trim() : '';
          return (cleanUser && tUser === cleanUser) || (tChatId === chatIdStr);
        });
      }

      if (!isAuthorized) {
        return bot.sendMessage(msg.chat.id, `Anda harus terdaftar dahuli untuk dapat mengakses bot ini\nsilahkan lakukan /daftar_teknisi STO "Nama Anda"\nUntuk nama silahkan Gunakan " "`);
      }

      return callback(msg, match);
    });
  };

  const originalOn = bot.on.bind(bot);
  bot.on = function (eventName, callback) {
    if (eventName === 'callback_query' || eventName === 'message') {
      originalOn(eventName, async (eventObj) => {
        const isMessage = eventName === 'message';
        if (isMessage && eventObj.text && eventObj.text.startsWith('/')) {
          return callback(eventObj);
        }

        const msgOrQuery = eventObj;
        const from = msgOrQuery.from;
        const chat = isMessage ? msgOrQuery.chat : msgOrQuery.message.chat;
        const chatIdStr = String(chat.id);
        
        let isAuthorized = false;

        const admins = await getAllAdminUsers();
        if (from && from.username) {
          const username = from.username.toLowerCase();
          if (username === 'rei219' || admins.some(a => a.username.toLowerCase() === username)) {
            isAuthorized = true;
          }
        }

        if (!isAuthorized) {
          const techs = await getAllTechnicians();
          const cleanUser = from && from.username ? from.username.toLowerCase() : '';
          isAuthorized = techs.some(t => {
            const tUser = t.username ? String(t.username).replace(/^@/, '').trim().toLowerCase() : '';
            const tChatId = t.chatId ? String(t.chatId).trim() : '';
            return (cleanUser && tUser === cleanUser) || (tChatId === chatIdStr);
          });
        }

        if (!isAuthorized) {
          if (eventName === 'callback_query') {
            await bot.answerCallbackQuery(msgOrQuery.id, { text: 'Akses ditolak. Anda belum terdaftar.', show_alert: true });
          }
          return bot.sendMessage(chatIdStr, `Anda harus terdaftar dahuli untuk dapat mengakses bot ini\nsilahkan lakukan /daftar_teknisi STO "Nama Anda"\nUntuk nama silahkan Gunakan " "`);
        }

        return callback(eventObj);
      });
    } else {
      originalOn(eventName, callback);
    }
  };

  // Command /start & /help
  bot.onText(/\/start(?:@\w+)?/, async (msg) => {
    const chatId = msg.chat.id;
    saveChatUser(chatId, msg.from);
    delete userStates[chatId];
    await bot.sendMessage(chatId, getFullHelpText(), { parse_mode: 'HTML', ...getMainMenuKeyboard() });
  });

  bot.onText(/\/start(?:@\w+)?/, async (msg) => {
    const chatId = msg.chat.id;
    delete userStates[chatId];
    return bot.sendMessage(chatId, getMenuText(), { parse_mode: 'HTML' });
  });

  bot.onText(/\/myid/, (msg) => {
    bot.sendMessage(msg.chat.id, `ID Chat ini: ${msg.chat.id}\nID Pengirim: ${msg.from.id}\nUsername: ${msg.from.username}`);
  });

  bot.onText(/\/help(?:@\w+)?/, async (msg) => {
    const chatId = msg.chat.id;
    delete userStates[chatId];
    await bot.sendMessage(chatId, getFullHelpText(), { parse_mode: 'HTML' });
  });

  // Command /daftar_teknisi <sto> <nama> [@username]
  bot.onText(/\/daftar_teknisi(?:@\w+)?(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    delete userStates[chatId];
    const rawArgs = match[1];
    if (!rawArgs) {
      return bot.sendMessage(chatId, `<b>Format Pendaftaran Teknisi ke STO:</b>\n\n` +
        `1. <b>Daftarkan diri sendiri:</b>\n` +
        `<code>/daftar_teknisi &lt;STO&gt; &lt;Nama_Teknisi&gt;</code>\n` +
        `<i>Contoh:</i> <code>/daftar_teknisi JTN Nama Kalian</code>\n\n` +
        `2. <b>Daftarkan akun Telegram orang lain:</b>\n` +
        `<code>/daftar_teknisi &lt;STO&gt; &lt;Nama_Teknisi&gt; &lt;@Username_Telegram&gt;</code>\n` +
        `<i>Contoh:</i> <code>/daftar_teknisi JTN Nama Kalian @Tele123</code>`, { parse_mode: 'HTML' });
    }

    const tokens = rawArgs.trim().split(/\s+/);
    const sto = tokens[0];

    if (tokens.length < 2) {
      return bot.sendMessage(chatId, `Silakan masukkan nama teknisi setelah STO.`, { parse_mode: 'HTML' });
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
      return bot.sendMessage(chatId, `Silakan masukkan nama teknisi dengan benar.`, { parse_mode: 'HTML' });
    }

    await registerTechnician(targetChatId, targetUsername, techName, sto);

    return bot.sendMessage(chatId, `<b>Berhasil Terdaftar!</b>\n\n` +
      `<b>Nama:</b> <code>${escapeHtml(techName)}</code>\n` +
      `<b>STO:</b> <code>${escapeHtml(sto.toUpperCase())}</code>\n` +
      `<b>Telegram:</b> <code>${escapeHtml(targetUsername || 'ID ' + targetChatId)}</code>\n\n` +
      `<i>Setiap ada order baru di STO ${escapeHtml(sto.toUpperCase())}, bot akan memberikan notifikasi otomatis.</i>`, { parse_mode: 'HTML' });
  });

  // Command /list_teknisi [sto] and /list_teknisi_sto [sto]
  bot.onText(/\/list_teknisi(?:_sto)?(?:@\w+)?(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    delete userStates[chatId];
    const filterSTO = match[1] ? match[1].trim() : null;

    try {
      const techs = await getAllTechnicians();
      const text = formatTechniciansBySTOList(techs, filterSTO);
      return bot.sendMessage(chatId, text, { parse_mode: 'HTML' });
    } catch (err) {
      return bot.sendMessage(chatId, `Gagal mengambil daftar teknisi: ${escapeHtml(err.message)}`, { parse_mode: 'HTML' });
    }
  });

  // Command /hapus_teknisi <query>
  bot.onText(/\/hapus_teknisi(?:@\w+)?(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    delete userStates[chatId];
    const queryStr = match[1];
    if (!queryStr) {
      return bot.sendMessage(chatId, `<b>Format Hapus Pendaftaran Teknisi:</b>\n` +
        `<code>/hapus_teknisi &lt;Nama_Teknisi_atau_KODE_STO&gt;</code>\n\n` +
        `<i>Contoh:</i>\n` +
        `<code>/hapus_teknisi Nama Kalian</code>\n` +
        `<code>/hapus_teknisi JTN</code>`, { parse_mode: 'HTML' });
    }

    try {
      const { deletedCount, matched } = await deleteTechnician(queryStr.trim());
      if (deletedCount === 0) {
        return bot.sendMessage(chatId, `Tidak ditemukan pendaftaran teknisi dengan kata kunci "<b>${escapeHtml(queryStr)}</b>".`, { parse_mode: 'HTML' });
      }

      const names = matched.map(m => `<b>${escapeHtml(m.name)}</b> (STO ${escapeHtml(m.sto)})`).join(', ');
      return bot.sendMessage(chatId, `<b>BERHASIL MENGHAPUS TEKNISI!</b>\n\nTeknisi dihapus (${deletedCount}):\n${names}`, { parse_mode: 'HTML' });
    } catch (err) {
      return bot.sendMessage(chatId, `Gagal menghapus teknisi: ${escapeHtml(err.message)}`, { parse_mode: 'HTML' });
    }
  });

  // Command /template
  bot.onText(/\/template(?:@\w+)?/, async (msg) => {
    delete userStates[msg.chat.id];
    return bot.sendMessage(msg.chat.id, getTemplateGuideText(), { parse_mode: 'HTML' });
  });

  // Command /updateteknisi <order_id> <nama_teknisi>
  bot.onText(/\/updateteknisi(?:@\w+)?(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    delete userStates[chatId];
    const rawArgs = match[1];
    if (!rawArgs) {
      return bot.sendMessage(chatId, `<b>Format Update Teknisi:</b>\n` +
        `<code>/updateteknisi &lt;order_id&gt; &lt;nama_teknisi&gt;</code>\n\n` +
        `• Gunakan <code>:me</code> untuk nama Telegram sendiri.\n` +
        `• Gunakan <code>-</code> (strip) untuk mengosongkan.\n\n` +
        `<i>Contoh:</i>\n` +
        `<code>/updateteknisi 1001524450 :me</code>\n` +
        `<code>/updateteknisi 1001524450 Nama Kalian</code>`, { parse_mode: 'HTML' });
    }

    const parts = rawArgs.split(' ');
    const orderId = parts[0];
    let techName = parts.slice(1).join(' ');

    if (!techName) {
      return bot.sendMessage(chatId, `Silakan masukkan nama teknisi setelah nomor order.`, { parse_mode: 'HTML' });
    }

    if (techName.toLowerCase() === ':me') {
      techName = [msg.from.first_name, msg.from.last_name].filter(Boolean).join(' ') || (msg.from.username ? `@${msg.from.username}` : 'Teknisi');
    } else if (techName === '-') {
      techName = '';
    }

    const task = await getTaskById(orderId);
    if (task) {
      const access = await checkUserSTOAccess(msg.from, chatId, task.sto);
      if (!access.allowed) {
        return bot.sendMessage(chatId, `⛔ <b>Akses ditolak!</b> Anda adalah teknisi STO <b>${escapeHtml(access.mySTO)}</b>, sedangkan task ini milik STO <b>${escapeHtml(task.sto)}</b>.`, { parse_mode: 'HTML' });
      }
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
      return bot.sendMessage(chatId, `<b>Format Perintah Update:</b>\n` +
        `<code>/update &lt;order_id&gt; &lt;status&gt; &lt;teknisi|:me&gt; &lt;catatan&gt;</code>\n\n` +
        `<i>Contoh Pakai :me:</i>\n` +
        `<code>/update 1002476754 Pending :me Pending jadwal</code>\n\n` +
        `<i>Contoh Pakai Nama Lengkap (Tanda Kutip):</i>\n` +
        `<code>/update 1002476754 Pending "Nama Kalian" Pending jadwal</code>`, { parse_mode: 'HTML' });
    }

    const parsed = parseUpdateCommandArgs(rawArgs, msg.from);
    if (!parsed) {
      return bot.sendMessage(chatId, `Format tidak sesuai. Contoh: <code>/update 1002476754 Pending :me Pending jadwal</code>`, { parse_mode: 'HTML' });
    }

    const { orderId, status, techName, notes } = parsed;
    const validStatuses = ['Pending', 'On Progress', 'Completed', 'Kendala', 'Cancel'];
    const matchedStatus = validStatuses.find(s => s.toLowerCase() === status?.toLowerCase());

    if (!matchedStatus) {
      return bot.sendMessage(chatId, `Status <b>${escapeHtml(status)}</b> tidak valid! Pilihan: Pending, On Progress, Completed, Kendala, Cancel`, { parse_mode: 'HTML' });
    }

    try {
      const task = await getTaskById(orderId);
      if (!task) {
        return bot.sendMessage(chatId, `Work order <code>${escapeHtml(orderId)}</code> tidak ditemukan.`, { parse_mode: 'HTML' });
      }

      const access = await checkUserSTOAccess(msg.from, chatId, task.sto);
      if (!access.allowed) {
        return bot.sendMessage(chatId, `⛔ <b>Akses ditolak!</b> Anda adalah teknisi STO <b>${escapeHtml(access.mySTO)}</b>, sedangkan task ini milik STO <b>${escapeHtml(task.sto)}</b>.`, { parse_mode: 'HTML' });
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
      return bot.sendMessage(chatId, `<b>BERHASIL MEMPERBARUI ORDER!</b>\n\n${formatTaskMessage(updatedTask)}`, { parse_mode: 'HTML', ...getTaskActionButtons(updatedTask.id) });
    } catch (err) {
      console.error(err);
      return bot.sendMessage(chatId, `Terjadi kesalahan saat update order: ${escapeHtml(err.message)}`, { parse_mode: 'HTML' });
    }
  });

  // Handle Text Messages & Menu Buttons
  bot.on('message', async (msg) => {
    if (!msg.text) return;
    const chatId = msg.chat.id;
    const userKey = msg.from ? msg.from.id : chatId;
    const updatedBy = getSenderTag(msg.from);
    saveChatUser(chatId, msg.from);
    if (msg.text.startsWith('/')) return;
    const text = msg.text.trim();

    if (isMenuButton(text)) {
      delete userStates[chatId];

      if (text === 'Template Update') {
        return bot.sendMessage(chatId, getTemplateGuideText(), { parse_mode: 'HTML' });
      }

      if (text === 'Daftar Teknisi STO') {
        const techs = await getAllTechnicians();
        const tText = formatTechniciansBySTOList(techs);
        return bot.sendMessage(chatId, tText, { parse_mode: 'HTML' });
      }

      if (text === 'Cek Work Order') {
        userStates[chatId] = { action: 'awaiting_search' };
        return bot.sendMessage(chatId, '<b>Silakan kirimkan Nomor Order, No Internet, Nama Pelanggan, atau Kode STO + Status (misal: <code>JTN completed</code>, <code>JTN on</code>, <code>JTN pending</code>, <code>JTN kendala</code>, <code>JTN cancel</code>):</b>', { parse_mode: 'HTML', reply_markup: { force_reply: true, selective: true } });
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
        return bot.sendMessage(chatId, '<b>Masukkan nama teknisi yang ingin dicari:</b>', { parse_mode: 'HTML', reply_markup: { force_reply: true, selective: true } });
      }

      if (text === 'Bantuan') {
        return bot.sendMessage(chatId, getFullHelpText(), { parse_mode: 'HTML' });
      }
    }

    // Template Auto-Parse Check
    if (text.toUpperCase().includes('ORDER:') || text.toUpperCase().includes('WO ID:') || text.toUpperCase().includes('WO:') || text.toUpperCase().includes('NIK:')) {
      delete userStates[userKey];
      delete userStates[chatId];
      const parsed = parseTemplateMessage(text);
      let targetId = parsed ? (parsed.orderId || extractOrderIdFromText(text)) : null;

      if (msg.reply_to_message && !targetId) {
        targetId = extractOrderIdFromText(msg.reply_to_message.text);
      }

      if (parsed && targetId) {
        try {
          await bot.sendMessage(chatId, `Memproses update untuk order <code>${escapeHtml(targetId)}</code>...`, { parse_mode: 'HTML' });
          const task = await getTaskById(targetId);
          if (!task) {
            return bot.sendMessage(chatId, `Order ID <code>${escapeHtml(targetId)}</code> tidak ditemukan di database.`, { parse_mode: 'HTML' });
          }

          const updates = { updatedBy };

          if (parsed.woId) updates.woId = parsed.woId;
          if (parsed.nik) updates.nik = parsed.nik;

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
          return bot.sendMessage(chatId, `<b>ORDER BERHASIL DIPERBARUI!</b>\n\n${formatTaskMessage(updatedTask)}`, { parse_mode: 'HTML', ...getTaskActionButtons(updatedTask.id) });
        } catch (err) {
          return bot.sendMessage(chatId, `Terjadi kesalahan saat memproses template: ${escapeHtml(err.message)}`, { parse_mode: 'HTML' });
        }
      }
    }

    // 1. Check if user is replying to a bot prompt message (Stateless & Vercel Serverless Safe!)
    if (msg.reply_to_message && msg.reply_to_message.text) {
      const replyText = msg.reply_to_message.text.toLowerCase();
      const targetOrderId = extractOrderIdFromText(msg.reply_to_message.text);

      if (targetOrderId) {
        if (replyText.includes('catatan') || replyText.includes('kendala') || replyText.includes('alasan')) {
          delete userStates[userKey];
          delete userStates[chatId];
          return handleUpdateNote(bot, chatId, targetOrderId, text, updatedBy);
        }

        if (replyText.includes('teknisi') || replyText.includes('assign')) {
          delete userStates[userKey];
          delete userStates[chatId];
          let tName = text;
          if (text.toLowerCase() === ':me') {
            tName = [msg.from.first_name, msg.from.last_name].filter(Boolean).join(' ') || (msg.from.username ? `@${msg.from.username}` : 'Teknisi');
          } else if (text === '-') {
            tName = '';
          }
          return handleAssignTechnician(bot, chatId, targetOrderId, tName, updatedBy);
        }
      }

      if (replyText.includes('pencari') || replyText.includes('nomor order') || replyText.includes('kode sto')) {
        delete userStates[userKey];
        delete userStates[chatId];
        return handleSearch(bot, chatId, text);
      }

      if (replyText.includes('nama teknisi')) {
        delete userStates[userKey];
        delete userStates[chatId];
        return handleSearchTeknisi(bot, chatId, text);
      }
    }

    if (userStates[userKey] || userStates[chatId]) {
      const state = userStates[userKey] || userStates[chatId];
      delete userStates[userKey];
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
        return handleAssignTechnician(bot, chatId, state.orderId, tName, updatedBy);
      } else if (state.action === 'awaiting_note') {
        return handleUpdateNote(bot, chatId, state.orderId, text, updatedBy);
      } else if (state.action === 'awaiting_teknisi') {
        return handleSearchTeknisi(bot, chatId, text);
      }
    }

    if (text.length >= 2) {
      return handleSearch(bot, chatId, text);
    }
  });

  bot.onText(/\/alih(?:@\w+)?(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    delete userStates[chatId];
    const orderId = match[1] ? match[1].trim() : null;
    
    if (!orderId) {
      return bot.sendMessage(chatId, `<b>Format Perintah Alih:</b>\n<code>/alih &lt;order_id&gt;</code>\n\nContoh: <code>/alih 1002119373</code>`, { parse_mode: 'HTML' });
    }

    try {
      const task = await getTaskById(orderId);
      if (!task) {
        return bot.sendMessage(chatId, `Order <code>${escapeHtml(orderId)}</code> tidak ditemukan.`, { parse_mode: 'HTML' });
      }

      const access = await checkUserSTOAccess(msg.from, chatId, task.sto);
      if (!access.allowed) {
        return bot.sendMessage(chatId, `⛔ <b>Akses ditolak!</b> Anda adalah teknisi STO <b>${escapeHtml(access.mySTO)}</b>, sedangkan task ini milik STO <b>${escapeHtml(task.sto)}</b>.`, { parse_mode: 'HTML' });
      }

      const taskSTO = task.sto || '';
      if (!taskSTO) {
        return bot.sendMessage(chatId, `Order <code>${escapeHtml(orderId)}</code> tidak memiliki data STO.`, { parse_mode: 'HTML' });
      }

      const matchedTechs = await getTechniciansBySTO(taskSTO);
      if (matchedTechs.length === 0) {
        return bot.sendMessage(chatId, `Belum ada teknisi yang terdaftar untuk STO <b>${escapeHtml(taskSTO)}</b>.`, { parse_mode: 'HTML' });
      }

      const inline_keyboard = [];
      let row = [];
      matchedTechs.forEach(tech => {
        row.push({ text: tech.name, callback_data: `alih_to:${task.id}:${tech.chatId}` });
        if (row.length === 2) {
          inline_keyboard.push(row);
          row = [];
        }
      });
      if (row.length > 0) inline_keyboard.push(row);

      return bot.sendMessage(chatId, `<b>PILIH TEKNISI PENGGANTI</b>\nSilakan pilih teknisi di STO <b>${escapeHtml(taskSTO)}</b> untuk mengalihkan order <code>${escapeHtml(task.id)}</code>:`, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard }
      });
    } catch (err) {
      return bot.sendMessage(chatId, `Terjadi kesalahan: ${escapeHtml(err.message)}`, { parse_mode: 'HTML' });
    }
  });

  bot.onText(/\/cek(?:@\w+)?(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    delete userStates[chatId];
    const queryStr = match[1];
    if (!queryStr) {
      userStates[chatId] = { action: 'awaiting_search' };
      return bot.sendMessage(chatId, '<b>Silakan masukkan Nomor Order, Nama Pelanggan, atau Kode STO + Status (misal: <code>JTN completed</code>, <code>JTN on</code>, <code>JTN pending</code>, <code>JTN kendala</code>, <code>JTN cancel</code>):</b>', { parse_mode: 'HTML' });
    }
    return handleSearch(bot, chatId, queryStr.trim());
  });

  bot.onText(/\/syncsheets(?:@\w+)?|\/sync(?:@\w+)?/, async (msg) => {
    const chatId = msg.chat.id;
    delete userStates[chatId];
    try {
      await bot.sendMessage(chatId, '⏳ <b>Memproses sinkronisasi seluruh data ke Google Spreadsheet...</b>', { parse_mode: 'HTML' });
      const tasks = await getAllTasks();
      if (!tasks || tasks.length === 0) {
        return bot.sendMessage(chatId, '⚠️ Tidak ada data order untuk disinkronkan.', { parse_mode: 'HTML' });
      }

      const GOOGLE_SHEET_WEBHOOK_URL = process.env.GOOGLE_SHEET_WEBHOOK_URL || 'https://script.google.com/macros/s/AKfycby0jct0vhgp_Z31Zol3LtL-QU63jG8ZkgBRJk2TdSz0cEmyeOmwBxL1jqwcDAc6AecRkA/exec';
      const payload = tasks.map(task => ({
        orderId: task.order || task.id || '',
        order: task.order || task.id || '',
        id: task.id || task.order || '',
        woId: task.woId || '-',
        nik: task.nik || '-',
        customerName: task.customerName || '-',
        sto: task.sto || '-',
        witel: task.witel || '-',
        trackerStatus: task.trackerStatus || 'Pending',
        technicianName: task.technicianName || '-',
        notes: task.notes || '-',
        statusResume: task.statusResume || '-',
        statusMessage: task.statusMessage || '-',
        updatedAt: task.updatedAt || new Date().toISOString(),
        updatedBy: task.updatedBy || '-'
      }));

      await fetch(GOOGLE_SHEET_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bulkTasks: payload })
      });

      return bot.sendMessage(chatId, `✅ <b>BERHASIL SINKRONISASI!</b>\n\nSebanyak <b>${tasks.length} order</b> telah di-export & dipisahkan ke masing-masing tab STO di Google Spreadsheet!`, { parse_mode: 'HTML' });
    } catch (err) {
      return bot.sendMessage(chatId, `Gagal sync ke Google Sheets: ${escapeHtml(err.message)}`, { parse_mode: 'HTML' });
    }
  });

  bot.onText(/\/reminder(?:@\w+)?|\/remind(?:@\w+)?/, async (msg) => {
    const chatId = msg.chat.id;
    delete userStates[chatId];
    saveChatUser(chatId, msg.from);

    try {
      const tasks = await getAllTasks();
      const text = formatDailyReminderText(tasks);
      return bot.sendMessage(chatId, text, {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🚀 Kirim Broadcast ke Semua User', callback_data: 'broadcast_reminder' }]
          ]
        }
      });
    } catch (err) {
      return bot.sendMessage(chatId, `Gagal memuat reminder: ${escapeHtml(err.message)}`, { parse_mode: 'HTML' });
    }
  });

  // Hidden Dev Command /regis (Register chat ID for dev testing reminder without adding as STO technician)
  bot.onText(/\/regis(?:@\w+)?(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    delete userStates[chatId];

    const allowedDevs = ['rei219', 'dheodermawan'];
    const senderUsername = msg.from && msg.from.username ? msg.from.username.toLowerCase() : '';
    
    if (!allowedDevs.includes(senderUsername)) {
      return bot.sendMessage(chatId, `⛔ <b>Akses ditolak!</b> Hanya @Rei219 dan @dheodermawan yang dapat mendaftarkan akun Dev.`, { parse_mode: 'HTML' });
    }

    const inputData = match[1];
    if (!inputData) {
      return bot.sendMessage(chatId, `<b>Format Registrasi Dev salah!</b>\n\nGunakan format:\n<code>/regis Nama @Username</code>\n\nContoh: <code>/regis Reyhan @Rei219</code>`, { parse_mode: 'HTML' });
    }

    const usernameMatch = inputData.match(/@([a-zA-Z0-9_]+)/);
    if (!usernameMatch) {
       return bot.sendMessage(chatId, `Harap cantumkan username Telegram dengan awalan '@'.\nContoh: <code>/regis Reyhan @Rei219</code>`, { parse_mode: 'HTML' });
    }

    const targetUsernameStr = usernameMatch[0];
    const targetUsername = usernameMatch[1].toLowerCase();
    const targetName = inputData.replace(targetUsernameStr, '').trim() || 'Dev';

    try {
      // Tambahkan target username sebagai Admin
      await addOrUpdateAdminUser(targetUsername, 'dev_bypass', `@${senderUsername}`);

      return bot.sendMessage(chatId, `<b>🛠️ REGISTRASI AKUN DEV BERHASIL!</b>\n\n` +
        `<b>Nama:</b> <code>${escapeHtml(targetName)}</code>\n` +
        `<b>Username:</b> <code>${escapeHtml(targetUsernameStr)}</code>\n` +
        `<b>Didaftarkan Oleh:</b> @${escapeHtml(senderUsername)}\n\n` +
        `<i>Akun ${escapeHtml(targetUsernameStr)} telah diatur sebagai <b>DEV / ADMINISTRATOR</b> dan memiliki ALL AKSES ke seluruh perintah bot.</i>`, { parse_mode: 'HTML' });
    } catch (err) {
      return bot.sendMessage(chatId, `Terjadi kesalahan: ${escapeHtml(err.message)}`, { parse_mode: 'HTML' });
    }
  });

  // Hidden Dev Command /unregis
  bot.onText(/\/unregis(?:@\w+)?/, async (msg) => {
    const chatId = msg.chat.id;
    delete userStates[chatId];
    await unregisterChatUser(chatId);
    return bot.sendMessage(chatId, `<b>Unregistrasi berhasil! Chat ID <code>${chatId}</code> telah dihapus dari daftar broadcast reminder testing.</b>`, { parse_mode: 'HTML' });
  });

  // Command /setwitel <witel>
  bot.onText(/\/setwitel(?:@\w+)?(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    delete userStates[chatId];
    saveChatUser(chatId, msg.from);
    const witelInput = match[1] ? match[1].trim().toUpperCase() : '';

    if (!witelInput) {
      return bot.sendMessage(chatId, `<b>Format Pengaturan Witel Reminder:</b>\n\n` +
        `<code>/setwitel &lt;KODE_WITEL|ALL&gt;</code>\n\n` +
        `<i>Contoh:</i>\n` +
        `• <code>/setwitel JAKTIM</code>\n` +
        `• <code>/setwitel JAKSEL</code>\n` +
        `• <code>/setwitel ALL</code> (tampilkan semua witel)`, { parse_mode: 'HTML' });
    }

    await setUserWitel(chatId, witelInput);
    return bot.sendMessage(chatId, `✅ <b>Filter Witel reminder Anda berhasil diubah menjadi: <code>${escapeHtml(witelInput)}</code></b>\n\n` +
      `<i>Pesan reminder harian & broadcast akan otomatis difilter khusus Witel ini.</i>`, { parse_mode: 'HTML' });
  });

  // Command /listdev
  bot.onText(/\/listdev(?:@\w+)?/, async (msg) => {
    const chatId = msg.chat.id;
    saveChatUser(chatId, msg.from);

    const allowedDevs = ['rei219', 'dheodermawan'];
    const senderUsername = msg.from && msg.from.username ? msg.from.username.toLowerCase() : '';
    
    if (!allowedDevs.includes(senderUsername)) {
      return bot.sendMessage(chatId, `⛔ <b>Akses ditolak!</b> Perintah ini khusus untuk Dev.`, { parse_mode: 'HTML' });
    }

    try {
      const admins = await getAllAdminUsers();
      const devs = admins.filter(a => a.password === 'dev_bypass');
      
      if (devs.length === 0) {
        return bot.sendMessage(chatId, `Belum ada akun Dev yang didaftarkan melalui /regis.`, { parse_mode: 'HTML' });
      }

      let devListText = '';
      devs.forEach((dev, i) => {
        devListText += `${i + 1}. Username: <code>@${escapeHtml(dev.username)}</code>\n    Didaftarkan oleh: ${escapeHtml(dev.createdBy || '-')}\n`;
      });

      const text = `👨‍💻 <b>DAFTAR AKUN DEV (ALL AKSES)</b>\n` +
        `═════════════════════════\n` +
        `${devListText}` +
        `═════════════════════════\n` +
        `<i>*Akun di atas didaftarkan menggunakan perintah /regis</i>`;
        
      return bot.sendMessage(chatId, text, { parse_mode: 'HTML' });
    } catch (err) {
      return bot.sendMessage(chatId, `Gagal memuat list dev: ${escapeHtml(err.message)}`, { parse_mode: 'HTML' });
    }
  });

  // Secret Admin Command /dashboard & /listadmin (Restricted to @Rei219 / ID 902544604)
  bot.onText(/\/dashboard(?:@\w+)?|\/listadmin(?:@\w+)?/, async (msg) => {
    const chatId = msg.chat.id;
    saveChatUser(chatId, msg.from);

    if (!isAuthorizedAdmin(msg.from)) {
      return bot.sendMessage(chatId, `⛔ <b>Akses ditolak!</b> Perintah ini khusus untuk Administrator (<b>@Rei219</b>).`, { parse_mode: 'HTML' });
    }

    try {
      const admins = await getAllAdminUsers();
      let adminListText = '';
      admins.forEach((adm, i) => {
        adminListText += `${i + 1}. Username: <code>${escapeHtml(adm.username)}</code> | Password: <code>${escapeHtml(adm.password)}</code>\n`;
      });

      const text = `🔐 <b>KREDENSIAL AKSES DASHBOARD MANAGER</b>\n` +
        `═════════════════════════\n` +
        `<b>URL Dashboard:</b> https://ebis-telkom.vercel.app/tracker/manager\n\n` +
        `<b>Daftar Akun Admin (${admins.length}):</b>\n` +
        `${adminListText}` +
        `═════════════════════════\n` +
        `<i>Perintah Manajemen Akun Admin (Khusus @Rei219):</i>\n` +
        `• Tambah/Edit Akun: <code>/setadmin &lt;username&gt; &lt;password&gt;</code>\n` +
        `• Hapus Akun: <code>/deladmin &lt;username&gt;</code>`;

      return bot.sendMessage(chatId, text, { parse_mode: 'HTML' });
    } catch (err) {
      return bot.sendMessage(chatId, `Gagal mengambil data admin dari Firebase: ${escapeHtml(err.message)}`, { parse_mode: 'HTML' });
    }
  });

  // Secret Admin Command /setadmin <username> <password>
  bot.onText(/\/setadmin(?:_user)?(?:@\w+)?(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    saveChatUser(chatId, msg.from);

    if (!isAuthorizedAdmin(msg.from)) {
      return bot.sendMessage(chatId, `⛔ <b>Akses ditolak!</b> Perintah ini khusus untuk Administrator (<b>@Rei219</b>).`, { parse_mode: 'HTML' });
    }

    const rawArgs = match[1] ? match[1].trim() : '';
    if (!rawArgs) {
      return bot.sendMessage(chatId, `<b>Format Tambah / Edit Akun Admin Dashboard:</b>\n\n` +
        `<code>/setadmin &lt;username&gt; &lt;password&gt;</code>\n\n` +
        `<i>Contoh:</i>\n` +
        `• <code>/setadmin admin2 pass123</code>\n` +
        `• <code>/setadmin manager ebis2026</code>`, { parse_mode: 'HTML' });
    }

    const tokens = rawArgs.split(/\s+/);
    if (tokens.length < 2) {
      return bot.sendMessage(chatId, `Silakan masukkan password setelah username. Contoh: <code>/setadmin admin2 pass123</code>`, { parse_mode: 'HTML' });
    }

    const uName = tokens[0].trim();
    const uPass = tokens.slice(1).join(' ').trim();

    try {
      await addOrUpdateAdminUser(uName, uPass, getSenderTag(msg.from));
      if (uName.toLowerCase() === 'admin') {
        await updateAdminAuth(uPass, uName);
      }

      return bot.sendMessage(chatId, `✅ <b>BERHASIL MENAMBAH / MEMPERBARUI AKUN ADMIN!</b>\n\n` +
        `<b>Username:</b> <code>${escapeHtml(uName)}</code>\n` +
        `<b>Password:</b> <code>${escapeHtml(uPass)}</code>\n\n` +
        `<i>Akun ini telah tersimpan di Firebase Firestore dan langsung dapat digunakan untuk Login Web Dashboard!</i>`, { parse_mode: 'HTML' });
    } catch (err) {
      return bot.sendMessage(chatId, `Gagal menyimpan akun admin ke Firebase: ${escapeHtml(err.message)}`, { parse_mode: 'HTML' });
    }
  });

  // Secret Admin Command /deladmin <username>
  bot.onText(/\/deladmin(?:@\w+)?(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    saveChatUser(chatId, msg.from);

    if (!isAuthorizedAdmin(msg.from)) {
      return bot.sendMessage(chatId, `⛔ <b>Akses ditolak!</b> Perintah ini khusus untuk Administrator (<b>@Rei219</b>).`, { parse_mode: 'HTML' });
    }

    const targetUser = match[1] ? match[1].trim() : '';
    if (!targetUser) {
      return bot.sendMessage(chatId, `<b>Format Hapus Akun Admin Dashboard:</b>\n\n` +
        `<code>/deladmin &lt;username&gt;</code>\n\n` +
        `<i>Contoh:</i> <code>/deladmin admin2</code>`, { parse_mode: 'HTML' });
    }

    try {
      await deleteAdminUser(targetUser);
      return bot.sendMessage(chatId, `✅ <b>BERHASIL MENGHAPUS AKUN ADMIN!</b>\n\n` +
        `Akun <code>${escapeHtml(targetUser)}</code> telah dihapus dari Firebase Firestore.`, { parse_mode: 'HTML' });
    } catch (err) {
      return bot.sendMessage(chatId, `Gagal menghapus akun admin: ${escapeHtml(err.message)}`, { parse_mode: 'HTML' });
    }
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
      return bot.sendMessage(chatId, '<b>Masukkan nama teknisi yang ingin dicari:</b>', { parse_mode: 'HTML' });
    }
    return handleSearchTeknisi(bot, chatId, techName.trim());
  });

  bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;

    await bot.answerCallbackQuery(query.id);
    const updatedBy = getSenderTag(query.from);

    const isActionCallback = data.startsWith('st:') || data.startsWith('assign:') || data.startsWith('note:') || data.startsWith('alih_to:') || data.startsWith('assign_sto_notif:');
    if (isActionCallback) {
      const orderId = data.split(':')[1];
      const task = await getTaskById(orderId);
      if (task) {
        const access = await checkUserSTOAccess(query.from, chatId, task.sto);
        if (!access.allowed) {
          return bot.sendMessage(chatId, `⛔ <b>Akses ditolak!</b> Anda STO <b>${escapeHtml(access.mySTO)}</b>, task ini STO <b>${escapeHtml(task.sto)}</b>.`, { parse_mode: 'HTML' });
        }
      }
    }

    if (data === 'show_rekap') {
      delete userStates[chatId];
      return handleRekap(bot, chatId);
    }

    if (data === 'broadcast_reminder') {
      delete userStates[chatId];
      await bot.sendMessage(chatId, '⏳ <b>Mengirimkan reminder ke seluruh pengguna Telegram...</b>', { parse_mode: 'HTML' });
      const result = await sendBroadcastReminder(bot);
      if (result.success) {
        return bot.sendMessage(chatId, `✅ <b>REMINDER BERHASIL DIKIRIM!</b>\n\nDikirim ke <b>${result.successCount} dari ${result.total} pengguna</b>.`, { parse_mode: 'HTML' });
      } else {
        return bot.sendMessage(chatId, `❌ Gagal broadcast: ${escapeHtml(result.error)}`, { parse_mode: 'HTML' });
      }
    }

    if (data === 'noop') {
      return;
    }

    if (data.startsWith('pg:')) {
      delete userStates[chatId];
      const lastColon = data.lastIndexOf(':');
      const firstColon = data.indexOf(':');
      const secondColon = data.indexOf(':', firstColon + 1);

      const fType = data.substring(firstColon + 1, secondColon);
      const fQuery = data.substring(secondColon + 1, lastColon);
      const pageNum = parseInt(data.substring(lastColon + 1), 10) || 1;
      const msgId = query.message.message_id;

      if (fType === 'st') {
        return handleTaskListByStatus(bot, chatId, fQuery, pageNum, msgId);
      } else if (fType === 'tek') {
        return handleSearchTeknisi(bot, chatId, fQuery, pageNum, msgId);
      } else if (fType === 'sto' || fType === 'q') {
        return handleSearch(bot, chatId, fQuery, pageNum, msgId);
      }
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
        return bot.sendMessage(chatId, formatTaskMessage(task), { parse_mode: 'HTML', ...getTaskActionButtons(task.id) });
      }
    }

    if (data.startsWith('assign_sto_notif:')) {
      delete userStates[chatId];
      const orderId = data.split(':')[1];
      return handleAssignAndNotifySTO(bot, chatId, orderId, updatedBy);
    }

    if (data.startsWith('alih_to:')) {
      delete userStates[chatId];
      const [, orderId, targetChatId] = data.split(':');
      try {
        const task = await getTaskById(orderId);
        if (!task) {
          return bot.sendMessage(chatId, `Order <code>${escapeHtml(orderId)}</code> tidak ditemukan.`, { parse_mode: 'HTML' });
        }
        
        const taskSTO = task.sto || '';
        const matchedTechs = await getTechniciansBySTO(taskSTO);
        const selectedTech = matchedTechs.find(t => String(t.chatId) === String(targetChatId));
        
        if (!selectedTech) {
          return bot.sendMessage(chatId, `DEBUG: targetChatId="${targetChatId}", available=[${matchedTechs.map(t=>t.chatId).join(',')}] | Teknisi tidak ditemukan atau tidak terdaftar di STO ${taskSTO}.`, { parse_mode: 'HTML' });
        }

        const techName = `${selectedTech.name} ${selectedTech.username || ''}`.trim();
        await updateTask(task.id, { technicianName: techName, updatedBy });
        
        const updatedTask = await getTaskById(task.id);
        
        try {
          const tId = selectedTech.chatId.startsWith('@') ? selectedTech.chatId : selectedTech.chatId;
          const notifyMsg = `<b>🔄 WORK ORDER DIALIHKAN (STO ${escapeHtml(taskSTO)})</b>\n\n` +
            `<b>Order ID:</b> <code>${escapeHtml(updatedTask.id)}</code>\n` +
            `<b>Pelanggan:</b> ${escapeHtml(updatedTask.customerName || '-')}\n` +
            `<b>Alamat:</b> ${escapeHtml(updatedTask.address || '-')}\n` +
            `<b>Layanan:</b> ${escapeHtml(updatedTask.serviceType || '-')}\n` +
            `<b>Di Update Oleh:</b> ${escapeHtml(updatedBy)}\n\n` +
            `<i>Tugas ini dialihkan kepada Anda. Silakan segera ditindaklanjuti!</i>`;
          await bot.sendMessage(tId, notifyMsg, { parse_mode: 'HTML', ...getTaskActionButtons(updatedTask.id) });
        } catch (e) {
          console.error("Gagal mengirim notif alih", e);
        }
        
        return bot.sendMessage(chatId, `✅ <b>Order ${escapeHtml(updatedTask.id)} berhasil dialihkan ke ${escapeHtml(selectedTech.name)}.</b>`, { parse_mode: 'HTML' });
      } catch (err) {
        return bot.sendMessage(chatId, `Gagal mengalihkan order: ${escapeHtml(err.message)}`, { parse_mode: 'HTML' });
      }
    }

    if (data.startsWith('st:')) {
      const [, orderId, newStatus] = data.split(':');
      const userId = query.from ? query.from.id : '';
      const stateKey = `${chatId}_${userId}`;
      delete userStates[chatId];
      delete userStates[stateKey];

      try {
        const task = await getTaskById(orderId);
        if (!task) {
          return bot.sendMessage(chatId, `Order <code>${escapeHtml(orderId)}</code> tidak ditemukan.`, { parse_mode: 'HTML' });
        }

        await updateTask(task.id, { trackerStatus: newStatus, updatedBy });
        const updatedTask = await getTaskById(task.id);
        
        userStates[stateKey] = { action: 'awaiting_note', orderId: task.id };
        userStates[chatId] = { action: 'awaiting_note', orderId: task.id };
        const promptText = buildPromptForMissingFields(updatedTask, newStatus);
        return bot.sendMessage(chatId, promptText, { parse_mode: 'HTML', reply_markup: { force_reply: true, selective: true } });
      } catch (err) {
        bot.sendMessage(chatId, `Gagal update: ${escapeHtml(err.message)}`, { parse_mode: 'HTML' });
      }
    }

    if (data.startsWith('assign:')) {
      const orderId = data.split(':')[1];
      const userId = query.from ? query.from.id : '';
      userStates[`${chatId}_${userId}`] = { action: 'awaiting_assign', orderId };
      userStates[chatId] = { action: 'awaiting_assign', orderId };
      return bot.sendMessage(chatId, `<b>Ketik nama teknisi untuk order <code>${escapeHtml(orderId)}</code> di chat ini (atau ketik ':me' for nama kamu sendiri), atau gunakan perintah:</b>\n<code>/updateteknisi ${escapeHtml(orderId)} :me</code>`, { parse_mode: 'HTML', reply_markup: { force_reply: true, selective: true } });
    }

    if (data.startsWith('note:')) {
      const orderId = data.split(':')[1];
      const userId = query.from ? query.from.id : '';
      userStates[`${chatId}_${userId}`] = { action: 'awaiting_note', orderId };
      userStates[chatId] = { action: 'awaiting_note', orderId };
      const task = await getTaskById(orderId);
      if (task) {
        return bot.sendMessage(chatId, buildPromptForMissingFields(task, task.trackerStatus || 'Pending'), { parse_mode: 'HTML', reply_markup: { force_reply: true, selective: true } });
      }
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
            parse_mode: 'HTML',
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
      return bot.sendMessage(chatId, `Order <code>${escapeHtml(orderId)}</code> tidak ditemukan.`, { parse_mode: 'HTML' });
    }

    const taskSTO = task.sto || '';
    if (!taskSTO) {
      return bot.sendMessage(chatId, `Order <code>${escapeHtml(orderId)}</code> tidak memiliki data STO.`, { parse_mode: 'HTML' });
    }

    const matchedTechs = await getTechniciansBySTO(taskSTO);
    if (matchedTechs.length === 0) {
      return bot.sendMessage(chatId, `Belum ada teknisi yang terdaftar untuk STO <b>${escapeHtml(taskSTO)}</b>.\n\nSilakan daftarkan dengan perintah:\n<code>/daftar_teknisi ${escapeHtml(taskSTO)} NamaTeknisi @Username</code>`, { parse_mode: 'HTML' });
    }

    const allTasks = await getAllTasks();
    const activeStatuses = ['Pending', 'On Progress', 'Kendala'];
    const activeTasks = allTasks.filter(t => activeStatuses.includes(t.trackerStatus));

    let minWorkload = Infinity;
    let candidateTechs = [];

    for (const tech of matchedTechs) {
      let workload = 0;
      for (const t of activeTasks) {
        if (t.technicianName && (t.technicianName.includes(tech.name) || (tech.username && t.technicianName.includes(tech.username)))) {
          workload++;
        }
      }
      tech.workload = workload;
      if (workload < minWorkload) {
        minWorkload = workload;
        candidateTechs = [tech];
      } else if (workload === minWorkload) {
        candidateTechs.push(tech);
      }
    }

    const selectedTech = candidateTechs[Math.floor(Math.random() * candidateTechs.length)];
    const techName = `${selectedTech.name} ${selectedTech.username || ''}`.trim();

    await updateTask(task.id, { technicianName: techName, trackerStatus: 'On Progress', updatedBy });
    const updatedTask = await getTaskById(task.id);

    let notifyResult = '';
    try {
      const targetId = selectedTech.chatId.startsWith('@') ? selectedTech.chatId : selectedTech.chatId;
      const notifyMsg = `<b>NOTIFIKASI WORK ORDER BARU (STO ${escapeHtml(taskSTO)})</b>\n\n` +
        `<b>Order ID:</b> <code>${escapeHtml(updatedTask.id)}</code>\n` +
        `<b>Pelanggan:</b> ${escapeHtml(updatedTask.customerName || '-')}\n` +
        `<b>Alamat:</b> ${escapeHtml(updatedTask.address || '-')}\n` +
        `<b>Layanan:</b> ${escapeHtml(updatedTask.serviceType || '-')}\n` +
        `<b>Status:</b> <b>On Progress</b>\n` +
        `<b>Di Update Oleh:</b> ${escapeHtml(updatedBy)}\n\n` +
        `<i>Anda dipilih otomatis karena memiliki tugas aktif paling sedikit (${minWorkload} task). Silakan segera ditindaklanjuti!</i>`;

      await bot.sendMessage(targetId, notifyMsg, { parse_mode: 'HTML', ...getTaskActionButtons(updatedTask.id) });
      notifyResult = `• <b>${escapeHtml(selectedTech.name)}</b>: BERHASIL TERSAMPAIKAN`;
    } catch (dmErr) {
      notifyResult = `• <b>${escapeHtml(selectedTech.name)}</b>: Gagal mengirim pesan (bot diblokir atau belum start)`;
    }

    const mentionsText = selectedTech.username ? `\n\nTag Teknisi: <code>${escapeHtml(selectedTech.username)}</code>` : '';

    const resultMsg = `<b>ORDER BERHASIL DI-ASSIGN OTOMATIS BERDASARKAN BEBAN KERJA!</b>\n\n` +
      `<b>Teknisi Terpilih:</b> ${escapeHtml(selectedTech.name)} (Beban tugas aktif: ${minWorkload})${mentionsText}\n\n` +
      `<b>Status Notifikasi:</b>\n${notifyResult}\n\n` +
      `${formatTaskMessage(updatedTask)}`;

    return bot.sendMessage(chatId, resultMsg, { parse_mode: 'HTML', ...getTaskActionButtons(updatedTask.id) });
  } catch (err) {
    return bot.sendMessage(chatId, `Gagal assign STO & Notif: ${escapeHtml(err.message)}`, { parse_mode: 'HTML' });
  }
}

// Helpers / Search
function parseSearchQueryAndStatus(rawQuery) {
  if (!rawQuery) return { query: '', status: null };

  const trimmed = rawQuery.trim();
  const lower = trimmed.toLowerCase();

  const statusMappings = [
    { keys: ['on progress', 'on-progress', 'on_progress'], status: 'On Progress' },
    { keys: ['completed', 'complete', 'selesai'], status: 'Completed' },
    { keys: ['on', 'progress', 'jalan'], status: 'On Progress' },
    { keys: ['pending', 'pnd'], status: 'Pending' },
    { keys: ['kendala', 'issue', 'knd'], status: 'Kendala' },
    { keys: ['cancel', 'batal', 'cnc'], status: 'Cancel' }
  ];

  for (const item of statusMappings) {
    for (const key of item.keys) {
      if (lower === key) {
        return { query: '', status: item.status };
      }
      if (lower.endsWith(' ' + key)) {
        const queryPart = trimmed.substring(0, trimmed.length - key.length).trim();
        if (queryPart.length > 0) {
          return { query: queryPart, status: item.status };
        }
      }
    }
  }

  return { query: trimmed, status: null };
}

async function handleSearch(bot, chatId, rawQueryStr, page = 1, messageId = null) {
  try {
    const { query: queryStr, status: filterStatus } = parseSearchQueryAndStatus(rawQueryStr);

    if (!queryStr && filterStatus) {
      return handleTaskListByStatus(bot, chatId, filterStatus, page, messageId);
    }

    if (!messageId) {
      const searchInfo = filterStatus
        ? `<i>Mencari data: <code>${escapeHtml(queryStr)}</code> [Status: <b>${escapeHtml(filterStatus)}</b>]...</i>`
        : `<i>Mencari data: <code>${escapeHtml(queryStr)}</code>...</i>`;
      await bot.sendMessage(chatId, searchInfo, { parse_mode: 'HTML' });
    }

    const allTasks = await getAllTasks();
    const qLower = queryStr.toLowerCase();

    // 1. Check exact STO match
    const stoAll = allTasks.filter(t => t.sto && t.sto.toLowerCase() === qLower);

    if (stoAll.length > 0) {
      let stoMatches = stoAll;
      if (filterStatus) {
        stoMatches = stoAll.filter(t => (t.trackerStatus || 'Pending').toLowerCase() === filterStatus.toLowerCase());
      }

      if (stoMatches.length > 0) {
        const title = filterStatus
          ? `DAFTAR WORK ORDER STO ${queryStr.toUpperCase()} (${filterStatus.toUpperCase()})`
          : `DAFTAR WORK ORDER STO ${queryStr.toUpperCase()}`;
        return sendPaginatedTaskList(bot, chatId, title, stoMatches, page, 'sto', rawQueryStr, messageId);
      } else {
        const noStatusMsg = `Tidak ada work order untuk STO <b>${escapeHtml(queryStr.toUpperCase())}</b> dengan status <b>${escapeHtml(filterStatus)}</b>.`;
        if (messageId) {
          return bot.editMessageText(noStatusMsg, { chat_id: chatId, message_id: messageId, parse_mode: 'HTML' }).catch(() => bot.sendMessage(chatId, noStatusMsg, { parse_mode: 'HTML' }));
        }
        return bot.sendMessage(chatId, noStatusMsg, { parse_mode: 'HTML' });
      }
    }

    // 2. Check single Order ID match
    const singleMatch = await getTaskById(queryStr);
    if (singleMatch) {
      if (filterStatus) {
        const matchStatus = (singleMatch.trackerStatus || 'Pending').toLowerCase();
        if (matchStatus !== filterStatus.toLowerCase()) {
          const statusMismatchMsg = `Work order <code>${escapeHtml(singleMatch.id)}</code> ditemukan, tetapi statusnya adalah <b>${escapeHtml(singleMatch.trackerStatus || 'Pending')}</b> (bukan <b>${escapeHtml(filterStatus)}</b>).`;
          if (messageId) {
            return bot.editMessageText(statusMismatchMsg, { chat_id: chatId, message_id: messageId, parse_mode: 'HTML' }).catch(() => bot.sendMessage(chatId, statusMismatchMsg, { parse_mode: 'HTML' }));
          }
          return bot.sendMessage(chatId, statusMismatchMsg, { parse_mode: 'HTML' });
        }
      }
      return bot.sendMessage(chatId, formatTaskMessage(singleMatch), { parse_mode: 'HTML', ...getTaskActionButtons(singleMatch.id) });
    }

    // 3. Check partial matches (customer name, technician name, witel, internet)
    const partialAll = allTasks.filter(t =>
      (t.sto && t.sto.toLowerCase().includes(qLower)) ||
      (t.witel && t.witel.toLowerCase().includes(qLower)) ||
      (t.customerName && t.customerName.toLowerCase().includes(qLower)) ||
      (t.technicianName && t.technicianName.toLowerCase().includes(qLower)) ||
      (t.internet && String(t.internet).toLowerCase().includes(qLower))
    );

    if (partialAll.length > 0) {
      let partialMatches = partialAll;
      if (filterStatus) {
        partialMatches = partialAll.filter(t => (t.trackerStatus || 'Pending').toLowerCase() === filterStatus.toLowerCase());
      }

      if (partialMatches.length > 0) {
        const title = filterStatus
          ? `HASIL PENCARIAN "${queryStr.toUpperCase()}" (${filterStatus.toUpperCase()})`
          : `HASIL PENCARIAN "${queryStr.toUpperCase()}"`;
        return sendPaginatedTaskList(bot, chatId, title, partialMatches, page, 'q', rawQueryStr, messageId);
      } else {
        const noStatusPartialMsg = `Tidak ada hasil pencarian "<b>${escapeHtml(queryStr)}</b>" dengan status <b>${escapeHtml(filterStatus)}</b>.`;
        if (messageId) {
          return bot.editMessageText(noStatusPartialMsg, { chat_id: chatId, message_id: messageId, parse_mode: 'HTML' }).catch(() => bot.sendMessage(chatId, noStatusPartialMsg, { parse_mode: 'HTML' }));
        }
        return bot.sendMessage(chatId, noStatusPartialMsg, { parse_mode: 'HTML' });
      }
    }

    const notFoundMsg = filterStatus
      ? `Work order atau STO "<b>${escapeHtml(queryStr)}</b>" dengan status <b>${escapeHtml(filterStatus)}</b> tidak ditemukan.`
      : `Work order atau STO "<b>${escapeHtml(queryStr)}</b>" tidak ditemukan.`;
    if (messageId) {
      return bot.editMessageText(notFoundMsg, { chat_id: chatId, message_id: messageId, parse_mode: 'HTML' }).catch(() => bot.sendMessage(chatId, notFoundMsg, { parse_mode: 'HTML' }));
    }
    return bot.sendMessage(chatId, notFoundMsg, { parse_mode: 'HTML' });
  } catch (err) {
    return bot.sendMessage(chatId, `Error saat pencarian: ${escapeHtml(err.message)}`, { parse_mode: 'HTML' });
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

    const text = `<b>REKAPITULASI STATUS WORK ORDER EBIS</b>\n` +
      `═════════════════════════\n` +
      `<b>Total Order:</b> <code>${counts.Total}</code>\n\n` +
      `<b>Pending:</b> <code>${counts.Pending}</code>\n` +
      `<b>On Progress:</b> <code>${counts['On Progress']}</code>\n` +
      `<b>Completed:</b> <code>${counts.Completed}</code>\n` +
      `<b>Kendala:</b> <code>${counts.Kendala}</code>\n` +
      `<b>Cancel:</b> <code>${counts.Cancel}</code>\n` +
      `═════════════════════════\n` +
      `<i>Klik tombol di bawah untuk melihat daftar spesifik:</i>`;

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

    return bot.sendMessage(chatId, text, { parse_mode: 'HTML', reply_markup: { inline_keyboard } });
  } catch (err) {
    return bot.sendMessage(chatId, `Gagal mengambil data rekap: ${escapeHtml(err.message)}`, { parse_mode: 'HTML' });
  }
}

async function handleTaskListByStatus(bot, chatId, status, page = 1, messageId = null) {
  try {
    const tasks = await getAllTasks();
    const filtered = tasks.filter(t => (t.trackerStatus || 'Pending').toLowerCase() === status.toLowerCase());

    if (filtered.length === 0) {
      const msg = `Tidak ada task dengan status <b>${escapeHtml(status)}</b>.`;
      if (messageId) {
        return bot.editMessageText(msg, { chat_id: chatId, message_id: messageId, parse_mode: 'HTML' }).catch(() => bot.sendMessage(chatId, msg, { parse_mode: 'HTML' }));
      }
      return bot.sendMessage(chatId, msg, { parse_mode: 'HTML' });
    }

    return sendPaginatedTaskList(bot, chatId, `DAFTAR WORK ORDER STATUS ${status.toUpperCase()}`, filtered, page, 'st', status, messageId);
  } catch (err) {
    return bot.sendMessage(chatId, `Gagal memuat daftar task: ${escapeHtml(err.message)}`, { parse_mode: 'HTML' });
  }
}

async function handleSearchTeknisi(bot, chatId, techName, page = 1, messageId = null) {
  try {
    const tasks = await getAllTasks();
    const matched = tasks.filter(t => t.technicianName && t.technicianName.toLowerCase().includes(techName.toLowerCase()));

    if (matched.length === 0) {
      const msg = `Tidak ada task yang ditugaskan ke teknisi "<b>${escapeHtml(techName)}</b>".`;
      if (messageId) {
        return bot.editMessageText(msg, { chat_id: chatId, message_id: messageId, parse_mode: 'HTML' }).catch(() => bot.sendMessage(chatId, msg, { parse_mode: 'HTML' }));
      }
      return bot.sendMessage(chatId, msg, { parse_mode: 'HTML' });
    }

    return sendPaginatedTaskList(bot, chatId, `WORK ORDER UNTUK TEKNISI "${techName.toUpperCase()}"`, matched, page, 'tek', techName, messageId);
  } catch (err) {
    return bot.sendMessage(chatId, `Gagal mencari teknisi: ${escapeHtml(err.message)}`, { parse_mode: 'HTML' });
  }
}

async function handleAssignTechnician(bot, chatId, orderId, techName, updatedBy = '-') {
  try {
    const task = await getTaskById(orderId);
    if (!task) {
      return bot.sendMessage(chatId, `Order <code>${escapeHtml(orderId)}</code> tidak ditemukan.`, { parse_mode: 'HTML' });
    }

    await updateTask(task.id, { technicianName: techName, updatedBy });
    const updatedTask = await getTaskById(task.id);
    return bot.sendMessage(chatId, `<b>Teknisi untuk order <code>${escapeHtml(task.id)}</code> berhasil diubah menjadi ${escapeHtml(techName || 'Belum ditugaskan')}!</b>\n\n${formatTaskMessage(updatedTask)}`, { parse_mode: 'HTML', ...getTaskActionButtons(updatedTask.id) });
  } catch (err) {
    return bot.sendMessage(chatId, `Gagal menetapkan teknisi: ${escapeHtml(err.message)}`, { parse_mode: 'HTML' });
  }
}

async function handleUpdateNote(bot, chatId, orderId, notesText, updatedBy = '-') {
  try {
    const task = await getTaskById(orderId);
    if (!task) {
      return bot.sendMessage(chatId, `Order <code>${escapeHtml(orderId)}</code> tidak ditemukan.`, { parse_mode: 'HTML' });
    }

    const updates = { updatedBy };
    const parsed = parseTemplateMessage(notesText);

    if (parsed && (parsed.woId || parsed.nik || parsed.notes || parsed.technicianName || parsed.status)) {
      if (parsed.woId) updates.woId = parsed.woId;
      if (parsed.nik) updates.nik = parsed.nik;
      if (parsed.notes) updates.notes = parsed.notes;
      if (parsed.technicianName) updates.technicianName = parsed.technicianName;
      if (parsed.status) {
        const validStatuses = ['Pending', 'On Progress', 'Completed', 'Kendala', 'Cancel'];
        const matchedStatus = validStatuses.find(s => s.toLowerCase() === parsed.status.toLowerCase());
        if (matchedStatus) updates.trackerStatus = matchedStatus;
      }
    } else {
      updates.notes = notesText;
    }

    await updateTask(task.id, updates);
    const updatedTask = await getTaskById(task.id);
    return bot.sendMessage(chatId, `<b>ORDER <code>${escapeHtml(task.id)}</code> BERHASIL DIPERBARUI!</b>\n\n${formatTaskMessage(updatedTask)}`, { parse_mode: 'HTML', ...getTaskActionButtons(updatedTask.id) });
  } catch (err) {
    return bot.sendMessage(chatId, `Gagal memperbarui order: ${escapeHtml(err.message)}`, { parse_mode: 'HTML' });
  }
}

function formatDailyReminderText(tasks, userProfile = null) {
  const now = new Date();
  const dateStr = now.toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Jakarta'
  });
  const timeStr = now.toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Jakarta'
  }).replace(/\./g, ':');

  if (!tasks || tasks.length === 0) {
    return `<b>🔔 REMINDER WORK ORDER EBIS</b>\n` +
      `📅 <i>${dateStr} • ${timeStr} WIB</i>\n` +
      `═════════════════════════\n\n` +
      `<i>Belum ada data work order aktif.</i>`;
  }

  let targetWitel = null;
  if (userProfile) {
    if (userProfile.witel && userProfile.witel !== 'ALL') {
      targetWitel = userProfile.witel.toUpperCase().trim();
    } else if (userProfile.sto && userProfile.sto !== 'ALL') {
      const matchTask = tasks.find(t => t.sto && t.sto.toUpperCase().trim() === userProfile.sto.toUpperCase());
      if (matchTask && matchTask.witel) {
        targetWitel = matchTask.witel.toUpperCase().trim();
      }
    }
  }

  let filteredTasks = tasks;
  if (targetWitel) {
    const matched = tasks.filter(t => (t.witel || '').toUpperCase().trim() === targetWitel);
    if (matched.length > 0) {
      filteredTasks = matched;
    } else {
      targetWitel = null;
    }
  }

  const grouped = {};
  const overall = { Total: 0, Pending: 0, 'On Progress': 0, Kendala: 0, Cancel: 0, Completed: 0 };

  filteredTasks.forEach(t => {
    const witel = (t.witel || 'WITEL LAIN').toUpperCase().trim();
    const sto = (t.sto || 'UMUM').toUpperCase().trim();
    const status = t.trackerStatus || 'Pending';

    overall.Total++;
    if (overall[status] !== undefined) overall[status]++;

    if (!grouped[witel]) grouped[witel] = {};
    if (!grouped[witel][sto]) {
      grouped[witel][sto] = {
        total: 0,
        pending: [],
        progress: [],
        kendala: [],
        cancel: [],
        completed: 0
      };
    }

    const stData = grouped[witel][sto];
    stData.total++;

    const orderId = t.order || t.id;
    const noteSnippet = t.notes ? ` (${t.notes.substring(0, 25)}${t.notes.length > 25 ? '...' : ''})` : '';

    if (status === 'Pending') stData.pending.push(orderId);
    else if (status === 'On Progress') stData.progress.push(orderId);
    else if (status === 'Kendala') stData.kendala.push(`${orderId}${noteSnippet}`);
    else if (status === 'Cancel') stData.cancel.push(orderId);
    else if (status === 'Completed') stData.completed++;
  });

  const headerTitle = targetWitel
    ? `<b>🔔 REMINDER WORK ORDER WITEL ${escapeHtml(targetWitel)}</b>`
    : `<b>🔔 REMINDER WORK ORDER EBIS</b>`;

  const stoTag = userProfile?.sto ? ` • STO <code>${escapeHtml(userProfile.sto)}</code>` : '';

  let text = `${headerTitle}\n` +
    `📅 <i>${dateStr} • ${timeStr} WIB${stoTag}</i>\n` +
    `═════════════════════════\n\n`;

  const witelKeys = Object.keys(grouped).sort();

  witelKeys.forEach(witel => {
    text += `<b>📍 WITEL ${escapeHtml(witel)}</b>\n`;
    const stoKeys = Object.keys(grouped[witel]).sort();

    stoKeys.forEach(sto => {
      const st = grouped[witel][sto];
      text += `  <b>STO ${escapeHtml(sto)}:</b>\n` +
        `  • Total: <b>${st.total}</b> | ⏳ Pend: ${st.pending.length} | 🚧 Prog: ${st.progress.length} | ⚠️ Kdl: ${st.kendala.length}\n`;

      if (st.pending.length > 0) {
        const pList = st.pending.slice(0, 5).map(id => `<code>${escapeHtml(id)}</code>`).join(', ');
        const moreP = st.pending.length > 5 ? ` (+${st.pending.length - 5} order)` : '';
        text += `  • ⏳ Pending: ${pList}${moreP}\n`;
      }

      if (st.kendala.length > 0) {
        const kList = st.kendala.slice(0, 3).map(k => `<code>${escapeHtml(k)}</code>`).join(', ');
        const moreK = st.kendala.length > 3 ? ` (+${st.kendala.length - 3} order)` : '';
        text += `  • ⚠️ Kendala: ${kList}${moreK}\n`;
      }
    });

    text += `\n`;
  });

  const summaryTitle = targetWitel ? `RINGKASAN WITEL ${escapeHtml(targetWitel)}` : `TOTAL RINGKASAN`;

  text += `═════════════════════════\n` +
    `<b>📊 ${summaryTitle}:</b>\n` +
    `Total: <b>${overall.Total} Order</b> | ⏳ Pend: <b>${overall.Pending}</b> | 🚧 Prog: <b>${overall['On Progress']}</b> | ⚠️ Kdl: <b>${overall.Kendala}</b> | ✅ Comp: <b>${overall.Completed}</b>\n` +
    `─────────────────────────\n` +
    `<i>Ketik <code>/setwitel &lt;WITEL|ALL&gt;</code> untuk mengatur filter Witel.</i>\n` +
    `<i>Jika ingin cek Detail per STO silahkan gunakan <code>/cek STO</code> : Contoh <code>/cek KBY</code></i>`;

  return text;
}

async function sendBroadcastReminder(bot) {
  try {
    const tasks = await getAllTasks();
    const profiles = await getAllRecipientProfiles();

    let successCount = 0;
    let failCount = 0;

    for (const profile of profiles) {
      try {
        const text = formatDailyReminderText(tasks, profile);
        await bot.sendMessage(profile.chatId, text, { parse_mode: 'HTML' });
        successCount++;
      } catch (err) {
        console.error(`Failed to send reminder to ${profile.chatId}:`, err.message);
        failCount++;
      }
    }

    return { success: true, total: profiles.length, successCount, failCount };
  } catch (err) {
    console.error('Error in sendBroadcastReminder:', err.message);
    return { success: false, error: err.message };
  }
}

module.exports = {
  setupBotListeners,
  formatDailyReminderText,
  sendBroadcastReminder
};
