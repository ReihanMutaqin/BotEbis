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
const COLLECTION_NAME = "ebis_tasks";

// Helper functions for tasks
async function getAllTasks() {
  const querySnapshot = await getDocs(collection(db, COLLECTION_NAME));
  const tasks = [];
  querySnapshot.forEach((docSnap) => {
    tasks.push({ id: docSnap.id, ...docSnap.data() });
  });
  return tasks;
}

async function getTaskById(orderId) {
  const docRef = doc(db, COLLECTION_NAME, orderId);
  const docSnap = await getDoc(docRef);
  if (docSnap.exists()) {
    return { id: docSnap.id, ...docSnap.data() };
  }
  
  // Try case-insensitive or substring match across all tasks
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
  const docRef = doc(db, COLLECTION_NAME, orderId);
  await setDoc(docRef, {
    ...updates,
    updatedAt: new Date().toISOString()
  }, { merge: true });
  return true;
}

module.exports = {
  db,
  COLLECTION_NAME,
  getAllTasks,
  getTaskById,
  updateTask
};
