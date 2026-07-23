require('dotenv').config();
const { initializeApp } = require('firebase/app');
const { 
  getFirestore, 
  collection, 
  getDocs, 
  doc, 
  getDoc, 
  updateDoc, 
  setDoc,
  deleteDoc,
  query, 
  where 
} = require('firebase/firestore');

const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.VITE_FIREBASE_APP_ID,
  databaseURL: process.env.VITE_FIREBASE_DATABASE_URL
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const TASKS_COLLECTION = "ebis_tasks";
const TECH_COLLECTION = "ebis_technicians";

// Task helpers
async function getAllTasks() {
  const querySnapshot = await getDocs(collection(db, TASKS_COLLECTION));
  const tasks = [];
  querySnapshot.forEach((docSnap) => {
    tasks.push({ id: docSnap.id, ...docSnap.data() });
  });
  return tasks;
}

async function getTaskById(orderId) {
  const docRef = doc(db, TASKS_COLLECTION, orderId);
  const docSnap = await getDoc(docRef);
  if (docSnap.exists()) {
    return { id: docSnap.id, ...docSnap.data() };
  }
  
  const all = await getAllTasks();
  const found = all.find(t => 
    (t.id && t.id.toLowerCase() === orderId.toLowerCase()) || 
    (t.order && String(t.order).toLowerCase() === orderId.toLowerCase()) ||
    (t.customerName && t.customerName.toLowerCase().includes(orderId.toLowerCase())) ||
    (t.internet && String(t.internet).toLowerCase() === orderId.toLowerCase())
  );
  return found || null;
}

const GOOGLE_SHEET_WEBHOOK_URL = process.env.GOOGLE_SHEET_WEBHOOK_URL || 'https://script.google.com/macros/s/AKfycby0jct0vhgp_Z31Zol3LtL-QU63jG8ZkgBRJk2TdSz0cEmyeOmwBxL1jqwcDAc6AecRkA/exec';

async function syncToGoogleSheets(task) {
  if (!GOOGLE_SHEET_WEBHOOK_URL || !task) return;
  try {
    const payload = JSON.stringify({
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
    });

    if (typeof fetch !== 'undefined') {
      fetch(GOOGLE_SHEET_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload
      }).catch(err => console.error('Google Sheets sync error:', err.message));
    }
  } catch (err) {
    console.error('Failed to trigger Google Sheets sync:', err.message);
  }
}

async function updateTask(orderId, updates) {
  const docRef = doc(db, TASKS_COLLECTION, orderId);
  const updatedAt = new Date().toISOString();
  await setDoc(docRef, {
    ...updates,
    updatedAt: updatedAt
  }, { merge: true });

  try {
    const updatedSnap = await getDoc(docRef);
    if (updatedSnap.exists()) {
      syncToGoogleSheets({ id: updatedSnap.id, ...updatedSnap.data() });
    }
  } catch (e) {
    console.error('Error fetching updated task for Google Sheets sync:', e.message);
  }

  return true;
}

// Technician & STO Mapping helpers
async function registerTechnician(chatId, username, name, sto) {
  const cleanUsername = username ? (username.startsWith('@') ? username : `@${username}`) : '';
  const docId = (cleanUsername ? cleanUsername.replace('@', '') : String(chatId)).toLowerCase();
  
  const docRef = doc(db, TECH_COLLECTION, docId);
  const techData = {
    chatId: String(chatId),
    username: cleanUsername,
    name: name,
    sto: sto.toUpperCase().trim(),
    updatedAt: new Date().toISOString()
  };
  await setDoc(docRef, techData, { merge: true });
  return techData;
}

async function getAllTechnicians() {
  const querySnapshot = await getDocs(collection(db, TECH_COLLECTION));
  const techs = [];
  querySnapshot.forEach((docSnap) => {
    techs.push(docSnap.data());
  });
  return techs;
}

async function getTechniciansBySTO(sto) {
  const all = await getAllTechnicians();
  return all.filter(t => t.sto.toUpperCase() === sto.toUpperCase());
}

async function deleteTechnician(queryStr) {
  const all = await getAllTechnicians();
  const matched = all.filter(t => 
    t.name.toLowerCase().includes(queryStr.toLowerCase()) || 
    t.sto.toLowerCase() === queryStr.toLowerCase() ||
    (t.username && t.username.toLowerCase().includes(queryStr.toLowerCase())) ||
    t.chatId === queryStr
  );

  let deletedCount = 0;
  for (const t of matched) {
    const docId = (t.username ? t.username.replace('@', '') : String(t.chatId)).toLowerCase();
    const docRef = doc(db, TECH_COLLECTION, docId);
    await deleteDoc(docRef);
    deletedCount++;
  }
  return { deletedCount, matched };
}

const CHATS_COLLECTION = "ebis_chats";

async function saveChatUser(chatId, from) {
  if (!chatId) return;
  try {
    const docId = String(chatId);
    const docRef = doc(db, CHATS_COLLECTION, docId);
    const username = from?.username ? `@${from.username}` : '';
    const name = [from?.first_name, from?.last_name].filter(Boolean).join(' ') || username || `User ${chatId}`;
    
    await setDoc(docRef, {
      chatId: String(chatId),
      username: username,
      name: name,
      lastSeen: new Date().toISOString()
    }, { merge: true });

    // Auto-link numeric chatId to ebis_technicians if username matches
    if (from?.username) {
      const cleanUser = from.username.trim().toLowerCase();
      const techSnap = await getDocs(collection(db, TECH_COLLECTION));
      techSnap.forEach(async (d) => {
        const data = d.data();
        const techUser = data.username ? String(data.username).replace(/^@/, '').trim().toLowerCase() : '';
        if (techUser === cleanUser && String(data.chatId || '') !== String(chatId)) {
          try {
            await setDoc(doc(db, TECH_COLLECTION, d.id), { chatId: String(chatId) }, { merge: true });
          } catch (err) {}
        }
      });
    }
  } catch (e) {
    console.error("Failed to save chat user:", e.message);
  }
}

async function setUserWitel(chatId, witel) {
  if (!chatId) return false;
  try {
    const docId = String(chatId);
    const docRef = doc(db, CHATS_COLLECTION, docId);
    await setDoc(docRef, {
      chatId: String(chatId),
      witel: (witel || '').toUpperCase().trim(),
      updatedAt: new Date().toISOString()
    }, { merge: true });
    return true;
  } catch (e) {
    console.error("Failed to set user witel:", e.message);
    return false;
  }
}

async function getAllRecipientProfiles() {
  const profilesMap = new Map();
  const usernameToTech = new Map();

  try {
    const techs = await getAllTechnicians();
    techs.forEach(t => {
      const cleanUser = t.username ? String(t.username).replace(/^@/, '').trim().toLowerCase() : '';
      const rawChatId = t.chatId ? String(t.chatId).trim() : '';

      const techObj = {
        chatId: /^\d+$/.test(rawChatId) ? rawChatId : '',
        name: t.name || '',
        username: cleanUser ? `@${cleanUser}` : (t.username || ''),
        sto: (t.sto || '').toUpperCase().trim(),
        witel: (t.witel || '').toUpperCase().trim()
      };

      if (techObj.chatId) {
        profilesMap.set(techObj.chatId, techObj);
      }
      if (cleanUser) {
        usernameToTech.set(cleanUser, techObj);
      }
    });

    const querySnapshot = await getDocs(collection(db, CHATS_COLLECTION));
    querySnapshot.forEach(docSnap => {
      const data = docSnap.data();
      const rawChatId = data.chatId ? String(data.chatId).trim() : '';
      if (!/^\d+$/.test(rawChatId)) return;

      const cleanUser = data.username ? String(data.username).replace(/^@/, '').trim().toLowerCase() : '';

      let existing = profilesMap.get(rawChatId);
      if (!existing && cleanUser && usernameToTech.has(cleanUser)) {
        existing = usernameToTech.get(cleanUser);
      }

      const mergedProfile = {
        chatId: rawChatId,
        name: data.name || existing?.name || '',
        username: data.username || existing?.username || '',
        sto: existing?.sto || (data.sto || '').toUpperCase().trim(),
        witel: data.witel || existing?.witel || ''
      };

      profilesMap.set(rawChatId, mergedProfile);
    });
  } catch (e) {
    console.error('Error fetching recipient profiles:', e.message);
  }

  return Array.from(profilesMap.values()).filter(p => /^\d+$/.test(p.chatId));
}

async function getAllRecipientChatIds() {
  const profiles = await getAllRecipientProfiles();
  return profiles.map(p => p.chatId);
}

async function unregisterChatUser(chatId) {
  if (!chatId) return false;
  try {
    const docId = String(chatId);
    const docRef = doc(db, CHATS_COLLECTION, docId);
    await deleteDoc(docRef);
    return true;
  } catch (e) {
    console.error("Failed to unregister chat user:", e.message);
    return false;
  }
}

const CONFIG_COLLECTION = "ebis_config";

async function getAdminAuth() {
  const defaultAuth = { username: "admin", password: "ebis902544604" };
  try {
    const docRef = doc(db, CONFIG_COLLECTION, "admin_auth");
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      const data = docSnap.data();
      return {
        username: data.username || "admin",
        password: data.password || "ebis902544604"
      };
    } else {
      await setDoc(docRef, defaultAuth);
      return defaultAuth;
    }
  } catch (e) {
    console.error("Failed to fetch admin auth from Firestore:", e.message);
    return defaultAuth;
  }
}

async function updateAdminAuth(newPassword, newUsername = "admin") {
  try {
    const docRef = doc(db, CONFIG_COLLECTION, "admin_auth");
    await setDoc(docRef, {
      username: newUsername,
      password: newPassword,
      updatedAt: new Date().toISOString()
    }, { merge: true });
    return true;
  } catch (e) {
    console.error("Failed to update admin auth in Firestore:", e.message);
    throw e;
  }
}

const ADMINS_COLLECTION = "ebis_admins";

async function addOrUpdateAdminUser(username, password, createdBy = '@Rei219') {
  if (!username || !password) return false;
  const docId = username.trim().toLowerCase();
  const docRef = doc(db, ADMINS_COLLECTION, docId);
  await setDoc(docRef, {
    username: username.trim(),
    password: password.trim(),
    createdBy: createdBy,
    updatedAt: new Date().toISOString()
  }, { merge: true });
  return true;
}

async function getAllAdminUsers() {
  const admins = [];
  try {
    const querySnapshot = await getDocs(collection(db, ADMINS_COLLECTION));
    querySnapshot.forEach(docSnap => {
      admins.push(docSnap.data());
    });

    if (admins.length === 0) {
      const defaultAdmin = { username: "admin", password: "ebis902544604", createdBy: "SISTEM" };
      await addOrUpdateAdminUser(defaultAdmin.username, defaultAdmin.password, defaultAdmin.createdBy);
      admins.push(defaultAdmin);
    }
  } catch (e) {
    console.error("Error fetching admin users:", e.message);
  }
  return admins;
}

async function deleteAdminUser(username) {
  if (!username) return false;
  const docId = username.trim().toLowerCase();
  const docRef = doc(db, ADMINS_COLLECTION, docId);
  await deleteDoc(docRef);
  return true;
}

module.exports = {
  db,
  TASKS_COLLECTION,
  TECH_COLLECTION,
  CHATS_COLLECTION,
  CONFIG_COLLECTION,
  ADMINS_COLLECTION,
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
};
