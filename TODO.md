# V11 Peer DAW remaining work

The original workspace-stub issues are resolved: Session, Signal Flow, Clips,
Samples, Arrangement, Mixer, and focused Module views now exist and are covered
by browser tests. This file tracks the remaining high-value work.

## Implemented in 1.4.0 — Collaboration Confidence

- Typed operations cover frequent scalar and stable musical-entity edits.
- Arrangement placements, clip slots, notes, and zones use stable IDs with legacy migration.
- The persisted journal covers acknowledgements, retry/backoff, replay,
  checkpoint compaction, deduplication, tombstones, conflicts, and recovery export.
- Protocol capability negotiation retains snapshot fallback for older clients.
- Sync Center exposes pending, acknowledged, retrying, conflicted, and recovered state.
- Protocol clocks, reducers, journal storage, retry scheduling, and Sync Center
  rendering are extracted into independently tested modules.

See `docs/plans/2026-07-14-v1.4.0-collaboration-confidence.md`.

## Collaboration

- Move module add/remove, graph/routing topology, presets, and sample-library
  metadata toward typed structural operations where incremental behavior is safe.
- Add vector-clock checkpoint rebasing for pending edits created against older snapshots.
- Extend conflict resolution beyond current rejected/missing-entity recovery paths.
- Move the remaining live-runtime collaboration adapter methods out of `src/app.js`.
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

- Continue splitting the large application controller into collaboration-runtime,
  workspace, and UI modules.
- Separate layout, toast, and
  workspace-navigation behavior from the remaining application controller.
- Avoid rebuilding full workspace HTML for controls that can update incrementally.
- Add long-session soak tests for hub re-election, peer reconnects, repeated room switches, and audio graph cleanup.
