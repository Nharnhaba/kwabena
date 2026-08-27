const firebaseConfig = {
  apiKey: "AIzaSyDTqYVsYUTX3SujL7R7whG0RRUTsesjuDU",
  authDomain: "sika-expenses.firebaseapp.com",
  projectId: "sika-expenses",
  storageBucket: "sika-expenses.firebasestorage.app",
  messagingSenderId: "215957107746",
  appId: "1:215957107746:web:3ac9ef20f2e160d760467b"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
db.settings({
  experimentalAutoDetectLongPolling: true,
  useFetchStreams: false,
  merge: true
});

// Enable Firestore multi-tab offline persistence
db.enableMultiTabIndexedDbPersistence().catch((err) => {
  console.warn("Firestore multi-tab persistence failed to enable:", err);
});