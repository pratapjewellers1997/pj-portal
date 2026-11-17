// Firebase connection for chat + phone notifications (Step 13, v2).
// Loaded only when needed (dynamic import), so the rest of the portal stays light.
// These config values are public by design (they identify the project);
// security comes from Firestore rules (firestore.rules) and Google sign-in.

import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithCredential, onAuthStateChanged, signOut } from 'firebase/auth';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, query, where, orderBy, limitToLast, onSnapshot, writeBatch, setDoc, getDoc,
  serverTimestamp,
} from 'firebase/firestore';

export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyA8H0UuZ8di2fPa3xfrj7hfvAHAKNaHqHk',
  authDomain: 'pj-portal-3cc45.firebaseapp.com',
  projectId: 'pj-portal-3cc45',
  storageBucket: 'pj-portal-3cc45.firebasestorage.app',
  messagingSenderId: '737545759597',
  appId: '1:737545759597:web:c4a825bed71707e8450864',
};
export const VAPID_KEY = 'BA7tZ_OZFjgkykpLyn96N2nvvmOv8zsH5YAM4cKLbGIkR6NAwyyrfYME9kzuCijykQxupKrBgQNd-nRCY7YNOTo';

const app = initializeApp(FIREBASE_CONFIG);
const auth = getAuth(app);
let db;
try {
  // Keeps chats on the phone, so they open instantly and work on weak data.
  db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
} catch {
  db = initializeFirestore(app, {});
}
export { app };

/** Resolves with the Firebase user (or null) once Firebase knows. */
export function currentUser() {
  return new Promise((resolve) => {
    const off = onAuthStateChanged(auth, (u) => { off(); resolve(u); });
  });
}

/** Signs in to chat with the same Google sign-in the portal uses (ID token from Google). */
export async function connectChat(idToken) {
  const cred = GoogleAuthProvider.credential(idToken);
  return (await signInWithCredential(auth, cred)).user;
}

export function disconnectChat() { return signOut(auth).catch(() => {}); }

/** My staff record in Firestore: {primary, name, ...} or null if not added yet / inactive. */
export async function myStaff(email) {
  const snap = await getDoc(doc(db, 'staff', String(email).toLowerCase()));
  return snap.exists() && snap.data().active ? snap.data() : null;
}

/** All active staff (for "new message"), one entry per person. */
export function watchStaff(cb, onError) {
  return onSnapshot(query(collection(db, 'staff'), where('active', '==', true)), (snap) => {
    const byPrimary = new Map();
    snap.forEach((d) => { const s = d.data(); if (!byPrimary.has(s.primary)) byPrimary.set(s.primary, { email: s.primary, ...s }); });
    cb([...byPrimary.values()].sort((a, b) => a.name.localeCompare(b.name)));
  }, onError);
}

export const keyOf = (email) => String(email).toLowerCase().replace(/[^a-z0-9]/g, '_');
export const chatIdOf = (a, b) => [a, b].sort().join('__');
const ms = (t) => (t && typeof t.toMillis === 'function' ? t.toMillis() : t || 0);

/** My chats, live. Each: {id, other, otherName, last:{text,at,from,kind}, unread, seenByOther}. */
export function watchChats(me, cb, onError) {
  const q = query(collection(db, 'chats'), where('members', 'array-contains', me));
  return onSnapshot(q, (snap) => {
    const list = [];
    snap.forEach((d) => {
      const c = d.data();
      const other = c.members.find((m) => m !== me) || me;
      const names = c.names || {};
      const read = c.read || {};
      const lastAt = ms(c.last?.at);
      list.push({
        id: d.id, other, otherName: names[keyOf(other)] || other,
        last: c.last ? { text: c.last.text || '', at: lastAt, from: c.last.from, kind: c.last.kind || '' } : null,
        unread: Boolean(c.last && c.last.from !== me && lastAt > ms(read[keyOf(me)])),
        otherReadAt: ms(read[keyOf(other)]),
      });
    });
    list.sort((a, b) => (b.last?.at || 0) - (a.last?.at || 0));
    cb(list);
  }, onError);
}

/** One chat's messages, live (last 200). */
export function watchMessages(chatId, cb, onError) {
  const q = query(collection(db, 'chats', chatId, 'messages'), orderBy('at'), limitToLast(200));
  return onSnapshot(q, { includeMetadataChanges: true }, (snap) => {
    const list = [];
    snap.forEach((d) => {
      const m = d.data();
      list.push({ id: d.id, from: m.from, text: m.text || '', at: ms(m.at) || Date.now(), file: m.file || null, pending: d.metadata.hasPendingWrites });
    });
    cb(list);
  }, onError);
}

export function watchChat(chatId, cb, onError) {
  return onSnapshot(doc(db, 'chats', chatId), (d) => cb(d.exists() ? d.data() : null), onError);
}

/** Sends one message (and creates the chat the first time). */
export function sendChatMessage({ me, myName, other, otherName, text, file }) {
  const id = chatIdOf(me, other);
  const batch = writeBatch(db);
  const chatRef = doc(db, 'chats', id);
  batch.set(chatRef, {
    members: [me, other].sort(),
    names: { [keyOf(me)]: myName, [keyOf(other)]: otherName },
    last: { text: (text || (file ? fileLabel(file) : '')).slice(0, 90), at: serverTimestamp(), from: me, kind: file ? file.kind : '' },
    read: { [keyOf(me)]: serverTimestamp() },
  }, { merge: true });
  const msg = { from: me, text: text || '', at: serverTimestamp() };
  if (file) msg.file = { id: file.id, name: file.name, mime: file.mime, size: file.size, kind: file.kind };
  batch.set(doc(collection(db, 'chats', id, 'messages')), msg);
  return batch.commit();
}

export function markChatRead(chatId, me) {
  return setDoc(doc(db, 'chats', chatId), { read: { [keyOf(me)]: serverTimestamp() } }, { merge: true });
}

export function fileLabel(f) {
  return f.kind === 'image' ? '📷 Photo' : f.kind === 'video' ? '🎬 Video' : `📄 ${f.name || 'File'}`;
}

/* ---------- Phone notifications ---------- */

export async function pushSupported() {
  try {
    const { isSupported } = await import('firebase/messaging');
    return (await isSupported()) && 'Notification' in window && 'serviceWorker' in navigator;
  } catch { return false; }
}

/** Asks permission and returns this device's push token (or throws). */
export async function enablePush() {
  const { getMessaging, getToken } = await import('firebase/messaging');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error(perm === 'denied' ? 'push_blocked' : 'push_dismissed');
  const reg = await navigator.serviceWorker.ready;
  return getToken(getMessaging(app), { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
}

export async function disablePush() {
  const { getMessaging, deleteToken } = await import('firebase/messaging');
  try { await deleteToken(getMessaging(app)); } catch {}
}
