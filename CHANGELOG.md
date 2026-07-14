# Changelog

All notable changes to V11 Peer DAW are documented here. The project follows
[Semantic Versioning](https://semver.org/) and the structure of
[Keep a Changelog](https://keepachangelog.com/).

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

[1.1.1]: https://github.com/fkr-0/v11-peer-daw/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/fkr-0/v11-peer-daw/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/fkr-0/v11-peer-daw/releases/tag/v1.0.0
