# V11 Peer DAW remaining work

The original workspace-stub issues are resolved: Session, Signal Flow, Clips,
Samples, Arrangement, Mixer, and focused Module views now exist and are covered
by browser tests. This file tracks the remaining high-value work.

## Collaboration

- Move frequent edits from whole-project snapshots toward typed operations.
- Add revision acknowledgements and a visible unresolved-conflict state.
- Persist revision acknowledgements across reconnects and expose unacknowledged revisions.
- Add retry/backoff diagnostics for App Hub sub-lobbies and sample transfer paths.

## Mixer

- Add live peak/RMS meters.
- Add bus routing, sends, channel grouping, and routing-target controls.
- Preserve the compact bottom mixer as an overview only.

## Focused module editors

- Samplers: deeper slice visualization and missing-sample repair.
- OCRA/sequencer/arp: probability, scales, lanes, and richer clip export.
- Field recorder: real recording timeline and take export.
- Peer/wiring: packet filters, route health, and direct-peer diagnostics.

## Performance and reliability

- Split the large application controller into collaboration, workspace, and UI modules.
- Avoid rebuilding full workspace HTML for controls that can update incrementally.
- Add long-session soak tests for hub re-election, peer reconnects, repeated room switches, and audio graph cleanup.
