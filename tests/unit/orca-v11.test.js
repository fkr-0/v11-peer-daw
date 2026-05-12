// V11 Peer DAW/tests/unit/orca-v11.test.js
// Unit tests for ORCA V11 module

import { beforeEach, describe, expect, it } from '@jest/globals';

// Mock ModuleBase and dependencies
class MockModuleBase {
  constructor(config) {
    this.id = config.id;
    this.title = config.title;
    this.kind = config.kind;
    this.inputs = config.inputs || [];
    this.outputs = config.outputs || [];
    this.root = null;
  }

  mount(element) {
    this.root = element;
  }

  emitPacket(packet, outputId) {
    this.lastPacket = { packet, outputId };
  }

  render() {
    if (this.root) {
      this.root.innerHTML = `<div class="mock-module">${this.title}</div>`;
    }
  }
}

// Mock port types
const PortType = {
  CLOCK: 'clock',
  MIDI: 'midi',
  CONTROL: 'control',
  AUDIO: 'audio',
};

function uid(prefix = 'test') {
  return `${prefix}-${Date.now().toString(36)}`;
}

// ORCA Constants
const GW = 32;
const GH = 14;
const PENTA = [0, 2, 4, 7, 9];
const OP_CHARS = 'DOCARMVEWNS';

// Simplified ORCA module for testing
class TestOcraModule extends MockModuleBase {
  constructor(config = {}) {
    super({
      id: config.id || uid('ocra'),
      title: config.title || 'Test OCRA',
      kind: 'midi-generator',
      inputs: [
        { id: 'clock', type: PortType.CLOCK },
        { id: 'control', type: PortType.CONTROL },
      ],
      outputs: [
        { id: 'midi', type: PortType.MIDI },
        { id: 'audio', type: PortType.AUDIO },
      ],
    });

    this.grid = [];
    this.orcaFrame = 0;
    this.cursorX = 0;
    this.cursorY = 0;
    this.vars = {};

    this.initGrid();
  }

  initGrid() {
    this.grid = [];
    for (let i = 0; i < GH; i++) {
      this.grid.push(new Array(GW).fill('.'));
    }
  }

  gc(x, y) {
    return x >= 0 && x < GW && y >= 0 && y < GH ? this.grid[y][x] : '#';
  }

  gv(x, y) {
    const c = this.gc(x, y);
    if (c >= '0' && c <= '9') return c.charCodeAt(0) - 48;
    if (c >= 'a' && c <= 'f') return c.charCodeAt(0) - 87;
    return 0;
  }

  isV(c) {
    return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f');
  }

  isOp(c) {
    return OP_CHARS.indexOf(c) >= 0;
  }

  toH(n) {
    const v = n % 16;
    return v < 10 ? String(v) : String.fromCharCode(87 + v);
  }

  noteFreq(nv, oct) {
    const s = PENTA[nv % 5] + Math.floor(nv / 5) * 12;
    // MIDI note: C4 is 60
    // oct 3 -> C4 when nv=0
    const midiNote = (oct + 2) * 12 + s;
    return 440 * 2 ** ((midiNote - 69) / 12);
  }

  loadGrid(g) {
    for (let y = 0; y < GH; y++) {
      for (let x = 0; x < GW; x++) {
        this.grid[y][x] = g[y]?.[x] ? g[y][x] : '.';
      }
    }
  }

  runOrca() {
    // Guard clause for empty grid
    if (!this.grid || this.grid.length === 0) {
      return { act: [], notes: [] };
    }

    const trig = [];
    const act = [];
    const notes = [];

    for (let i = 0; i < GH; i++) {
      trig.push(new Array(GW).fill(false));
      act.push(new Array(GW).fill(false));
    }

    // First pass: handle * operator (triggers neighbors)
    for (let y = 0; y < GH; y++) {
      for (let x = 0; x < GW; x++) {
        const c = this.grid[y][x];
        if (c === '*') {
          // Mark the bang itself as active
          act[y][x] = true;
          // Trigger all neighbors (they get marked as active)
          if (y > 0) act[y - 1][x] = true; // North
          if (y + 1 < GH) act[y + 1][x] = true; // South
          if (x > 0) act[y][x - 1] = true; // West
          if (x + 1 < GW) act[y][x + 1] = true; // East
          // Also mark them in trig for O operator
          if (y > 0) trig[y - 1][x] = true;
          if (y + 1 < GH) trig[y + 1][x] = true;
          if (x > 0) trig[y][x - 1] = true;
          if (x + 1 < GW) trig[y][x + 1] = true;
          // Clear the bang
          this.grid[y][x] = '.';
        }
      }
    }

    // Second pass: handle other operators
    for (let y = 0; y < GH; y++) {
      for (let x = 0; x < GW; x++) {
        const c = this.grid[y][x];
        if (c === '.' || c === '#') continue;

        if (c === 'D') {
          const r = Math.max(1, this.gv(x + 1, y) || 1);
          const off = this.gv(x - 1, y);
          const idx = this.orcaFrame - off;
          if (idx >= 0 && idx % r === 0) {
            act[y][x] = true;
            if (y + 1 < GH) {
              act[y + 1][x] = true; // Mark south as active
              trig[y + 1][x] = true; // Also mark for O operator
            }
          }
        } else if (c === 'O' && trig[y][x]) {
          const n = this.gv(x + 1, y);
          const o = this.gv(x, y + 1) || 3;
          notes.push({ note: n, oct: o, row: y });
          act[y][x] = true;
        } else if (c === 'C') {
          act[y][x] = true;
          const m = Math.max(1, this.gv(x + 1, y) || 8);
          const out = this.orcaFrame % m;
          if (y + 1 < GH) {
            const h = this.toH(out);
            if (this.grid[y + 1][x] === '.' || this.isV(this.grid[y + 1][x])) {
              this.grid[y + 1][x] = h;
            }
          }
        }
      }
    }

    return { act, notes };
  }
}

describe('ORCA V11 Module', () => {
  let ocra;

  beforeEach(() => {
    ocra = new TestOcraModule();
  });

  describe('Grid Initialization', () => {
    it('should create a 32x14 grid filled with dots', () => {
      expect(ocra.grid.length).toBe(14);
      expect(ocra.grid[0].length).toBe(32);
      expect(ocra.grid[0][0]).toBe('.');
      expect(ocra.grid[13][31]).toBe('.');
    });

    it('should load a preset grid correctly', () => {
      const preset = ['D8...........................', 'O4...........................'];
      ocra.loadGrid(preset);

      expect(ocra.grid[0][0]).toBe('D');
      expect(ocra.grid[0][1]).toBe('8');
      expect(ocra.grid[1][0]).toBe('O');
      expect(ocra.grid[1][1]).toBe('4');
    });
  });

  describe('Grid Cell Access', () => {
    it('should return valid characters within bounds', () => {
      ocra.grid[5][10] = 'O';
      expect(ocra.gc(10, 5)).toBe('O');
    });

    it('should return wall for out of bounds', () => {
      expect(ocra.gc(-1, 0)).toBe('#');
      expect(ocra.gc(32, 0)).toBe('#');
      expect(ocra.gc(0, -1)).toBe('#');
      expect(ocra.gc(0, 14)).toBe('#');
    });

    it('should parse decimal values correctly', () => {
      ocra.grid[0][0] = '5';
      expect(ocra.gv(0, 0)).toBe(5);

      ocra.grid[0][1] = '9';
      expect(ocra.gv(1, 0)).toBe(9);
    });

    it('should parse hex values correctly', () => {
      ocra.grid[0][0] = 'a';
      expect(ocra.gv(0, 0)).toBe(10);

      ocra.grid[0][1] = 'f';
      expect(ocra.gv(1, 0)).toBe(15);
    });

    it('should return 0 for non-value characters', () => {
      ocra.grid[0][0] = 'D';
      expect(ocra.gv(0, 0)).toBe(0);
    });
  });

  describe('Value Detection', () => {
    it('should detect decimal values', () => {
      expect(ocra.isV('0')).toBe(true);
      expect(ocra.isV('5')).toBe(true);
      expect(ocra.isV('9')).toBe(true);
    });

    it('should detect hex values', () => {
      expect(ocra.isV('a')).toBe(true);
      expect(ocra.isV('c')).toBe(true);
      expect(ocra.isV('f')).toBe(true);
    });

    it('should reject non-value characters', () => {
      expect(ocra.isV('D')).toBe(false);
      expect(ocra.isV('O')).toBe(false);
      expect(ocra.isV('.')).toBe(false);
    });
  });

  describe('Operator Detection', () => {
    it('should detect valid operators', () => {
      expect(ocra.isOp('D')).toBe(true);
      expect(ocra.isOp('O')).toBe(true);
      expect(ocra.isOp('C')).toBe(true);
      expect(ocra.isOp('R')).toBe(true);
      expect(ocra.isOp('A')).toBe(true);
      expect(ocra.isOp('M')).toBe(true);
      expect(ocra.isOp('V')).toBe(true);
      expect(ocra.isOp('E')).toBe(true);
      expect(ocra.isOp('W')).toBe(true);
      expect(ocra.isOp('N')).toBe(true);
      expect(ocra.isOp('S')).toBe(true);
    });

    it('should reject non-operator characters', () => {
      expect(ocra.isOp('0')).toBe(false);
      expect(ocra.isOp('.')).toBe(false);
      expect(ocra.isOp('X')).toBe(false);
    });
  });

  describe('Hex Conversion', () => {
    it('should convert numbers 0-9 to string', () => {
      expect(ocra.toH(0)).toBe('0');
      expect(ocra.toH(5)).toBe('5');
      expect(ocra.toH(9)).toBe('9');
    });

    it('should convert numbers 10-15 to hex letters', () => {
      expect(ocra.toH(10)).toBe('a');
      expect(ocra.toH(11)).toBe('b');
      expect(ocra.toH(15)).toBe('f');
    });

    it('should handle modulo 16 for larger numbers', () => {
      expect(ocra.toH(16)).toBe('0');
      expect(ocra.toH(17)).toBe('1');
      expect(ocra.toH(26)).toBe('a');
    });
  });

  describe('Delay Operator (D)', () => {
    it('should trigger on frame 0 with no offset', () => {
      ocra.grid[0][0] = 'D';
      ocra.grid[0][1] = '1';
      ocra.orcaFrame = 0; // Set frame to 0

      const result = ocra.runOrca();

      expect(result.act[0][0]).toBe(true);
      expect(result.act[1][0]).toBe(true); // South trigger
    });

    it('should trigger every N frames', () => {
      ocra.grid[0][0] = 'D';
      ocra.grid[0][1] = '4';

      // Frame 0
      let result = ocra.runOrca();
      expect(result.act[0][0]).toBe(true);

      // Frame 1, 2, 3 - no trigger
      for (let i = 1; i < 4; i++) {
        ocra.orcaFrame++;
        result = ocra.runOrca();
        expect(result.act[0][0]).toBe(false);
      }

      // Frame 4 - trigger
      ocra.orcaFrame++;
      result = ocra.runOrca();
      expect(result.act[0][0]).toBe(true);
    });

    it('should respect offset parameter', () => {
      ocra.grid[0][0] = '4';
      ocra.grid[0][1] = 'D';
      ocra.grid[0][2] = '8';

      // Frame 4 (offset 4, rate 8)
      ocra.orcaFrame = 4;
      const result = ocra.runOrca();

      expect(result.act[0][1]).toBe(true);
      expect(result.act[1][1]).toBe(true);
    });
  });

  describe('Oscillator Operator (O)', () => {
    it('should emit notes when triggered', () => {
      ocra.grid[0][0] = '*';
      ocra.grid[1][0] = 'O';
      ocra.grid[1][1] = '4';
      ocra.grid[1][2] = '3';

      const result = ocra.runOrca();

      expect(result.notes.length).toBeGreaterThan(0);
      expect(result.notes[0].note).toBe(4);
      expect(result.notes[0].oct).toBe(3);
    });

    it('should default to octave 3 when not specified', () => {
      ocra.grid[0][0] = '*';
      ocra.grid[1][0] = 'O';
      ocra.grid[1][1] = '7';

      const result = ocra.runOrca();

      expect(result.notes[0].oct).toBe(3);
    });
  });

  describe('Clock Operator (C)', () => {
    it('should count modulo N', () => {
      ocra.grid[0][0] = 'C';
      ocra.grid[0][1] = '4';

      // Frame 0
      let result = ocra.runOrca();
      expect(ocra.grid[1][0]).toBe('0');
      expect(result.act[0][0]).toBe(true);

      // Frame 1
      ocra.orcaFrame++;
      result = ocra.runOrca();
      expect(ocra.grid[1][0]).toBe('1');

      // Frame 3
      ocra.orcaFrame = 3;
      result = ocra.runOrca();
      expect(ocra.grid[1][0]).toBe('3');

      // Frame 4 - wraps to 0
      ocra.orcaFrame = 4;
      result = ocra.runOrca();
      expect(ocra.grid[1][0]).toBe('0');
    });

    it('should default to modulo 8', () => {
      ocra.grid[0][0] = 'C';

      for (let i = 0; i < 8; i++) {
        ocra.orcaFrame = i;
        ocra.runOrca();
        expect(ocra.grid[1][0]).toBe(ocra.toH(i));
      }

      ocra.orcaFrame = 8;
      ocra.runOrca();
      expect(ocra.grid[1][0]).toBe('0');
    });
  });

  describe('Bang Operator (*)', () => {
    it('should trigger all neighbors and clear itself', () => {
      ocra.grid[1][1] = '*';

      const result = ocra.runOrca();

      expect(result.act[1][1]).toBe(true);
      expect(result.act[0][1]).toBe(true); // North
      expect(result.act[2][1]).toBe(true); // South
      expect(result.act[1][0]).toBe(true); // West
      expect(result.act[1][2]).toBe(true); // East
      expect(ocra.grid[1][1]).toBe('.'); // Cleared
    });

    it('should not trigger out of bounds', () => {
      ocra.grid[0][0] = '*';

      const result = ocra.runOrca();

      expect(result.act[0][0]).toBe(true);
      expect(ocra.grid[0][0]).toBe('.');
      // Out of bounds should not cause errors
    });
  });

  describe('Note Frequency Calculation', () => {
    it('should calculate correct frequencies for pentatonic scale', () => {
      // C4 (middle C)
      const freqC4 = ocra.noteFreq(0, 3);
      expect(freqC4).toBeCloseTo(261.63, 0.1);

      // D4
      const freqD4 = ocra.noteFreq(1, 3);
      expect(freqD4).toBeCloseTo(293.66, 0.1);

      // E4
      const freqE4 = ocra.noteFreq(2, 3);
      expect(freqE4).toBeCloseTo(329.63, 0.1);
    });

    it('should handle different octaves', () => {
      const freqC3 = ocra.noteFreq(0, 2);
      const freqC4 = ocra.noteFreq(0, 3);
      const freqC5 = ocra.noteFreq(0, 4);

      expect(freqC5).toBeCloseTo(freqC4 * 2, 0.1);
      expect(freqC4).toBeCloseTo(freqC3 * 2, 0.1);
    });
  });

  describe('Module Configuration', () => {
    it('should have correct input/output ports', () => {
      expect(ocra.inputs.length).toBe(2);
      expect(ocra.inputs[0].id).toBe('clock');
      expect(ocra.inputs[0].type).toBe(PortType.CLOCK);

      expect(ocra.outputs.length).toBe(2);
      expect(ocra.outputs[0].id).toBe('midi');
      expect(ocra.outputs[0].type).toBe(PortType.MIDI);
    });

    it('should have correct kind', () => {
      expect(ocra.kind).toBe('midi-generator');
    });
  });

  describe('Integration Scenarios', () => {
    it('should handle a simple delay + oscillator pattern', () => {
      // Set up D8 triggering every 8 frames, with O4 below
      ocra.grid[0][0] = 'D';
      ocra.grid[0][1] = '8';
      ocra.grid[1][0] = 'O';
      ocra.grid[1][1] = '4';

      // Run 16 frames
      const notes = [];
      for (let frame = 0; frame < 16; frame++) {
        const result = ocra.runOrca();
        notes.push(...result.notes);
        ocra.orcaFrame++;
      }

      // Should trigger on frames 0 and 8
      expect(notes.length).toBe(2);
      expect(notes[0].note).toBe(4);
      expect(notes[1].note).toBe(4);
    });

    it('should handle multiple independent patterns', () => {
      // Two separate D+O pairs
      ocra.grid[0][0] = 'D';
      ocra.grid[0][1] = '4';
      ocra.grid[1][0] = 'O';
      ocra.grid[1][1] = '2';

      ocra.grid[3][0] = 'D';
      ocra.grid[3][1] = '6';
      ocra.grid[4][0] = 'O';
      ocra.grid[4][1] = '7';

      const notes = [];
      for (let frame = 0; frame < 12; frame++) {
        const result = ocra.runOrca();
        notes.push(...result.notes);
        ocra.orcaFrame++;
      }

      // First pattern triggers on 0, 4, 8
      // Second pattern triggers on 0, 6
      expect(notes.length).toBe(5);
    });
  });
});

describe('ORCA V11 Error Handling', () => {
  let ocra;

  beforeEach(() => {
    ocra = new TestOcraModule();
  });

  it('should handle empty grid gracefully', () => {
    ocra.grid = [];
    expect(() => ocra.runOrca()).not.toThrow();
  });

  it('should handle invalid characters gracefully', () => {
    ocra.grid[0][0] = 'X'; // Invalid operator
    ocra.grid[0][1] = 'Z'; // Invalid character

    expect(() => ocra.runOrca()).not.toThrow();
    const result = ocra.runOrca();
    expect(result.notes.length).toBe(0);
  });

  it('should handle very large values', () => {
    ocra.grid[0][0] = 'D';
    ocra.grid[0][1] = 'f'; // 15

    for (let i = 0; i < 30; i++) {
      expect(() => ocra.runOrca()).not.toThrow();
      ocra.orcaFrame++;
    }
  });
});
