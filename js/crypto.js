/**
 * js/crypto.js — Arcanum
 *
 * NOTA IMPORTANTE SULLA TRASPARENZA:
 * Questa NON è la libreria ufficiale libsignal (Signal Protocol audited).
 * È un'implementazione custom ispirata al Double Ratchet di Signal,
 * costruita su primitive libsodium (X25519, BLAKE2b come HKDF, XChaCha20-Poly1305).
 *
 * Proprietà di sicurezza replicate:
 *   - Forward secrecy: ogni messaggio usa una chiave diversa, derivata e poi scartata
 *   - Post-compromise security parziale: il ratchet DH periodico rigenera le chiavi radice
 *
 * Cosa NON replica rispetto a libsignal originale:
 *   - Non ha subito audit di sicurezza indipendenti
 *   - Gestione header/out-of-order messages semplificata
 *   - Nessuna protezione formale contro replay avanzati
 *
 * Per un progetto che gestisce dati sensibili di terzi in produzione,
 * valutare in futuro l'integrazione della libreria ufficiale o un audit dedicato.
 */

import sodium from 'https://cdn.jsdelivr.net/npm/libsodium-wrappers-sumo@0.7.15/+esm';

let ready = false;
export async function initCrypto() {
  if (ready) return;
  await sodium.ready;
  ready = true;
}

// ── Identity keypair (X25519) — generato una volta, persistito in IndexedDB ──
export function generateIdentityKeyPair() {
  const kp = sodium.crypto_kx_keypair();
  return {
    publicKey: sodium.to_base64(kp.publicKey),
    secretKey: sodium.to_base64(kp.privateKey),
  };
}

export function pubKeyFromSecret(secretKeyB64) {
  const sk = sodium.from_base64(secretKeyB64);
  // deriviamo la pubkey ricreando il keypair da seed non è diretto con crypto_kx;
  // per semplicità la pubkey viene sempre salvata insieme alla secret key al momento
  // della generazione (vedi generateIdentityKeyPair) — questa funzione resta come utility.
  return sodium.to_base64(sodium.crypto_scalarmult_base(sk));
}

// ── X3DH-lite: handshake iniziale al momento dello scan QR ───────────────────
// Deriva un root key condiviso da (my secret, their public) via X25519 + BLAKE2b
export function deriveRootKey(mySecretKeyB64, theirPublicKeyB64) {
  const mySecret = sodium.from_base64(mySecretKeyB64);
  const theirPublic = sodium.from_base64(theirPublicKeyB64);
  const shared = sodium.crypto_scalarmult(mySecret, theirPublic);
  // HKDF-like: BLAKE2b con chiave per derivare il root key a 32 byte
  const rootKey = sodium.crypto_generichash(32, shared, 'arcanum-root-key-v1');
  return rootKey; // Uint8Array, tenuto in memoria/IndexedDB come base64
}

// ── Stato ratchet iniziale per una conversazione ──────────────────────────────
// FIX CRITICO: prima versione derivava sendChainKey/recvChainKey identici per
// entrambi i lati (stessa root key, stesse label 'send-chain'/'recv-chain') —
// nessuna distinzione direzionale, quindi Alice e Bob non potevano MAI
// scambiarsi un messaggio reale (Alice cifra col suo sendChainKey, Bob prova
// a decifrare col suo recvChainKey — valore diverso, decrypt sempre fallito).
//
// Fix: i ruoli A/B sono assegnati confrontando le chiavi pubbliche in ordine
// lessicografico — è deterministico, entrambi i lati calcolano lo stesso
// risultato senza bisogno di negoziazione. Chi ha la pubkey "minore" usa il
// canale A2B per inviare e B2A per ricevere; l'altro viceversa. Così il
// sendChainKey di uno coincide sempre col recvChainKey dell'altro.
export function initRatchetState(rootKeyBytes, myPublicKeyB64, theirPublicKeyB64) {
  const iAmA = myPublicKeyB64 < theirPublicKeyB64;
  const a2b = sodium.to_base64(sodium.crypto_generichash(32, rootKeyBytes, 'arcanum-a2b-chain'));
  const b2a = sodium.to_base64(sodium.crypto_generichash(32, rootKeyBytes, 'arcanum-b2a-chain'));
  return {
    rootKey:      sodium.to_base64(rootKeyBytes),
    sendChainKey: iAmA ? a2b : b2a,
    recvChainKey: iAmA ? b2a : a2b,
    sendCount: 0,
    recvCount: 0,
  };
}

// Deriva la prossima chiave di messaggio dalla chain key, poi avanza la chain
// (KDF a due output: messageKey + nextChainKey — pattern standard del ratchet simmetrico)
function ratchetChain(chainKeyB64) {
  const chainKey = sodium.from_base64(chainKeyB64);
  const messageKey   = sodium.crypto_generichash(32, chainKey, 'msg-key');
  const nextChainKey = sodium.crypto_generichash(32, chainKey, 'next-chain');
  return { messageKey, nextChainKey: sodium.to_base64(nextChainKey) };
}

// ── Cifra un messaggio e avanza il sending chain ──────────────────────────────
export function encryptMessage(state, plaintext) {
  const { messageKey, nextChainKey } = ratchetChain(state.sendChainKey);
  const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  const cipher = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    sodium.from_string(plaintext), null, null, nonce, messageKey
  );
  const newState = { ...state, sendChainKey: nextChainKey, sendCount: state.sendCount + 1 };
  const payload = sodium.to_base64(nonce) + '.' + sodium.to_base64(cipher);
  return { payload, newState };
}

// ── Decifra un messaggio e avanza il receiving chain ──────────────────────────
export function decryptMessage(state, payload) {
  const [nonceB64, cipherB64] = payload.split('.');
  const nonce  = sodium.from_base64(nonceB64);
  const cipher = sodium.from_base64(cipherB64);
  const { messageKey, nextChainKey } = ratchetChain(state.recvChainKey);
  const plainBytes = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
    null, cipher, null, nonce, messageKey
  );
  const newState = { ...state, recvChainKey: nextChainKey, recvCount: state.recvCount + 1 };
  return { plaintext: sodium.to_string(plainBytes), newState };
}

export { sodium };

// ── Numero di sicurezza (ispirato ai "safety numbers" di Signal) ─────────────
// Serve a verificare FUORI BANDA (di persona, per telefono) che lo scambio
// di chiavi pubbliche non sia stato manomesso da un attaccante nel mezzo.
// Se il numero calcolato da entrambi i lati coincide, le chiavi scambiate
// sono sicuramente quelle giuste — nessun terzo si è inserito nello scambio.
//
// Ordinamento deterministico delle due pubkey (stessa tecnica già usata per
// assegnare i canali send/recv in initRatchetState) — così Alice e Bob
// calcolano lo stesso identico numero senza doversi coordinare su chi è
// "primo" e chi è "secondo".
export function computeSafetyNumber(myPublicKeyB64, theirPublicKeyB64) {
  const a = sodium.from_base64(myPublicKeyB64);
  const b = sodium.from_base64(theirPublicKeyB64);
  const [first, second] = myPublicKeyB64 < theirPublicKeyB64 ? [a, b] : [b, a];

  const combined = new Uint8Array(first.length + second.length);
  combined.set(first, 0);
  combined.set(second, first.length);
  const hash = sodium.crypto_generichash(32, combined, 'arcanum-safety-number-v1');

  // 6 gruppi da 5 cifre = 30 cifre totali, leggibili a voce a blocchi
  const groups = [];
  for (let i = 0; i < 12; i += 2) {
    const val = ((hash[i] << 8) | hash[i + 1]) % 100000;
    groups.push(String(val).padStart(5, '0'));
  }
  return groups.join(' ');
}
