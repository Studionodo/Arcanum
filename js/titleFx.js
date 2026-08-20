/**
 * js/titleFx.js: Arcanum
 *
 * Effetto titolo, due cose insieme, non una al posto dell'altra:
 * 1) Le lettere sono SEMPRE riempite da righe di codice Matrix che
 *    scorrono al loro interno (canvas + destination-in sulla sagoma).
 * 2) Il ciclo di decodifica esistente resta: periodicamente il testo si
 *    "scrambla" in caratteri casuali e si rivela di nuovo da sinistra a
 *    destra, ma anche durante quel ciclo, ogni carattere (vero o ancora
 *    scramblato) è comunque riempito dallo stesso codice che scorre.
 */

import { CHARS } from './rain.js';

function randomChar() { return CHARS[Math.floor(Math.random() * CHARS.length)]; }

export function startTitleEffect(canvasId, realText) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return () => {};
  const ctx = canvas.getContext('2d');

  // Font monospace per entrambi (sagoma del testo e codice che scorre),
  // così la larghezza dei caratteri non cambia durante il ciclo di
  // decodifica (un font proporzionale farebbe "saltare" il canvas ad ogni
  // carattere sostituito, monospace evita il problema).
  const TEXT_FONT = `800 26px 'Share Tech Mono', monospace`;
  const CODE_FONT = `12px 'Share Tech Mono', monospace`;

  ctx.font = TEXT_FONT;
  const width = Math.ceil(ctx.measureText(realText).width) + 6;
  const height = 36;
  canvas.width = width;
  canvas.height = height;

  const CELL_W = 7;
  const CELL_H = 10;
  let scrollOffset = 0;

  // ── Stato del ciclo di decodifica, determina la sagoma corrente ────────────
  let maskText = realText.split('').map(() => randomChar()).join('');
  let lockedUpTo = -1;
  let decodeInterval = null;
  let decodePause = null;

  function runDecodeCycle() {
    lockedUpTo = -1;
    decodeInterval = setInterval(() => {
      if (lockedUpTo >= realText.length - 1) {
        clearInterval(decodeInterval);
        decodeInterval = null;
        maskText = realText;
        decodePause = setTimeout(runDecodeCycle, 2400 + Math.random() * 2200);
        return;
      }
      lockedUpTo++;
      maskText = realText
        .split('')
        .map((ch, i) => (ch === ' ' || i <= lockedUpTo) ? ch : randomChar())
        .join('');
    }, 65);
  }
  let startDelay = setTimeout(runDecodeCycle, 1200);

  // ── Disegno: codice che scorre, mascherato dalla sagoma corrente ────────────
  let raf;
  function draw() {
    ctx.clearRect(0, 0, width, height);

    ctx.globalCompositeOperation = 'source-over';
    ctx.font = CODE_FONT;
    ctx.fillStyle = 'rgba(0,255,65,0.95)';
    // Griglia densa che copre l'intera area, non un carattere sparso per
    // colonna (quello produceva una "pioggia" troppo rada, illeggibile
    // dentro sagome piccole come le lettere di un titolo). Scorre
    // verticalmente nel tempo per restare "viva".
    const rows = Math.ceil(height / CELL_H) + 2;
    const gridCols = Math.ceil(width / CELL_W) + 1;
    for (let r = -1; r < rows; r++) {
      const y = r * CELL_H + (scrollOffset % CELL_H);
      for (let c = 0; c < gridCols; c++) {
        ctx.fillText(randomChar(), c * CELL_W, y);
      }
    }
    scrollOffset += 1.2;

    ctx.globalCompositeOperation = 'destination-in';
    ctx.font = TEXT_FONT;
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'middle';
    ctx.fillText(maskText, 2, height / 2 + 1);

    ctx.globalCompositeOperation = 'source-over';
    raf = requestAnimationFrame(draw);
  }
  draw();

  return function stop() {
    cancelAnimationFrame(raf);
    clearInterval(decodeInterval);
    clearTimeout(decodePause);
    clearTimeout(startDelay);
  };
}

