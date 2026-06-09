# V11 Peer DAW UI Analysis: Module Chain Discoverability

## Diagnosis

The app has the right core surfaces for a modular DAW: transport, rack modules, patch canvas, clip/session view, mixer, examples, and a derived chain view. The remaining UX problem is orientation. Users can load examples and see clips, but it is not obvious that the sound is made by a chain of modules, nor where to inspect or edit that chain.

The current Chains view is useful but hidden behind a generic tab. It acts like one optional workspace among many, even though signal flow is the mental map users need before manipulating clips, samples, drums, effects, and mixer levels. Module cards also do not show their chain membership, so the rack never teaches how modules relate. Clip rows expose chain text, but the chain button is generic and does not visibly select or highlight the relevant chain.

## Root Causes

- Naming: `Chains` is too abstract. `Signal Flow` better describes the user task.
- Entry points: example loading and session overview do not invite the user to inspect the signal flow.
- Rack disconnect: module cards show Remove/Focus but no chain badge or View Chain action.
- Missing selected-chain state: the app can derive chains, but it does not preserve which chain the user asked to inspect.
- Weak cross-highlighting: clips, rack modules, and chain cards are not visually tied together.

## Fix Strategy

Make module chains a persistent navigation primitive, not a hidden report. The minimal fix is:

1. Rename the workspace tab from `Chains` to `Signal Flow`.
2. Add a Session overview card that shows chain count, unpatched module count, and an `Inspect Signal Flow` action.
3. Add chain badges and `View Chain` actions to every rack module card.
4. Add selected-chain state so clip/module actions open Signal Flow with the exact chain highlighted.
5. Add selected-chain styling for chain cards and matching rack modules.

## Non-goals

- Do not introduce a persisted chain entity model yet. Derived chains are enough for this pass.
- Do not rewrite the patch canvas. Highlight integration can follow after the main affordances are visible.
- Do not add modal onboarding; use inline cards, badges, and contextual actions.

## Success Criteria

- A user loading an example sees `Signal Flow` as a first-class workspace.
- Session view explains that the project has module chains and offers a direct inspection action.
- Rack modules answer: “which chain am I in?” without leaving the rack.
- Clip rows answer: “which chain plays this clip?” and open that exact chain.
- Selected chains are visually highlighted in the Signal Flow view and on matching module cards.
