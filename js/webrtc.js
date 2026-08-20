/**
 * js/webrtc.js: Arcanum
 * Wrapper su RTCPeerConnection nativo del browser (no simple-peer, non serve in web).
 * Stessa interfaccia concettuale di TransportLayer.js WebRTCTransport.
 */

const ICE_SERVERS = [
  {
    urls: ['stun:arcanum-relay.fly.dev:3478', 'turn:arcanum-relay.fly.dev:3478'],
    username: 'arcanum',
    credential: 'CAMBIA_QUESTA_PASSWORD',
  },
];

export class WebRTCTransport {
  constructor() {
    this.peers = new Map(); // deviceId → { pc, channel }
    this.onData   = null;
    this.onStatus = null;
    this.onSignal = null;
  }

  connect(device) {
    if (this.peers.has(device.id)) return;
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const channel = pc.createDataChannel('arcanum');
    this._bind(pc, channel, device);
    this.peers.set(device.id, { pc, channel });
    this.onStatus?.(device.id, 'connecting');

    pc.onnegotiationneeded = async () => {
      // AUDIT: nessuna gestione errori qui prima, se createOffer/
      // setLocalDescription falliva (stato di segnalazione inatteso,
      // rinegoziazione concorrente), diventava una promise rejection
      // silenziosa: la connessione restava bloccata senza che l'utente
      // vedesse alcun feedback, nessun modo di capire cosa fosse successo.
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
      } catch (e) {
        console.warn('[WebRTC] negotiation error', e.message);
        this.onStatus?.(device.id, 'error');
      }
    };
    pc.onicecandidate = (e) => {
      if (e.candidate === null) {
        // ICE gathering completo, invia l'intero SDP (trickle:false equivalente)
        this.onSignal?.(device.id, pc.localDescription);
      }
    };
  }

  async accept(device, remoteSdp) {
    let entry = this.peers.get(device.id);
    let pc, channel;

    if (!entry) {
      pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      pc.ondatachannel = (e) => {
        channel = e.channel;
        this._bindChannel(channel, device);
      };
      pc.onicecandidate = (e) => {
        if (e.candidate === null) this.onSignal?.(device.id, pc.localDescription);
      };
      entry = { pc, channel: null };
      this.peers.set(device.id, entry);
      this.onStatus?.(device.id, 'connecting');
    } else {
      pc = entry.pc;
    }

    // AUDIT: stesso problema di onnegotiationneeded, un SDP malformato o
    // uno stato di segnalazione inatteso (es. offer/answer fuori ordine)
    // lanciava un'eccezione mai catturata, lasciando il pairing bloccato
    // senza nessun segnale visibile per l'utente.
    try {
      if (remoteSdp.type === 'offer') {
        await pc.setRemoteDescription(remoteSdp);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
      } else if (remoteSdp.type === 'answer') {
        await pc.setRemoteDescription(remoteSdp);
      }
    } catch (e) {
      console.warn('[WebRTC] accept/SDP error', e.message);
      this.onStatus?.(device.id, 'error');
    }
  }

  send(deviceId, data) {
    const entry = this.peers.get(deviceId);
    if (!entry?.channel || entry.channel.readyState !== 'open') return false;
    try { entry.channel.send(data); return true; }
    catch (e) { console.warn('[WebRTC] send error', e.message); return false; }
  }

  disconnect(deviceId) {
    const entry = this.peers.get(deviceId);
    entry?.channel?.close();
    entry?.pc?.close();
    this.peers.delete(deviceId);
  }

  disconnectAll() {
    [...this.peers.keys()].forEach((id) => this.disconnect(id));
  }

  isConnected(deviceId) {
    return this.peers.get(deviceId)?.channel?.readyState === 'open';
  }

  _bind(pc, channel, device) {
    this._bindChannel(channel, device);
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        this.onStatus?.(device.id, 'error');
        this.peers.delete(device.id);
      }
    };
  }

  _bindChannel(channel, device) {
    const entry = this.peers.get(device.id);
    if (entry) entry.channel = channel;

    channel.onopen = () => this.onStatus?.(device.id, 'connected');
    channel.onmessage = (e) => this.onData?.(device.id, e.data);
    channel.onclose = () => {
      this.onStatus?.(device.id, 'disconnected');
      this.peers.delete(device.id);
    };
  }
}
