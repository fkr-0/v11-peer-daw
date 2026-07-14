# Changelog

All notable changes to V11 Peer DAW are documented here. The project follows
[Semantic Versioning](https://semver.org/) and the structure of
[Keep a Changelog](https://keepachangelog.com/).

## [1.4.0] - 2026-07-14

### Added

- Collaboration protocol 2 with typed project operations, capability negotiation, targeted acknowledgements, and protocol-1 snapshot fallback.
- A persistent per-room operation journal with pending, partially acknowledged, retrying, rejected, applied, and checkpoint state.
- Bounded retry/backoff, reconnect replay, same-field operation coalescing, duplicate suppression, checkpoint compaction, and recovery export.
- Deterministic pure reducers for module parameters, mixer state, tempo, clip slots, notes, sequencer steps, arrangement placements/loops, multisampler zones, and atomic batches.
- Stable IDs and legacy migration for arrangement placements, clip slots, notes, and multisampler zones.
- A Sync Center with Overview, Pending Delivery, Activity, Conflicts, and Recovery sections.
- Compact `SYNCED`, `N PENDING`, `RECONNECTING`, `N CONFLICTS`, and `RECOVERED` status states in the transport bar.
- Command-center actions for opening Sync Center, retrying pending edits, and requesting a recovery snapshot.
- Browser coverage for incremental two-client convergence, zero-rig-rebuild scalar updates, payload-size reduction, persisted reload replay, and protocol-v2 simultaneous edits.

### Changed

- Frequent mixer, synth/effect/sampler, tempo, clip, piano-roll, grid, sequencer, OCRA, arrangement, and multisampler edits now publish typed operations rather than complete project snapshots.
- Whole-project snapshots remain the compatibility, bootstrap, module/graph topology, binary sample, import, and recovery mechanism.
- Same-field scalar conflicts resolve deterministically by Lamport clock and actor ID while unrelated fields merge independently.
- Local actor identity persists for the lifetime of a browser tab so pending operations survive reload without conflating separate collaborators.
- Remote operations update live module/runtime state directly and preserve the focused editor, selection, and workspace scroll where possible.
- Legacy project imports receive additive stable entity IDs without mutating the input document or breaking 1.3-era readers.

### Fixed

- Concurrent edits to different controls no longer replace one another through whole-rig last-writer-wins snapshots.
- Duplicate delivery through local and Peernet transports no longer mutates musical state twice.
- Pending edits no longer disappear across reload or a short disconnect.
- Older note, placement, or zone additions cannot resurrect entities deleted by a newer operation.
- Normal bootstrap checkpoints are no longer mislabeled as recovery events.
- Capability detection no longer mistakes one logical peer exposed through multiple transport roles for an incompatible client.
- Repeated continuous-control input is coalesced in the pending outbox instead of growing an unbounded series of obsolete field edits.

## [1.3.0] - 2026-07-14

### Added

- A persistent focus mode that expands the central editor and temporarily hides setup and monitoring panels.
- Independent setup-panel and monitor-panel controls, available from the top bar, keyboard shortcuts, and command center.
- Collapsible Patch Canvas and Module Rack surfaces with remembered expansion state.
- Context headers for every workspace view with a clear purpose, current title, and keyboard shortcut.
- Arrow-key tab navigation plus direct `Ctrl+1` through `Ctrl+7` workspace switching.
- Collapsible Mixer, Routes, and Packet Monitor inspector drawers with live item counts.
- Non-blocking toast feedback for transport, synchronization, layout, module, route, and clipboard actions.
- Command-center actions for all panel, focus, surface, and layout-reset operations.

### Changed

- The central workspace now uses responsive panel-width variables and can occupy the full application width.
- Session controls use explicit action names such as `RECONNECT`, `NEW SESSION`, and `SNAPSHOT`.
- Workspace tabs remain visible while scrolling and expose roving-tab accessibility semantics.
- Patch Canvas and Module Rack headers now explain their purpose and group related controls more clearly.
- The right inspector uses compact persistent drawers instead of one long undifferentiated column.
- Mobile and constrained-height layouts preserve the full command and workspace navigation without horizontal overflow.

### Fixed

- Saved closed drawer states now restore as closed instead of only restoring drawers saved as open.
- The inspector no longer enforces a width that can overflow narrow layouts.
- Focused-module view titles now update when the selected module changes.

## [1.2.0] - 2026-07-14

### Added

- Room-scoped project synchronization over the production Peernet transport, not only the same-origin BroadcastChannel fallback.
- A versioned request/snapshot/update/acknowledgement protocol with cross-transport message deduplication.
- Targeted Peernet snapshot and acknowledgement replies, retry/backoff for initial hydration, and automatic resync when peers appear.
- Per-transport send/receive timestamps, delivery counts, last acknowledgement state, and a project-sync dashboard card.
- Remote-only diagnostics through `?localSync=false` and deterministic browser coverage using the production shared core over a fake low-level PeerJS transport.
- A dedicated, unit-tested `ProjectSyncState` core module.

### Changed

- Peernet message subscriptions may now be registered before transport initialization and remain active after startup/reconnect.
- Project updates publish through both Peernet and the local fallback while retaining deterministic version/client conflict ordering.
- Manual `SYNC NOW` always performs a fresh room request instead of becoming a no-op after the first successful synchronization.
- The Session workspace now exposes project revision, transport activity, peer delivery counts, and direct synchronization recovery.

### Fixed

- Remote clients no longer require an App Hub sub-lobby or a same-browser fallback channel to receive the current project.
- Late PeerJS connections trigger a new hydration request instead of remaining on the default rig.
- Duplicate delivery of the same update over local and remote transports no longer rebuilds the project twice.

## [1.1.1] - 2026-07-14

### Added

- Automatic room-snapshot requests so a late joiner receives the current project without waiting for another edit.
- A visible project-sync status with version, last synchronization time, local-only fallback, and manual `SYNC NOW` recovery.
- A room-code input and `JOIN ROOM` action, including Enter-key submission and canonical invite-compatible room codes.

### Changed

- Room switches now close the previous local channel cleanly, reconnect the session-specific PeerJS hub, update the URL, and request the destination room state.
- Collaboration E2E coverage now includes late joining and manual room switching in addition to live convergence and simultaneous-edit resolution.

### Fixed

- New clients no longer start with a stale default rig when the room already contains edits.
- Session creation and room switching no longer announce a leave event with the destination room code on the old channel.

## [1.1.0] - 2026-07-14

### Added

- Session-specific PeerJS hub identities so separate DAW rooms no longer share one transport hub.
- Deterministic same-session conflict resolution for simultaneous local edits.
- Local-session heartbeat, stale-peer pruning, reconnect cleanup, and direct/hub/local peer counters.
- Copyable session invite URLs, a visible application version badge, and a concise network-health summary.
- Live parameter readouts for synth and mixer controls.
- Unit coverage for Peernet session isolation and FM zero-value parameters.
- End-to-end coverage for parallel test isolation, simultaneous edits, session convergence, project import/export, and the complete workspace flow.

### Changed

- Continuous range and number controls now update on the live `input` event without a duplicate `change` rebuild.
- The sidebar uses non-shrinking sections and reliable nested scrolling so Project I/O, Samples, and Examples remain clickable at constrained heights.
- Workspace tabs expose current selection semantics, focused module cards are visually marked, and small-screen layouts scroll naturally.
- Starfield rendering adapts to device capability, pauses in background tabs, and honors reduced-motion preferences.
- Existing stored sessions refresh their title, code, and open-collaboration metadata when reopened.

### Fixed

- Packet-route totals now refresh immediately after routes change.
- FM modulation index can be set to `0` instead of reverting to the previous value.
- Editing one numeric control no longer destroys the next slider before its gesture begins.
- Drum-pad actions now produce clear, searchable event-log messages.
- Local peers that close unexpectedly no longer remain indefinitely in the participant count.
- URL-based joining no longer starts the Peernet stack twice.

## [1.0.0] - 2026-05-11

### Added

- Initial standalone V11 Peer DAW repository and modular collaborative workstation baseline.

[1.4.0]: https://github.com/fkr-0/v11-peer-daw/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/fkr-0/v11-peer-daw/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/fkr-0/v11-peer-daw/compare/v1.1.1...v1.2.0
[1.1.1]: https://github.com/fkr-0/v11-peer-daw/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/fkr-0/v11-peer-daw/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/fkr-0/v11-peer-daw/releases/tag/v1.0.0
