// firebase.js
const admin = require('firebase-admin');

if (!admin.apps.length) {
  let serviceAccount;
  try {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  } catch (error) {
    console.error('Error parsing FIREBASE_SERVICE_ACCOUNT:', error);
    throw new Error('Failed to parse FIREBASE_SERVICE_ACCOUNT environment variable');
  }

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://worldlynk-97994.firebaseio.com"
  });
}

const db = admin.firestore();

module.exports = { admin, db };