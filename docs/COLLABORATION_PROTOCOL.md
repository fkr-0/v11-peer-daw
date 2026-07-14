# V11 Peer DAW collaboration protocol

## Compatibility

V11 Peer DAW 1.4.0 introduces collaboration protocol `2` and advertises the
capability `project-ops-v1`. Protocol-2 clients continue to accept the existing
protocol-1 request, snapshot, project-update, and acknowledgement messages.

Snapshots remain authoritative for bootstrap, late joining, older clients,
structural changes, project import, binary sample assignment, and recovery.

## Message types

### `collaboration-capabilities`

Advertises operation support for a room. Capability messages are room-scoped
and are repeated when a transport connects, a peer appears, or the room changes.

### `project-operation`

Contains one validated domain operation:

```json
{
  "protocol": 2,
  "type": "project-operation",
  "messageId": "alpha:mabc:41",
  "clientId": "alpha",
  "sessionCode": "ROOM-1",
  "operation": {
    "opId": "alpha:41",
    "actorId": "alpha",
    "sequence": 41,
    "lamport": 93,
    "baseRevision": 18,
    "domain": "module-parameter",
    "action": "set",
    "target": { "moduleId": "main-synth", "parameter": "cutoff" },
    "payload": { "value": 2400 }
  }
}
```

Operations are limited to 64 KiB. Batch operations contain at most 256 nested
operations and apply atomically.

### `operation-ack`

Acknowledges an operation with one of:

- `applied`
- `duplicate`
- `rejected`
- `needs-snapshot`

The acknowledgement includes the receiver revision, Lamport value, and an
optional structured reason.

## Operation domains in 1.4.0

- `module-parameter`
- `mixer-master`
- `mixer-channel`
- `clock`
- `clip-slot`
- `note`
- `sequencer-step`
- `arrangement-placement`
- `arrangement-loop`
- `multisampler-zone`
- `batch`

Module add/remove, graph and route topology, project import, sample binaries,
and complex preset replacement remain snapshot-only.

## Ordering and idempotency

Scalar field updates use deterministic last-writer ordering by
`(lamport, actorId)`. Operations target stable entity IDs, not array indexes.
Deletes create bounded session tombstones, preventing an older add from
resurrecting a removed note, placement, or zone.

The journal records applied operation IDs, so duplicate delivery through both
BroadcastChannel and Peernet is a no-op. Continuous edits to the same pending
field are coalesced to the newest operation.

## Journal and retry behavior

The journal is isolated by room and browser-tab actor. Pending work survives
reload. Retry delays are bounded at approximately 0.8, 1.6, 3.2, and 6.4
seconds before the entry becomes rejected and visible for manual recovery.

Acknowledged operations compact after checkpoints. Pending or rejected work is
never silently removed. The recovery journal can be exported from Sync Center.

## Recovery

An unknown domain, missing stable target, operation gap, or explicit user
request can trigger snapshot recovery. Normal bootstrap snapshots are recorded
as checkpoints; only actual repair flows are presented as `RECOVERED`.
