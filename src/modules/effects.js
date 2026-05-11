// PeerModGroove/src/modules/effects.js
import { ModuleBase, PortType, uid } from '../core/contracts.js';

class EffectModule extends ModuleBase {
  constructor({ id, title, kind = 'audio-effect' }) {
    super({
      id,
      title,
      kind,
      inputs: [
        { id: 'audio', type: PortType.AUDIO },
        { id: 'control', type: PortType.CONTROL },
      ],
      outputs: [{ id: 'audio', type: PortType.AUDIO }],
    });
    this.input = null;
    this.output = null;
  }
  async start(context) {
    this.ctx = context;
    if (!this.input) {
      this.input = this.ctx.createGain();
      this.output = this.ctx.createGain();
      this.build?.();
    }
  }
  connectAudio(dest) {
    if (this.output && dest) this.output.connect(dest);
  }
  disconnectAudio() {
    try {
      this.output?.disconnect();
    } catch (_) {}
  }
  receive(packet) {
    if (packet.kind === PortType.CONTROL && packet.type === 'param' && packet.target in this) {
      this[packet.target] = Number(packet.value);
      this.applyParams?.();
      this.render();
    }
  }
  render() {
    if (!this.root) return;
    const params = this.params || [];
    this.root.innerHTML = `<div class="module-head"><span>✦</span><strong>${this.title}</strong><small>AUDIO EFFECT</small></div><div class="effect-rack">${params.map((p) => `<label>${p.label}<input class="mini-input" type="range" min="${p.min}" max="${p.max}" step="${p.step}" value="${this[p.key]}" data-param="${p.key}"></label>`).join('')}</div><p class="microcopy">${this.description || 'WebAudio effect module.'}</p>`;
    this.root.querySelectorAll('[data-param]').forEach(
      (el) =>
        (el.oninput = (e) => {
          this[e.target.dataset.param] = Number(e.target.value);
          this.applyParams?.();
        })
    );
  }
}

export class DubEchoModule extends EffectModule {
  constructor(c = {}) {
    super({ id: c.id || uid('dubecho'), title: c.title || 'Dub Echo' });
    this.description = 'Feedback delay with filtered repeats.';
    this.feedback = 0.52;
    this.wet = 0.45;
    this.params = [
      { key: 'feedback', label: 'Feedback ', min: 0, max: 0.95, step: 0.01 },
      { key: 'wet', label: 'Wet ', min: 0, max: 1, step: 0.01 },
    ];
  }
  build() {
    const d = this.ctx.createDelay(2),
      fb = this.ctx.createGain(),
      f = this.ctx.createBiquadFilter(),
      wet = this.ctx.createGain();
    d.delayTime.value = 0.38;
    fb.gain.value = 0.52;
    f.type = 'lowpass';
    f.frequency.value = 1800;
    wet.gain.value = 0.45;
    this.input.connect(this.output);
    this.input.connect(d);
    d.connect(f);
    f.connect(fb);
    fb.connect(d);
    d.connect(wet);
    wet.connect(this.output);
  }
}
export class ReverbModule extends EffectModule {
  constructor(c = {}) {
    super({ id: c.id || uid('reverb'), title: c.title || 'Reverb' });
    this.description = 'Synthetic convolution-ish ambience.';
    this.wet = 0.35;
    this.params = [{ key: 'wet', label: 'Wet ', min: 0, max: 1, step: 0.01 }];
  }
  build() {
    const d1 = this.ctx.createDelay(1),
      d2 = this.ctx.createDelay(1),
      g = this.ctx.createGain();
    d1.delayTime.value = 0.07;
    d2.delayTime.value = 0.13;
    g.gain.value = 0.35;
    this.input.connect(this.output);
    this.input.connect(d1);
    d1.connect(d2);
    d2.connect(g);
    g.connect(d1);
    d2.connect(this.output);
  }
}
export class FlangerModule extends EffectModule {
  constructor(c = {}) {
    super({ id: c.id || uid('flanger'), title: c.title || 'Flanger' });
    this.description = 'Short modulated delay.';
    this.depth = 0.004;
    this.rate = 0.22;
    this.params = [
      { key: 'depth', label: 'Depth ', min: 0, max: 0.02, step: 0.001 },
      { key: 'rate', label: 'Rate ', min: 0.01, max: 5, step: 0.01 },
    ];
  }
  build() {
    const d = this.ctx.createDelay(0.03),
      lfo = this.ctx.createOscillator(),
      depth = this.ctx.createGain();
    d.delayTime.value = 0.006;
    lfo.frequency.value = 0.22;
    depth.gain.value = 0.004;
    lfo.connect(depth);
    depth.connect(d.delayTime);
    lfo.start();
    this.input.connect(this.output);
    this.input.connect(d);
    d.connect(this.output);
  }
}
export class PhaserModule extends EffectModule {
  constructor(c = {}) {
    super({ id: c.id || uid('phaser'), title: c.title || 'Phaser' });
    this.description = 'Moving all-pass phase network.';
    this.rate = 0.18;
    this.depth = 500;
    this.params = [
      { key: 'rate', label: 'Rate ', min: 0.01, max: 5, step: 0.01 },
      { key: 'depth', label: 'Depth ', min: 10, max: 1200, step: 1 },
    ];
  }
  build() {
    const a = this.ctx.createBiquadFilter(),
      lfo = this.ctx.createOscillator(),
      depth = this.ctx.createGain();
    a.type = 'allpass';
    a.frequency.value = 700;
    lfo.frequency.value = 0.18;
    depth.gain.value = 500;
    lfo.connect(depth);
    depth.connect(a.frequency);
    lfo.start();
    this.input.connect(this.output);
    this.input.connect(a);
    a.connect(this.output);
  }
}
export class TapeEchoModule extends EffectModule {
  constructor(c = {}) {
    super({ id: c.id || uid('tapeecho'), title: c.title || 'Tape Echo' });
    this.description = 'Wow/flutter flavored echo.';
    this.feedback = 0.42;
    this.rate = 0.8;
    this.params = [
      { key: 'feedback', label: 'Feedback ', min: 0, max: 0.95, step: 0.01 },
      { key: 'rate', label: 'Wow ', min: 0.05, max: 6, step: 0.01 },
    ];
  }
  build() {
    const d = this.ctx.createDelay(2),
      fb = this.ctx.createGain(),
      lfo = this.ctx.createOscillator(),
      depth = this.ctx.createGain();
    d.delayTime.value = 0.44;
    fb.gain.value = 0.42;
    lfo.frequency.value = 0.8;
    depth.gain.value = 0.012;
    lfo.connect(depth);
    depth.connect(d.delayTime);
    lfo.start();
    this.input.connect(this.output);
    this.input.connect(d);
    d.connect(fb);
    fb.connect(d);
    d.connect(this.output);
  }
}
export class BpmBeatLooperModule extends EffectModule {
  constructor(c = {}) {
    super({ id: c.id || uid('beatlooper'), title: c.title || 'BPM Beat Looper' });
    this.description = 'Beat-repeat style delay placeholder synced by delay time.';
    this.feedback = 0.65;
    this.wet = 0.55;
    this.params = [
      { key: 'feedback', label: 'Feedback ', min: 0, max: 0.95, step: 0.01 },
      { key: 'wet', label: 'Wet ', min: 0, max: 1, step: 0.01 },
    ];
  }
  build() {
    const d = this.ctx.createDelay(4),
      fb = this.ctx.createGain(),
      wet = this.ctx.createGain();
    d.delayTime.value = 0.25;
    fb.gain.value = 0.65;
    wet.gain.value = 0.55;
    this.input.connect(this.output);
    this.input.connect(d);
    d.connect(fb);
    fb.connect(d);
    d.connect(wet);
    wet.connect(this.output);
  }
}
