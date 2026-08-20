/**
 * js/mutex.js — Arcanum
 *
 * Perché serve: il ratchet crittografico è un read-modify-write sullo stato
 * per-contatto (sendChainKey/recvChainKey). Se due operazioni sullo stesso
 * contatto si sovrappongono (es. due chunk media ricevuti ravvicinati, o un
 * messaggio inviato mentre un media è ancora in trasferimento), entrambe
 * possono leggere lo stesso stato di partenza e derivare la stessa chiave —
 * causando decrypt falliti o desincronizzazione della chain.
 *
 * withContactLock(contactId, fn) garantisce che fn() per un dato contactId
 * venga eseguita solo dopo che ogni fn() precedente sullo stesso contactId
 * è completata. Operazioni su contatti diversi restano indipendenti/parallele.
 */

const queues = new Map(); // contactId → Promise (coda dell'ultima operazione)

export function withContactLock(contactId, fn) {
  const prev = queues.get(contactId) || Promise.resolve();
  const next = prev.then(fn, fn); // esegue fn anche se la precedente ha fallito
  // Evita che la coda cresca all'infinito trattenendo referenze —
  // salva sempre solo l'ultima promise, con errori "silenziati" per il chaining
  // (l'errore reale viene comunque propagato a chi ha chiamato withContactLock)
  queues.set(contactId, next.catch(() => {}));
  return next;
}
