// PeerModGroove/src/modules/peer-bridge.js

import { PeernetLobby } from '../../vendor/peernet-lib.js';
import { ModuleBase, PortType, uid } from '../core/contracts.js';
import { escapeAttr, escapeHtml } from '../core/html.js';

export class PeerBridgeModule extends ModuleBase {
  constructor(config = {}) {
    super({
      id: config.id || uid('peer'),
      title: config.title || 'Peer Bridge',
      kind: 'network',
      inputs: [
        { id: 'control', type: PortType.CONTROL },
        { id: 'midi', type: PortType.MIDI },
      ],
      outputs: [
        { id: 'control', type: PortType.CONTROL },
        { id: 'midi', type: PortType.MIDI },
      ],
    });
    this.lobbyId = config.lobbyId || 'peermodgroove-alpha';
    this.lobby = null;
    this.status = config.status || 'offline';
    this.lastPilot = config.lastPilot || 'pilot';
    this.packetLog = Array.isArray(config.packetLog)
      ? config.packetLog.map((packet) => ({ ...packet }))
      : [];
  }

  receive(packet, inputId) {
    this.packetLog.push({ ...packet, inputId, at: Date.now() });
    this.packetLog = this.packetLog.slice(-32);
    this.lobby?.broadcast({ type: 'pmg-packet', inputId, packet });
  }

  serialize() {
    return {
      ...super.serialize(),
      lobbyId: this.lobbyId,
      status: this.status,
      lastPilot: this.lastPilot,
      packetLog: this.packetLog.slice(-32),
    };
  }

  hydrate(data = {}) {
    this.lobbyId = data.lobbyId || this.lobbyId;
    this.status = data.status || this.status;
    this.lastPilot = data.lastPilot || this.lastPilot;
    this.packetLog = Array.isArray(data.packetLog) ? data.packetLog.slice(-32) : this.packetLog;
    this.render();
  }

  async connect(username = 'pilot') {
    this.lastPilot = username;
    this.lobby = new PeernetLobby(this.lobbyId, { debug: false });
    this.lobby.addEventListener('status', (e) => {
      this.status = e.detail.text;
      this.render();
    });
    this.lobby.addEventListener('data', (e) => {
      const data = e.detail.data;
      if (data?.type === 'pmg-packet') this.emitPacket(data.packet, data.inputId || 'control');
    });
    await this.lobby.connect(username);
  }

  render() {
    if (!this.root) return;
    this.root.innerHTML = `
      <div class="module-head"><span>⌁</span><strong>${escapeHtml(this.title)}</strong><small>PEER CONTROL</small></div>
      <input class="mini-input" placeholder="pilot name" value="${escapeAttr(this.lastPilot || 'pilot')}">
      <button class="mini-button">CONNECT</button>
      <p class="microcopy">Status: ${escapeHtml(this.status)}. Broadcasts JSON-safe midi/control packets.</p>
    `;
    this.root
      .querySelector('button')
      .addEventListener('click', () =>
        this.connect(this.root.querySelector('input').value || 'pilot')
      );
  }
}
