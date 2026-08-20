/**
 * js/swipe.js — Arcanum
 *
 * Riconoscimento swipe orizzontale. Ascolta SIA Pointer Events SIA i Touch
 * Events nativi, non solo i primi — trovato con un vero banco di prova in
 * Chromium headless che in quel contesto sintetizzava pointerdown/pointermove
 * ma MAI pointerup da un gesto touch (touchend nativo invece arrivava
 * regolarmente). Coprire entrambe le famiglie evita che lo swipe si rompa
 * silenziosamente su browser/versioni con la stessa sintesi incompleta.
 *
 * La decisione "è uno swipe orizzontale o uno scroll verticale?" è isolata
 * in funzioni pure (resolveLock, isSwipeTriggered) — testabili senza bisogno
 * di un vero touchscreen o browser.
 *
 * Regole:
 * - direction-lock: i primi ~12px di movimento decidono se il gesto è
 *   orizzontale o verticale. Una volta deciso verticale, lo swipe viene
 *   ignorato per tutta la durata del gesto — non interferisce mai con lo
 *   scroll di .messages o .contact-list.
 * - soglia minima 70px orizzontali per considerare il gesto uno swipe
 *   intenzionale, non un tocco accidentale.
 * - elementi interattivi (input, audio, bottoni icona) sono esclusi in
 *   partenza — uno swipe che inizia lì non viene mai intercettato.
 * - se sia Pointer Events che Touch Events fanno partire un gesto (capita
 *   su alcuni browser), solo la prima famiglia rilevata viene seguita fino
 *   alla fine — evita doppio triggering dello stesso swipe.
 */

const DIRECTION_LOCK_PX = 12;
const SWIPE_THRESHOLD_PX = 70;
// 'video' non è nell'ignore-list: l'unico elemento <video> dell'app è
// l'anteprima camera nella schermata Scan, SENZA controlli nativi
// (nessuna barra di scrubbing da proteggere) — escluderlo qui impediva
// per errore lo swipe-per-uscire su quella schermata, dove il video
// riempie quasi tutto lo schermo. 'audio' resta escluso perché i
// messaggi vocali IN CHAT hanno davvero una barra di scrubbing nativa
// da proteggere da uno swipe accidentale.
// AUDIT: 'button' e '.icon-btn' erano nella lista ma sono ridondanti E
// dannosi — bloccavano lo swipe partendo da QUALSIASI bottone (righe
// contatto, pillole, icone), che coprono gran parte della superficie
// toccabile dell'app. La protezione è già garantita dal direction-lock
// (12px) + soglia minima (70px): un tap normale non muove mai abbastanza
// da bloccarsi su 'h', quindi il click del bottone funziona comunque senza
// bisogno di escluderlo esplicitamente. Restano esclusi solo gli elementi
// con un vero comportamento di trascinamento orizzontale nativo da
// proteggere (cursore di testo, barra di scrubbing audio).
const IGNORE_SELECTOR = 'input, textarea, audio';

// ── Logica pura, testabile senza DOM ──────────────────────────────────────────
export function resolveLock(dx, dy) {
  if (Math.abs(dx) < DIRECTION_LOCK_PX && Math.abs(dy) < DIRECTION_LOCK_PX) return null; // non ancora deciso
  return Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
}

export function isSwipeTriggered(dx) {
  if (dx <= -SWIPE_THRESHOLD_PX) return 'left';
  if (dx >= SWIPE_THRESHOLD_PX) return 'right';
  return null;
}

// Estrae {x, y} sia da PointerEvent (clientX/clientY diretti) sia da
// TouchEvent (touches per start/move, changedTouches per end/cancel)
function getPoint(e) {
  if (e.touches && e.touches.length) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
  if (e.changedTouches && e.changedTouches.length) return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
  return { x: e.clientX, y: e.clientY };
}

// ── Wiring DOM ─────────────────────────────────────────────────────────────────
export function attachSwipeNav(el, { onSwipeLeft, onSwipeRight } = {}) {
  if (!el) return () => {};

  let startX = 0, startY = 0, tracking = false, locked = null, activeFamily = null;

  function begin(e, family) {
    if (tracking) return; // un gesto è già in corso (l'altra famiglia di eventi)
    if (e.target.closest(IGNORE_SELECTOR)) return;
    const p = getPoint(e);
    startX = p.x; startY = p.y;
    tracking = true; locked = null; activeFamily = family;
  }

  function move(e, family) {
    if (!tracking || family !== activeFamily) return;
    const p = getPoint(e);
    const dx = p.x - startX, dy = p.y - startY;
    if (locked === null) locked = resolveLock(dx, dy);
    if (locked === 'h' && e.cancelable) e.preventDefault();
  }

  function end(e, family) {
    if (!tracking || family !== activeFamily) return;
    tracking = false;
    if (locked !== 'h') return;
    const p = getPoint(e);
    const dx = p.x - startX;
    const dir = isSwipeTriggered(dx);
    if (dir === 'left') onSwipeLeft?.();
    if (dir === 'right') onSwipeRight?.();
  }

  function cancel() { tracking = false; locked = null; activeFamily = null; }

  const onPointerDown = (e) => {
    // FIX (trovato con banco di prova reale): preventDefault() su un
    // PointerEvent non blocca lo scroll nativo del touch — solo
    // preventDefault() sul TouchEvent vero lo fa. Se il pointer event
    // viene da un dito (pointerType 'touch'), lo ignoriamo qui e lasciamo
    // che siano touchstart/touchmove/touchend a gestire il gesto per
    // intero — sono gli unici in grado di bloccare davvero lo scroll.
    // I Pointer Events restano usati solo per mouse/pen.
    if (e.pointerType === 'touch') return;
    begin(e, 'pointer');
  };
  const onPointerMove = (e) => move(e, 'pointer');
  const onPointerUp   = (e) => end(e, 'pointer');
  const onTouchStart  = (e) => begin(e, 'touch');
  const onTouchMove   = (e) => move(e, 'touch');
  const onTouchEnd    = (e) => end(e, 'touch');

  el.addEventListener('pointerdown', onPointerDown, { passive: true });
  el.addEventListener('pointermove', onPointerMove, { passive: false });
  el.addEventListener('pointerup', onPointerUp, { passive: true });
  el.addEventListener('pointercancel', cancel, { passive: true });
  el.addEventListener('touchstart', onTouchStart, { passive: true });
  el.addEventListener('touchmove', onTouchMove, { passive: false });
  el.addEventListener('touchend', onTouchEnd, { passive: true });
  el.addEventListener('touchcancel', cancel, { passive: true });

  return function detach() {
    el.removeEventListener('pointerdown', onPointerDown);
    el.removeEventListener('pointermove', onPointerMove);
    el.removeEventListener('pointerup', onPointerUp);
    el.removeEventListener('pointercancel', cancel);
    el.removeEventListener('touchstart', onTouchStart);
    el.removeEventListener('touchmove', onTouchMove);
    el.removeEventListener('touchend', onTouchEnd);
    el.removeEventListener('touchcancel', cancel);
  };
}
