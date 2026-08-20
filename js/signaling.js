/**
 * js/signaling.js — Arcanum
 * Porta web di SignalingService.js — stesso protocollo, stesso relay Fly.io.
 * IMPORTANTE: aggiorna RELAY_URL con il tuo endpoint reale dopo il deploy.
 */

const RELAY_URL = 'wss://arcanum-relay.fly.dev:4000';
const RECONNECT_DELAY_BASE = 3000;
const RECONNECT_DELAY_MAX = 30000;

class SignalingService {
  constructor() {
    this.ws = null;
    this.deviceId = null;
    this.connected = false;
    this._reconnectTimer = null;
    this._reconnectAttempts = 0; // AUDIT: prima riprovava ogni 3s per sempre,
    // senza backoff né limite — nessuna chiamata a disconnect() esiste da
    // nessuna parte nell'app, quindi il loop non si fermava mai finché il
    // tab restava aperto. Con il relay non ancora deployato, ogni utente
    // che apre l'app oggi genera un tentativo fallito ogni 3s all'infinito.

    this.onOffer     = null; // (fromId, sdp) => void
    this.onAnswer    = null; // (fromId, sdp) => void
    this.onConnected = null;
    this.onError     = null;
  }

  connect(deviceId) {
    this.deviceId = deviceId;
    return new Promise((resolve) => this._open(resolve));
  }

  _open(onReady) {
    if (this.ws) { onReady?.(); return; }

    try {
      this.ws = new WebSocket(RELAY_URL);

      this.ws.onopen = () => {
        this.connected = true;
        this._reconnectAttempts = 0; // connessione riuscita — azzera il backoff
        this._send({ type: 'register', deviceId: this.deviceId });
        this.onConnected?.();
        onReady?.();
      };

      this.ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === 'offer')  this.onOffer?.(msg.from, msg.sdp);
          if (msg.type === 'answer') this.onAnswer?.(msg.from, msg.sdp);
        } catch (err) {
          console.warn('[Signaling] parse error', err);
        }
      };

      this.ws.onerror = (err) => {
        console.warn('[Signaling] WS error', err);
        this.onError?.(err);
        onReady?.(); onReady = null;
      };

      this.ws.onclose = () => {
        this.connected = false;
        this.ws = null;
        onReady?.(); onReady = null;
        const delay = Math.min(RECONNECT_DELAY_BASE * (2 ** this._reconnectAttempts), RECONNECT_DELAY_MAX);
        this._reconnectAttempts++;
        this._reconnectTimer = setTimeout(() => {
          if (this.deviceId) this._open();
        }, delay);
      };
    } catch (e) {
      console.warn('[Signaling] connect failed', e);
      onReady?.();
    }
  }

  sendOffer(toId, sdp)  { this._send({ type: 'offer',  to: toId, sdp }); }
  sendAnswer(toId, sdp) { this._send({ type: 'answer', to: toId, sdp }); }

  _send(obj) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  disconnect() {
    clearTimeout(this._reconnectTimer);
    this.deviceId = null;
    this.ws?.close();
    this.ws = null;
  }
}

export default new SignalingService();
