// V11 Peer DAW/src/ui/sample-panel-renderer.js
// Pure render helpers for project sample usage and global sample-library panels.

import { escapeHtml } from '../core/html.js';

export function renderSampleLibraryTreeHtml(root = {}) {
  const renderDir = (dir = {}, depth = 0) => {
    const sampleRows = (dir.samples || [])
      .map(
        (sample) =>
          `<div class="sample-library-sample" draggable="true" data-sample-id="${escapeHtml(sample.id)}" style="margin-left:${depth * 10}px"><strong>${escapeHtml(sample.filename)}</strong><small>${escapeHtml(sample.sampleLengthMs || 0)}ms · ${escapeHtml(sample.type || sample.mime || 'audio')}</small><span class="pill">${escapeHtml(sample.source || 'local')}</span></div>`
      )
      .join('');
    const childRows = (dir.dirs || []).map((child) => renderDir(child, depth + 1)).join('');
    const label = dir.name === 'root' ? 'library' : dir.name;
    return `<div class="sample-library-dir" style="margin-left:${depth * 8}px"><strong>/${escapeHtml(label)}</strong>${sampleRows}${childRows}</div>`;
  };
  return renderDir(root);
}

export function renderProjectSampleUsageHtml(usage = []) {
  if (!usage.length) return '<p class="microcopy">No project sample references yet.</p>';
  return usage
    .map((slot) => {
      const progress = Math.round(
        (slot.progress ?? (slot.availability === 'missing' ? 0 : 1)) * 100
      );
      return `<article class="sample-slot-card state-${escapeHtml(slot.availability)}" data-sample-slot="${escapeHtml(slot.id)}" data-sample-ref="${escapeHtml(slot.sampleRef)}" data-module-id="${escapeHtml(slot.moduleId || '')}" data-filename="${escapeHtml(slot.filename)}" style="--sample-fill:${progress}%"><div class="sample-slot-fill"></div><strong>${escapeHtml(slot.filename)}</strong><small>${escapeHtml(slot.moduleTitle)} · ${escapeHtml(slot.sampleRef)}</small><span class="pill">${escapeHtml(slot.availability)}</span><span class="microcopy">${escapeHtml(slot.sampleLengthMs || '?')}ms · ${escapeHtml(slot.type || 'unknown type')}</span><p class="microcopy sample-edit-hint">Open Samples to swap this buffer, upload a replacement, then test hits in the target module.</p><div class="button-row"><button type="button" data-sample-action="query-peer">QUERY PEERS</button><button type="button" data-sample-action="pick-upload">UPLOAD / REPLACE</button><button type="button" data-sample-action="open-editor" data-module-id="${escapeHtml(slot.moduleId || slot.moduleTitle || '')}">OPEN SAMPLES</button></div></article>`;
    })
    .join('');
}

export function renderSampleLibraryMatrixHtml({ samples = [], slots = [], selectedSampleId = '' } = {}) {
  const sampleRows = samples.length
    ? samples
        .map((sample) => {
          const selected = String(sample.id) === String(selectedSampleId);
          return `<button type="button" class="sample-matrix-file ${selected ? 'selected-sample' : ''}" data-sample-action="select-library-sample" data-sample-id="${escapeHtml(sample.id)}"><strong>${escapeHtml(sample.filename)}</strong><small>${escapeHtml(sample.sampleLengthMs || 0)}ms · ${escapeHtml(sample.source || 'local')}</small>${selected ? '<span class="pill">Selected sample</span>' : ''}</button>`;
        })
        .join('')
    : '<p class="microcopy">No files in the global sample library yet. Upload or import a library to start assigning samples.</p>';

  const slotRows = slots.length
    ? slots
        .map((slot) => {
          const status = slot.availability || slot.fillState || 'empty';
          const filename = slot.filename || 'open slot';
          return `<article class="sample-matrix-slot state-${escapeHtml(status)}" data-sample-slot="${escapeHtml(slot.id)}" data-sample-ref="${escapeHtml(slot.sampleRef || slot.id)}" data-module-id="${escapeHtml(slot.moduleId || '')}" data-slot-id="${escapeHtml(slot.slotId || '')}"><div><strong>${escapeHtml(slot.moduleTitle || slot.moduleId || 'Module')}</strong><small>${escapeHtml(slot.slotLabel || slot.slotId || slot.sampleRef || slot.id)} · ${escapeHtml(filename)}</small></div><span class="pill">${escapeHtml(status)}</span><div class="button-row"><button type="button" data-sample-action="assign-selected" data-sample-slot="${escapeHtml(slot.id)}">ASSIGN SELECTED</button><button type="button" data-sample-action="pick-upload" data-sample-slot="${escapeHtml(slot.id)}">UPLOAD / REPLACE</button><button type="button" data-sample-action="query-peer" data-sample-slot="${escapeHtml(slot.id)}">QUERY PEERS</button><button type="button" data-sample-action="open-editor" data-module-id="${escapeHtml(slot.moduleId || '')}">OPEN MODULE</button></div></article>`;
        })
        .join('')
    : '<p class="microcopy">No sample-capable slots in this project yet. Add a sampler, drum sampler, or multisampler.</p>';

  return `<section class="sample-library-matrix"><article class="sample-matrix-column"><header><strong>Library files</strong><span class="pill">${samples.length}</span></header><div class="sample-matrix-files">${sampleRows}</div></article><article class="sample-matrix-column"><header><strong>Project sample slots</strong><span class="pill">${slots.length}</span></header><div class="sample-matrix-slots">${slotRows}</div></article></section>`;
}
