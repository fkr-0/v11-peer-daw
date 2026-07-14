# V11 Peer DAW

Modular peer-to-peer audio workstation with collaborative sessions.

## Features

- **Modular Architecture**: Plug-and-play audio modules
- **Peer-to-Peer Collaboration**: Real-time sessions via WebRTC
- **ORCA Integration**: Full ORCA sequencer as modular component
- **Field Recording**: Built-in audio capture and playback
- **Visual Patching**: Canvas-based routing interface
- **Storage Snapshots**: Save and restore rig configurations
- **Flexible Workspace**: Persistent focus mode, independent panels, and collapsible production surfaces
- **Keyboard Workflow**: Command center, direct workspace shortcuts, and accessible arrow-key tab navigation

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
import { ModuleBase, PortType } from './src/core/contracts.js';

class ExampleModule extends ModuleBase {
  constructor(config = {}) {
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

1. Create or join a room using its share code.
2. Share the generated invite URL with collaborators.
3. Late joiners request the current project snapshot automatically.
4. Project updates travel over PeerJS/Peernet with a same-origin fallback.
5. Duplicate cross-transport messages are ignored deterministically.
6. Updates receive acknowledgements and expose transport diagnostics in Session view.
7. Audio/control packets continue to broadcast over P2P.
8. Storage snapshots remain available for persistence and recovery.

Use `?localSync=false` to disable the BroadcastChannel fallback while testing
or diagnosing the remote Peernet path. The Session panel shows project revision,
last transport activity, delivery counts, and acknowledgement state.

### Collaboration Confidence in 1.4

Frequent edits now travel as typed protocol-v2 operations instead of complete
project replacements. Mixer controls, tempo, module parameters, clip actions,
notes, sequencer steps, arrangement placements, loops, and multisampler zones
are applied incrementally and acknowledged by compatible peers.

The transport bar exposes a compact collaboration state. Open **Sync Center**
to inspect:

- Pending, partially acknowledged, retrying, rejected, and completed edits.
- Human-readable local and remote activity.
- Protocol compatibility and connected operation-capable peers.
- Conflicts requiring manual recovery.
- Snapshot recovery, immediate retry, journal export, and acknowledged-history cleanup.

Pending operations are persisted per room and browser-tab actor, replay after a
reload or reconnect, and compact after checkpoints. Duplicate local/Peernet
delivery is idempotent. Complete snapshots remain available for late joining,
older clients, structural module/routing changes, project imports, sample
binary assignment, and recovery.

Protocol details and operation-domain boundaries are documented in
`docs/COLLABORATION_PROTOCOL.md`.

## Workspace and Keyboard UX

The central DAW workspace can be adapted without losing project state:

- **Focus mode** hides both side panels and gives the editor the full width.
- **LEFT** and **RIGHT** independently toggle the setup and monitor panels.
- Patch Canvas and Module Rack can be collapsed when a focused editor needs more vertical space.
- Mixer, Routes, and Packet Monitor are independent persistent drawers.
- `Ctrl+1` through `Ctrl+7` open Session, Signal Flow, Clips, Samples, Arrangement, Mixer, and Module views.
- `Ctrl+Shift+L`, `Ctrl+Shift+R`, and `Ctrl+Shift+F` toggle the setup panel, monitor panel, and focus mode.
- Arrow keys, Home, and End move between workspace tabs when a tab has focus.
- Every layout action is also searchable from the `Ctrl+K` command center.

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
