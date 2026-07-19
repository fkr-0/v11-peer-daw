const DEFAULT_STORAGE_KEY = 'v11-peer-daw-low-power-mode';

export function formatDb(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)} dB` : '−∞ dB';
}

export function formatLatency(seconds) {
  const value = Number(seconds || 0);
  return value > 0 ? `${(value * 1000).toFixed(value < 0.01 ? 1 : 0)} ms` : 'n/a';
}

export class PerformanceMonitor {
  constructor({
    root,
    runtime,
    getStats = () => ({}),
    storage = globalThis.localStorage,
    storageKey = DEFAULT_STORAGE_KEY,
    documentRoot = globalThis.document,
    onModeChange = () => {},
  } = {}) {
    this.root = root || null;
    this.runtime = runtime || null;
    this.getStats = getStats;
    this.storage = storage;
    this.storageKey = storageKey;
    this.documentRoot = documentRoot;
    this.onModeChange = onModeChange;
    this.lowPower = false;
    this.frameRequest = 0;
    this.lastMeterAt = 0;
    this.lastDetailsAt = 0;
    this.boundTick = (now) => this.tick(now);
    this.boundVisibility = () => this.handleVisibility();
  }

  bind() {
    try {
      this.lowPower = this.storage?.getItem?.(this.storageKey) === 'true';
    } catch (_) {}
    this.applyMode();
    this.root?.querySelector('#btnPerformanceMode')?.addEventListener('click', () => {
      this.setLowPower(!this.lowPower);
    });
    this.documentRoot?.addEventListener?.('visibilitychange', this.boundVisibility);
    this.start();
  }

  start() {
    if (this.frameRequest || this.documentRoot?.hidden) return;
    this.frameRequest = globalThis.requestAnimationFrame?.(this.boundTick) || 0;
  }

  stop() {
    if (this.frameRequest) globalThis.cancelAnimationFrame?.(this.frameRequest);
    this.frameRequest = 0;
  }

  destroy() {
    this.stop();
    this.documentRoot?.removeEventListener?.('visibilitychange', this.boundVisibility);
  }

  handleVisibility() {
    if (this.documentRoot?.hidden) this.stop();
    else this.start();
  }

  setLowPower(enabled) {
    this.lowPower = Boolean(enabled);
    try {
      this.storage?.setItem?.(this.storageKey, String(this.lowPower));
    } catch (_) {}
    this.applyMode();
    return this.lowPower;
  }

  applyMode() {
    const button = this.root?.querySelector('#btnPerformanceMode');
    if (button) {
      button.setAttribute('aria-pressed', this.lowPower ? 'true' : 'false');
      button.textContent = `LOW-POWER MODE ${this.lowPower ? 'ON' : 'OFF'}`;
    }
    this.onModeChange(this.lowPower);
  }

  tick(now = performance.now()) {
    this.frameRequest = 0;
    const meterInterval = this.lowPower ? 120 : 48;
    if (now - this.lastMeterAt >= meterInterval) {
      this.renderMeter(this.runtime?.getMeterSnapshot?.(now) || {});
      this.lastMeterAt = now;
    }
    if (now - this.lastDetailsAt >= 300) {
      this.renderDetails();
      this.lastDetailsAt = now;
    }
    this.start();
  }

  renderMeter(snapshot = {}) {
    const rms = Math.max(0, Math.min(1, Number(snapshot.rms || 0)));
    const peak = Math.max(rms, Math.min(1, Number(snapshot.peak || 0)));
    const clipped = Boolean(snapshot.clipped);
    this.documentRoot?.querySelectorAll?.('[data-master-meter]')?.forEach((meter) => {
      meter.style.setProperty('--meter-rms', `${(rms * 100).toFixed(2)}%`);
      meter.style.setProperty('--meter-peak', `${(peak * 100).toFixed(2)}%`);
      meter.dataset.clipped = clipped ? 'true' : 'false';
    });
    const peakNode = this.documentRoot?.querySelector?.('#performancePeak');
    const rmsNode = this.documentRoot?.querySelector?.('#performanceRms');
    if (peakNode) peakNode.textContent = formatDb(snapshot.peakDb);
    if (rmsNode) rmsNode.textContent = formatDb(snapshot.rmsDb);
  }

  renderDetails() {
    const performanceState = this.runtime?.getPerformanceSnapshot?.() || {};
    const appState = this.getStats?.() || {};
    const latency = Number(performanceState.baseLatency || 0) + Number(performanceState.outputLatency || 0);
    const stateNode = this.documentRoot?.querySelector?.('#performanceState');
    const latencyNode = this.documentRoot?.querySelector?.('#performanceLatency');
    const engineNode = this.documentRoot?.querySelector?.('#performanceEngine');
    if (stateNode) stateNode.textContent = performanceState.state || 'offline';
    if (latencyNode) latencyNode.textContent = formatLatency(latency);
    if (engineNode) {
      const sampleRate = Number(performanceState.sampleRate || 0);
      const modules = Number(appState.modules || 0);
      const routes = Number(appState.routes || 0);
      engineNode.textContent = sampleRate
        ? `${Math.round(sampleRate / 100) / 10} kHz · ${modules}/${routes}`
        : `${modules} modules · ${routes} routes`;
      engineNode.title = `${sampleRate || 0} Hz · analyser ${performanceState.analyserSize || 0} · ${Number(appState.pending || 0)} pending collaboration operations`;
    }
  }
}
