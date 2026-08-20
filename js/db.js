/**
 * js/db.js: Arcanum
 * IndexedDB wrapper. Equivalente browser di Database.js (SQLite) nella versione RN.
 * Store: identity, contacts, messages, ratchet_state
 */

const DB_NAME = 'arcanum_v1';
const DB_VERSION = 2; // v2: aggiunto store 'media' per foto/audio
let _dbPromise = null;

export function getDb() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('identity')) {
        db.createObjectStore('identity', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('contacts')) {
        db.createObjectStore('contacts', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('messages')) {
        const store = db.createObjectStore('messages', { keyPath: 'id' });
        store.createIndex('by_contact', 'contactId', { unique: false });
      }
      if (!db.objectStoreNames.contains('ratchet_state')) {
        db.createObjectStore('ratchet_state', { keyPath: 'contactId' });
      }
      if (!db.objectStoreNames.contains('media')) {
        // Blob nativo, IndexedDB li gestisce senza serializzazione manuale
        db.createObjectStore('media', { keyPath: 'id' });
      }
    };

    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror   = (e) => reject(e.target.error);
  });
  return _dbPromise;
}

function tx(storeName, mode = 'readonly') {
  return getDb().then((db) => db.transaction(storeName, mode).objectStore(storeName));
}

// ── Identity (keypair unico del device) ───────────────────────────────────────
export async function saveIdentity(identity) {
  const store = await tx('identity', 'readwrite');
  return new Promise((res, rej) => {
    const r = store.put({ id: 'self', ...identity });
    r.onsuccess = () => res(true);
    r.onerror   = () => rej(r.error);
  });
}

export async function loadIdentity() {
  const store = await tx('identity');
  return new Promise((res, rej) => {
    const r = store.get('self');
    r.onsuccess = () => res(r.result || null);
    r.onerror   = () => rej(r.error);
  });
}

// ── Contatti ───────────────────────────────────────────────────────────────────
export async function saveContact(contact) {
  const store = await tx('contacts', 'readwrite');
  return new Promise((res, rej) => {
    const r = store.put(contact);
    r.onsuccess = () => res(true);
    r.onerror   = () => rej(r.error);
  });
}

export async function loadContacts() {
  const store = await tx('contacts');
  return new Promise((res, rej) => {
    const r = store.getAll();
    r.onsuccess = () => res(r.result || []);
    r.onerror   = () => rej(r.error);
  });
}

// ── Messaggi ───────────────────────────────────────────────────────────────────
export async function saveMessage(msg) {
  const store = await tx('messages', 'readwrite');
  return new Promise((res, rej) => {
    const r = store.put(msg);
    r.onsuccess = () => res(true);
    r.onerror   = () => rej(r.error);
  });
}

export async function loadMessages(contactId) {
  const store = await tx('messages');
  const idx = store.index('by_contact');
  return new Promise((res, rej) => {
    const r = idx.getAll(contactId);
    r.onsuccess = () => res((r.result || []).sort((a, b) => a.created_at - b.created_at));
    r.onerror   = () => rej(r.error);
  });
}

export async function deleteMessage(msgId) {
  const store = await tx('messages', 'readwrite');
  return new Promise((res, rej) => {
    const r = store.delete(msgId);
    r.onsuccess = () => res(true);
    r.onerror   = () => rej(r.error);
  });
}

// Riusa loadMessages() invece di aggiungere un indice composito
// [contactId, created_at] al database (richiederebbe una migration di
// schema), a questa scala (chat personali, non migliaia di messaggi)
// caricare tutta la cronologia e prendere l'ultimo elemento è la scelta
// più semplice e sicura, non un problema di performance reale.
export async function getLastMessage(contactId) {
  const msgs = await loadMessages(contactId);
  return msgs.length ? msgs[msgs.length - 1] : null;
}

// ── Ratchet state (una entry per contatto) ────────────────────────────────────
export async function saveRatchetState(contactId, state) {
  const store = await tx('ratchet_state', 'readwrite');
  return new Promise((res, rej) => {
    const r = store.put({ contactId, ...state });
    r.onsuccess = () => res(true);
    r.onerror   = () => rej(r.error);
  });
}

export async function loadRatchetState(contactId) {
  const store = await tx('ratchet_state');
  return new Promise((res, rej) => {
    const r = store.get(contactId);
    r.onsuccess = () => res(r.result || null);
    r.onerror   = () => rej(r.error);
  });
}

// ── Media (Blob) ───────────────────────────────────────────────────────────────
// IndexedDB gestisce nativamente i Blob, nessuna conversione base64 necessaria,
// molto più efficiente in memoria rispetto a tenere il base64 in una stringa JS.
export async function saveMedia(id, blob, mimeType) {
  const store = await tx('media', 'readwrite');
  return new Promise((res, rej) => {
    const r = store.put({ id, blob, mimeType, savedAt: Date.now() });
    r.onsuccess = () => res(true);
    r.onerror   = () => rej(r.error);
  });
}

export async function loadMedia(id) {
  const store = await tx('media');
  return new Promise((res, rej) => {
    const r = store.get(id);
    r.onsuccess = () => res(r.result || null);
    r.onerror   = () => rej(r.error);
  });
}

export async function deleteMedia(id) {
  const store = await tx('media', 'readwrite');
  return new Promise((res, rej) => {
    const r = store.delete(id);
    r.onsuccess = () => res(true);
    r.onerror   = () => rej(r.error);
  });
}
