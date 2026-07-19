// PeerModGroove/src/core/audio.js

export class AudioRuntime {
  constructor() {
    this.context = null;
    this.master = null;
    this.analyser = null;
    this.meterBuffer = null;
    this.meterPeak = 0;
    this.meterRms = 0;
    this.clipHoldUntil = 0;
  }

  async init() {
    if (this.context) {
      if (this.context.state === 'suspended') await this.context.resume();
      return this.context;
    }
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    this.context = new AudioContextCtor();
    this.master = this.context.createGain();
    this.master.gain.value = 0.8;
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.72;
    this.master.connect(this.analyser);
    this.analyser.connect(this.context.destination);
    this.meterBuffer = new Float32Array(this.analyser.fftSize);
    return this.context;
  }

  setMasterVolume(value) {
    if (!this.master || !this.context) return;
    const normalized = Math.max(0, Math.min(1.5, Number(value) || 0));
    this.master.gain.setTargetAtTime(normalized, this.context.currentTime, 0.01);
  }

  getMeterSnapshot(now = performance.now()) {
    if (!this.analyser || !this.context) {
      return {
        state: this.context?.state || 'offline',
        peak: 0,
        rms: 0,
        peakDb: -Infinity,
        rmsDb: -Infinity,
        clipped: false,
      };
    }
    if (!this.meterBuffer || this.meterBuffer.length !== this.analyser.fftSize) {
      this.meterBuffer = new Float32Array(this.analyser.fftSize);
    }
    if (typeof this.analyser.getFloatTimeDomainData === 'function') {
      this.analyser.getFloatTimeDomainData(this.meterBuffer);
    } else {
      const bytes = new Uint8Array(this.analyser.fftSize);
      this.analyser.getByteTimeDomainData?.(bytes);
      for (let index = 0; index < bytes.length; index += 1) {
        this.meterBuffer[index] = (bytes[index] - 128) / 128;
      }
    }
    let peak = 0;
    let sumSquares = 0;
    for (const sample of this.meterBuffer) {
      const absolute = Math.abs(sample);
      if (absolute > peak) peak = absolute;
      sumSquares += sample * sample;
    }
    const rms = Math.sqrt(sumSquares / Math.max(1, this.meterBuffer.length));
    this.meterPeak = Math.max(peak, this.meterPeak * 0.82);
    this.meterRms = this.meterRms * 0.68 + rms * 0.32;
    if (peak >= 0.985) this.clipHoldUntil = now + 1500;
    const toDb = (value) => (value > 0.000001 ? 20 * Math.log10(value) : -Infinity);
    return {
      state: this.context.state,
      peak: Math.min(1, this.meterPeak),
      rms: Math.min(1, this.meterRms),
      peakDb: toDb(this.meterPeak),
      rmsDb: toDb(this.meterRms),
      clipped: now < this.clipHoldUntil,
    };
  }

  getPerformanceSnapshot() {
    return {
      state: this.context?.state || 'offline',
      sampleRate: Number(this.context?.sampleRate || 0),
      baseLatency: Number(this.context?.baseLatency || 0),
      outputLatency: Number(this.context?.outputLatency || 0),
      analyserSize: Number(this.analyser?.fftSize || 0),
    };
  }

  get destination() {
    return this.master;
  }
}
