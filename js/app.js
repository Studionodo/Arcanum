/**
 * js/app.js: Arcanum PWA
 * Orchestratore: identity, contatti, chat, WebRTC, ratchet crypto.
 */

import { initCrypto, generateIdentityKeyPair, deriveRootKey, initRatchetState, encryptMessage, decryptMessage, computeSafetyNumber, sodium } from './crypto.js';
import { saveIdentity, loadIdentity, saveContact, loadContacts, saveMessage, loadMessages, getLastMessage, deleteMessage, saveRatchetState, loadRatchetState, saveMedia } from './db.js';
import { WebRTCTransport } from './webrtc.js';
import signaling from './signaling.js';
import { renderQR, scanQR } from './qr.js';
import { sendMediaBlob, handleMediaChunk, getMediaObjectUrl } from './media.js';
import { withContactLock } from './mutex.js';
import { t, getLang, setLang } from './i18n.js';
import { startRain } from './rain.js';
import { startTitleEffect } from './titleFx.js';
import { attachSwipeNav } from './swipe.js';

const $ = (sel) => document.querySelector(sel);
const root = $('#app');

let identity = null;
let transport = new WebRTCTransport();
let ratchetCache = new Map(); // contactId → state (mirror di IndexedDB, evita round-trip continui)
let currentContact = null;
let screen = 'home';

// ── Boot ───────────────────────────────────────────────────────────────────────
async function boot() {
  await initCrypto();

  identity = await loadIdentity();
  if (!identity) {
    const kp = generateIdentityKeyPair();
    identity = { publicKey: kp.publicKey, secretKey: kp.secretKey, deviceId: 'node_' + sodium.to_hex(sodium.randombytes_buf(6)) };
    await saveIdentity(identity);
  }

  transport.onData   = handleData;
  transport.onStatus = handleStatus;
  transport.onSignal = (deviceId, sdp) => {
    if (sdp.type === 'offer')  signaling.sendOffer(deviceId, sdp);
    if (sdp.type === 'answer') signaling.sendAnswer(deviceId, sdp);
  };

  signaling.onOffer  = (fromId, sdp) => transport.accept({ id: fromId }, sdp);
  signaling.onAnswer = (fromId, sdp) => transport.accept({ id: fromId }, sdp);

  await signaling.connect(identity.deviceId);

  const contacts = await loadContacts();
  contacts.forEach((c) => transport.connect(c));

  render();
}

// ── Data / status handlers ──────────────────────────────────────────────────────
async function handleData(deviceId, dataStr) {
  // Serializza tutte le operazioni sul ratchet state di questo contatto,
  // vedi js/mutex.js per il perché (race condition su chunk/messaggi ravvicinati)
  return withContactLock(deviceId, () => handleDataLocked(deviceId, dataStr));
}

async function handleDataLocked(deviceId, dataStr) {
  try {
    const msg = JSON.parse(dataStr);
    if (msg.type === 'message') {
      let state = ratchetCache.get(deviceId) || (await loadRatchetState(deviceId));
      if (!state) return console.warn('[Arcanum] nessun ratchet state per', deviceId);
      const { plaintext, newState } = decryptMessage(state, msg.payload);
      ratchetCache.set(deviceId, newState);
      await saveRatchetState(deviceId, newState);
      const record = { id: msg.id, contactId: deviceId, from: deviceId, text: plaintext, created_at: msg.ts };
      await saveMessage(record);
      if (currentContact?.id === deviceId) renderChat();
    } else if (msg.type === 'delete') {
      let state = ratchetCache.get(deviceId) || (await loadRatchetState(deviceId));
      if (!state) return;
      const { plaintext: msgId, newState } = decryptMessage(state, msg.payload);
      ratchetCache.set(deviceId, newState);
      await saveRatchetState(deviceId, newState);
      await deleteMessage(msgId);
      if (currentContact?.id === deviceId) renderChat();
    } else if (msg.type === 'media_chunk') {
      let state = ratchetCache.get(deviceId) || (await loadRatchetState(deviceId));
      if (!state) return console.warn('[Arcanum] nessun ratchet state per', deviceId);
      const result = await handleMediaChunk(msg, state, deviceId);
      ratchetCache.set(deviceId, result.newState);
      await saveRatchetState(deviceId, result.newState);
      if (result.done) {
        await saveMessage({
          id: 'msg_' + result.mediaId, contactId: deviceId, from: deviceId,
          mediaId: result.mediaId, mediaType: result.mediaType, mimeType: result.mimeType,
          created_at: msg.ts,
        });
        if (currentContact?.id === deviceId) renderChat();
      }
    }
  } catch (e) {
    console.warn('[Arcanum] handleData error', e.message);
  }
}

// Mappa gli status grezzi del transport (sempre in inglese, valori interni)
// alle chiavi i18n corrispondenti, FIX: prima si usava il testo grezzo
// direttamente, bypassando la traduzione anche in modalità italiano.
const STATUS_KEY = {
  connected: 'statusConnected',
  connecting: 'statusConnecting',
  disconnected: 'statusDisconnected',
  error: 'statusError',
};

function handleStatus(deviceId, status) {
  const pill = document.querySelector(`[data-status="${deviceId}"]`);
  if (pill) pill.textContent = t(STATUS_KEY[status] || status);
  if (currentContact?.id === deviceId) renderChat();
}

// ── Invio messaggio ──────────────────────────────────────────────────────────────
async function sendMessage(contact, text) {
  return withContactLock(contact.id, () => sendMessageLocked(contact, text));
}

async function sendMessageLocked(contact, text) {
  let state = ratchetCache.get(contact.id) || (await loadRatchetState(contact.id));
  if (!state) return alert(t('handshakeMissing'));

  const { payload, newState } = encryptMessage(state, text);
  ratchetCache.set(contact.id, newState);
  await saveRatchetState(contact.id, newState);

  const id = 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  const sent = transport.send(contact.id, JSON.stringify({ type: 'message', id, payload, ts: Date.now() }));
  if (!sent) return alert(t('peerNotConnected'));

  await saveMessage({ id, contactId: contact.id, from: identity.deviceId, text, created_at: Date.now() });
  renderChat();
}

// ── Invio media (foto/audio) ──────────────────────────────────────────────────────
// NOTA: il lock resta acquisito per l'intera durata del trasferimento,
// un messaggio in arrivo dallo stesso contatto durante un invio media
// attende che il trasferimento finisca. Compromesso corretto per la
// correttezza crittografica (send e recv chain condividono lo stesso
// oggetto stato, un aggiornamento concorrente causerebbe un lost-update).
async function sendMediaFile(contact, blob, mediaType, onProgress) {
  return withContactLock(contact.id, () => sendMediaFileLocked(contact, blob, mediaType, onProgress));
}

async function sendMediaFileLocked(contact, blob, mediaType, onProgress) {
  let state = ratchetCache.get(contact.id) || (await loadRatchetState(contact.id));
  if (!state) return alert(t('handshakeMissing'));

  try {
    const { mediaId, newState } = await sendMediaBlob(
      blob, mediaType, state,
      (jsonStr) => transport.send(contact.id, jsonStr),
      onProgress,
    );
    ratchetCache.set(contact.id, newState);
    await saveRatchetState(contact.id, newState);

    // Salva anche in locale (mittente) per vederlo nella propria chat
    await saveMedia(mediaId, blob, blob.type);
    await saveMessage({
      id: 'msg_' + mediaId, contactId: contact.id, from: identity.deviceId,
      mediaId, mediaType, mimeType: blob.type, created_at: Date.now(),
    });
    renderChat();
  } catch (e) {
    alert(t('sendFailed', e.message));
  }
}

// ── Pairing via QR ────────────────────────────────────────────────────────────────
function myQrPayload() {
  return JSON.stringify({ id: identity.deviceId, pk: identity.publicKey, name: 'Nodo' });
}

async function pairWithScannedData(dataStr) {
  const data = JSON.parse(dataStr);
  if (!data.id || !data.pk) throw new Error('QR non valido: dati mancanti');

  const rootKey = deriveRootKey(identity.secretKey, data.pk);
  // FIX: passiamo entrambe le pubkey per assegnare correttamente i canali
  // send/recv, vedi crypto.js per il perché
  const state = initRatchetState(rootKey, identity.publicKey, data.pk);

  // Guard: garantisce un nome non vuoto anche con QR malformato/ostile
  // (senza questo, un avatar con name[0] su stringa vuota crasha il render)
  const safeName = (data.name && data.name.trim()) || data.id.slice(0, 10) || 'Nodo';
  const contact = { id: data.id, name: safeName, public_key: data.pk };
  await saveContact(contact);
  await saveRatchetState(contact.id, state);
  ratchetCache.set(contact.id, state);

  transport.connect(contact);
  screen = 'home';
  render();
}

// ── UI Rendering ───────────────────────────────────────────────────────────────
async function render() {
  // Piccola transizione fade+slide ad ogni cambio schermata (swipe, bottoni,
  // back), reflow forzato per poter ri-triggerare la CSS animation ad ogni
  // chiamata, anche se si passa più volte sulla stessa schermata.
  root.classList.remove('screen-enter');
  void root.offsetWidth;
  root.classList.add('screen-enter');

  if (screen === 'home')  return renderHome();
  if (screen === 'chat')  return renderChat();
  if (screen === 'scan')  return renderScan();
}

async function renderHome() {
  const contacts = await loadContacts();
  // Prende l'ultimo messaggio per ogni contatto, usato per l'anteprima
  // nella lista, al posto dello stato di connessione una volta che esiste
  // già una cronologia (più utile, stesso pattern di WhatsApp/Telegram)
  const lastMsgs = await Promise.all(contacts.map((c) => getLastMessage(c.id)));

  function previewText(m) {
    if (!m) return null;
    if (m.mediaId) return m.mediaType === 'image' ? t('mediaPhotoPreview') : t('mediaAudioPreview');
    const text = m.text || '';
    return text.length > 42 ? text.slice(0, 42) + '…' : text;
  }

  root.innerHTML = `
    <div class="topbar">
      <div>
        <canvas class="app-name" id="app-name-el"></canvas>
        <div class="app-sub">${t('appSub')}</div>
      </div>
      <div class="topbar-actions">
        <div class="lang-switch">
          <button id="lang-it" class="lang-option ${getLang() === 'it' ? 'active' : ''}">IT</button>
          <button id="lang-en" class="lang-option ${getLang() === 'en' ? 'active' : ''}">EN</button>
        </div>
        <button id="qr-btn" class="qr-btn">${t('myQr')}</button>
      </div>
    </div>
    <div id="qr-panel" class="qr-panel hidden"></div>
    <div class="contact-list">
      ${contacts.length === 0 ? `<div class="empty">${t('noContacts')}</div>` : ''}
      ${contacts.map((c, i) => {
        const preview = previewText(lastMsgs[i]);
        // Se esiste già una cronologia mostriamo l'anteprima (statica);
        // altrimenti lo stato di connessione live (data-status, aggiornato
        // in tempo reale da handleStatus, le due cose non convivono mai
        // nello stesso elemento, altrimenti un cambio di stato live
        // cancellerebbe l'anteprima del messaggio)
        const secondaryLine = preview
          ? `<div class="contact-preview">${escapeHtml(preview)}</div>`
          : `<div class="contact-status" data-status="${c.id}">${transport.isConnected(c.id) ? t('statusConnected') : t('statusConnecting')}</div>`;
        return `
          <button class="contact" data-id="${c.id}">
            <div class="avatar">${escapeHtml(c.name[0]).toUpperCase()}</div>
            <div class="contact-info">
              <div class="contact-name">${escapeHtml(c.name)}</div>
              ${secondaryLine}
            </div>
          </button>
        `;
      }).join('')}
    </div>
    <div class="nav">
      <button class="pill pill-home active">${t('navHome')}</button>
      <button class="pill pill-scan" id="scan-nav">${t('navScan')}</button>
    </div>
  `;

  // AUDIT: prima chiamava render() generica, che ri-anima TUTTO #app col
  // fade+slide anche se restiamo sulla stessa schermata, sembrava che la
  // pagina si ricaricasse. Il cambio lingua non è una navigazione, quindi
  // chiama direttamente renderHome() per aggiornare solo il testo.
  $('#lang-it').onclick = () => { setLang('it'); renderHome(); };
  $('#lang-en').onclick = () => { setLang('en'); renderHome(); };
  $('#qr-btn').onclick = () => {
    const panel = $('#qr-panel');
    panel.classList.toggle('hidden');
    if (!panel.classList.contains('hidden')) {
      panel.innerHTML = '';
      panel.appendChild(renderQR(myQrPayload(), 200));

      // Bottone "Copia codice", stesso contesto della condivisione QR,
      // per pairing a distanza (chat, email) invece che di persona
      const copyBtn = document.createElement('button');
      copyBtn.className = 'copy-code-btn';
      copyBtn.textContent = t('copyCode');
      copyBtn.onclick = async () => {
        try {
          await navigator.clipboard.writeText(myQrPayload());
          copyBtn.textContent = t('codeCopied');
          setTimeout(() => { copyBtn.textContent = t('copyCode'); }, 2000);
        } catch (e) {
          alert(t('copyFailed'));
        }
      };
      panel.appendChild(copyBtn);
    }
  };
  $('#scan-nav').onclick = () => { screen = 'scan'; render(); };
  root.querySelectorAll('.contact').forEach((btn) => {
    btn.onclick = async () => {
      const contacts = await loadContacts();
      currentContact = contacts.find((c) => c.id === btn.dataset.id);
      screen = 'chat';
      render();
    };
  });

  titleEffectStop = startTitleEffect('app-name-el', 'Arcanum');
}

let mediaRecorder = null;
let recordedChunks = [];

async function renderChat() {
  stopTitleEffect(); // usciamo da Home, nessun canvas #app-name-el da animare qui
  if (!currentContact) { screen = 'home'; return render(); }
  const msgs = await loadMessages(currentContact.id);

  // Raggruppa messaggi consecutivi dello stesso mittente, determina la
  // posizione nel gruppo per applicare bordi e spaziatura coerenti
  // (stesso pattern collaudato nel mockup JSX originale dell'app).
  const groupedMsgs = msgs.map((m, i) => {
    const prev = msgs[i - 1];
    const next = msgs[i + 1];
    const sameAsPrev = prev && prev.from === m.from;
    const sameAsNext = next && next.from === m.from;
    let pos = 'solo';
    if (!sameAsPrev && sameAsNext) pos = 'first';
    if (sameAsPrev && sameAsNext) pos = 'middle';
    if (sameAsPrev && !sameAsNext) pos = 'last';
    return { ...m, pos };
  });

  root.innerHTML = `
    <div class="chat-header">
      <button id="back-btn" class="back-btn">←</button>
      <button id="safety-btn" class="chat-contact chat-contact-btn">
        <div class="avatar-sm">${escapeHtml(currentContact.name[0]).toUpperCase()}</div>
        <div class="chat-name">${escapeHtml(currentContact.name)}</div>
        <div class="chat-status" data-status="${currentContact.id}">${transport.isConnected(currentContact.id) ? t('statusConnected') : t('statusConnecting')}</div>
      </button>
      <div style="width:40px"></div>
    </div>
    <div id="safety-panel" class="safety-panel hidden"></div>
    <div class="messages" id="messages">
      ${groupedMsgs.length === 0 ? `<div class="empty">${t('noMessagesYet')}</div>` : ''}
      ${groupedMsgs.map((m) => `
        <div class="msg ${m.from === identity.deviceId ? 'mine' : 'theirs'}" data-pos="${m.pos}">
          <div class="bubble">
            ${m.mediaId ? '<div class="media-slot" data-media-id="' + m.mediaId + '" data-media-type="' + m.mediaType + '">' + t('loading') + '</div>' : escapeHtml(m.text)}
            <div class="msg-time">${fmt(m.created_at)}</div>
          </div>
        </div>
      `).join('')}
    </div>
    <div id="upload-progress" class="upload-progress hidden"></div>
    <div class="input-bar">
      <button id="attach-btn" class="icon-btn">${ICON_ATTACH}</button>
      <input id="msg-input" placeholder="${t('writeMessage')}" autocomplete="off"/>
      <button id="mic-btn" class="icon-btn">${ICON_MIC}</button>
      <button id="send-btn">${ICON_SEND}</button>
    </div>
    <input type="file" id="file-input" accept="image/*" style="display:none"/>
  `;

  $('#back-btn').onclick = () => { screen = 'home'; currentContact = null; render(); };

  // Numero di sicurezza, tap sull'header apre/chiude il pannello di verifica
  $('#safety-btn').onclick = () => {
    const panel = $('#safety-panel');
    panel.classList.toggle('hidden');
    if (!panel.classList.contains('hidden')) {
      const number = computeSafetyNumber(identity.publicKey, currentContact.public_key);
      panel.innerHTML = `
        <div class="safety-number-title">${t('safetyNumberTitle')}</div>
        <div class="safety-number">${escapeHtml(number)}</div>
        <div class="safety-number-hint">${t('safetyNumberHint')}</div>
        <button id="safety-close" class="safety-close-btn">${t('safetyNumberClose')}</button>
      `;
      $('#safety-close').onclick = () => panel.classList.add('hidden');
    }
  };

  const input = $('#msg-input');
  const send = () => {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    sendMessage(currentContact, text);
  };
  $('#send-btn').onclick = send;
  input.onkeydown = (e) => { if (e.key === 'Enter') send(); };

  // ── Allegati: galleria/fotocamera ─────────────────────────────────────────
  const fileInput = $('#file-input');
  $('#attach-btn').onclick = () => fileInput.click();
  fileInput.onchange = async () => {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    showUploadProgress(0);
    await sendMediaFile(currentContact, file, 'image', showUploadProgress);
    hideUploadProgress();
  };

  // ── Audio: registra al tap, ferma al secondo tap ──────────────────────────
  const micBtn = $('#mic-btn');
  micBtn.onclick = async () => {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        recordedChunks = [];
        mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
        mediaRecorder.ondataavailable = (e) => recordedChunks.push(e.data);
        mediaRecorder.onstop = async () => {
          stream.getTracks().forEach((t) => t.stop());
          const blob = new Blob(recordedChunks, { type: 'audio/webm;codecs=opus' });
          showUploadProgress(0);
          await sendMediaFile(currentContact, blob, 'audio', showUploadProgress);
          hideUploadProgress();
        };
        mediaRecorder.start();
        micBtn.innerHTML = ICON_STOP;
        micBtn.classList.add('recording');
      } catch (e) {
        alert(t('micUnavailable', e.message));
      }
    } else {
      mediaRecorder.stop();
      micBtn.innerHTML = ICON_MIC;
      micBtn.classList.remove('recording');
    }
  };

  // ── Carica media bubble in modo asincrono (Blob URL) ──────────────────────
  root.querySelectorAll('.media-slot').forEach(async (slot) => {
    const mediaId = slot.dataset.mediaId;
    const mediaType = slot.dataset.mediaType;
    const url = await getMediaObjectUrl(mediaId);
    if (!url) { slot.textContent = t('mediaUnavailable'); return; }
    if (mediaType === 'image') {
      slot.innerHTML = `<img src="${url}" class="media-img" alt=""/>`;
    } else if (mediaType === 'audio') {
      slot.innerHTML = `<audio src="${url}" controls class="media-audio"></audio>`;
    }
  });

  const msgsEl = $('#messages');
  msgsEl.scrollTop = msgsEl.scrollHeight;
}

function showUploadProgress(pct) {
  const el = $('#upload-progress');
  if (!el) return;
  el.classList.remove('hidden');
  el.textContent = t('uploading', pct);
}
function hideUploadProgress() {
  const el = $('#upload-progress');
  if (el) el.classList.add('hidden');
}

// ── Camera dello scan QR, deve fermarsi su OGNI via d'uscita ────────────────
// BUG TROVATO CON AUDIT: scanQR() ritorna una funzione stop(), ma se
// l'utente lascia la schermata (bottone "Indietro" O swipe) prima di
// completare la scansione, quella funzione non veniva mai chiamata, la
// camera restava accesa indefinitamente in background (batteria, privacy,
// loop requestAnimationFrame orfano). Serve un riferimento richiamabile da
// entrambe le vie d'uscita, non una variabile locale a una sola funzione.
let scanCameraStop = null;

function stopScanCamera() {
  if (scanCameraStop) { scanCameraStop(); scanCameraStop = null; }
}

function renderScan() {
  stopTitleEffect(); // usciamo da Home, stesso motivo di renderChat
  root.innerHTML = `
    <div class="chat-header">
      <div style="width:40px"></div>
      <div class="chat-name">${t('scanTitle')}</div>
      <div style="width:40px"></div>
    </div>
    <div class="scan-area">
      <video id="scan-video" playsinline muted></video>
    </div>
    <button id="paste-link" class="paste-link">${t('pasteCode')}</button>
    <div id="paste-panel" class="paste-panel hidden">
      <div class="paste-panel-title">${t('pasteCodeTitle')}</div>
      <textarea id="paste-input" class="paste-input" placeholder="${t('pasteCodePlaceholder')}"></textarea>
      <button id="paste-from-clipboard" class="paste-clipboard-btn">${ICON_CLIPBOARD} ${t('pasteFromClipboard')}</button>
      <button id="paste-confirm" class="paste-confirm-btn">${t('pasteCodeConfirm')}</button>
    </div>
    <div class="nav">
      <button class="pill pill-home" id="nav-to-chat">${t('navHome')}</button>
      <button class="pill pill-scan active">${t('navScan')}</button>
    </div>
  `;
  // Pillola CHAT, stessa funzione del bottone "Indietro" di prima (deve
  // fermare la camera prima di uscire, altrimenti resterebbe accesa in
  // background, lo stesso bug corretto in precedenza su questa schermata)
  $('#nav-to-chat').onclick = () => { stopScanCamera(); screen = 'home'; render(); };

  scanQR($('#scan-video'), (data) => {
    pairWithScannedData(data).catch((e) => alert(t('qrInvalid', e.message)));
  }).then((stop) => { scanCameraStop = stop; })
    .catch((e) => alert(t('cameraUnavailable', e.message)));

  // Alternativa al QR: incolla manualmente il codice ricevuto per un
  // altro canale (chat, email), stesso flusso di pairing, stessa
  // funzione pairWithScannedData già usata dalla scansione camera
  $('#paste-link').onclick = () => {
    $('#paste-panel').classList.toggle('hidden');
  };
  $('#paste-from-clipboard').onclick = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) { alert(t('clipboardEmpty')); return; }
      $('#paste-input').value = text;
    } catch (e) {
      // Permesso negato o API non disponibile (comune su alcuni browser
      // mobile), l'incolla manuale nella textarea resta sempre disponibile,
      // questo bottone è solo una comodità in più, non l'unico modo.
      alert(t('clipboardReadFailed'));
    }
  };
  $('#paste-confirm').onclick = () => {
    const text = $('#paste-input').value.trim();
    if (!text) { alert(t('pasteCodeEmpty')); return; }
    stopScanCamera(); // pairing riuscito via testo, la camera non serve più
    pairWithScannedData(text).catch((e) => alert(t('qrInvalid', e.message)));
  };
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function fmt(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ── Icone SVG a tratto singolo, usano currentColor, niente emoji a colori
// che stonano con l'estetica monocromatica verde (📎🎙⏹ venivano rese a
// colori dal sistema operativo su molti dispositivi).
const ICON_ATTACH = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>`;
const ICON_MIC = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>`;
const ICON_STOP = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>`;
const ICON_SEND = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="13 5 20 12 13 19"/></svg>`;
const ICON_CLIPBOARD = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M9 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-3"/></svg>`;

// ── Effetto titolo "Arcanum", gestito interamente da titleFx.js ─────────────
// (canvas: le lettere sono riempite di codice che scorre + ciclo di
// decodifica). Qui teniamo solo il riferimento alla funzione di stop, da
// richiamare prima di cambiare schermata, altrimenti l'animazione
// resterebbe a girare a vuoto su un canvas che non esiste più nel DOM.
let titleEffectStop = null;

function stopTitleEffect() {
  if (titleEffectStop) { titleEffectStop(); titleEffectStop = null; }
}

// ── Navigazione touch: swipe orizzontale tra le schermate ────────────────────
// Home ⇄ Scan rispecchia le pill HOME/SCAN già esistenti (sono le stesse due
// "schede" mostrate in basso). In Chat, lo swipe verso destra equivale al
// tasto back, stesso gesto standard di "torna indietro" su mobile.
function handleSwipeLeft() {
  if (screen === 'home') { screen = 'scan'; render(); }
}
function handleSwipeRight() {
  if (screen === 'scan') { stopScanCamera(); screen = 'home'; render(); }
  else if (screen === 'chat') { screen = 'home'; currentContact = null; render(); }
}

// ── Avvio ──────────────────────────────────────────────────────────────────────
boot();
startRain();
attachSwipeNav(root, { onSwipeLeft: handleSwipeLeft, onSwipeRight: handleSwipeRight });

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js'));
}
