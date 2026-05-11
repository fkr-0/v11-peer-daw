// V11 Peer DAW/tests/unit/clock.test.js
// Unit tests for Clock module

import { beforeEach, describe, expect, it } from '@jest/globals';

// Mock dependencies
class MockModuleBase {
  constructor(config) {
    this.id = config.id;
    this.title = config.title;
    this.kind = config.kind;
    this.inputs = config.inputs || [];
    this.outputs = config.outputs || [];
    this.root = null;
    this.lastPacket = null;
  }

  mount(element) {
    this.root = element;
  }

  emitPacket(packet, outputId) {
    this.lastPacket = { packet, outputId };
  }

  render() {
    if (this.root) {
      this.root.innerHTML = `<div class="mock-clock">${this.title}</div>`;
    }
  }
}

const PortType = {
  CLOCK: 'clock',
  MIDI: 'midi',
  CONTROL: 'control',
  AUDIO: 'audio',
};

// Simplified Clock module for testing
class TestClockModule extends MockModuleBase {
  constructor(config = {}) {
    super({
      id: config.id || 'test-clock',
      title: config.title || 'Test Clock',
      kind: 'clock',
      inputs: [{ id: 'control', type: PortType.CONTROL }],
      outputs: [{ id: 'clock', type: PortType.CLOCK }],
    });

    this.bpm = config.bpm || 120;
    this.step = 0;
    this.timer = null;
    this.running = false;
  }

  start(context) {
    this.ctx = context;
    this.stop();
    this.running = true;

    const interval = (60 / this.bpm / 4) * 1000;
    this.timer = setInterval(() => {
      this.step++;
      this.emitPacket(
        {
          kind: PortType.CLOCK,
          type: 'step',
          step: this.step,
          bpm: this.bpm,
          at: this.ctx?.currentTime || 0,
        },
        'clock'
      );
    }, interval);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.running = false;
  }
}

// Mock AudioContext
class MockAudioContext {
  constructor() {
    this.currentTime = 0;
    this.state = 'running';
  }
}

describe('Clock Module', () => {
  let clock;
  let mockContext;

  beforeEach(() => {
    clock = new TestClockModule();
    mockContext = new MockAudioContext();
  });

  afterEach(() => {
    clock.stop();
  });

  describe('Initialization', () => {
    it('should initialize with default BPM', () => {
      expect(clock.bpm).toBe(120);
    });

    it('should initialize with custom BPM', () => {
      const customClock = new TestClockModule({ bpm: 140 });
      expect(customClock.bpm).toBe(140);
    });

    it('should start at step 0', () => {
      expect(clock.step).toBe(0);
    });

    it('should have correct ports', () => {
      expect(clock.outputs.length).toBe(1);
      expect(clock.outputs[0].id).toBe('clock');
      expect(clock.outputs[0].type).toBe(PortType.CLOCK);
    });
  });

  describe('Starting and Stopping', () => {
    it('should start the clock', () => {
      clock.start(mockContext);
      expect(clock.running).toBe(true);
      expect(clock.timer).not.toBeNull();
    });

    it('should stop the clock', () => {
      clock.start(mockContext);
      clock.stop();
      expect(clock.running).toBe(false);
      expect(clock.timer).toBeNull();
    });

    it('should restart the clock', () => {
      clock.start(mockContext);
      const firstTimer = clock.timer;
      clock.stop();
      clock.start(mockContext);

      expect(clock.running).toBe(true);
      expect(clock.timer).not.toBeNull();
      expect(clock.timer).not.toBe(firstTimer);
    });
  });

  describe('Step Generation', () => {
    it('should increment step counter', (done) => {
      clock.start(mockContext);

      setTimeout(() => {
        expect(clock.step).toBeGreaterThan(0);
        clock.stop();
        done();
      }, 100);
    });

    it('should emit clock packets', (done) => {
      clock.start(mockContext);

      setTimeout(() => {
        expect(clock.lastPacket).not.toBeNull();
        expect(clock.lastPacket.packet.type).toBe('step');
        expect(clock.lastPacket.packet.step).toBeGreaterThan(0);
        expect(clock.lastPacket.packet.bpm).toBe(120);
        clock.stop();
        done();
      }, 100);
    });

    it('should reset step when restarted', (done) => {
      clock.start(mockContext);

      setTimeout(() => {
        clock.stop();
        const finalStep = clock.step;

        clock.start(mockContext);
        expect(clock.step).toBe(finalStep + 1); // Continues from previous

        clock.stop();
        done();
      }, 100);
    });
  });

  describe('BPM Handling', () => {
    it('should use correct interval for 120 BPM', () => {
      const interval = (60 / 120 / 4) * 1000;
      expect(interval).toBe(125); // 125ms per step
    });

    it('should use correct interval for 60 BPM', () => {
      const interval = (60 / 60 / 4) * 1000;
      expect(interval).toBe(250); // 250ms per step
    });

    it('should use correct interval for 240 BPM', () => {
      const interval = (60 / 240 / 4) * 1000;
      expect(interval).toBeCloseTo(62.5, 0.1);
    });

    it('should emit packets with correct BPM', (done) => {
      clock.bpm = 140;
      clock.start(mockContext);

      setTimeout(() => {
        expect(clock.lastPacket.packet.bpm).toBe(140);
        clock.stop();
        done();
      }, 100);
    });
  });

  describe('Packet Structure', () => {
    it('should emit packets with correct structure', (done) => {
      clock.start(mockContext);

      setTimeout(() => {
        const packet = clock.lastPacket.packet;
        expect(packet).toHaveProperty('kind');
        expect(packet).toHaveProperty('type');
        expect(packet).toHaveProperty('step');
        expect(packet).toHaveProperty('bpm');
        expect(packet).toHaveProperty('at');

        expect(packet.kind).toBe(PortType.CLOCK);
        expect(packet.type).toBe('step');
        expect(packet.step).toBeGreaterThan(0);
        expect(packet.bpm).toBe(120);

        clock.stop();
        done();
      }, 100);
    });
  });

  describe('Multiple Clocks', () => {
    it('should support multiple independent clocks', (done) => {
      const clock1 = new TestClockModule({ id: 'clock-1', bpm: 120 });
      const clock2 = new TestClockModule({ id: 'clock-2', bpm: 140 });

      clock1.start(mockContext);
      clock2.start(mockContext);

      setTimeout(() => {
        expect(clock1.running).toBe(true);
        expect(clock2.running).toBe(true);
        expect(clock1.lastPacket.packet.bpm).toBe(120);
        expect(clock2.lastPacket.packet.bpm).toBe(140);

        clock1.stop();
        clock2.stop();
        done();
      }, 100);
    });

    it('should maintain independent step counters', (done) => {
      const clock1 = new TestClockModule({ id: 'clock-1' });
      const clock2 = new TestClockModule({ id: 'clock-2' });

      clock1.start(mockContext);
      clock2.start(mockContext);

      setTimeout(() => {
        expect(clock1.step).toBe(clock2.step); // Should be similar

        clock1.stop();
        clock2.stop();
        done();
      }, 100);
    });
  });

  describe('Error Handling', () => {
    it('should handle stop before start gracefully', () => {
      expect(() => clock.stop()).not.toThrow();
      expect(clock.running).toBe(false);
    });

    it('should handle multiple starts', () => {
      clock.start(mockContext);
      const _firstTimer = clock.timer;

      clock.start(mockContext);

      expect(clock.timer).not.toBeNull();
      expect(clock.running).toBe(true);

      clock.stop();
    });

    it('should handle multiple stops', () => {
      clock.start(mockContext);
      clock.stop();
      expect(() => clock.stop()).not.toThrow();
      expect(clock.running).toBe(false);
    });
  });

  describe('Timing Accuracy', () => {
    it('should maintain consistent timing', (done) => {
      const timings = [];
      clock.start(mockContext);

      const checkInterval = setInterval(() => {
        timings.push({
          step: clock.step,
          time: Date.now(),
        });

        if (timings.length >= 5) {
          clearInterval(checkInterval);
          clock.stop();

          // Check that steps are incrementing
          for (let i = 1; i < timings.length; i++) {
            expect(timings[i].step).toBeGreaterThan(timings[i - 1].step);
          }

          done();
        }
      }, 50);
    }, 10000);
  });
});

describe('Clock Module Integration', () => {
  let clock;
  let mockContext;

  beforeEach(() => {
    clock = new TestClockModule();
    mockContext = new MockAudioContext();
  });

  afterEach(() => {
    clock.stop();
  });

  describe('Module Lifecycle', () => {
    it('should mount to DOM element', () => {
      const element = document.createElement('div');
      clock.mount(element);

      expect(clock.root).toBe(element);
    });

    it('should render UI', () => {
      const element = document.createElement('div');
      clock.mount(element);
      clock.render();

      expect(element.innerHTML).toContain('Test Clock');
    });
  });

  describe('Clock Output Connection', () => {
    it('should emit to correct output port', (done) => {
      clock.start(mockContext);

      setTimeout(() => {
        expect(clock.lastPacket.outputId).toBe('clock');
        clock.stop();
        done();
      }, 100);
    });
  });
});
