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
      orderId: task.order || task.id,
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

module.exports = {
  db,
  TASKS_COLLECTION,
  TECH_COLLECTION,
  getAllTasks,
  getTaskById,
  updateTask,
  registerTechnician,
  getAllTechnicians,
  getTechniciansBySTO,
  deleteTechnician
};
