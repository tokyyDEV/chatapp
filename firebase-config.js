// ============================================
// FIREBASE KONFIGURÁCIÓ
// ============================================
// Cseréld le az alábbi értékeket a saját Firebase projekted adataira.
// Ezt a Firebase Console-ban találod:
// Project settings -> General -> Your apps -> SDK setup and configuration
//
// FONTOS: mielőtt ez működne, a Firebase Console-ban be kell kapcsolnod:
//  1. Authentication -> Sign-in method -> Google (engedélyezve)
//  2. Firestore Database (létrehozva, "production mode")
//  3. Storage (létrehozva, a profilképekhez)
// Lásd a README.md-t a részletes lépésekért és a biztonsági szabályokért!

const firebaseConfig = {
  apiKey: "AIzaSyD3aHTQvsT0FMso4BYxasRrZM7y1a6D2xM",
  authDomain: "papaszite.firebaseapp.com",
  projectId: "papaszite",
  storageBucket: "papaszite.firebasestorage.app",
  messagingSenderId: "1086306936774",
  appId: "1:1086306936774:web:ef08ffe516a7cdaa5874c7",
  measurementId: "G-KM75E77MY6"
};

firebase.initializeApp(firebaseConfig);

const auth = firebase.auth();
const db = firebase.firestore();
const storage = firebase.storage();
const googleProvider = new firebase.auth.GoogleAuthProvider();