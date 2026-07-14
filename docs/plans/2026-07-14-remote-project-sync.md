# Remote project synchronization hardening

## Scope

Extend the existing same-origin project request/snapshot/update flow over the production Peernet adapter while retaining BroadcastChannel as a local fallback.

## Implemented

- Versioned project-sync protocol with request, snapshot, update, and acknowledgement messages.
- Cross-transport message deduplication and room scoping.
- Deferred Peernet message subscriptions before transport initialization.
- Targeted Peernet responses for snapshots and acknowledgements.
- Retry/backoff for room hydration requests.
- Transport send/receive timestamps, delivery counts, and acknowledgement state.
- Remote-only diagnostic mode through `?localSync=false`.
- Session dashboard synchronization diagnostics and manual recovery action.
- Deterministic browser coverage using the production shared-core/PeernetStack over a fake low-level PeerJS transport.

## Remaining

- Replace high-frequency whole-project updates with typed operations.
- Persist revision acknowledgements across reconnects.
- Add soak coverage for repeated hub loss and re-election.
