// PeerModGroove/src/modules/clock.js

import { ModuleBase, PortType, uid } from '../core/contracts.js';

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
  }

  start(context) {
    this.ctx = context;
    this.stop();
    const interval = (60 / this.bpm / 4) * 1000;
    this.timer = setInterval(() => {
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
    }, interval);
    this.root?.classList.add('running');
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
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
      <div class="module-head"><span>⏱</span><strong>${this.title}</strong><small>CLOCK OUT</small></div>
      <label>BPM <input class="mini-input" type="number" min="40" max="260" value="${this.bpm}"></label>
      <p class="microcopy">No input required. Emits transport step packets.</p>
    `;
    this.root.querySelector('input').addEventListener('change', (e) => {
      this.bpm = Number(e.target.value) || 120;
    });
  }
}
