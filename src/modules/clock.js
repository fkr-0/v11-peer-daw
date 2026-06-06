// PeerModGroove/src/modules/clock.js

import { ModuleBase, PortType, uid } from '../core/contracts.js';
import { escapeHtml } from '../core/html.js';

export class ClockModule extends ModuleBase {
  constructor(config = {}) {
    super({
      id: config.id || uid('clock'),
      title: config.title || 'Transport Clock',
      kind: 'clock',
      inputs: [{ id: 'control', type: PortType.CONTROL }],
      outputs: [{ id: 'clock', type: PortType.CLOCK }],
    });
    this.bpm = config.bpm || 120;
    this.step = 0;
    this.timer = null;
    this._running = false;
  }

  start(context) {
    this.ctx = context;
    this.stop();
    this.step = 0;
    this._running = true;
    this._scheduleTick();
    this.root?.classList.add('running');
  }

  _scheduleTick() {
    if (!this._running) return;
    const interval = (60 / this.bpm / 4) * 1000;
    this.timer = setTimeout(() => {
      this.emitPacket(
        {
          kind: PortType.CLOCK,
          type: 'step',
          step: this.step++,
          bpm: this.bpm,
          at: this.ctx?.currentTime || 0,
        },
        'clock'
      );
      this._scheduleTick();
    }, interval);
  }

  stop() {
    this._running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.root?.classList.remove('running');
  }

  serialize() {
    return {
      ...super.serialize(),
      moduleType: 'clock',
      bpm: this.bpm,
    };
  }

  hydrate(data = {}) {
    this.bpm = Number(data.bpm) || this.bpm;
    this.render();
  }

  render() {
    if (!this.root) return;
    this.root.innerHTML = `
      <div class="module-head"><span>⏱</span><strong>${escapeHtml(this.title)}</strong><small>CLOCK OUT</small></div>
      <label>BPM <input class="mini-input" type="number" min="40" max="260" value="${this.bpm}"></label>
      <p class="microcopy">${this._running ? 'running' : 'stopped'} · emits transport step packets</p>
    `;
    this.root.querySelector('input').addEventListener('input', (e) => {
      this.bpm = Math.max(40, Math.min(260, Number(e.target.value) || 120));
    });
  }
}
