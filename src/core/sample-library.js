// V11 Peer DAW/src/core/sample-library.js
// Nested sample library, missing-slot detection, metadata helpers, and peer sync.

export const SAMPLE_PACKET_TYPES = Object.freeze({
  request: 'v11-daw:sample-request',
  start: 'v11-daw:sample-start',
  chunk: 'v11-daw:sample-chunk',
  complete: 'v11-daw:sample-complete',
});

function compactObject(input) {
  return Object.fromEntries(
    Object.entries(input).filter(
      ([, value]) => value !== undefined && value !== null && value !== ''
    )
  );
}

function uniqueStrings(values = []) {
  return [
    ...new Set(
      Array.from(values)
        .map((value) => String(value).trim())
        .filter(Boolean)
    ),
  ];
}

function normalizeMs(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : fallback;
}

export function createCue({ startMs = 0, endMs, bpm, upbeatMs, name } = {}) {
  return compactObject({
    startMs: normalizeMs(startMs),
    endMs: endMs === undefined ? undefined : normalizeMs(endMs),
    bpm: bpm === undefined ? undefined : Number(bpm),
    upbeatMs: upbeatMs === undefined ? undefined : normalizeMs(upbeatMs),
    name: name ? String(name) : undefined,
  });
}

export function normalizeSampleMetadata(input = {}) {
  const filename = String(input.filename || input.name || input.label || 'sample.wav').trim();
  const sampleLengthMs = normalizeMs(input.sampleLengthMs ?? input.lengthMs ?? input.durationMs);
  return compactObject({
    id: String(input.id || input.sampleRef || filename),
    sampleRef: input.sampleRef ? String(input.sampleRef) : undefined,
    filename,
    sampleLengthMs,
    bitrate: input.bitrate === undefined ? undefined : Number(input.bitrate),
    sampleRate: input.sampleRate === undefined ? undefined : Number(input.sampleRate),
    channels: input.channels === undefined ? undefined : Number(input.channels),
    type: input.type || input.mime,
    mime: input.mime || input.type,
    creator: input.creator || input.artist,
    artist: input.artist || input.creator,
    instrument: input.instrument,
    songTitle: input.songTitle,
    bpm: input.bpm === undefined ? undefined : Number(input.bpm),
    tags: uniqueStrings(input.tags),
    cues: Array.from(input.cues || []).map(createCue),
    slices: Array.from(input.slices || []).map(createCue),
    source: input.source || 'local',
    peerId: input.peerId,
    path: input.path,
    bytes: input.bytes,
    dataBase64: input.dataBase64,
  });
}

export function tapTempoBpm(taps = []) {
  const normalized = taps
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (normalized.length < 2) return 0;
  const intervals = [];
  for (let index = 1; index < normalized.length; index += 1) {
    const interval = normalized[index] - normalized[index - 1];
    if (interval > 0) intervals.push(interval);
  }
  if (!intervals.length) return 0;
  const avg = intervals.reduce((sum, value) => sum + value, 0) / intervals.length;
  return Math.round(60000 / avg);
}

export function deriveBpmFromInterval({ startMs = 0, endMs = 0, bars = 1, beatsPerBar = 4 } = {}) {
  const duration = Number(endMs) - Number(startMs);
  const beats = Number(bars) * Number(beatsPerBar);
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(beats) || beats <= 0)
    return 0;
  return Math.round((beats * 60000) / duration);
}

export function generateBeatCues({
  startMs = 0,
  bpm = 120,
  beats = 4,
  upbeatMs = 0,
  namePrefix = 'beat',
} = {}) {
  const stepMs = 60000 / Number(bpm || 120);
  return Array.from({ length: Math.max(0, Number(beats) || 0) }, (_, index) =>
    createCue({
      startMs: Number(startMs) + index * stepMs - Number(upbeatMs || 0),
      bpm,
      upbeatMs,
      name: `${namePrefix} ${index + 1}`,
    })
  );
}

function normalizeDir(input = {}, parentPath = '', overrides = {}) {
  const name = String(input.name || 'root');
  const currentPath =
    name === 'root' && parentPath === '' ? '' : `${parentPath}/${name}`.replace(/\/+/g, '/');
  const dir = {
    name,
    dirs: [],
    samples: [],
  };
  for (const sample of input.samples || []) {
    const normalized = normalizeSampleMetadata({ ...sample, ...overrides });
    normalized.path =
      `${currentPath}/${normalized.filename}`.replace(/\/+/g, '/') || `/${normalized.filename}`;
    dir.samples.push(normalized);
  }
  for (const child of input.dirs || input.children || []) {
    dir.dirs.push(normalizeDir(child, currentPath, overrides));
  }
  return dir;
}

function visitSamples(dir, visitor) {
  for (const sample of dir.samples || []) visitor(sample, dir);
  for (const child of dir.dirs || []) visitSamples(child, visitor);
}

function ensureDir(root, path = '/') {
  const parts = String(path)
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean);
  let cursor = root;
  for (const part of parts) {
    let next = cursor.dirs.find((dir) => dir.name === part);
    if (!next) {
      next = { name: part, dirs: [], samples: [] };
      cursor.dirs.push(next);
    }
    cursor = next;
  }
  return cursor;
}

export class SampleLibrary {
  constructor({
    storageKey = 'v11-peer-daw:sample-library',
    storage = globalThis.localStorage,
  } = {}) {
    this.storageKey = storageKey;
    this.storage = storage;
    this.root = { name: 'root', dirs: [], samples: [] };
  }

  importSnapshot(snapshot = {}) {
    this.root = normalizeDir(snapshot.root || snapshot, '', {});
    if (this.root.name !== 'root') {
      this.root = { name: 'root', dirs: [this.root], samples: [] };
    }
    return this;
  }

  exportSnapshot() {
    return { root: this.root };
  }

  exportJson() {
    return JSON.stringify(this.exportSnapshot(), null, 2);
  }

  load() {
    const raw = this.storage?.getItem?.(this.storageKey);
    if (!raw) return this;
    this.importSnapshot(JSON.parse(raw));
    return this;
  }

  save() {
    this.storage?.setItem?.(this.storageKey, this.exportJson());
    return this;
  }

  addSample(path = '/', sample = {}) {
    const dir = ensureDir(this.root, path);
    const normalized = normalizeSampleMetadata(sample);
    normalized.source = normalized.source || 'local';
    normalized.path =
      `${String(path).replace(/\/$/, '')}/${normalized.filename}`.replace(/\/+/g, '/') ||
      `/${normalized.filename}`;
    const existingIndex = dir.samples.findIndex(
      (entry) =>
        entry.id === normalized.id ||
        entry.filename === normalized.filename ||
        entry.sampleRef === normalized.sampleRef
    );
    if (existingIndex >= 0)
      dir.samples[existingIndex] = { ...dir.samples[existingIndex], ...normalized };
    else dir.samples.push(normalized);
    return normalized;
  }

  mergePeerLibrary(peerId, snapshot = {}) {
    const peer = normalizeDir(snapshot.root || snapshot, '', { source: 'peer', peerId });
    visitSamples(peer, (sample) =>
      this.addSample(sample.path?.replace(/\/[^/]+$/, '') || '/', sample)
    );
    return this;
  }

  listSamples() {
    const samples = [];
    visitSamples(this.root, (sample) => samples.push(sample));
    return samples;
  }

  findSample(identifier) {
    const needle = String(identifier || '');
    return (
      this.listSamples().find(
        (sample) =>
          sample.id === needle ||
          sample.filename === needle ||
          sample.sampleRef === needle ||
          sample.path === needle
      ) || null
    );
  }
}

function hasProjectAsset(project, sampleRef) {
  return Array.from(project?.assets || []).some(
    (asset) => asset.id === sampleRef || asset.sampleRef === sampleRef
  );
}

function availabilityFor(project, library, sampleRef, filename) {
  if (hasProjectAsset(project, sampleRef)) return 'embedded';
  if (library?.findSample?.(sampleRef) || library?.findSample?.(filename)) return 'available';
  return 'missing';
}

function looksLikeAudioFilename(value) {
  return /\.(wav|aif|aiff|flac|mp3|ogg|m4a)$/i.test(String(value || ''));
}

function sampleFilename(...values) {
  return values.find((value) => looksLikeAudioFilename(value)) || null;
}

function moduleTypeOf(module = {}) {
  const raw = String(module.moduleType || module.type || '').toLowerCase();
  if (raw) return raw;
  const hint = `${module.id || ''} ${module.title || ''} ${module.kind || ''}`.toLowerCase();
  if (hint.includes('drum') && hint.includes('sampler')) return 'drumsampler';
  if (hint.includes('multi') && hint.includes('sampler')) return 'multisampler';
  if (hint.includes('sampler')) return 'sampler';
  return String(module.kind || '').toLowerCase();
}

function slotAvailability(project, library, slot) {
  if (!slot.filename && !slot.assigned) return 'empty';
  return availabilityFor(project, library, slot.sampleRef, slot.filename);
}

function moduleSampleSlots(module = {}, { includeOpen = false } = {}) {
  const slots = [];
  const moduleType = moduleTypeOf(module);
  const moduleTitle = module.title || module.id;
  const base = {
    moduleId: module.id,
    moduleTitle,
    moduleType: module.moduleType || module.kind,
  };

  if (module.sampleRef || includeOpen && moduleType === 'sampler') {
    const sampleRef = module.sampleRef || `${module.id}/sample`;
    const filename = sampleFilename(module.fileName, module.label, module.sampleMetadata?.filename);
    const assigned = Boolean(module.sampleRef || filename);
    slots.push({
      ...base,
      id: sampleRef,
      sampleRef,
      slotId: 'sample',
      slotLabel: 'Main sample',
      filename: filename || undefined,
      sampleLengthMs: module.sampleLengthMs || module.sampleMetadata?.sampleLengthMs,
      type: module.type || module.mime || module.sampleMetadata?.type,
      assigned,
    });
  }

  for (const pad of module.pads || []) {
    if (!includeOpen && !pad.sampleRef) continue;
    const sampleRef = pad.sampleRef || `${module.id}/${pad.id || 'pad'}`;
    const filename = sampleFilename(pad.fileName, pad.filename, pad.name);
    const assigned = Boolean(pad.sampleRef || filename);
    slots.push({
      ...base,
      id: sampleRef,
      sampleRef,
      slotId: pad.id,
      slotLabel: pad.name || pad.id || 'Pad',
      filename: filename || undefined,
      sampleLengthMs: pad.sampleLengthMs,
      type: pad.type || pad.mime,
      assigned,
    });
  }

  const zones = module.zones || [];
  const openZones = includeOpen && moduleType === 'multisampler' && zones.length === 0
    ? [{ rootNote: 'C4', name: 'Empty zone' }]
    : zones;
  for (const [zoneIndex, zone] of openZones.entries()) {
    if (!includeOpen && !zone.sampleRef) continue;
    const slotId = zone.rootNote || `zone-${zoneIndex + 1}`;
    const sampleRef = zone.sampleRef || `${module.id}/${slotId}`;
    const filename = sampleFilename(zone.fileName, zone.filename, zone.name);
    const assigned = Boolean(zone.sampleRef || filename);
    slots.push({
      ...base,
      id: sampleRef,
      sampleRef,
      slotId,
      slotLabel: `Zone ${slotId}`,
      filename: filename || undefined,
      sampleLengthMs: zone.sampleLengthMs,
      type: zone.type || zone.mime,
      assigned,
    });
  }
  return slots;
}

export function detectProjectSampleUsage(project = {}, library = new SampleLibrary()) {
  return Array.from(project.modules || []).flatMap((module) =>
    moduleSampleSlots(module).map((slot) => {
      const availability = availabilityFor(project, library, slot.sampleRef, slot.filename);
      return {
        ...slot,
        availability,
        fillState: availability,
        progress: availability === 'missing' ? 0 : 1,
      };
    })
  );
}

export function detectProjectSampleSlots(project = {}, library = new SampleLibrary()) {
  return Array.from(project.modules || []).flatMap((module) =>
    moduleSampleSlots(module, { includeOpen: true }).map((slot) => {
      const availability = slotAvailability(project, library, slot);
      return {
        ...slot,
        availability,
        fillState: availability,
        progress: availability === 'empty' || availability === 'missing' ? 0 : 1,
      };
    })
  );
}

export function detectMissingSampleSlots(project = {}, library = new SampleLibrary()) {
  return detectProjectSampleUsage(project, library)
    .filter((slot) => slot.availability === 'missing')
    .map((slot) => ({ ...slot, fillState: 'missing', progress: 0 }));
}

function createEmitter() {
  const listeners = new Map();
  return {
    on(type, handler) {
      listeners.set(type, [...(listeners.get(type) || []), handler]);
      return () =>
        listeners.set(
          type,
          (listeners.get(type) || []).filter((fn) => fn !== handler)
        );
    },
    emit(type, payload) {
      for (const handler of listeners.get(type) || []) handler(payload);
    },
  };
}

function concatBytes(chunks = []) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

export class SampleSyncManager {
  constructor({ library = new SampleLibrary(), send = () => {}, chunkSize = 64 * 1024 } = {}) {
    this.library = library;
    this.send = send;
    this.chunkSize = chunkSize;
    this.transfers = new Map();
    this.emitter = createEmitter();
  }

  on(type, handler) {
    return this.emitter.on(type, handler);
  }

  requestSample({ slotId, sampleRef, filename, peerId } = {}) {
    const payload = { slotId, sampleRef, filename };
    this.send({ type: SAMPLE_PACKET_TYPES.request, peerId, payload });
    return payload;
  }

  receivePacket(packet = {}) {
    const payload = packet.payload || {};
    if (packet.type === SAMPLE_PACKET_TYPES.request) {
      this.emitter.emit('request', {
        peerId: packet.peerId,
        slotId: payload.slotId,
        sampleRef: payload.sampleRef,
        filename: payload.filename,
      });
      return true;
    }
    if (packet.type === SAMPLE_PACKET_TYPES.start) {
      this.receiveSampleStart(payload);
      return true;
    }
    if (packet.type === SAMPLE_PACKET_TYPES.chunk) {
      this.receiveSampleChunk(payload);
      return true;
    }
    if (packet.type === SAMPLE_PACKET_TYPES.complete) {
      this.receiveSampleComplete(payload);
      return true;
    }
    return false;
  }

  answerRequest({ peerId, slotId, sampleRef, filename } = {}) {
    const sample = this.library.findSample(sampleRef) || this.library.findSample(filename);
    const bytes = sample?.bytes instanceof Uint8Array ? sample.bytes : null;
    if (!sample || !bytes) return false;
    const { bytes: _bytes, dataBase64: _dataBase64, ...metadata } = sample;
    this.send({
      type: SAMPLE_PACKET_TYPES.start,
      peerId,
      payload: {
        slotId,
        sampleRef,
        filename: sample.filename || filename,
        totalBytes: bytes.length,
        metadata,
      },
    });
    for (let offset = 0; offset < bytes.length; offset += this.chunkSize) {
      const chunk = bytes.slice(offset, Math.min(bytes.length, offset + this.chunkSize));
      const isLast = offset + this.chunkSize >= bytes.length;
      this.send({
        type: isLast ? SAMPLE_PACKET_TYPES.complete : SAMPLE_PACKET_TYPES.chunk,
        peerId,
        payload: { slotId, bytes: chunk },
      });
    }
    return true;
  }

  receiveSampleStart({ slotId, sampleRef, filename, totalBytes = 0, metadata = {} } = {}) {
    const transfer = {
      slotId,
      sampleRef,
      filename,
      totalBytes: Number(totalBytes) || 0,
      receivedBytes: 0,
      chunks: [],
      metadata,
    };
    this.transfers.set(slotId, transfer);
    this.emitProgress(transfer, 0);
  }

  receiveSampleChunk({ slotId, bytes } = {}) {
    const transfer = this.transfers.get(slotId);
    if (!transfer) return;
    const chunk = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes || []);
    transfer.chunks.push(chunk);
    transfer.receivedBytes += chunk.length;
    this.emitProgress(
      transfer,
      transfer.totalBytes ? transfer.receivedBytes / transfer.totalBytes : 0
    );
  }

  receiveSampleComplete({ slotId, bytes } = {}) {
    const transfer = this.transfers.get(slotId);
    if (!transfer) return;
    if (bytes) {
      const chunk = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes || []);
      transfer.chunks.push(chunk);
      transfer.receivedBytes += chunk.length;
    }
    const sampleBytes = concatBytes(transfer.chunks);
    const sample = this.library.addSample('/synced', {
      ...transfer.metadata,
      filename: transfer.metadata.filename || transfer.filename,
      sampleRef: transfer.sampleRef,
      bytes: sampleBytes,
      source: 'local',
    });
    this.emitProgress(transfer, 1, { sample });
    this.transfers.delete(slotId);
  }

  emitProgress(transfer, progress, extra = {}) {
    this.emitter.emit('progress', {
      slotId: transfer.slotId,
      sampleRef: transfer.sampleRef,
      filename: transfer.filename,
      receivedBytes: transfer.receivedBytes,
      totalBytes: transfer.totalBytes,
      progress: Math.max(0, Math.min(1, Number(progress) || 0)),
      ...extra,
    });
  }
}
