/**
 * js/rain.js — Arcanum
 * Pioggia di caratteri stile Matrix sullo sfondo. Vive su un canvas separato
 * da #app (vedi index.html) — così sopravvive ai re-render innerHTML delle
 * schermate invece di riavviarsi ad ogni cambio view.
 *
 * v1.2.2 — riscritto su richiesta esplicita:
 * - PRIMA: formula zonale rendeva il centro schermo quasi invisibile
 *   (opacità ~0.02 dal 30% al 70% della larghezza) — ora uniforme su
 *   tutta la larghezza. Le card/pannelli restano sopra grazie ai loro
 *   sfondi opachi esistenti (z-index invariato, nessuna modifica lì).
 * - PRIMA: ogni colonna riavviava quasi subito al fondo (2.5%/frame,
 *   nessuna vera pausa) — sembrava una tenda uniforme sincronizzata.
 *   ORA: ogni colonna ha uno stato di pausa reale (0.5-3.5s, indipendente
 *   dalle altre) — pioggia intermittente e organica, non tutta insieme.
 */

export const CHARS = 'アイウエオカキクケコサシスセソタチナニヌネノハヒフヘホ0123456789ABCDEF│╣║╗╝┼╚╔╩╦╠═╬';

export function startRain() {
  const canvas = document.getElementById('rain-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  function resize() {
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  const COL_WIDTH = 16;
  function colCount() { return Math.floor(canvas.width / COL_WIDTH); }

  // Ogni colonna: { y, restUntil } — restUntil=0 significa "sta cadendo",
  // un timestamp futuro significa "in pausa fino a quel momento".
  // Alcune colonne partono già in pausa (stagger iniziale), così non
  // iniziano tutte a cadere nello stesso istante al boot.
  function newDrop() {
    const startsResting = Math.random() < 0.5;
    return {
      y: Math.random() * -60,
      restUntil: startsResting ? performance.now() + Math.random() * 4000 : 0,
    };
  }
  let drops = Array.from({ length: colCount() }, newDrop);

  function draw() {
    ctx.fillStyle = 'rgba(0,0,0,0.06)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const n = colCount();
    if (drops.length !== n) {
      drops = Array.from({ length: n }, (_, i) => drops[i] || newDrop());
    }

    const now = performance.now();

    for (let i = 0; i < n; i++) {
      const d = drops[i];

      // Colonna in pausa — non disegna nulla finché non scade il timer
      if (d.restUntil) {
        if (now < d.restUntil) continue;
        d.restUntil = 0;
        d.y = Math.random() * -40; // pausa finita, riparte dall'alto
      }

      if (d.y < 0) { d.y += 0.4 + Math.random() * 0.3; continue; }

      const ch = CHARS[Math.floor(Math.random() * CHARS.length)];
      const x = i * COL_WIDTH + 2;
      const yPx = d.y * 16;

      // Opacità organica uniforme su tutta la larghezza (niente più
      // fade zonale) + occasionale carattere "brillante" in evidenza
      const bright = Math.random() < 0.07;
      ctx.font = `${11 + (i % 4)}px 'Share Tech Mono', monospace`;
      if (bright) {
        ctx.fillStyle = 'rgba(210,255,220,0.95)';
        ctx.shadowColor = '#00ff41';
        ctx.shadowBlur = 6;
      } else {
        const op = 0.26 + Math.random() * 0.32;
        ctx.fillStyle = `rgba(0,255,65,${op})`;
        ctx.shadowBlur = 0;
      }
      ctx.fillText(ch, x, yPx);
      ctx.shadowBlur = 0;

      d.y += 0.55 + (i % 5) * 0.06;

      if (yPx > canvas.height) {
        // Al fondo: 40% riparte subito (raffica breve), 60% va in pausa reale
        if (Math.random() < 0.4) {
          d.y = Math.random() * -40;
        } else {
          d.restUntil = now + 500 + Math.random() * 3000;
        }
      }
    }

    requestAnimationFrame(draw);
  }

  draw();
}

