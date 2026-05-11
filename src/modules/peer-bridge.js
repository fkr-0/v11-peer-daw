// PeerModGroove/src/modules/peer-bridge.js

import { PeernetLobby } from '../../vendor/peernet-lib.js';
import { ModuleBase, PortType, uid } from '../core/contracts.js';

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
    this.status = 'offline';
  }

  receive(packet, inputId) {
    this.lobby?.broadcast({ type: 'pmg-packet', inputId, packet });
  }

  async connect(username = 'pilot') {
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
      <div class="module-head"><span>⌁</span><strong>${this.title}</strong><small>PEER CONTROL</small></div>
      <input class="mini-input" placeholder="pilot name" value="pilot">
      <button class="mini-button">CONNECT</button>
      <p class="microcopy">Status: ${this.status}. Broadcasts JSON-safe midi/control packets.</p>
    `;
    this.root
      .querySelector('button')
      .addEventListener('click', () =>
        this.connect(this.root.querySelector('input').value || 'pilot')
      );
  }
}
