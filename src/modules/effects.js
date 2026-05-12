// PeerModGroove/src/modules/effects.js
import { ModuleBase, PortType, uid } from '../core/contracts.js';

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

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
    this.nodes = {};
  }

  async start(context) {
    this.ctx = context;
    if (!this.input) {
      this.input = this.ctx.createGain();
      this.output = this.ctx.createGain();
      this.nodes = {};
      this.build?.();
      this.applyParams?.();
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
    if (packet.kind === PortType.CONTROL && packet.type === 'param') {
      this.setParam(packet.target, packet.value);
    }
  }

  setParam(target, value) {
    const spec = this.params?.find((param) => param.key === target);
    if (!spec) return;
    this[target] = clamp(Number(value), spec.min, spec.max);
    this.applyParams?.();
    this.render();
  }

  paramState() {
    return Object.fromEntries((this.params || []).map((param) => [param.key, this[param.key]]));
  }

  serialize() {
    return {
      ...super.serialize(),
      params: this.paramState(),
    };
  }

  hydrate(data = {}) {
    for (const [key, value] of Object.entries(data.params || {})) this.setParam(key, value);
  }

  render() {
    if (!this.root) return;
    const params = this.params || [];
    this.root.innerHTML = `<div class="module-head"><span>✦</span><strong>${this.title}</strong><small>AUDIO EFFECT</small></div><div class="effect-rack">${params.map((p) => `<label>${p.label}<input class="mini-input" type="range" min="${p.min}" max="${p.max}" step="${p.step}" value="${this[p.key]}" data-param="${p.key}"></label>`).join('')}</div><p class="microcopy">${this.description || 'WebAudio effect module.'}</p>`;
    this.root.querySelectorAll('[data-param]').forEach(
      (el) =>
        (el.oninput = (e) => {
          this.setParam(e.target.dataset.param, e.target.value);
        })
    );
  }
}

export class DubEchoModule extends EffectModule {
  constructor(c = {}) {
    super({ id: c.id || uid('dubecho'), title: c.title || 'Dub Echo' });
    this.description = 'Feedback delay with filtered repeats.';
    this.feedback = c.feedback ?? 0.52;
    this.wet = c.wet ?? 0.45;
    this.tone = c.tone ?? 1800;
    this.params = [
      { key: 'feedback', label: 'Feedback ', min: 0, max: 0.95, step: 0.01 },
      { key: 'wet', label: 'Wet ', min: 0, max: 1, step: 0.01 },
      { key: 'tone', label: 'Tone ', min: 300, max: 8000, step: 1 },
    ];
  }

  build() {
    const delay = this.ctx.createDelay(2);
    const feedback = this.ctx.createGain();
    const tone = this.ctx.createBiquadFilter();
    const wet = this.ctx.createGain();
    delay.delayTime.value = 0.38;
    tone.type = 'lowpass';
    this.nodes = { delay, feedback, tone, wet };
    this.input.connect(this.output);
    this.input.connect(delay);
    delay.connect(tone);
    tone.connect(feedback);
    feedback.connect(delay);
    delay.connect(wet);
    wet.connect(this.output);
  }

  applyParams() {
    this.nodes.feedback?.gain.setTargetAtTime(this.feedback, this.ctx.currentTime, 0.01);
    this.nodes.wet?.gain.setTargetAtTime(this.wet, this.ctx.currentTime, 0.01);
    this.nodes.tone?.frequency.setTargetAtTime(this.tone, this.ctx.currentTime, 0.02);
  }
}

export class ReverbModule extends EffectModule {
  constructor(c = {}) {
    super({ id: c.id || uid('reverb'), title: c.title || 'Reverb' });
    this.description = 'Synthetic ambience with size, tone, and wet controls.';
    this.wet = c.wet ?? 0.35;
    this.size = c.size ?? 0.5;
    this.tone = c.tone ?? 3200;
    this.params = [
      { key: 'wet', label: 'Wet ', min: 0, max: 1, step: 0.01 },
      { key: 'size', label: 'Size ', min: 0, max: 1, step: 0.01 },
      { key: 'tone', label: 'Tone ', min: 300, max: 8000, step: 1 },
    ];
  }

  build() {
    const d1 = this.ctx.createDelay(1);
    const d2 = this.ctx.createDelay(1);
    const feedback = this.ctx.createGain();
    const wet = this.ctx.createGain();
    const tone = this.ctx.createBiquadFilter();
    tone.type = 'lowpass';
    this.nodes = { d1, d2, feedback, wet, tone };
    this.input.connect(this.output);
    this.input.connect(d1);
    d1.connect(d2);
    d2.connect(tone);
    tone.connect(feedback);
    feedback.connect(d1);
    tone.connect(wet);
    wet.connect(this.output);
  }

  applyParams() {
    if (!this.ctx) return;
    this.nodes.d1?.delayTime.setTargetAtTime(0.03 + this.size * 0.12, this.ctx.currentTime, 0.02);
    this.nodes.d2?.delayTime.setTargetAtTime(0.07 + this.size * 0.2, this.ctx.currentTime, 0.02);
    this.nodes.feedback?.gain.setTargetAtTime(this.size * 0.7, this.ctx.currentTime, 0.02);
    this.nodes.wet?.gain.setTargetAtTime(this.wet, this.ctx.currentTime, 0.02);
    this.nodes.tone?.frequency.setTargetAtTime(this.tone, this.ctx.currentTime, 0.02);
  }
}

export class FlangerModule extends EffectModule {
  constructor(c = {}) {
    super({ id: c.id || uid('flanger'), title: c.title || 'Flanger' });
    this.description = 'Short modulated delay.';
    this.depth = c.depth ?? 0.004;
    this.rate = c.rate ?? 0.22;
    this.wet = c.wet ?? 0.5;
    this.params = [
      { key: 'depth', label: 'Depth ', min: 0, max: 0.02, step: 0.001 },
      { key: 'rate', label: 'Rate ', min: 0.01, max: 5, step: 0.01 },
      { key: 'wet', label: 'Wet ', min: 0, max: 1, step: 0.01 },
    ];
  }

  build() {
    const delay = this.ctx.createDelay(0.03);
    const lfo = this.ctx.createOscillator();
    const depth = this.ctx.createGain();
    const wet = this.ctx.createGain();
    delay.delayTime.value = 0.006;
    lfo.connect(depth);
    depth.connect(delay.delayTime);
    lfo.start();
    this.nodes = { delay, lfo, depth, wet };
    this.input.connect(this.output);
    this.input.connect(delay);
    delay.connect(wet);
    wet.connect(this.output);
  }

  applyParams() {
    this.nodes.lfo?.frequency.setTargetAtTime(this.rate, this.ctx.currentTime, 0.02);
    this.nodes.depth?.gain.setTargetAtTime(this.depth, this.ctx.currentTime, 0.02);
    this.nodes.wet?.gain.setTargetAtTime(this.wet, this.ctx.currentTime, 0.02);
  }
}

export class PhaserModule extends EffectModule {
  constructor(c = {}) {
    super({ id: c.id || uid('phaser'), title: c.title || 'Phaser' });
    this.description = 'Moving all-pass phase network.';
    this.rate = c.rate ?? 0.18;
    this.depth = c.depth ?? 500;
    this.wet = c.wet ?? 0.5;
    this.params = [
      { key: 'rate', label: 'Rate ', min: 0.01, max: 5, step: 0.01 },
      { key: 'depth', label: 'Depth ', min: 10, max: 1200, step: 1 },
      { key: 'wet', label: 'Wet ', min: 0, max: 1, step: 0.01 },
    ];
  }

  build() {
    const allpass = this.ctx.createBiquadFilter();
    const lfo = this.ctx.createOscillator();
    const depth = this.ctx.createGain();
    const wet = this.ctx.createGain();
    allpass.type = 'allpass';
    allpass.frequency.value = 700;
    lfo.connect(depth);
    depth.connect(allpass.frequency);
    lfo.start();
    this.nodes = { allpass, lfo, depth, wet };
    this.input.connect(this.output);
    this.input.connect(allpass);
    allpass.connect(wet);
    wet.connect(this.output);
  }

  applyParams() {
    this.nodes.lfo?.frequency.setTargetAtTime(this.rate, this.ctx.currentTime, 0.02);
    this.nodes.depth?.gain.setTargetAtTime(this.depth, this.ctx.currentTime, 0.02);
    this.nodes.wet?.gain.setTargetAtTime(this.wet, this.ctx.currentTime, 0.02);
  }
}

export class TapeEchoModule extends EffectModule {
  constructor(c = {}) {
    super({ id: c.id || uid('tapeecho'), title: c.title || 'Tape Echo' });
    this.description = 'Wow/flutter flavored echo.';
    this.feedback = c.feedback ?? 0.42;
    this.rate = c.rate ?? 0.8;
    this.wet = c.wet ?? 0.5;
    this.params = [
      { key: 'feedback', label: 'Feedback ', min: 0, max: 0.95, step: 0.01 },
      { key: 'rate', label: 'Wow ', min: 0.05, max: 6, step: 0.01 },
      { key: 'wet', label: 'Wet ', min: 0, max: 1, step: 0.01 },
    ];
  }

  build() {
    const delay = this.ctx.createDelay(2);
    const feedback = this.ctx.createGain();
    const lfo = this.ctx.createOscillator();
    const depth = this.ctx.createGain();
    const wet = this.ctx.createGain();
    delay.delayTime.value = 0.44;
    depth.gain.value = 0.012;
    lfo.connect(depth);
    depth.connect(delay.delayTime);
    lfo.start();
    this.nodes = { delay, feedback, lfo, depth, wet };
    this.input.connect(this.output);
    this.input.connect(delay);
    delay.connect(feedback);
    feedback.connect(delay);
    delay.connect(wet);
    wet.connect(this.output);
  }

  applyParams() {
    this.nodes.feedback?.gain.setTargetAtTime(this.feedback, this.ctx.currentTime, 0.02);
    this.nodes.lfo?.frequency.setTargetAtTime(this.rate, this.ctx.currentTime, 0.02);
    this.nodes.wet?.gain.setTargetAtTime(this.wet, this.ctx.currentTime, 0.02);
  }
}

export class BpmBeatLooperModule extends EffectModule {
  constructor(c = {}) {
    super({ id: c.id || uid('beatlooper'), title: c.title || 'BPM Beat Looper' });
    this.description = 'Beat-repeat style delay synced by delay time.';
    this.feedback = c.feedback ?? 0.65;
    this.wet = c.wet ?? 0.55;
    this.repeat = c.repeat ?? 0.25;
    this.params = [
      { key: 'feedback', label: 'Feedback ', min: 0, max: 0.95, step: 0.01 },
      { key: 'wet', label: 'Wet ', min: 0, max: 1, step: 0.01 },
      { key: 'repeat', label: 'Repeat ', min: 0.05, max: 1, step: 0.01 },
    ];
  }

  build() {
    const delay = this.ctx.createDelay(4);
    const feedback = this.ctx.createGain();
    const wet = this.ctx.createGain();
    this.nodes = { delay, feedback, wet };
    this.input.connect(this.output);
    this.input.connect(delay);
    delay.connect(feedback);
    feedback.connect(delay);
    delay.connect(wet);
    wet.connect(this.output);
  }

  applyParams() {
    this.nodes.delay?.delayTime.setTargetAtTime(this.repeat, this.ctx.currentTime, 0.02);
    this.nodes.feedback?.gain.setTargetAtTime(this.feedback, this.ctx.currentTime, 0.02);
    this.nodes.wet?.gain.setTargetAtTime(this.wet, this.ctx.currentTime, 0.02);
  }
}
