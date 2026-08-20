# Arcanum

Messaggistica peer-to-peer con cifratura end-to-end. Nessun server legge i tuoi
messaggi — non perché promette di non farlo, ma perché non esiste un server
che li vede: i dispositivi comunicano direttamente tra loro.

## Cosa fa

- **Chat cifrata** — testo, foto, audio, tutto cifrato prima di lasciare il telefono
- **Nessun account, nessuna registrazione** — l'identità è una coppia di chiavi
  generata localmente sul dispositivo, mai inviata a nessun server
- **Pairing tramite QR code o codice testuale** — per aggiungere un contatto si
  scambiano le chiavi pubbliche scansionando un QR di persona, oppure copiando
  e incollando un codice testuale su un canale già fidato
- **Numero di sicurezza** — permette di verificare, di persona o per telefono,
  che nessuno si sia inserito nello scambio delle chiavi
- **Forward secrecy** — ogni messaggio usa una chiave diversa, scartata subito
  dopo l'uso: anche se una chiave venisse compromessa in futuro, i messaggi
  passati restano illeggibili
- **Navigazione touch** — swipe orizzontale tra le schermate, oltre ai pulsanti
- **Bilingue** — interfaccia in italiano e inglese, cambio lingua immediato
- **PWA installabile** — funziona da browser, si installa come un'app nativa
  su Android e desktop, aggiornamenti automatici senza passare da uno store

## Cosa NON fa (ancora)

- Non ha una rete mesh — se internet manca, l'app non funziona
- Non ha una VPN integrata
- Non ha un server di backup — se perdi il dispositivo, perdi la cronologia
- La crittografia è un'implementazione custom ispirata a Signal, non la
  libreria ufficiale — vedi la nota tecnica più sotto prima di fidartene
  per comunicazioni realmente sensibili

---

## Stack

- Vanilla JS, nessun bundler, nessun framework — Vercel deploya senza build step
- Crittografia: [libsodium](https://github.com/jedisct1/libsodium.js) via CDN (X25519 + XChaCha20-Poly1305)
- Trasporto: RTCPeerConnection nativo del browser (WebRTC DataChannel)
- Database locale: IndexedDB
- QR: qrcode-generator (encode) + jsQR (decode)

## ⚠️ Nota importante sulla crittografia

Il modulo `js/crypto.js` implementa un **Double Ratchet custom** costruito su
primitive libsodium — **non è la libreria ufficiale libsignal** (quella
sottoposta ad audit di sicurezza indipendenti usata da Signal/WhatsApp).

Replica le proprietà di forward secrecy del Double Ratchet originale, ma:
- non ha subito audit di sicurezza esterni
- gestione semplificata dei messaggi fuori ordine
- da considerare "hobby-grade crittograficamente solido", non "audited production-grade"

Prima di un uso con dati realmente sensibili di terzi, valutare un audit dedicato
o la migrazione a una libreria Signal Protocol ufficiale quando disponibile per browser.

## Deploy — GitHub + Vercel

### 1. Crea il repository

```bash
cd arcanum-pwa
git init
git add .
git commit -m "Arcanum PWA"
git branch -M main
git remote add origin https://github.com/TUO-USERNAME/Arcanum.git
git push -u origin main
```

### 2. Collega Vercel

1. Vai su [vercel.com](https://vercel.com) → **New Project**
2. Importa il repository
3. Framework Preset: **Other** (nessun build step necessario)
4. Deploy

Ogni push su `main` triggera un deploy automatico.

### 3. Prima del primo deploy — aggiorna gli endpoint

Nei file `js/signaling.js` e `js/webrtc.js`, sostituisci:

```js
const RELAY_URL = 'wss://arcanum-relay.fly.dev:4000';
```

con l'URL reale del tuo relay Fly.io dopo il deploy.
**Senza un relay attivo, i dispositivi non trovano modo di scambiarsi l'SDP iniziale
e la connessione P2P non parte.**

Aggiorna anche username/password TURN in `webrtc.js`.

### 4. Icone

Le icone in `/icons/` sono placeholder — genera `icon-192.png`, `icon-512.png`,
`icon-maskable.png` (sfondo pieno, safe zone 80%) prima del deploy definitivo.

## Struttura

```
arcanum-pwa/
├── index.html          entry point
├── manifest.json        PWA manifest
├── sw.js                 service worker (offline caching)
├── vercel.json           config deploy + security headers
├── css/style.css        estetica Matrix phosphor green
├── js/
│   ├── app.js            orchestratore + UI
│   ├── crypto.js         Double Ratchet custom (libsodium) + numero di sicurezza
│   ├── db.js              IndexedDB wrapper
│   ├── media.js           chunking cifrato per foto/audio
│   ├── mutex.js           lock per contatto (previene race condition crypto)
│   ├── webrtc.js         RTCPeerConnection transport
│   ├── signaling.js      WebSocket verso relay Fly.io
│   ├── rain.js            animazione pioggia Matrix di sfondo
│   ├── swipe.js           riconoscimento gesto swipe (Pointer + Touch Events)
│   ├── i18n.js            traduzioni IT/EN interfaccia
│   └── qr.js              generazione/scansione QR
└── icons/                 (da popolare)
```

---
---

# Arcanum (English)

Peer-to-peer messaging with end-to-end encryption. No server reads your
messages — not because it promises not to, but because there is no server
that sees them: devices talk directly to each other.

## What it does

- **Encrypted chat** — text, photos, audio, all encrypted before leaving the phone
- **No account, no registration** — identity is a keypair generated locally
  on the device, never sent to any server
- **Pairing via QR code or text code** — to add a contact, both sides exchange
  public keys either by scanning a QR code in person, or by copying and
  pasting a text code over an already-trusted channel
- **Safety number** — lets you verify, in person or by phone, that no one
  intercepted the key exchange
- **Forward secrecy** — every message uses a different key, discarded right
  after use: even if a key were compromised in the future, past messages
  stay unreadable
- **Touch navigation** — horizontal swipe between screens, in addition to buttons
- **Bilingual** — interface in Italian and English, instant language switch
- **Installable PWA** — runs from the browser, installs like a native app on
  Android and desktop, updates automatically with no app store involved

## What it doesn't do (yet)

- No mesh network — if internet is unavailable, the app doesn't work
- No integrated VPN
- No backup server — lose the device, lose the history
- The encryption is a custom implementation inspired by Signal, not the
  official library — see the technical note below before relying on it
  for truly sensitive communications

---

## Stack

- Vanilla JS, no bundler, no framework — Vercel deploys with zero build step
- Encryption: [libsodium](https://github.com/jedisct1/libsodium.js) via CDN (X25519 + XChaCha20-Poly1305)
- Transport: native browser RTCPeerConnection (WebRTC DataChannel)
- Local database: IndexedDB
- QR: qrcode-generator (encode) + jsQR (decode)

## ⚠️ Important note about the encryption

The `js/crypto.js` module implements a **custom Double Ratchet** built on
libsodium primitives — **it is not the official libsignal library** (the one
that has undergone independent security audits, used by Signal/WhatsApp).

It replicates the forward secrecy properties of the original Double Ratchet, but:
- has not undergone external security audits
- simplified handling of out-of-order messages
- should be considered "hobby-grade cryptographically sound", not "audited production-grade"

Before using it for real sensitive third-party data, consider a dedicated
audit or migrating to an official Signal Protocol library once available for browsers.

## Deploy — GitHub + Vercel

### 1. Create the repository

```bash
cd arcanum-pwa
git init
git add .
git commit -m "Arcanum PWA"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/Arcanum.git
git push -u origin main
```

### 2. Connect Vercel

1. Go to [vercel.com](https://vercel.com) → **New Project**
2. Import the repository
3. Framework Preset: **Other** (no build step needed)
4. Deploy

Every push to `main` triggers an automatic deploy.

### 3. Before the first deploy — update the endpoints

In `js/signaling.js` and `js/webrtc.js`, replace:

```js
const RELAY_URL = 'wss://arcanum-relay.fly.dev:4000';
```

with your real Fly.io relay URL after deploying it.
**Without an active relay, devices have no way to exchange the initial SDP
and the P2P connection never starts.**

Also update the TURN username/password in `webrtc.js`.

### 4. Icons

The icons in `/icons/` are placeholders — generate `icon-192.png`, `icon-512.png`,
`icon-maskable.png` (solid background, 80% safe zone) before the final deploy.

## Structure

```
arcanum-pwa/
├── index.html          entry point
├── manifest.json        PWA manifest
├── sw.js                 service worker (offline caching)
├── vercel.json           deploy config + security headers
├── css/style.css        Matrix phosphor green aesthetic
├── js/
│   ├── app.js            orchestrator + UI
│   ├── crypto.js         custom Double Ratchet (libsodium) + safety number
│   ├── db.js              IndexedDB wrapper
│   ├── media.js           encrypted chunking for photos/audio
│   ├── mutex.js           per-contact lock (prevents crypto race conditions)
│   ├── webrtc.js         RTCPeerConnection transport
│   ├── signaling.js      WebSocket to the Fly.io relay
│   ├── rain.js            background Matrix rain animation
│   ├── swipe.js           swipe gesture recognition (Pointer + Touch Events)
│   ├── i18n.js            IT/EN interface translations
│   └── qr.js              QR generation/scanning
└── icons/                 (to be filled in)
```
