/**
 * js/media.js: Arcanum
 * Invio/ricezione media (foto, audio) cifrati a chunk sul DataChannel.
 * Stesso schema collaudato nella versione nativa React Native (P2PManager.sendMedia).
 *
 * Limiti dimensione, più stretti che nativo perché il browser condivide
 * lo stesso heap JS per tutto (IndexedDB + memoria applicativa):
 *   - foto:  nessun limite pratico (i telefoni comprimono già in JPEG/HEIC)
 *   - audio: nessun limite pratico (i vocali sono piccoli, tipicamente <2MB)
 *   - video: NON ancora supportato in questa versione (vedi roadmap)
 */

import { encryptMessage, decryptMessage } from './crypto.js';
import { saveMedia, loadMedia } from './db.js';

const CHUNK_SIZE = 12000; // byte per chunk, sotto il limite pratico DataChannel (~16KB)
const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25MB, guard anti-OOM

// In-flight reassembly state: mediaId → { chunks[], received, total, mimeType, mediaType, fromId, timer }
const incoming = new Map();
const INCOMING_TIMEOUT = 60000; // 60s, se un trasferimento resta incompleto, scarta

// ── Invio ──────────────────────────────────────────────────────────────────────
// blob: File/Blob dal file input o da MediaRecorder
// send: funzione transport.send già bindata al deviceId del contatto
export async function sendMediaBlob(blob, mediaType, ratchetState, send, onProgress) {
  if (blob.size > MAX_FILE_BYTES) {
    throw new Error(`File troppo grande (${Math.round(blob.size / 1024 / 1024)}MB). Massimo 25MB.`);
  }

  const buffer = await blob.arrayBuffer();
  const bytes  = new Uint8Array(buffer);
  const totalChunks = Math.ceil(bytes.length / CHUNK_SIZE);
  const mediaId = 'media_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);

  let state = ratchetState;
  for (let i = 0; i < totalChunks; i++) {
    const slice = bytes.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
    // Ogni chunk passa per il ratchet come fosse un messaggio a sé,
    // stessa forward secrecy dei messaggi di testo, chunk per chunk.
    const chunkB64 = btoa(String.fromCharCode(...slice));
    const { payload, newState } = encryptMessage(state, chunkB64);
    state = newState;

    const sent = send(JSON.stringify({
      type: 'media_chunk',
      mediaId, index: i, total: totalChunks,
      mediaType, mimeType: blob.type,
      payload, ts: Date.now(),
    }));

    if (!sent) throw new Error('Peer non connesso, invio interrotto al chunk ' + i);
    onProgress?.(Math.round(((i + 1) / totalChunks) * 100));

    // Piccola pausa tra chunk per non saturare il buffer del DataChannel
    if (i < totalChunks - 1) await new Promise((r) => setTimeout(r, 8));
  }

  return { mediaId, newState: state };
}

// ── Ricezione ──────────────────────────────────────────────────────────────────
// Chiamato da handleData quando arriva un chunk. Ritorna newState del ratchet
// (va salvato dal chiamante), e se il trasferimento è completo ritorna anche
// { done: true, mediaId, mediaType, mimeType }, altrimenti { done: false }.
export async function handleMediaChunk(msg, ratchetState, fromId) {
  const { mediaId, index, total, mediaType, mimeType } = msg;

  if (!incoming.has(mediaId)) {
    const timer = setTimeout(() => {
      incoming.delete(mediaId);
      console.warn('[Arcanum] media transfer timeout', mediaId);
    }, INCOMING_TIMEOUT);
    incoming.set(mediaId, { chunks: new Array(total), received: 0, total, mediaType, mimeType, fromId, timer });
  }

  const state0 = incoming.get(mediaId);

  // FIX: decryptMessage lancia un'eccezione su chiave errata/corruzione
  // (non torna null), la catturiamo qui esplicitamente per pulire subito
  // la entry incompleta invece di lasciarla nella Map fino al timeout di 60s
  let chunkB64, newState;
  try {
    const result = decryptMessage(ratchetState, msg.payload);
    chunkB64 = result.plaintext;
    newState = result.newState;
  } catch (e) {
    console.warn('[Arcanum] media chunk decrypt fallito, indice', index, e.message);
    clearTimeout(state0.timer);
    incoming.delete(mediaId);
    throw new Error(`Chunk ${index} non decifrabile: trasferimento abortito`);
  }

  if (state0.chunks[index] === undefined) {
    state0.chunks[index] = chunkB64;
    state0.received++;
  }

  if (state0.received === state0.total) {
    clearTimeout(state0.timer);
    incoming.delete(mediaId);

    // Riassembla i byte da tutti i chunk base64
    const parts = state0.chunks.map((b64) => {
      const bin = atob(b64);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      return arr;
    });
    const totalLen = parts.reduce((sum, p) => sum + p.length, 0);
    const full = new Uint8Array(totalLen);
    let offset = 0;
    for (const p of parts) { full.set(p, offset); offset += p.length; }

    const blob = new Blob([full], { type: state0.mimeType });
    await saveMedia(mediaId, blob, state0.mimeType);

    return { newState, done: true, mediaId, mediaType: state0.mediaType, mimeType: state0.mimeType, fromId };
  }

  return { newState, done: false };
}

// ── Utility per la UI ────────────────────────────────────────────────────────────
export async function getMediaObjectUrl(mediaId) {
  const record = await loadMedia(mediaId);
  if (!record) return null;
  return URL.createObjectURL(record.blob);
}
