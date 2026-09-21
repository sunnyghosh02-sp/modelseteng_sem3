// ============================================================
// NEW FIREBASE PROJECT — modelset-hub-v2
// ============================================================
const firebaseConfig = {
  apiKey: "AIzaSyDNO_eE2R6m9-w0h3xAqG91X4quS8gnCFs",
  authDomain: "modelsethubv2.firebaseapp.com",
  projectId: "modelsethubv2",
  storageBucket: "modelsethubv2.firebasestorage.app",
  messagingSenderId: "64301828901",
  appId: "1:64301828901:web:794a54cb9c3b1d2445a8cc"
};

if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

const db = firebase.firestore();

db.enablePersistence()
    .catch(err => {
        if (err.code === 'failed-precondition') {
            console.warn('Multiple tabs open — using single-tab mode');
        } else if (err.code === 'unimplemented') {
            console.warn('Browser does not support persistence');
        }
    });