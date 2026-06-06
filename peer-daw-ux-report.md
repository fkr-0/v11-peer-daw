# V11 Peer DAW -- UX Analysis Report

**Date:** 2026-06-05
**Scope:** Full interface review -- composing and operating workflows
**Codebase state:** Post-signal-chain and drum sampler UX pass

---

## 1. Overall Layout

The application uses a three-column layout: **sidebar (200px)**, **center rack (flex)**, **inspector (240px)**. A persistent top bar provides transport controls (Boot Audio, Start Clock, Stop) and status indicators for audio and peer state.

### Strengths

- **Clear spatial hierarchy.** The three columns separate browsing/config (left), composition (center), and monitoring (right). This is a well-established DAW pattern.
- **Compact top bar.** Transport, audio status, and peer status are always visible. The user never has to hunt for play/stop.
- **Dark theme with accent colors per module kind.** Module cards in the rack receive border colors by kind (clock, sequencer, instrument, effect, network, utility), providing instant visual classification.

### Issues

- **Fixed column widths with no resize handles.** The sidebar (200px) and inspector (240px) are static. Users with wide monitors waste space; users on smaller screens may find the center cramped. The inspector has `resizable-mixer` class but no drag-resize logic is implemented.
- **No keyboard shortcut overlay.** Transport controls lack visible keybindings. Space for play/pause, numbers for view switching, and similar shortcuts are not discoverable in the UI.
- **Footer is low-value.** The footer repeats the brand line and links to architecture docs. This space could house a status bar with beat count, CPU usage, or active peer count.

---

## 2. Left Sidebar

The sidebar contains the module palette (Add Module dropdown), session/peer panel, and three collapsible drawers (Project I/O, Samples, Examples).

### Strengths

- **Clean `<details>` drawers.** Project I/O, Samples, and Examples collapse out of the way. This was a significant improvement from the prior layout where non-operating panels cluttered the sidebar.
- **Well-organized module dropdown.** Modules are grouped by category (Timing & Control, Sequencers, Instruments, Effects, Utilities, Networking) with clear labels.
- **Session panel consolidation.** Peer list, sub-lobby controls, pilot name, session code, and snapshot button are grouped together logically.

### Issues

- **No search/filter for modules.** With 25+ module types in the dropdown, users must scroll through optgroups. A type-to-filter input would reduce friction for power users.
- **Session panel is dense.** The peer panel packs pilot name input, session code, 3 buttons (Connect, Session, Snap), sub-lobby status, block-join checkbox, 3 sub-lobby buttons (Host, New Room, Carry), and two peer lists into a narrow 200px column. Visual hierarchy is flat -- everything is the same size.
- **No visual feedback on SNAP/CONNECT success.** Buttons lack loading/success states. After clicking CONNECT or SNAP, the user must check the event log or peer list to confirm the action worked.
- **Drawer states are not persisted.** Refreshing the page resets all drawers to closed, even if the user was actively working with the sample library.
- **Sample library tree lacks drag-to-module.** The tree renders draggable sample items but there is no visible drop target indicator on module cards in the rack.

---

## 3. Center Rack

The center column is the primary workspace area, divided into three vertical sections:

1. **Workspace tabs + main view** (top, max-height 480px)
2. **Patch canvas** (middle)
3. **Module rack** (bottom, scrollable grid)

### 3.1 Workspace Tabs

Six tabs: **Session, Chains, Clips, Arrange, Mixer, Module**. A Reset button returns to Session view.

**Issue: Tab switching has no transition.** Content swaps instantly via innerHTML replacement. This causes a jarring flash, especially when switching between data-heavy views like Mixer and Arrangement. A CSS transition or crossfade would smooth navigation.

**Issue: Active tab state is only visual.** There is no URL hash or query param reflecting the current view. Refreshing always returns to Session. Deep-linking to a specific view is not possible.

**Issue: The "Module" tab auto-selects a focused module.** If no module is explicitly focused, it falls through a priority chain (hovered card > first piano roll > first midi-generator > first module). This heuristic is invisible to the user and can be confusing when the wrong module appears.

### 3.2 Session View

Displays three summary cards: session code, participant count, and rig state (module count, routes, peernet status).

**Assessment:** Functional as a landing page. Low information density for the space it occupies. Could show recent activity, a mini arrangement timeline, or quick-launch actions.

### 3.3 Chains View

The signal chain view detects connected module groups by traversing both patchbay routes and audio routing graph edges, then renders each chain as a horizontal strip with arrows between nodes. Each node shows contextual inline controls based on module kind.

**Strengths:**
- Solves the core problem of understanding signal flow in a modular system. Users can see "Clock -> Sequencer -> Synth -> Reverb -> Destination" as a single visual chain.
- Inline controls (BPM for clocks, waveform/cutoff/envelope for synths, pad count for samplers, first 3 params for effects, level fader for audio modules) let users tweak the most important parameters without leaving the chain view.
- Orphan modules (unpatched) are shown separately with quick-focus chips.
- OPEN button on each node navigates to the full Module editor.
- PLAY button appears only on playable modules (trigger/play/noteOn detection).

**Issues:**
- **No drag-to-reorder or drag-to-connect.** Chains are read-only visualizations. Users cannot rewire signal flow from this view -- they must use the patch canvas.
- **Chain detection is DFS from sources.** Modules with circular routing or feedback paths may produce unexpected chain groupings. No cycle detection or feedback indicator exists.
- **No chain-level mute/solo.** Users can mute individual modules in the mixer, but there is no way to mute an entire signal chain as a unit.
- **Arrow styling is CSS-only.** The chain arrows (`::before` pseudo-element triangles) don't reflect connection type (MIDI vs audio vs control). All connections look identical.

### 3.4 Clips View

Lists clip slots with launch/stop/place/delete actions. Each slot shows module association, note count, quantization, and active state.

**Strengths:**
- Clear clip slot model with launch quantization.
- Place All and Clear Arrangement bulk actions available.

**Issues:**
- **No clip recording workflow.** Users can create clips and slots, but there is no visible "arm for recording" or "capture live performance" flow. Clips are populated programmatically from module note arrays.
- **No clip color or visual differentiation.** All slots look identical except for the playing/queued/empty pill badge. In a session with many clips, orientation is difficult.
- **No drag-to-arrangement.** Clips must be placed via button click; there is no drag from clip list to arrangement timeline.

### 3.5 Arrangement View

A lane-based arrangement editor with loop controls, preview beat, and placement toolbar. Clips are rendered as positioned blocks in lane timelines.

**Strengths:**
- Comprehensive interaction model documented in microcopy: drag to move, Ctrl-drag to copy, edge-drag to resize, Shift for 4-beat snap, Alt for fine 1/4-beat snap.
- Loop region is explicit (start/end beat inputs).

**Issues:**
- **Text-based timeline.** Lanes render as `<div>` blocks with positioning. There is no time ruler, beat grid, or playhead visualization. Users cannot see where beat 16 is without counting.
- **Max-height 480px is constraining.** With multiple lanes, the arrangement becomes scrollable quickly. For a composing-focused view, this area needs to dominate the viewport, not be a capped panel.
- **No zoom control.** The timeline scale is fixed. Dense arrangements at high BPM or long arrangements become unreadable.

### 3.6 Mixer View

A grid of mixer channel strips, each with level fader, pan knob, mute/solo/focus buttons, and a gain percentage display.

**Strengths:**
- Master volume control at the top.
- All audio-capable modules automatically get mixer channels.
- Mute/solo state is visually indicated with CSS classes.
- FOCUS button navigates to the module editor.

**Issues:**
- **No metering.** There are no level meters, peak indicators, or VU displays. Users have no visual feedback about actual audio levels -- only the fader position.
- **No channel grouping.** All channels are in a flat grid. In a session with 10+ modules, finding a specific channel requires scanning all cards.
- **Pan control is a slider, not a knob.** Horizontal sliders for pan are unconventional in mixer UIs. A rotary knob or at least a center-detent indicator would be more intuitive.
- **Solo is local-only and non-exclusive.** Multiple channels can be soloed simultaneously, which is correct behavior, but there is no "solo clear" or "unsolo all" action.

### 3.7 Module View (Full Editor)

The Module view renders a full editor panel for the focused module. The editor varies by module type:

**Synth Editor:** Panels for oscillator (waveform, detune, osc mix), filter (cutoff, resonance, filter env, drive), FM (carrier/mod ratio, index, feedback), wavetable (table select, morph, size), and ADSR envelope. Audition buttons for single note and chord.

- **Strength:** Comprehensive parameter coverage. All synth types (basic, clean, poly, analog, FM, wavetable, drum) get appropriate panels with only relevant sections shown.
- **Issue:** All parameters are sliders or number inputs. No visual envelope curve, no oscilloscope, no filter response plot. The interface is functional but not inspiring for sound design.

**Sampler Editor (Clean):** Sample display with filename, waveform preview, play button, pitch/time controls (root note, time shift, stretch, pitch semitones/cents), ADSR envelope, and metadata panel (BPM, tags, creator, instrument, song, cues).

- **Strength:** Deep metadata workflow. Cue generation, library sync, waveform editing (trim, fade, gain, reverse, normalize) in a non-destructive model.
- **Issue:** Waveform preview is a bar chart of peak values (`<i>` elements with height). It is not interactive -- no click-to-seek, no selection region, no zoom.

**Drum Sampler Editor:** Grid of per-pad editors showing loaded/empty status badges, file names, name/note/gain/pan/choke group controls, trigger buttons, and per-pad file upload.

- **Strength:** Clear visual distinction between loaded (green badge, filename shown) and empty (gray badge, drop hint) pads. Per-pad file upload via both drag-drop and file picker.
- **Issue:** The pad grid is a vertical list of full editor cards, not a compact pad matrix. For quick triggering and auditioning, this layout is too spread out. A compact 4x4 or 2x4 grid of trigger-only pads alongside the full editor would be more performant.

**Piano Roll Editor:** Grid of note cells with note name labels on the left and step columns. Click/drag to paint, Shift to select, arrows to move, Delete to erase.

- **Strength:** Full grid editing with velocity per note, swing application, clear/add actions. Microcopy documents all keyboard shortcuts.
- **Issue:** Step count is capped at 64 and the grid does not scroll horizontally. The grid renders all steps as buttons, which can produce a very wide layout. No zoom or horizontal scroll for longer patterns.

**OCRA Grid Editor:** Dual-mode editing -- text row inputs and clickable cell grid. Clear, Basic Pulse, and Run Frame actions.

- **Strength:** Unique livecoding-inspired workflow. Text-based pattern entry is powerful for experienced users.
- **Issue:** Two simultaneous editing modes (text inputs and cell grid) with no synchronization indicator. If the user edits a text row, the cell grid updates on re-render, but mid-edit there is no live preview.

**Step Sequencer Editor:** Row-based step grid with per-step velocity and micro-timing controls. Convert to Piano Roll action.

- **Strength:** Classic drum machine workflow. Step enable/disable is one-click.
- **Issue:** Only the first step of each row has velocity/micro-timing controls in the detail view. Editing velocity for step 8 requires programmatic access or selecting the step in the grid.

**Arpeggiator Editor:** Note input, scale/interval/direction/octaves controls, generated pattern preview.

- **Strength:** Real-time pattern preview as pill badges. Clean parameter layout.
- **Issue:** No live playback preview. The PREVIEW PATTERN button only logs to the event log -- it does not play the pattern audibly.

**Field Recorder Editor:** Take manager with add/delete/play, waveform edit panel, promote-to-sample-library action.

- **Strength:** Non-destructive take management with trim/fade/gain/reverse. Promote workflow lets field recordings enter the sample library.
- **Issue:** No recording UI. The "Field Recorder" has no visible record button or input source selector. Recording is presumably handled externally.

**Peer/Wiring Monitor:** Status display, pilot name, connect button, patch route list, recent packet log.

- **Strength:** Transparency into peer networking state. Test packet button is useful for debugging.
- **Issue:** Packet log is capped at 8 entries with no scrollback or filtering.

---

## 4. Right Inspector Panel

The inspector panel contains:
1. **Mixer strip** -- compact volume sliders per module
2. **Routes list** -- ordered list of all packet routes and audio graph edges
3. **Packet monitor** -- event log of system activity

### Strengths

- Always-visible route list provides transparency into the patching state.
- Event log captures module actions, peer events, and system messages.

### Issues

- **Dual mixer surfaces.** The inspector's mixer strip (compact sliders) and the Mixer workspace tab (full channel strips) are separate UI surfaces controlling the same state. Changes in one are not always reflected in the other without a re-render.
- **No route editing in the inspector.** Routes are displayed as text (`moduleId:portId -> moduleId:portId`) but cannot be deleted or edited from this list. Users must use the patch canvas.
- **Event log has no filtering or search.** All events dump into a single stream. In an active session with clock ticks, MIDI events, and peer messages, finding relevant entries requires scrolling.
- **Inspector cannot be collapsed.** On narrow screens, the 240px inspector consumes significant horizontal space with no toggle to hide it.

---

## 5. Module Rack

The rack renders all registered modules as compact cards in a scrollable grid. Each card shows the module's own render output (via `module.mount()`) plus Remove and Focus buttons.

### Strengths

- **Self-rendering modules.** Each module controls its own compact card content through `render()`. This keeps module-specific UI logic encapsulated.
- **Kind-based border colors.** Cards are visually classified at a glance.
- **Focus button** navigates to the full workspace editor.
- **Remove button** with proper cleanup (removes from patchbay, routing graph, DOM, and triggers stats update).

### Issues

- **No drag-and-drop reordering.** Modules appear in creation order. Users cannot rearrange the rack layout.
- **No minimize/collapse per card.** Every card is fully expanded. A session with 8+ modules makes the rack very tall.
- **Compact cards vary wildly in height.** A clock module is 2-3 lines; a clean sampler with waveform preview, 9 parameter sliders, and metadata fields is 15+ lines. This creates uneven visual flow.
- **No search/filter in the rack.** Finding a specific module in a large rack requires scrolling.

---

## 6. Patch Canvas

The patch canvas sits between the workspace view and the module rack. It visualizes the routing graph.

### Issues

- **Canvas rendering is opaque.** The `PatchCanvas` class (external) is referenced but not loaded inline. If it is unavailable, the canvas is an empty div.
- **No direct MIDI/audio type distinction.** Connections in the canvas do not visually differentiate between packet routes (MIDI, control) and audio routing graph edges.
- **Small default size.** The canvas container has no explicit height and relies on CSS. It can be too small to show complex routing clearly.

---

## 7. Composing Workflow Assessment

A typical composing workflow involves: add modules -> patch them -> program patterns -> mix levels -> arrange clips.

### What works well

1. **Module creation to sound.** Adding a synth + sequencer + connecting them via autopatch is fast. Audio auto-connects to destination. Sound comes out quickly.
2. **Pattern editing.** The piano roll and step sequencer grids are functional and responsive. The paint/select/move model is standard and learnable.
3. **Chain view for understanding flow.** After patching, the Chains tab gives a clear picture of signal flow with inline controls for quick tweaks.
4. **Sample management.** The sample library, metadata system, waveform editing, and per-pad drum sampler workflow is comprehensive.
5. **Peer collaboration.** The session/sub-lobby model allows multiple pilots to share a session with module state synchronization.

### What needs improvement

1. **No undo/redo.** Any action (note toggle, module removal, parameter change) is permanent. This is the single largest UX gap for a composing tool.
2. **No global transport position indicator.** The current beat is tracked internally but not displayed in a fixed, always-visible location. Users must be in the Clips or Arrangement view to see the beat count.
3. **innerHTML-based rendering.** Every workspace view change reconstructs the entire DOM subtree. This causes focus loss on active inputs (e.g., typing in a text field triggers a re-render that replaces the input). Sliders in the mixer or synth editor cannot be dragged smoothly because each `input` event triggers `renderWorkspaceView()`.
4. **No MIDI input.** The system handles MIDI packets internally but does not bind to the Web MIDI API for external controller input. Hardware controllers cannot trigger pads or control parameters.
5. **No preset management.** Synth parameters, effect settings, and drum kits cannot be saved/loaded as presets independently of the full project.

---

## 8. Operating Workflow Assessment

Operating = performing, mixing live, collaborating in real-time.

### What works well

1. **Live clip launching.** Clips can be launched and stopped on the beat with quantization.
2. **Mixer mute/solo.** Quick mute/solo toggling is available in both the mixer view and the inspector strip.
3. **Peer state sync.** Module state changes emit `publishProjectChange()` which feeds the collaboration layer.

### What needs improvement

1. **No performance mode.** There is no reduced UI mode optimized for live performance. The full editing interface with all its panels and inputs is the only mode.
2. **No crossfader or scene transitions.** The mixer is channel-based only. There is no A/B crossfade, scene recall, or snapshot interpolation.
3. **No visual metronome or beat indicator.** During playback, there is no flashing beat indicator, no animated playhead, and no visual rhythm reference.
4. **Latency is not surfaced.** Audio context latency, peer network latency, and scheduler lookahead are internal values not shown to the user.

---

## 9. Priority Recommendations

### High Impact, Moderate Effort

1. **Add a global beat/transport bar** below the topbar showing current beat, BPM, and a visual beat pulse. This is the most-needed composing orientation aid.
2. **Debounce workspace re-renders** to prevent input focus loss during parameter adjustment. Separate parameter-change events (which should update the model only) from full re-renders.
3. **Add undo/redo** at the project level. Even a simple command stack for the last 20 actions would transform the composing experience.

### Medium Impact, Low Effort

4. **Add a type-to-filter input** above the module dropdown for faster module creation.
5. **Persist workspace tab and drawer states** in localStorage so the UI remembers the last working configuration.
6. **Show connection type in chain arrows** (MIDI = dashed, Audio = solid, Control = dotted) to make the chain view more informative.
7. **Add "Unsolo All" button** to the mixer toolbar.

### Medium Impact, Higher Effort

8. **Implement level metering** in the mixer using AnalyserNode. Even simple peak bars would give crucial mixing feedback.
9. **Add a beat ruler and playhead** to the arrangement view to make timeline orientation possible.
10. **Build a compact pad trigger grid** for drum sampler alongside the full per-pad editor, optimized for finger/mouse triggering.

### Lower Priority / Future

11. Web MIDI API integration for external controllers.
12. Preset save/load for synths and effects.
13. Performance mode with reduced UI.
14. Drag-to-reorder in the module rack.
15. Resizable sidebar and inspector panels.

---

## 10. Summary

The V11 Peer DAW is a remarkably feature-dense modular DAW for a browser application. The module system, patchbay routing, signal chain visualization, comprehensive sampler workflow, and peer collaboration layer form a solid architectural foundation.

The primary UX gaps are in **real-time feedback** (no metering, no beat indicator, no visual playhead), **edit safety** (no undo/redo), and **render performance** (innerHTML-based re-rendering causes input focus issues). Addressing the transport bar, render debouncing, and undo system would yield the highest improvement in both composing and operating workflows.

The recent improvements to drum sampler pad visibility, sidebar decluttering, and signal chain view have meaningfully improved the interface. The chain view in particular transforms module management from a flat list into a comprehensible signal flow, which is the core UX challenge of any modular audio system.
