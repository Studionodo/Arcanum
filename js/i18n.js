/**
 * js/i18n.js — Arcanum
 * Internazionalizzazione minimale: dizionario piatto IT/EN, nessuna dipendenza esterna.
 * La lingua scelta persiste in localStorage — è un flag di preferenza UI,
 * non dato sensibile, quindi localStorage (sincrono, semplice) va benissimo
 * a differenza dello stato crittografico che vive in IndexedDB.
 */

const STRINGS = {
  it: {
    appSub:            'Messaggi cifrati · P2P',
    myQr:              'IL MIO QR',
    noContacts:        'Nessun contatto — scansiona un QR per iniziare',
    statusConnected:   'connected',
    statusConnecting:  'connecting',
    statusDisconnected:'disconnesso',
    statusError:       'errore',
    navHome:           'CHAT',
    navScan:           'SCAN',
    writeMessage:      'Scrivi un messaggio…',
    loading:           'caricamento…',
    mediaUnavailable:  'media non disponibile',
    uploading:         (pct) => `Invio in corso… ${pct}%`,
    back:              '← Indietro',
    scanTitle:         'Scansiona',
    handshakeMissing:  'Handshake non completato con questo contatto.',
    peerNotConnected:  'Peer non connesso.',
    sendFailed:        (msg) => `Invio fallito: ${msg}`,
    micUnavailable:    (msg) => `Microfono non disponibile: ${msg}`,
    qrInvalid:         (msg) => `QR non valido: ${msg}`,
    cameraUnavailable: (msg) => `Camera non disponibile: ${msg}`,
    copyCode:          'Copia codice',
    codeCopied:        '✓ Copiato',
    copyFailed:        'Copia non riuscita — prova a selezionare il testo manualmente',
    pasteCode:         'Incolla codice invece',
    pasteCodeTitle:    'Incolla il codice ricevuto',
    pasteCodePlaceholder: 'Incolla qui il codice…',
    pasteCodeConfirm:  'Aggiungi contatto',
    pasteCodeEmpty:    'Nessun codice incollato.',
    safetyNumberTitle: 'Numero di sicurezza',
    safetyNumberHint:  'Confronta questo numero con il tuo contatto di persona o per telefono. Se coincide su entrambi i dispositivi, la connessione è sicura e nessuno si è inserito nello scambio.',
    safetyNumberClose: 'Chiudi',
    noMessagesYet:     'Nessun messaggio — scrivi qualcosa per iniziare',
    mediaPhotoPreview: '📷 Foto',
    mediaAudioPreview: '🎙 Audio',
    pasteFromClipboard: 'Leggi dagli appunti',
    clipboardEmpty:    'Gli appunti sono vuoti.',
    clipboardReadFailed: 'Lettura appunti non riuscita — incolla manualmente nel campo qui sotto.',
  },
  en: {
    appSub:            'Encrypted messages · P2P',
    myQr:              'MY QR',
    noContacts:        'No contacts yet — scan a QR to get started',
    statusConnected:   'connected',
    statusConnecting:  'connecting',
    statusDisconnected:'disconnected',
    statusError:       'error',
    navHome:           'CHAT',
    navScan:           'SCAN',
    writeMessage:      'Write a message…',
    loading:           'loading…',
    mediaUnavailable:  'media unavailable',
    uploading:         (pct) => `Sending… ${pct}%`,
    back:              '← Back',
    scanTitle:         'Scan',
    handshakeMissing:  'Handshake not completed with this contact.',
    peerNotConnected:  'Peer not connected.',
    sendFailed:        (msg) => `Send failed: ${msg}`,
    micUnavailable:    (msg) => `Microphone unavailable: ${msg}`,
    qrInvalid:         (msg) => `Invalid QR: ${msg}`,
    cameraUnavailable: (msg) => `Camera unavailable: ${msg}`,
    copyCode:          'Copy code',
    codeCopied:        '✓ Copied',
    copyFailed:        'Copy failed — try selecting the text manually',
    pasteCode:         'Paste code instead',
    pasteCodeTitle:    'Paste the received code',
    pasteCodePlaceholder: 'Paste the code here…',
    pasteCodeConfirm:  'Add contact',
    pasteCodeEmpty:    'No code pasted.',
    safetyNumberTitle: 'Safety number',
    safetyNumberHint:  'Compare this number with your contact in person or by phone. If it matches on both devices, the connection is secure and no one has intercepted the exchange.',
    safetyNumberClose: 'Close',
    noMessagesYet:     'No messages yet — say something to get started',
    mediaPhotoPreview: '📷 Photo',
    mediaAudioPreview: '🎙 Audio',
    pasteFromClipboard: 'Read from clipboard',
    clipboardEmpty:    'Clipboard is empty.',
    clipboardReadFailed: 'Clipboard read failed — paste manually in the field below.',
  },
};

const STORAGE_KEY = 'arcanum_lang';

function detectDefaultLang() {
  const nav = (navigator.language || 'it').slice(0, 2).toLowerCase();
  return nav === 'en' ? 'en' : 'it'; // default IT per qualsiasi lingua diversa da EN
}

let currentLang = localStorage.getItem(STORAGE_KEY) || detectDefaultLang();

export function getLang() {
  return currentLang;
}

export function setLang(lang) {
  currentLang = lang === 'en' ? 'en' : 'it';
  localStorage.setItem(STORAGE_KEY, currentLang);
  document.documentElement.lang = currentLang;
}

export function toggleLang() {
  setLang(currentLang === 'it' ? 'en' : 'it');
  return currentLang;
}

// t('key') per stringhe statiche, t('key', arg) per le funzioni con parametro
export function t(key, arg) {
  const entry = STRINGS[currentLang][key];
  if (typeof entry === 'function') return entry(arg);
  return entry ?? key;
}

// Applica subito lang all'elemento html al caricamento del modulo
document.documentElement.lang = currentLang;
