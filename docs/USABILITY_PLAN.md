# V11 Peer DAW usability plan

## Goal

Make V11 Peer DAW usable as a collaborative browser DAW, not only a patching demo.

## Current highest-impact gaps

1. **Session defaulting**
   - Default launch should enter one shared open studio session.
   - The UI should show the current session code, local participant state, and connected peers without requiring a manual SESSION click.
   - Peernet/PeerJS failures should degrade to local-first mode, not make the app appear dead.

2. **Workspace views**
   - Patch canvas stays useful as an overview, but the main pane needs real task views:
     - Session dashboard
     - Clip launcher/editor overview
     - Arrangement timeline overview
     - Mixer view
     - Focused module detail view

3. **Module usability**
   - Mixer modules need visible bus/level state.
   - Sequencer and piano-roll modules need a full-pane editing path.
   - Module cards should remain compact; full editing belongs in the workspace view.

4. **Project confidence**
   - Users need visible module count, route count, sample availability, active session, and sync mode.
   - E2E tests should cover default session bootstrap and workspace tabs.

## Implemented first slice

- Default shared session code: `V11-OPEN-STUDIO`.
- Local-first Peernet session bootstrap on app start.
- Workspace view shell with Session, Clips, Arrangement, Mixer, and Module tabs.
- Session view summarizes session code, participants, module count, and route counts.
- Clip, arrangement, mixer, and module views expose serious state instead of placeholder sidebar text.
- Peer status warnings are rendered instead of crashing when PeerJS transport is unavailable.

## Implemented through 1.5.0

- Editable clip slots, launch/stop/place operations, and project persistence.
- Full piano-roll and pattern editing paths with keyboard/grid operations.
- Serious mixer controls with master/channel level, pan, mute, and solo state.
- Two-client convergence and deterministic simultaneous-edit verification.
- Session-specific hubs, local presence heartbeat/pruning, and late-join room snapshots.
- Manual room-code joining, invite copying, sync status, and explicit sync recovery.
- Remote PeerJS room hydration, live project updates, acknowledgements, deduplication, and transport diagnostics.
- Persistent focus mode, independent side panels, collapsible production surfaces, and layout reset.
- Contextual workspace headings, direct keyboard view shortcuts, and accessible arrow-key tab navigation.
- Inspector drawers with live counts and remembered closed/open state.
- Toast feedback for important state-changing actions and responsive no-overflow verification.
- Typed operation collaboration for frequent controls and stable musical entities.
- Persistent per-room outbox, acknowledgements, retry/backoff, replay, deduplication,
  checkpoint compaction, and recovery export.
- Stable IDs and legacy migration for placements, slots, notes, and zones.
- Sync Center status, activity, pending delivery, conflicts, compatibility, and recovery UI.
- Incremental remote application that avoids whole-rig rebuilds for covered operations.

## Next implementation slices

### 1.4.0 release theme: Collaboration Confidence — implemented

- Replace frequent whole-project updates with typed, deterministic operations.
- Preserve snapshots for bootstrap, compatibility, structural edits, and recovery.
- Persist pending operations and acknowledgement/retry state per room.
- Add stable IDs to arrangement placements and other index-addressed musical entities.
- Add a Sync Center for delivery state, activity, conflicts, and recovery.
- Apply remote operations without replacing focused editors or workspace context.
- Expose live master peak/RMS, latency, sample-rate, and engine-state telemetry.
- Offer a persistent low-power visual monitoring mode for constrained devices.

Detailed design: `docs/plans/2026-07-14-v1.4.0-collaboration-confidence.md`.

### Slice 6: operation-level collaboration

- Replace whole-project last-writer-wins messages with typed operations where practical.
- Keep snapshot exchange for bootstrap and recovery.
- Add revision acknowledgements and explicit conflict indicators.

### Slice 7: remote transport diagnostics

- Add reconnect attempt history and route-level failure state for App Hub sub-lobbies.
- Persist acknowledgement/revision history across reconnects.
- Add hub-loss and hub-re-election soak verification.

### Slice 8: mixer and module depth

- Add real meters, sends, grouping, and bus routing.
- Add packet filters and route health to peer/wiring editors.
- Complete field-recorder export and sampler slice visualization.
