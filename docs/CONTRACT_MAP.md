# V11 Peer DAW Contract Map

This map reconciles the main user-facing contracts with the source files, tests, and task files that currently protect them.

## Verification gates

| Contract | Source | Verification |
| --- | --- | --- |
| Formatting/lint gate | `biome.json`, `package.json` | `pnpm check` |
| Unit behavior gate | `tests/unit/*.js`, `jest.config.js` | `pnpm test -- --runInBand` |
| Production bundle gate | `vite.config.js`, `index.html`, `src/**` | `pnpm build` |
| Dependency audit gate | `package.json`, `pnpm-lock.yaml` | `pnpm audit --audit-level moderate` |
| CI gate | `.github/workflows/ci.yml` | Workflow mirrors install, check, test, build, and optional deploy-contract commands |

## Runtime and module contracts

| Area | Owns | Source | Tests |
| --- | --- | --- | --- |
| Module ABI | `ModuleBase`, ports, lifecycle, packet helpers, serialization base fields | `src/core/contracts.js`, `src/modules/catalog.js`, `src/modules/*.js` | `tests/unit/module-lifecycle-conformance.test.js`, module-specific tests |
| Safe module rendering | Escaping untrusted module titles, peer names/status, filenames, pad/zone/row labels | `src/core/html.js`, `src/modules/*.js` | `tests/unit/module-lifecycle-conformance.test.js` |
| Audio graph application | Applying `RoutingGraph` edges to module audio nodes | `src/core/routing-graph.js`, `src/core/audio-graph-sync.js` | `tests/unit/routing-graph.test.js`, `tests/unit/audio-graph-sync.test.js` |
| Packet routes | MIDI/control/clock route dispatch separate from audio graph edges | `src/core/patchbay.js`, `src/app.js` | `tests/unit/module-runtime.test.js`, `tests/unit/peer-daw-feature-set.test.js` |
| Patch canvas | Visual graph nodes/edges and canvas node positions | `src/ui/patch-canvas.js` | `tests/unit/patch-canvas.test.js` |

## Project and persistence contracts

| Area | Current contract | Source | Tests |
| --- | --- | --- | --- |
| Project JSON | Schema-versioned project state with modules, packet routes, clips, arrangement, mixer, audio graph, and canvas positions | `src/core/project-io.js`, `src/app.js` | `tests/unit/project-io.test.js` |
| Inline samples project | JSON project with base64-encoded sample assets | `src/core/project-io.js` | `tests/unit/project-io.test.js` |
| Project archive | Stored ZIP archive containing `project.json` plus `samples/**`; rejects malformed/unsafe archives | `src/core/project-io.js` | `tests/unit/project-io.test.js` |
| Sample library snapshot | Nested root/dirs/samples tree with normalized metadata and local/peer source annotations | `src/core/sample-library.js` | `tests/unit/sample-library.test.js` |
| Storage implementation | localStorage-compatible storage for sample library snapshots and workspace preferences; IndexedDB is not implemented | `src/core/sample-library.js`, `src/app.js` | `tests/unit/sample-library.test.js` |

## Workspace and UI contracts

| Area | Current contract | Source | Tests / follow-up |
| --- | --- | --- | --- |
| Workspace tabs | Dynamic workspace shell uses `[data-workspace-view]` tabs and `#workspaceMainView` | `index.html`, `src/app.js` | Existing static checks in `tests/unit/peer-daw-feature-set.test.js`; browser smoke still tracked by `project-review.yml` P1-001 |
| Legacy hidden anchors | `automationOperatorPanel`, `clipSessionPanel`, and `arrangementTimelinePanel` remain hidden compatibility/static-test anchors until workspace behavior tests replace the old ID contract | `index.html` | `tests/unit/peer-daw-feature-set.test.js`; replacement tracked by `project-review.yml` P1-001/P3-001 notes |
| Sample-library UI | Project-level sample panels and library controls exist in the shell, but browser-visible behavior still needs smoke coverage | `index.html`, `src/app.js`, `tasks.yml` | `tests/unit/peer-daw-feature-set.test.js`, `tests/unit/sample-library.test.js`; browser validation remains open |
| Module focused views | Focused module editors exist for sampler/drums/multisampler/field/peer and generic fallback views | `src/app.js`, `docs/MODULE_UI_BACKLOG.md` | Unit/module tests plus future browser smoke |

## Peer and collaboration contracts

| Area | Current contract | Source | Tests |
| --- | --- | --- | --- |
| Peernet session stack | PeerJS/Peernet session initialization, default session, sub-lobby carry/host/new room flows | `src/core/peernet-stack.js`, `src/core/sub-lobby-manager.js`, `vendor/peernet/*.js` | `tests/unit/sub-lobby-manager.test.js`, deploy import tests |
| Peer sample request/response | Request packets emit request events; answer helper sends start/chunk/complete packets from local library bytes; receive path stores completed samples locally | `src/core/sample-library.js` | `tests/unit/sample-library.test.js` |

## Active roadmap/task sources

| File | Role |
| --- | --- |
| `project-review.yml` | Evidence-based review, task tree, status, and completion evidence |
| `tasks.yml` | Sample-library/missing-sample-sync implementation scope |
| `improve.yml` | Architecture/route/project/UI improvement backlog |
| `TODO.md` | Human-readable UX/product gaps |
| `docs/USABILITY_PLAN.md` | Workspace/UI target state |
| `docs/MODULE_UI_BACKLOG.md` | Module editor backlog |

## Remaining high-risk open contracts

1. Browser smoke for patch canvas/workspace/sample-library panels is still open in `project-review.yml` P1-001.
2. `src/app.js` remains a large orchestration file; controller extraction remains open in `project-review.yml` P1-002.
3. P1-007 is in progress: core peer sample protocol is covered, but project-level sample UI/browser validation remains open.
4. Repository hygiene/checkpointing remains open in `project-review.yml` P0-004 because the tree was dirty before this review/fix work.
