# V11 Peer DAW

Modular peer-to-peer audio workstation with collaborative sessions.

## Features

- **Modular Architecture**: Plug-and-play audio modules
- **Peer-to-Peer Collaboration**: Real-time sessions via WebRTC
- **ORCA Integration**: Full ORCA sequencer as modular component
- **Field Recording**: Built-in audio capture and playback
- **Visual Patching**: Canvas-based routing interface
- **Storage Snapshots**: Save and restore rig configurations

## Quick Start

```bash
# Install dependencies
pnpm install

# Start development server
pnpm dev

# Build for production
pnpm build

# Run the local unit/build verification gate
pnpm verify:build

# Run the deploy-facing gate used by the app hub contract tests
pnpm verify:deploy

# Preview production build
pnpm preview
```

## Project Structure

```
v11-peer-daw/
├── src/
│   ├── core/          # Core audio & networking
│   ├── modules/       # Audio modules & processors
│   ├── ui/            # User interface components
│   ├── adapters/      # Protocol adapters
│   ├── crdt/          # Conflict resolution
│   └── app.js         # Main application
├── vendor/            # External dependencies
├── docs/              # Documentation
├── assets/            # Static assets
├── index.html         # Entry point
├── style.css          # Global styles
├── vite.config.js     # Vite configuration
├── biome.json         # Biome configuration
└── package.json       # Project metadata
```

## Module System

The DAW uses a modular architecture where each audio component is a self-contained module:

- **Inputs**: Clock, MIDI, Control, Audio
- **Outputs**: MIDI, Audio, Control
- **State**: Serializable configuration
- **UI**: Self-contained rendering

### Available Modules

#### Timing & Control
- `clock` - Transport clock
- `metronome` - Click track

#### Sequencers
- `ocra` - ORCA V11 grid sequencer
- `pianoroll` - MIDI piano roll
- `basicseq` - Step sequencer
- `arp` - Arpeggiator

#### Instruments
- `synth` - Basic synthesizer
- `cleansynth` - Polished synth voice
- `sampler` - Sample playback
- `multisampler` - Slice-based sampling

#### Effects
- `reverb` - Spatial ambience
- `dubecho` - Feedback delay
- `tapeecho` - Wow & flutter delay
- `flanger` - Jet sweep modulation
- `phaser` - Allpass sweep

#### Utilities
- `channel` - Gain/pan/mute strip
- `mixerdesk` - Master bus mixer
- `field` - Field recorder
- `beatlooper` - Beat repeat effect

#### Networking
- `peer` - Peer bridge for collaboration

## Example Sets

The Project I/O panel includes an **Example Sets** section with original tutorial rigs:

- **Detroit Pocket Study — Conant Gardens cover workflow**: demonstrates a dusty swung clock, drum roll, filtered bass, electric-key stabs, echo routing, peer notes, and master output.
- **Fall in Love Remix Sketch — original swing demo**: demonstrates longer-form remix sketching with shuffled drums, floating chords, FM counter-lines, filter automation, tape echo, and import/export.

These examples are educational and royalty-free. They do not include Slum Village samples, recordings, lyrics, or note-for-note melody transcriptions. Use **STAGE JSON** to inspect the example in the Project I/O text area, or **LOAD EXAMPLE** to rebuild the rack directly.

## Development

### Code Quality

```bash
# Check code (lint + format)
pnpm check

# Auto-fix issues
pnpm check:fix

# Format code
pnpm format

# Lint only
pnpm lint
```

### Building

The build process has two useful gates:

```bash
# DAW-local gate: Jest unit tests plus Vite production bundle
pnpm verify:build

# Deploy-facing gate: DAW gate plus regenerated hub catalog and DAW deploy asset contracts
pnpm verify:deploy
```

The hub deploy path builds `v11-peer-daw/dist`, includes that dist folder as the `v11-peer-daw` artifact target, then validates import paths and deploy assets from the root `tests/v11-peer-daw-*.test.mjs` contracts.

The build process creates optimized bundles with code splitting:

```
dist/
├── index.html
└── assets/
    ├── main-[hash].js
    ├── vendor-peerjs-[hash].js
    ├── vendor-peernet-[hash].js
    ├── core-audio-[hash].js
    └── ui-patch-[hash].js
```

## Architecture

### Core Systems

1. **Audio Runtime** - WebAudio context management
2. **Patch Bay** - Module routing and packet dispatch
3. **Peernet Stack** - P2P networking via PeerJS
4. **Routing Graph** - Visual connection management
5. **Storage Manager** - State persistence

### Module Contract

Every module implements:

```javascript
class ModuleBase extends ModuleBase {
  constructor(config) {
    super({
      id: 'unique-id',
      title: 'Module Name',
      kind: 'midi-generator', // midi-generator, instrument, effect, etc.
      inputs: [{ id: 'clock', type: PortType.CLOCK }],
      outputs: [{ id: 'midi', type: PortType.MIDI }]
    });
  }

  async start(context) { /* Initialize audio nodes */ }
  receive(packet) { /* Handle incoming packets */ }
  connectAudio(destination) { /* Connect to output */ }
  disconnectAudio() { /* Disconnect */ }
  render() { /* Render UI */ }
  serialize() { /* Save state */ }
}
```

## ORCA V11 Module

The redesigned ORCA module includes:

- Full 32×14 grid with ORCA operators
- Tutorial presets with explanations
- Per-row synth selection and mixer
- Real-time collaboration
- Visual feedback with cursor tracking

### Operators

- `D` - Delay (triggers every N frames)
- `O` - Oscillator (plays note)
- `C` - Clock (counter modulo E)
- `R` - Random (random 0..E)
- `A` - Add (E + W mod 16)
- `M` - Multiply (E * W mod 16)
- `V` - Variable (read/write storage)
- `E/W/N/S` - Direction triggers
- `*` - Bang (one-shot trigger)
- `#` - Wall (blocks propagation)

## Field Recorder

The field recorder module provides:

- Audio file loading and playback
- Real-time recording capability
- Sample library management
- Integration with modular routing

## Collaboration

V11 Peer DAW supports real-time collaboration:

1. Create a session (generates share code)
2. Share code with collaborators
3. Changes sync automatically
4. Audio packets broadcast over P2P
5. Storage snapshots for persistence

## App Hub V11 Integration

V11 Peer DAW integrates with the NEXUS App Hub v11 as a modular artifact:

- Launch from hub catalog
- Share sessions via hub lobby
- Storage managed by hub
- Theme integration
- Profile synchronization

## License

MIT

## Credits

Built with:
- Vite.js (build tooling)
- Biome (code quality)
- PeerJS (WebRTC networking)
- WebAudio API (audio processing)
