# V11 Peer DAW Architecture

## System Overview

V11 Peer DAW is a modular, peer-to-peer audio workstation built on WebAudio and WebRTC. The system is designed around autonomous modules that communicate via a central patch bay, with collaborative sessions powered by PeerJS.

## Core Architecture

### Layer Structure

```
┌─────────────────────────────────────────────────────────────┐
│                      Application Layer                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │   UI Layer   │  │  Patch Canvas │  │ Inspector UI │    │
│  └──────────────┘  └──────────────┘  └──────────────┘    │
├─────────────────────────────────────────────────────────────┤
│                      Module Layer                           │
│  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐      │
│  │Clock │  │ ORCA │  │Synth │  │Reverb│  │Peer  │ ... │
│  └──────┘  └──────┘  └──────┘  └──────┘  └──────┘      │
├─────────────────────────────────────────────────────────────┤
│                      Core Services                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │ Audio Runtime│  │  Patch Bay   │  │Routing Graph │    │
│  └──────────────┘  └──────────────┘  └──────────────┘    │
├─────────────────────────────────────────────────────────────┤
│                    Networking Layer                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │ Peernet Stack│  │   PeerJS     │  │ Storage Mgr  │    │
│  └──────────────┘  └──────────────┘  └──────────────┘    │
├─────────────────────────────────────────────────────────────┤
│                      Platform Layer                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │  WebAudio    │  │   WebRTC     │  │ localStorage │    │
│  └──────────────┘  └──────────────┘  └──────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

## Module System

### Module Contract

Every module implements the `ModuleBase` interface:

```typescript
interface ModuleConfig {
  id: string;
  title: string;
  kind: ModuleKind;
  inputs: Port[];
  outputs: Port[];
}

interface Module {
  id: string;
  title: string;
  kind: ModuleKind;
  inputs: Port[];
  outputs: Port[];
  output?: AudioNode;

  start(context: AudioContext): Promise<void>;
  receive(packet: Packet): void;
  connectAudio(destination: AudioNode): void;
  disconnectAudio(): void;
  mount(element: HTMLElement): void;
  render(): void;
  serialize?(): ModuleState;
}
```

### Port Types

```typescript
enum PortType {
  CLOCK = 'clock',      // Transport timing
  MIDI = 'midi',        // Note/control data
  CONTROL = 'control',  // Parameter changes
  AUDIO = 'audio'       // Audio signal
}
```

### Packet Protocol

All inter-module communication uses JSON-serializable packets:

```typescript
interface Packet {
  kind: PortType;
  type: string;
  at: number;           // AudioContext time
  audioTime: number;    // Scheduled time
  dueAt: number;        // Wall clock time

  // Type-specific data
  note?: string;
  velocity?: number;
  gate?: number;
  step?: number;
  bpm?: number;
  value?: number;
}
```

## Audio Architecture

### Graph Flow

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Source    │────▶│   Effect    │────▶│    Mix      │
│  Modules    │     │   Modules   │     │   Modules   │
└─────────────┘     └─────────────┘     └─────────────┘
       │                                      │
       └──────────────┬───────────────────────┘
                      ▼
              ┌─────────────┐
              │ Destination │
              │   (Speakers) │
              └─────────────┘
```

### Time Management

The system uses a hybrid timing approach:

1. **Audio Time**: `AudioContext.currentTime` for scheduling
2. **Wall Clock**: `Date.now()` for UI updates
3. **Transport Time**: Frame/step counters for sequencing

### Scheduling Strategy

```javascript
// Look-ahead scheduling (100ms window)
const lookAhead = 0.1;
const scheduleAhead = 0.05;

function schedule() {
  while (nextNoteTime < audioCtx.currentTime + lookAhead) {
    scheduleNote(nextNoteTime);
    nextNoteTime += secondsPerBeat;
  }
}
```

## ORCA V11 Module

### Grid Representation

The ORCA grid is a 32×14 character array:

```javascript
const grid = [
  'D8...........................',  // Row 0
  'O4...........................',  // Row 1
  '.............................',
  // ... 11 more rows
];
```

### Operator Execution

Each frame, the ORCA engine:

1. **Reset triggers**: Clear active cell tracking
2. **Evaluate operators**: Process each cell left-to-right, top-to-bottom
3. **Propagate bangs**: Spread triggers to neighbors
4. **Emit notes**: Generate MIDI packets for oscillator operators
5. **Update UI**: Render grid with active cells highlighted

### Operator Implementation

```javascript
// Example: Delay operator
if (c === 'D') {
  const rate = gv(x + 1, y);     // East neighbor
  const offset = gv(x - 1, y);   // West neighbor
  const frame = orcaFrame - offset;

  if (frame >= 0 && frame % rate === 0) {
    // Trigger south neighbor
    if (y + 1 < GH) trig[y + 1][x] = true;
  }
}
```

## Peer Networking

### Connection Flow

```
┌─────────┐         ┌─────────┐         ┌─────────┐
│  Host   │◀───────▶│ PeerJS │◀───────▶│  Guest  │
└─────────┘         └─────────┘         └─────────┘
     │                   │                   │
     └───────────────────┴───────────────────┘
                     │
                     ▼
              ┌─────────────┐
              │  Signaling  │
              │   Server    │
              └─────────────┘
```

### Session Management

1. **Host** creates session → Generates share code
2. **Guest** joins with code → Connects to host
3. **State sync** → Initial grid/mixer configuration
4. **Real-time updates** → Cell edits, parameter changes
5. **Audio packets** → MIDI/control data broadcast

### Data Sync Strategy

```javascript
// Host broadcasts all state
function broadcastState() {
  const state = {
    type: 'full_sync',
    grid: serializeGrid(),
    bpm: currentBpm,
    mixer: serializeMixer()
  };
  broadcast(state);
}

// Guests send edits
function sendCellEdit(x, y, char) {
  const edit = { type: 'cell', x, y, char };
  sendToHost(edit);
}
```

## Storage System

### Persistence Layers

1. **localStorage-compatible storage**: sample-library snapshots and UI preferences
2. **Project packages**: complete rig state as JSON, inline-sample JSON, or stored ZIP archive
3. **Session snapshots**: peer/shared rig state exchanged through the collaboration layer

IndexedDB is not currently implemented in this repository. Treat IndexedDB-backed audio storage as a future persistence option until a concrete adapter and tests exist.

### Snapshot Schema

```json
{
  "version": 1,
  "timestamp": "2026-05-11T12:00:00Z",
  "modules": [
    {
      "id": "main-ocra",
      "kind": "midi-generator",
      "title": "OCRA V11",
      "grid": ["D8...", "O4..."],
      "rowStates": [...]
    }
  ],
  "routes": [
    {
      "from": { "moduleId": "main-clock", "outputId": "clock" },
      "to": { "moduleId": "main-ocra", "inputId": "clock" }
    }
  ]
}
```

## Field Recorder

### Recording Pipeline

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Mic Input  │────▶│  Recorder   │────▶│    Buffer   │
└─────────────┘     └─────────────┘     └─────────────┘
                            │
                            ▼
                     ┌─────────────┐
                     │  Encoded    │
                     │    Data     │
                     └─────────────┘
```

### Sample Management

- **Upload**: File input → Array buffer → Audio buffer
- **Store**: Float32 → Int16 PCM → Base64 → LocalStorage
- **Retrieve**: Base64 → Int16 → Float32 → Audio buffer

## Performance Considerations

### Optimization Strategies

1. **Code Splitting**: Separate bundles for vendor/feature code
2. **Lazy Loading**: Modules loaded on demand
3. **Virtual Scrolling**: Large UI lists render viewport only
4. **Throttle UI Updates**: Limit render frequency (60fps max)
5. **Audio Worklet**: Offload processing when possible

### Memory Management

- **Audio Buffers**: Limit size, reuse when possible
- **Grid State**: Compress when storing
- **Event Listeners**: Clean up on module removal
- **Canvas**: Single shared context for visualizations

## Security Considerations

### Input Validation

- Sanitize all user input before grid insertion
- Validate packet structure before processing
- Limit file upload sizes

### Network Security

- PeerJS provides encrypted WebRTC connections
- No sensitive data in broadcast packets
- Session codes are one-time use

## Future Enhancements

1. **Audio Worklet**: Move DSP to worker thread
2. **WASM Modules**: High-performance DSP
3. **Plugin System**: Third-party module support
4. **Cloud Storage**: Backup/sync to cloud
5. **Mobile Support**: Touch-optimized UI
6. **MIDI Hardware**: Physical controller support
