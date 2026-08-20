# Arcanum

Messaggistica peer-to-peer con cifratura end-to-end. Nessun server legge i tuoi
messaggi: non perché promette di non farlo, ma perché non esiste un server
che li vede. I dispositivi comunicano direttamente tra loro.

## Cosa fa

- **Chat cifrata**: testo, foto, audio, tutto cifrato prima di lasciare il telefono.
- **Nessun account, nessuna registrazione**: l'identità è una coppia di chiavi
  generata localmente sul dispositivo, mai inviata a nessun server.
- **Pairing tramite QR code o codice testuale**: per aggiungere un contatto si
  scambiano le chiavi pubbliche scansionando un QR di persona, oppure copiando
  e incollando un codice testuale su un canale già fidato.
- **Numero di sicurezza**: permette di verificare, di persona o per telefono,
  che nessuno si sia inserito nello scambio delle chiavi.
- **Forward secrecy**: ogni messaggio usa una chiave diversa, scartata subito
  dopo l'uso. Anche se una chiave venisse compromessa in futuro, i messaggi
  passati resterebbero illeggibili.
- **Interfaccia bilingue**: italiano e inglese, cambio lingua immediato.
- **PWA installabile**: funziona da browser, si installa come un'app nativa
  su Android e desktop, con aggiornamenti automatici senza passare da uno store.

---

## La crittografia

Arcanum non è fatto da una multinazionale, ma la crittografia che usa è
tutt'altro che amatoriale. Le fondamenta sono le stesse di applicazioni usate
da centinaia di milioni di persone.

- **X25519** per lo scambio di chiavi: la stessa curva ellittica usata da
  Signal, WhatsApp, iMessage.
- **XChaCha20-Poly1305** per la cifratura autenticata dei messaggi: un
  cifrario moderno, veloce e resistente, scelto da Google per Android e da
  molti protocolli di rete recenti.
- **Double Ratchet** per la forward secrecy: la stessa tecnica usata da
  Signal, in cui ogni messaggio ha una chiave propria, scartata subito dopo
  l'uso.

Queste primitive crittografiche (X25519, XChaCha20-Poly1305) sono implementate
da [libsodium](https://github.com/jedisct1/libsodium.js), una libreria open
source ampiamente verificata e usata in produzione da migliaia di progetti.
La logica del ratchet che le orchestra è invece un'implementazione originale
di questo progetto: replica correttamente le proprietà di forward secrecy del
protocollo Signal, ma, a differenza della libreria ufficiale libsignal, non
ha ancora ricevuto un audit di sicurezza indipendente dedicato. Le fondamenta
sono solide; la costruzione sopra è nuova.

## Stack tecnico

Vanilla JavaScript, nessun framework. PWA installabile con crittografia
end-to-end via libsodium, trasporto diretto peer-to-peer via WebRTC, archivio
locale in IndexedDB.

---
---

# Arcanum (English)

Peer-to-peer messaging with end-to-end encryption. No server reads your
messages, not because it promises not to, but because there is no server
that sees them. Devices talk directly to each other.

## What it does

- **Encrypted chat**: text, photos, audio, all encrypted before leaving the phone.
- **No account, no registration**: identity is a keypair generated locally
  on the device, never sent to any server.
- **Pairing via QR code or text code**: to add a contact, both sides exchange
  public keys either by scanning a QR code in person, or by copying and
  pasting a text code over an already trusted channel.
- **Safety number**: lets you verify, in person or by phone, that no one
  intercepted the key exchange.
- **Forward secrecy**: every message uses a different key, discarded right
  after use. Even if a key were compromised in the future, past messages
  would stay unreadable.
- **Bilingual interface**: Italian and English, instant language switch.
- **Installable PWA**: runs from the browser, installs like a native app on
  Android and desktop, with automatic updates and no app store involved.

---

## The cryptography

Arcanum isn't built by a large company, but the cryptography behind it is
far from amateur. Its foundations are the same ones used by applications
relied on by hundreds of millions of people.

- **X25519** for key exchange: the same elliptic curve used by Signal,
  WhatsApp, iMessage.
- **XChaCha20-Poly1305** for authenticated message encryption: a modern,
  fast, resilient cipher, chosen by Google for Android and by many recent
  network protocols.
- **Double Ratchet** for forward secrecy: the same technique used by Signal,
  in which every message has its own key, discarded immediately after use.

These cryptographic primitives (X25519, XChaCha20-Poly1305) are implemented
by [libsodium](https://github.com/jedisct1/libsodium.js), a widely reviewed
open source library used in production by thousands of projects. The ratchet
logic that orchestrates them is instead an original implementation built for
this project. It correctly replicates the forward secrecy properties of the
Signal protocol, but, unlike the official libsignal library, it hasn't yet
received a dedicated independent security audit. The foundations are solid;
the construction on top of them is new.

## Tech stack

Vanilla JavaScript, no framework. Installable PWA with end-to-end encryption
via libsodium, direct peer-to-peer transport via WebRTC, local storage in
IndexedDB.
