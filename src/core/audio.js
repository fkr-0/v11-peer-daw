// PeerModGroove/src/core/audio.js

export class AudioRuntime {
  constructor() {
    this.context = null;
    this.master = null;
    this.analyser = null;
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
    this.analyser.fftSize = 512;
    this.master.connect(this.analyser);
    this.analyser.connect(this.context.destination);
    return this.context;
  }

  setMasterVolume(value) {
    if (!this.master || !this.context) return;
    this.master.gain.setTargetAtTime(value, this.context.currentTime, 0.01);
  }

  get destination() {
    return this.master;
  }
}
