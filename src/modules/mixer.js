// PeerModGroove/src/modules/mixer.js

import { ModuleBase, PortType, uid } from '../core/contracts.js';

export class MixerModule extends ModuleBase {
  constructor(runtime, config = {}) {
    super({
      id: config.id || uid('mixer'),
      title: config.title || 'Central Mixer',
      kind: 'mixer',
      inputs: [
        { id: 'audio', type: PortType.AUDIO },
        { id: 'control', type: PortType.CONTROL },
      ],
      outputs: [{ id: 'audio', type: PortType.AUDIO }],
    });
    this.runtime = runtime;
  }

  get destination() {
    return this.runtime?.destination || null;
  }

  render() {
    if (!this.root) return;
    this.root.innerHTML = `
      <div class="module-head"><span>▤</span><strong>${this.title}</strong><small>AUDIO SUM</small></div>
      <label>Master <input type="range" min="0" max="100" value="80" class="mini-input"></label>
      <p class="microcopy">Default sum bus. Submix modules may coexist and feed this master.</p>
    `;
    this.root.querySelector('input').addEventListener('input', (e) => {
      this.runtime?.setMasterVolume?.(Number(e.target.value) / 100);
    });
  }
}
