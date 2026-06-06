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

## Next implementation slices

### Slice 2: editable clips

- Bind clips view to `src/core/clips-arrangement.js`.
- Add clip create/delete buttons.
- Add quantized launch/stop operations.
- Persist clip slots in project export/import.

### Slice 3: full piano roll view

- Use focused module view for piano-roll modules.
- Add note grid, velocity lane, and automation lane preview.
- Add keyboard shortcuts for drawing/deleting notes.

### Slice 4: serious mixer

- Expand mixer view with per-channel level, mute, solo, pan, and routing target.
- Keep mini mixer strip as overview only.
- Persist mixer state in project JSON.

### Slice 5: real multi-client verification

- Add a mock PeerJS transport for deterministic two-page e2e tests.
- Verify two browser pages enter `V11-OPEN-STUDIO` and converge on session participants/project state.
- Verify a module added by one page appears on the other page.
