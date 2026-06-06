// V11 Peer DAW/src/core/project-io.js
// Project import/export helpers for JSON, inline samples, ZIP archives, and placeholder exports.

const PROJECT_SCHEMA_VERSION = 1;
const PROJECT_TYPE = 'v11.peer-daw.project';

const EXPORT_FILENAMES = Object.freeze({
  'just-project': 'v11-peer-daw-project.json',
  'inline-samples-project': 'v11-peer-daw-project.inline-samples.json',
  'project-archive': 'v11-peer-daw-project.zip',
  'project-replaced': 'v11-peer-daw-project.placeholder-synths.json',
});

const MIME_BY_MODE = Object.freeze({
  'just-project': 'application/json',
  'inline-samples-project': 'application/json',
  'project-archive': 'application/zip',
  'project-replaced': 'application/json',
});

function bytesToBase64(bytes) {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(base64) {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(base64, 'base64'));
  const binary = atob(base64);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function utf8Bytes(text) {
  return new TextEncoder().encode(text);
}

function writeAscii(view, offset, text) {
  for (let index = 0; index < text.length; index += 1)
    view.setUint8(offset + index, text.charCodeAt(index));
}

function assertSafeArchiveEntryName(name) {
  if (!name || name.startsWith('/') || name.startsWith('\\\\') || name.includes('\\0')) {
    throw new Error(`Invalid project archive entry: ${name}`);
  }
  const parts = name.split('/');
  if (parts.some((part) => part === '..' || part === '')) {
    throw new Error(`Invalid project archive entry: ${name}`);
  }
}

function crc32(bytes) {
  let crc = -1;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ -1) >>> 0;
}

function readStoredZip(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const entries = [];
  let offset = 0;

  try {
    while (offset + 4 <= data.length) {
      const signature = view.getUint32(offset, true);
      if (signature === 0x02014b50 || signature === 0x06054b50) break;
      if (signature !== 0x04034b50) throw new Error('missing local file header');
      if (offset + 30 > data.length) throw new Error('truncated local file header');

      const flags = view.getUint16(offset + 6, true);
      const method = view.getUint16(offset + 8, true);
      const expectedCrc = view.getUint32(offset + 14, true);
      const compressedSize = view.getUint32(offset + 18, true);
      const uncompressedSize = view.getUint32(offset + 22, true);
      const nameLength = view.getUint16(offset + 26, true);
      const extraLength = view.getUint16(offset + 28, true);
      if (flags & 0x08) throw new Error('data descriptor archives are unsupported');
      if (method !== 0) throw new Error('compressed archive entries are unsupported');
      if (compressedSize !== uncompressedSize) throw new Error('compressed size mismatch');

      const nameOffset = offset + 30;
      const dataOffset = nameOffset + nameLength + extraLength;
      const nextOffset = dataOffset + uncompressedSize;
      if (nextOffset > data.length) throw new Error('truncated archive entry');

      const name = new TextDecoder().decode(data.slice(nameOffset, nameOffset + nameLength));
      assertSafeArchiveEntryName(name);
      const entryBytes = data.slice(dataOffset, nextOffset);
      if (crc32(entryBytes) !== expectedCrc) throw new Error(`CRC mismatch for ${name}`);
      entries.push({ name, bytes: entryBytes });
      offset = nextOffset;
    }
  } catch (error) {
    throw new Error(`Invalid project archive: ${error.message}`);
  }

  if (!entries.length) throw new Error('Invalid project archive: no stored entries found');
  return entries;
}

function createStoredZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = utf8Bytes(entry.name);
    const data = entry.bytes instanceof Uint8Array ? entry.bytes : new Uint8Array(entry.bytes);
    const checksum = crc32(data);

    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, 0, true);
    localView.setUint16(12, 0, true);
    localView.setUint32(14, checksum, true);
    localView.setUint32(18, data.length, true);
    localView.setUint32(22, data.length, true);
    localView.setUint16(26, nameBytes.length, true);
    localView.setUint16(28, 0, true);
    local.set(nameBytes, 30);
    local.set(data, 30 + nameBytes.length);
    localParts.push(local);

    const central = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, 0, true);
    centralView.setUint16(14, 0, true);
    centralView.setUint32(16, checksum, true);
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(24, data.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint16(30, 0, true);
    centralView.setUint16(32, 0, true);
    centralView.setUint16(34, 0, true);
    centralView.setUint16(36, 0, true);
    centralView.setUint32(38, 0, true);
    centralView.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centralParts.push(central);

    offset += local.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);

  const zip = new Uint8Array(offset + centralSize + end.length);
  let cursor = 0;
  for (const part of [...localParts, ...centralParts, end]) {
    zip.set(part, cursor);
    cursor += part.length;
  }
  return zip;
}

function getChannelCount(buffer) {
  return Math.max(1, buffer.numberOfChannels || 1);
}

export function audioBufferToWavBytes(buffer) {
  const sampleRate = buffer.sampleRate || 44100;
  const channelCount = getChannelCount(buffer);
  const length = buffer.length || Math.floor((buffer.duration || 0) * sampleRate);
  const bytesPerSample = 2;
  const blockAlign = channelCount * bytesPerSample;
  const dataSize = length * blockAlign;
  const wav = new Uint8Array(44 + dataSize);
  const view = new DataView(wav.buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  const channels = Array.from({ length: channelCount }, (_, channel) =>
    buffer.getChannelData(Math.min(channel, channelCount - 1))
  );
  let offset = 44;
  for (let frame = 0; frame < length; frame += 1) {
    for (let channel = 0; channel < channelCount; channel += 1) {
      const sample = Math.max(-1, Math.min(1, channels[channel][frame] || 0));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += bytesPerSample;
    }
  }

  return wav;
}

export function inferModuleType(moduleOrData) {
  const name = moduleOrData?.constructor?.name;
  if (name === 'CleanSamplerModule') return 'sampler';
  if (name === 'DrumSamplerModule') return 'drumsampler';
  if (name === 'MultiSamplerModule') return 'multisampler';
  if (name === 'PianoRollModule') return 'pianoroll';
  if (name === 'ClockModule') return 'clock';
  if (name === 'CleanSynthModule') return 'cleansynth';
  if (name === 'PolySynthModule') return 'polysynth';
  if (name === 'SubtractiveAnalogSynthModule') return 'analogsynth';
  if (name === 'FmPhaseSynthModule') return 'fmsynth';
  if (name === 'WavetableSynthModule') return 'wavetablesynth';
  if (name === 'DrumSynthModule') return 'drumsynth';
  if (name === 'ChannelStripModule') return 'channel';
  if (name === 'MixerModule') return 'master';
  return moduleOrData?.moduleType || moduleOrData?.kind || 'module';
}

function sampleAsset(assetId, moduleId, label, buffer, path) {
  if (!buffer) return null;
  const bytes = audioBufferToWavBytes(buffer);
  return {
    id: assetId,
    moduleId,
    label,
    path,
    mime: 'audio/wav',
    encoding: 'base64',
    dataBase64: bytesToBase64(bytes),
    bytes,
  };
}

function serializeModule(module, { mode, assets }) {
  const moduleType = inferModuleType(module);
  const serialized = module.serialize?.() || {
    id: module.id,
    title: module.title,
    kind: module.kind,
  };
  const base = { moduleType, ...serialized };

  if (mode === 'project-replaced') {
    if (moduleType === 'sampler') {
      return {
        id: module.id,
        title: `${module.title || 'Sampler'} Placeholder`,
        kind: 'audio-source',
        moduleType: 'placeholder-synth',
        placeholder: { voice: 'sine', source: 'sample', originalFileName: module.fileName || null },
      };
    }
    if (moduleType === 'drumsampler') {
      return {
        id: module.id,
        title: `${module.title || 'Drum Sampler'} Placeholder`,
        kind: 'audio-source',
        moduleType: 'placeholder-drumcomputer',
        placeholder: { voice: 'drumcomputer', source: 'drum-samples' },
        pads: Array.from(module.pads?.values?.() || []).map((pad) => ({
          id: pad.id,
          note: pad.note,
          name: pad.name,
          chokeGroup: pad.chokeGroup,
          gain: pad.gain,
          pan: pad.pan,
        })),
      };
    }
  }

  if (moduleType === 'sampler' && module.buffer) {
    const id = `${module.id}/sample`;
    base.sampleRef = id;
    if (mode !== 'just-project') {
      assets.push(
        sampleAsset(
          id,
          module.id,
          module.fileName || 'sample.wav',
          module.buffer,
          `samples/${module.id}/sample.wav`
        )
      );
    }
  }

  if (moduleType === 'drumsampler' && module.pads) {
    base.pads = Array.from(module.pads.values()).map((pad) => {
      const result = {
        id: pad.id,
        note: pad.note,
        name: pad.name,
        chokeGroup: pad.chokeGroup,
        gain: pad.gain,
        pan: pad.pan,
      };
      if (pad.buffer) {
        const id = `${module.id}/${pad.id}`;
        result.sampleRef = id;
        if (mode !== 'just-project') {
          assets.push(
            sampleAsset(
              id,
              module.id,
              pad.name || `${pad.id}.wav`,
              pad.buffer,
              `samples/${module.id}/${pad.id}.wav`
            )
          );
        }
      }
      return result;
    });
  }

  return base;
}

function createProject(source, { mode }) {
  const assets = [];
  const modules = Array.from(source.modules || []).map((module) =>
    serializeModule(module, { mode, assets })
  );
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    type: PROJECT_TYPE,
    exportMode: mode,
    exportedAt: new Date(0).toISOString(),
    modules,
    routes: Array.from(source.routes || []),
    clips: source.clips || { currentBeat: 0, slots: [] },
    arrangement: source.arrangement || { loopStartBeat: 0, loopEndBeat: 0, clips: [] },
    mixer: source.mixer || { masterVolume: 0.8, channels: {} },
    graph: source.graph || { nodes: [], edges: [], chains: [] },
    canvasPositions: source.canvasPositions || {},
    assets:
      mode === 'inline-samples-project' ? assets.map(({ bytes: _bytes, ...asset }) => asset) : [],
  };
}

export async function createProjectPackage(source, { mode = 'just-project' } = {}) {
  const exportMode = mode;
  const project = createProject(source, { mode: exportMode });

  if (exportMode === 'project-archive') {
    const archiveAssets = [];
    const archiveProject = {
      ...project,
      assets: [],
    };
    for (const module of Array.from(source.modules || [])) {
      serializeModule(module, { mode: 'project-archive', assets: archiveAssets });
    }
    archiveProject.assets = archiveAssets.map(
      ({ bytes: _bytes, dataBase64: _dataBase64, ...asset }) => asset
    );
    const projectText = JSON.stringify(archiveProject, null, 2);
    const zipBytes = createStoredZip([
      { name: 'project.json', bytes: utf8Bytes(projectText) },
      ...archiveAssets.map((asset) => ({ name: asset.path, bytes: asset.bytes })),
    ]);
    return {
      mode: exportMode,
      filename: EXPORT_FILENAMES[exportMode],
      mime: MIME_BY_MODE[exportMode],
      project: archiveProject,
      bytes: zipBytes,
      text: JSON.stringify(
        {
          ...archiveProject,
          archiveEncoding: 'base64+zip',
          archiveBase64: bytesToBase64(zipBytes),
        },
        null,
        2
      ),
    };
  }

  const text = JSON.stringify(project, null, 2);
  return {
    mode: exportMode,
    filename: EXPORT_FILENAMES[exportMode],
    mime: MIME_BY_MODE[exportMode],
    project,
    text,
    bytes: utf8Bytes(text),
  };
}

export function parseProjectPayload(payload) {
  if (payload instanceof ArrayBuffer || payload instanceof Uint8Array) {
    const archiveBytes = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
    const archiveEntries = readStoredZip(archiveBytes);
    const projectEntry = archiveEntries.find((entry) => entry.name === 'project.json');
    if (!projectEntry) throw new Error('Invalid project archive: missing project.json');
    const project = JSON.parse(new TextDecoder().decode(projectEntry.bytes));
    return {
      ...project,
      archiveBytes,
      archiveEntries: archiveEntries.map(({ name, bytes }) => ({ name, byteLength: bytes.length })),
    };
  }
  const text = String(payload || '').trim();
  const project = JSON.parse(text);
  if (project.archiveBase64) {
    return {
      ...project,
      archiveBytes: base64ToBytes(project.archiveBase64),
    };
  }
  return project;
}
