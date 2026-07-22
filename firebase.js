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

async function updateTask(orderId, updates) {
  const docRef = doc(db, TASKS_COLLECTION, orderId);
  await setDoc(docRef, {
    ...updates,
    updatedAt: new Date().toISOString()
  }, { merge: true });
  return true;
}

// Technician & STO Mapping helpers
async function registerTechnician(chatId, username, name, sto) {
  const docRef = doc(db, TECH_COLLECTION, String(chatId));
  const techData = {
    chatId: String(chatId),
    username: username || '',
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

module.exports = {
  db,
  TASKS_COLLECTION,
  TECH_COLLECTION,
  getAllTasks,
  getTaskById,
  updateTask,
  registerTechnician,
  getAllTechnicians,
  getTechniciansBySTO
};
