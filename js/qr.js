/**
 * js/qr.js: Arcanum
 * Generazione QR: qrcode-generator (leggerissima, no dipendenze)
 * Scansione QR: jsQR + getUserMedia
 */

import qrGen from 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/+esm';
import jsQR from 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/+esm';

export function renderQR(text, size = 220) {
  const qr = qrGen(0, 'M');
  qr.addData(text);
  qr.make();
  const cellSize = Math.floor(size / qr.getModuleCount());
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = cellSize * qr.getModuleCount();
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#00ff41';
  for (let r = 0; r < qr.getModuleCount(); r++) {
    for (let c = 0; c < qr.getModuleCount(); c++) {
      if (qr.isDark(r, c)) ctx.fillRect(c * cellSize, r * cellSize, cellSize, cellSize);
    }
  }
  return canvas;
}

// Avvia la camera e chiama onResult(text) al primo QR trovato.
// Ritorna una funzione stop() per fermare lo stream.
export async function scanQR(videoEl, onResult) {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
  videoEl.srcObject = stream;
  await videoEl.play();

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  let stopped = false;

  function tick() {
    if (stopped) return;
    if (videoEl.readyState === videoEl.HAVE_ENOUGH_DATA) {
      canvas.width = videoEl.videoWidth;
      canvas.height = videoEl.videoHeight;
      ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height);
      if (code) { onResult(code.data); stop(); return; }
    }
    requestAnimationFrame(tick);
  }

  function stop() {
    stopped = true;
    stream.getTracks().forEach((t) => t.stop());
  }

  tick();
  return stop;
}
