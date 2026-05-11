// V11 Peer DAW/src/modules/ocra-v11.js
// Redesigned OCRA Module - Full ORCA functionality as modular component

import { ModuleBase, PortType, createMidiPacket, uid } from '../core/contracts.js';

// ORCA Constants
const GW = 32;
const GH = 14;
const PENTA = [0, 2, 4, 7, 9];
const OP_CHARS = 'DOCARMVEWNS';
const SYNTHS = ['saw', 'sin', 'kick', 'snare', 'hihat', 'bass'];

// Operator Definitions
const _OP_INFO = [
  {
    c: 'D',
    name: 'Delay',
    desc: 'Bangs every N frames. E=rate, W=offset',
    ex: '4D8 = offset 4, rate 8',
  },
  {
    c: 'O',
    name: 'Oscillator',
    desc: 'Plays note. E=note val, S=octave',
    ex: 'O4 = note 4, octave 3',
  },
  { c: 'C', name: 'Clock', desc: 'Counter modulo E, writes hex south', ex: 'C8 = count 0-7' },
  { c: 'R', name: 'Random', desc: 'Random 0..E, writes hex south', ex: 'R8 = rand 0-7' },
  { c: 'A', name: 'Add', desc: 'E + W mod 16, writes south', ex: '4A8 = 12' },
  { c: 'M', name: 'Multiply', desc: 'E * W mod 16, writes south', ex: '3M4 = 12' },
  { c: 'V', name: 'Variable', desc: 'Read/write global storage', ex: 'V8 = store 8' },
  { c: 'E', name: 'East', desc: 'Bang east when triggered', ex: '*E = bang right' },
  { c: 'W', name: 'West', desc: 'Bang west when triggered', ex: '*W = bang left' },
  { c: 'N', name: 'North', desc: 'Bang north when triggered', ex: '*N = bang up' },
  { c: 'S', name: 'South', desc: 'Bang south when triggered', ex: '*S = bang down' },
  { c: '*', name: 'Bang', desc: 'Triggers neighbors once, clears', ex: '* = one-shot' },
  { c: '#', name: 'Wall', desc: 'Blocks propagation', ex: '# = blocker' },
];

// Tutorial Presets
const PRESETS = {
  'Basic Pulse': {
    bpm: 120,
    notes:
      'Four D+O pairs at different rates.\n\nD8 triggers every 8 frames (2 beats).\nO4 plays note 4 (G) at octave 3.\n\nEach O is below its D — triggers propagate south.',
    grid: [
      'D8...........................',
      'O4...........................',
      '.............................',
      'D4...........................',
      'O9...........................',
      '.............................',
      'D6...........................',
      'O7...........................',
      '.............................',
      'D3...........................',
      'Oc...........................',
      '.............................',
      '.............................',
      '.............................',
    ],
    mixer: {
      1: { synth: 'saw' },
      4: { synth: 'saw' },
      7: { synth: 'sin' },
      10: { synth: 'sin' },
    },
  },
  Arpeggio: {
    bpm: 140,
    notes:
      'Staggered D offsets create arpeggios.\n\n0D4=offset 0, 1D4=offset 1, etc.\nEach O plays a different note = C-E-G-A.',
    grid: [
      '0D4..........................',
      'O0...........................',
      '.............................',
      '1D4..........................',
      'O2...........................',
      '.............................',
      '2D4..........................',
      'O4...........................',
      '.............................',
      '3D4..........................',
      'O7...........................',
      '.............................',
      '.............................',
      '.............................',
    ],
    mixer: {
      1: { synth: 'saw' },
      4: { synth: 'saw' },
      7: { synth: 'saw' },
      10: { synth: 'saw' },
    },
  },
};

export class OcraV11Module extends ModuleBase {
  constructor(config = {}) {
    super({
      id: config.id || uid('ocra'),
      title: config.title || 'OCRA V11',
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

    // ORCA Engine State
    this.grid = [];
    this.orcaFrame = 0;
    this.cursorX = 0;
    this.cursorY = 0;
    this.vars = {};

    // Audio State
    this.ctx = null;
    this.output = null;
    this.rowGains = [];
    this.rowStates = [];

    // UI State
    this.showContextMenu = false;
    this.contextMenuExpanded = false;

    // Initialize
    this.initGrid();
    this.initRowStates();
  }

  initGrid() {
    this.grid = [];
    for (let i = 0; i < GH; i++) {
      this.grid.push(new Array(GW).fill('.'));
    }
    if (PRESETS['Basic Pulse']) {
      this.loadGrid(PRESETS['Basic Pulse'].grid);
    }
  }

  loadGrid(g) {
    for (let y = 0; y < GH; y++) {
      for (let x = 0; x < GW; x++) {
        this.grid[y][x] = g[y]?.[x] ? g[y][x] : '.';
      }
    }
  }

  initRowStates() {
    for (let i = 0; i < GH; i++) {
      this.rowStates.push({
        vol: 0.7,
        mute: false,
        solo: false,
        synth: 'saw',
        activity: 0,
      });
    }
  }

  async start(context) {
    this.ctx = context;
    if (!this.output) {
      this.output = this.ctx.createGain();
      this.output.gain.value = 0.7;

      for (let i = 0; i < GH; i++) {
        const g = this.ctx.createGain();
        g.gain.value = 0.7;
        g.connect(this.output);
        this.rowGains.push(g);
      }
    }
  }

  receive(packet) {
    if (packet.kind !== PortType.CLOCK || packet.type !== 'step') return;

    this.orcaFrame++;
    const result = this.runOrca();
    this.handleNotes(result.notes, packet.at);
    this.renderGrid(result.act);
  }

  // ORCA Engine Methods
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
    return n < 10 ? String(n) : String.fromCharCode(87 + n);
  }

  noteFreq(nv, oct) {
    const s = PENTA[nv % 5] + Math.floor(nv / 5) * 12;
    return 440 * 2 ** (((oct + 1) * 12 + s - 69) / 12);
  }

  runOrca() {
    const trig = [];
    const act = [];
    const notes = [];

    for (let i = 0; i < GH; i++) {
      trig.push(new Array(GW).fill(false));
      act.push(new Array(GW).fill(false));
    }

    for (let y = 0; y < GH; y++) {
      for (let x = 0; x < GW; x++) {
        const c = this.grid[y][x];
        if (c === '.' || c === '#') continue;

        let bang = false;
        const t = trig[y][x];

        if (c === '*') {
          bang = true;
          if (y > 0) trig[y - 1][x] = true;
          if (y + 1 < GH) trig[y + 1][x] = true;
          if (x > 0) trig[y][x - 1] = true;
          if (x + 1 < GW) trig[y + 1][x] = true;
          this.grid[y][x] = '.';
        } else if (c === 'D') {
          const r = Math.max(1, this.gv(x + 1, y) || 1);
          const off = this.gv(x - 1, y);
          const idx = this.orcaFrame - off;
          if (idx >= 0 && idx % r === 0) {
            bang = true;
            if (y + 1 < GH) trig[y + 1][x] = true;
          }
        } else if (c === 'O') {
          if (t) {
            const n = this.gv(x + 1, y);
            const o = this.gv(x, y + 1) || 3;
            notes.push({ note: n, oct: o, row: y });
            bang = true;
          }
        } else if (c === 'C') {
          const m = Math.max(1, this.gv(x + 1, y) || 8);
          const out = this.orcaFrame % m;
          if (y + 1 < GH) {
            const h = this.toH(out);
            if (this.grid[y + 1][x] === '.' || this.isV(this.grid[y + 1][x])) {
              this.grid[y + 1][x] = h;
            }
            trig[y + 1][x] = true;
          }
          bang = true;
        } else if (c === 'R') {
          if (t) {
            const mx = Math.max(1, this.gv(x + 1, y) || 8);
            const rout = Math.floor(Math.random() * mx);
            if (y + 1 < GH) {
              const rh = this.toH(rout);
              if (this.grid[y + 1][x] === '.' || this.isV(this.grid[y + 1][x])) {
                this.grid[y + 1][x] = rh;
              }
              trig[y + 1][x] = true;
            }
            bang = true;
          }
        }

        act[y][x] = bang;
      }
    }

    return { act, notes };
  }

  handleNotes(notes, audioTime) {
    for (const n of notes) {
      if (!this.isRowAudible(n.row)) continue;

      const _f = this.noteFreq(n.note, n.oct);
      const g = this.rowGains[n.row];
      g.gain.value = this.rowStates[n.row].vol;

      this.emitPacket(
        createMidiPacket('note-on', {
          note: `ORCA-${n.note}`,
          velocity: 0.7,
          gate: 0.25,
          at: audioTime,
        }),
        'midi'
      );

      this.emitPacket(
        createMidiPacket('note-off', {
          note: `ORCA-${n.note}`,
          velocity: 0,
          at: audioTime + 0.25,
        }),
        'midi'
      );

      this.rowStates[n.row].activity = 1;
    }
  }

  isRowAudible(r) {
    const anySolo = this.rowStates.some((s) => s.solo);
    if (anySolo) return this.rowStates[r].solo && !this.rowStates[r].mute;
    return !this.rowStates[r].mute;
  }

  connectAudio(destination) {
    if (this.output && destination) {
      this.output.connect(destination);
    }
  }

  disconnectAudio() {
    try {
      this.output?.disconnect();
    } catch (_) {}
  }

  serialize() {
    return {
      id: this.id,
      kind: this.kind,
      title: this.title,
      grid: this.grid,
      rowStates: this.rowStates.map((s) => ({
        vol: s.vol,
        mute: s.mute,
        solo: s.solo,
        synth: s.synth,
      })),
    };
  }

  render() {
    if (!this.root) return;

    this.root.innerHTML = `
      <div class="ocra-v11-container">
        <div class="module-head">
          <span>▧</span>
          <strong>${this.title}</strong>
          <small>ORCA V11 · CLOCK IN / MIDI + AUDIO OUT</small>
        </div>

        <div class="ocra-controls">
          <select class="ocra-preset">
            <option value="">Load Preset...</option>
            ${Object.keys(PRESETS)
              .map((name) => `<option value="${name}">${name}</option>`)
              .join('')}
          </select>
          <button class="ocra-clear">Clear Grid</button>
          <button class="ocra-help">Help</button>
        </div>

        <div class="ocra-grid-wrapper">
          <canvas class="ocra-grid-canvas" tabindex="0"></canvas>
        </div>

        <div class="ocra-mixer">
          ${this.rowStates
            .map(
              (_, i) => `
            <div class="ocra-mixer-strip" data-row="${i}">
              <span class="mix-lbl">R${String(i).padStart(2, '0')}</span>
              <select class="mix-synth" data-row="${i}">
                ${SYNTHS.map((s) => `<option value="${s}">${s}</option>`).join('')}
              </select>
              <input type="range" class="mix-vol" min="0" max="100" value="70" data-row="${i}">
              <button class="mix-btn" data-action="mute" data-row="${i}">M</button>
              <button class="mix-btn" data-action="solo" data-row="${i}">S</button>
              <div class="vu"><div class="vu-fill" style="height:0%"></div></div>
            </div>
          `
            )
            .join('')}
        </div>

        <div class="ocra-notes">
          <div class="notes-header">
            <small>ORCA Notes</small>
            <button class="notes-toggle">+</button>
          </div>
          <div class="notes-content">
            <p class="microcopy">Right-click grid for operator menu. Space = bang. Arrow keys to navigate.</p>
          </div>
        </div>
      </div>
    `;

    this.bindEvents();
    this.initCanvas();
    this.renderGrid(null);
  }

  bindEvents() {
    const preset = this.root.querySelector('.ocra-preset');
    if (preset) {
      preset.addEventListener('change', (e) => {
        const name = e.target.value;
        if (name && PRESETS[name]) {
          this.loadGrid(PRESETS[name].grid);
          this.renderGrid(null);
          e.target.value = '';
        }
      });
    }

    const clearBtn = this.root.querySelector('.ocra-clear');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        this.initGrid();
        this.renderGrid(null);
      });
    }

    const mixer = this.root.querySelector('.ocra-mixer');
    if (mixer) {
      mixer.addEventListener('input', (e) => {
        const row = Number.parseInt(e.target.dataset.row);
        if (Number.isNaN(row)) return;

        if (e.target.classList.contains('mix-vol')) {
          this.rowStates[row].vol = e.target.value / 100;
          if (this.rowGains[row]) {
            this.rowGains[row].gain.value = this.rowStates[row].vol;
          }
        }
        if (e.target.classList.contains('mix-synth')) {
          this.rowStates[row].synth = e.target.value;
        }
      });

      mixer.addEventListener('click', (e) => {
        if (!e.target.classList.contains('mix-btn')) return;
        const row = Number.parseInt(e.target.dataset.row);
        const action = e.target.dataset.action;

        if (action === 'mute') {
          this.rowStates[row].mute = !this.rowStates[row].mute;
          e.target.classList.toggle('mute-on', this.rowStates[row].mute);
        }
        if (action === 'solo') {
          this.rowStates[row].solo = !this.rowStates[row].solo;
          e.target.classList.toggle('solo-on', this.rowStates[row].solo);
        }
      });
    }
  }

  initCanvas() {
    const canvas = this.root.querySelector('.ocra-grid-canvas');
    if (!canvas) return;

    const CELL = 16;
    const GAP = 1;
    const STEP = CELL + GAP;

    canvas.width = GW * STEP + GAP;
    canvas.height = GH * STEP + GAP;
    canvas.style.width = `${canvas.width}px`;
    canvas.style.height = `${canvas.height}px`;

    this.canvasCtx = canvas.getContext('2d');
    this.canvasCell = CELL;
    this.canvasGap = GAP;
    this.canvasStep = STEP;
  }

  renderGrid(act) {
    if (!this.canvasCtx) return;

    const ctx = this.canvasCtx;
    const W = this.canvasCtx.canvas.width;
    const H = this.canvasCtx.canvas.height;

    // Background
    ctx.fillStyle = '#04040e';
    ctx.fillRect(0, 0, W, H);

    // Grid columns
    for (let x = 0; x < GW; x++) {
      if (x % 4 === 0) {
        ctx.fillStyle = 'rgba(0, 240, 255, 0.025)';
        ctx.fillRect(
          this.canvasGap + x * this.canvasStep,
          0,
          this.canvasStep * 4 - this.canvasGap,
          H
        );
      }
    }

    // Draw cells
    for (let y = 0; y < GH; y++) {
      for (let x = 0; x < GW; x++) {
        const px = this.canvasGap + x * this.canvasStep;
        const py = this.canvasGap + y * this.canvasStep;
        const c = this.grid[y][x];
        const active = act?.[y][x];
        const isCur = x === this.cursorX && y === this.cursorY;

        // Cell background
        if (c !== '.') {
          let bg = 'rgba(0, 240, 255, 0.06)';
          if (active) bg = 'rgba(0, 240, 255, 0.25)';
          else if (this.isOp(c)) bg = 'rgba(153, 0, 255, 0.08)';
          else if (this.isV(c)) bg = 'rgba(0, 240, 255, 0.05)';
          else if (c === '*') bg = 'rgba(255, 0, 170, 0.3)';
          else if (c === '#') bg = 'rgba(255, 255, 255, 0.03)';

          ctx.fillStyle = bg;
          ctx.fillRect(px, py, this.canvasCell, this.canvasCell);
        }

        // Active glow
        if (active) {
          ctx.save();
          ctx.shadowColor = c === '*' ? '#ff00aa' : '#00f0ff';
          ctx.shadowBlur = 8;
          ctx.fillStyle = 'rgba(0, 240, 255, 0.08)';
          ctx.fillRect(px, py, this.canvasCell, this.canvasCell);
          ctx.restore();
        }

        // Character
        if (c !== '.' && c !== '#') {
          let fg = '#224466';
          if (active) fg = c === '*' ? '#ff44cc' : '#00f0ff';
          else if (this.isOp(c)) fg = '#9966cc';
          else if (this.isV(c)) fg = '#3388aa';

          ctx.fillStyle = fg;
          ctx.font = '10px "JetBrains Mono"';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(c, px + this.canvasCell / 2, py + this.canvasCell / 2);
        } else if (c === '#') {
          ctx.fillStyle = '#1a1a2e';
          ctx.fillRect(px, py, this.canvasCell, this.canvasCell);
        }

        // Cursor
        if (isCur) {
          ctx.strokeStyle = '#00f0ff';
          ctx.lineWidth = 1;
          ctx.strokeRect(px + 0.5, py + 0.5, this.canvasCell - 1, this.canvasCell - 1);
        }
      }
    }

    // Update VU meters
    this.updateVU();
  }

  updateVU() {
    if (!this.root) return;

    for (let i = 0; i < GH; i++) {
      const strip = this.root.querySelector(`.ocra-mixer-strip[data-row="${i}"]`);
      if (!strip) continue;

      const vu = strip.querySelector('.vu-fill');
      if (vu) {
        const activity = this.rowStates[i].activity * 100;
        vu.style.height = `${Math.min(100, activity)}%`;
        vu.style.background = activity > 70 ? '#ff00aa' : activity > 40 ? '#9900ff' : '#00f0ff';
        this.rowStates[i].activity *= 0.82;
        if (this.rowStates[i].activity < 0.01) {
          this.rowStates[i].activity = 0;
        }
      }

      // Update mute/solo buttons
      const muteBtn = strip.querySelector('[data-action="mute"]');
      const soloBtn = strip.querySelector('[data-action="solo"]');
      if (muteBtn) muteBtn.classList.toggle('mute-on', this.rowStates[i].mute);
      if (soloBtn) soloBtn.classList.toggle('solo-on', this.rowStates[i].solo);
    }
  }
}
