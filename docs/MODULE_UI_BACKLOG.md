# V11 Peer DAW module UI backlog

## Purpose

Track full-pane module editor coverage. Compact module cards are useful as overview widgets, but each module family needs a serious focused editor in the central workspace Module tab.

## Coverage states

- `done`: focused full-pane editor exists and is covered by e2e or unit contracts.
- `started`: a focused editor exists but needs deeper domain-specific controls.
- `todo`: only compact card or generic inspector exists.

## Current coverage

| Module/factory | Family | Focused UI status | Next work |
|---|---:|---:|---|
| `pianoroll` / default drum roll | sequencing | done | Add drag-select and piano keyboard audition. |
| `master`, `mixer`, `channel`, `mixerdesk` | mixing | done/started | Add bus routing, meters, sends, and grouping. |
| `clock`, `metronome` | transport | started | Add tap tempo, swing/groove, transport timeline control. |
| `effects`, `reverb`, `dubecho`, `delay`, `tapeecho`, `flanger`, `phaser`, `beatrepeat`, `beatlooper`, `graindelay`, `pitchshift` | effects | started | Add per-effect visual feedback, preset A/B, automation lanes. |
| `synth`, `cleansynth`, `polysynth`, `analogsynth`, `fmsynth`, `wavetablesynth`, `drumsynth` | instruments | started | Add oscillator/envelope/filter-specific panels and patch presets. |
| `sampler`, `drumsampler`, `multisampler` | sampling | started | Waveform, pad, cue, zone, metadata, and library-assignment editors exist; deepen slice visualization and repair UX. |
| `ocra`, `sequencer`, `basicseq`, `arp` | sequencing | started | Focused grid/pattern editors exist; add probability, scale lanes, and richer clip export. |
| `field` | capture | started | Take list, trim metadata, playback, and sample promotion exist; add recording timeline/export. |
| `peer`, `wiring` | collaboration/routing | started | Route and packet monitor exists; add packet filters, per-route health, and direct-peer diagnostics. |

## Implemented first batch

- Universal full-pane module inspector for every module:
  - title/kind/id
  - port list
  - incoming/outgoing patch counts
  - route-aware summary
- Clock editor:
  - BPM field updates the module and rerenders card state.
- Synth-style editor:
  - waveform, cutoff, and release controls when supported by the module.
  - audition button sends a test note when the module exposes `noteOn()`.
- Effect editor:
  - renders all module `params` sliders from the effect module spec.
  - uses the module's own `setParam()` so audio state and compact card stay in sync.

## Next implementation batch

1. Sampler/drum-sampler/multisampler focused editors:
   - waveform preview
   - sample library assignment
   - pad/slice map
   - missing-sample repair flow
2. OCRA/sequencer/arp focused editors:
   - full grid/pattern editor
   - quantization and scale controls
   - clip export into the Clips tab
3. Field recorder focused editor:
   - take list
   - trim/export
   - promote take to sample library
4. Peer/wiring focused editor:
   - peer packet router
   - route health
   - packet filter monitor
