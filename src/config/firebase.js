const admin = require('firebase-admin');
require('dotenv').config();

const firebaseConfig = {
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  privateKey: process.env.FIREBASE_PRIVATE_KEY ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') : undefined,
};

function initializeFirebase() {
  if (!firebaseConfig.projectId || !firebaseConfig.privateKey || !firebaseConfig.clientEmail) {
    console.log('\x1b[33m[!] Firebase Admin not configured. Push notifications disabled.\x1b[0m');
    return null;
  }

  try {
    admin.initializeApp({
      credential: admin.credential.cert(firebaseConfig),
    });
    console.log('\x1b[32m[+] Firebase Admin initialized successfully\x1b[0m');
    return admin;
  } catch (error) {
    console.error('Firebase Admin initialization error:', error);
    return null;
  }
}

module.exports = { initializeFirebase, admin };
