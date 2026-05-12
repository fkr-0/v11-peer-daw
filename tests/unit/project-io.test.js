// V11 Peer DAW/tests/unit/project-io.test.js
// Project import/export packaging tests.

import { readFileSync } from 'node:fs';
import { describe, expect, test } from '@jest/globals';
import {
  createProjectPackage,
  inferModuleType,
  parseProjectPayload,
} from '../../src/core/project-io.js';
import { CleanSamplerModule } from '../../src/modules/clean-sampler.js';
import { DrumSamplerModule } from '../../src/modules/drum-sampler.js';
import { PianoRollModule } from '../../src/modules/piano-roll.js';

function fakeBuffer(duration = 0.25, length = 32) {
  return {
    duration,
    length,
    sampleRate: 44100,
    numberOfChannels: 1,
    getChannelData() {
      return Float32Array.from({ length }, (_, index) => Math.sin(index / 3));
    },
  };
}

function projectSource() {
  const sampler = new CleanSamplerModule({ id: 'sampler-a', title: 'String Sample' });
  sampler.fileName = 'string.wav';
  sampler.buffer = fakeBuffer(0.4);

  const drums = new DrumSamplerModule({ id: 'drum-a', title: 'Drum Pads' });
  drums.assignPad('kick', { note: 'C1', name: 'kick.wav', buffer: fakeBuffer(0.2) });

  const roll = new PianoRollModule({
    id: 'roll-a',
    title: 'Roll A',
    notes: [{ id: 'n1', beat: 0, note: 'C1', velocity: 0.9, duration: 0.1 }],
  });

  return {
    modules: [sampler, drums, roll],
    routes: [
      {
        from: { moduleId: 'roll-a', outputId: 'midi' },
        to: { moduleId: 'drum-a', inputId: 'midi' },
      },
    ],
  };
}

describe('project IO packages', () => {
  test('infers module types for importable module configs', () => {
    expect(inferModuleType(new CleanSamplerModule({ id: 'x' }))).toBe('sampler');
    expect(inferModuleType(new DrumSamplerModule({ id: 'x' }))).toBe('drumsampler');
    expect(inferModuleType(new PianoRollModule({ id: 'x' }))).toBe('pianoroll');
  });

  test('exports just-project without binary sample data', async () => {
    const pkg = await createProjectPackage(projectSource(), { mode: 'just-project' });
    const project = JSON.parse(pkg.text);

    expect(pkg.filename).toBe('v11-peer-daw-project.json');
    expect(project.exportMode).toBe('just-project');
    expect(project.assets).toEqual([]);
    expect(project.modules.map((module) => module.moduleType)).toEqual([
      'sampler',
      'drumsampler',
      'pianoroll',
    ]);
    expect(pkg.text).not.toContain('dataBase64');
  });

  test('exports inline-samples-project as JSON with WAV samples encoded as base64', async () => {
    const pkg = await createProjectPackage(projectSource(), { mode: 'inline-samples-project' });
    const project = JSON.parse(pkg.text);

    expect(project.exportMode).toBe('inline-samples-project');
    expect(project.assets).toHaveLength(2);
    expect(project.assets[0]).toEqual(
      expect.objectContaining({
        encoding: 'base64',
        mime: 'audio/wav',
        dataBase64: expect.any(String),
      })
    );
    expect(project.assets[0].dataBase64.startsWith('UklGR')).toBe(true);
    expect(project.modules[0].sampleRef).toBe('sampler-a/sample');
    expect(project.modules[1].pads[0].sampleRef).toBe('drum-a/kick');
  });

  test('exports project-replaced with placeholder instruments instead of sample payloads', async () => {
    const pkg = await createProjectPackage(projectSource(), { mode: 'project-replaced' });
    const project = JSON.parse(pkg.text);

    expect(project.exportMode).toBe('project-replaced');
    expect(project.assets).toEqual([]);
    expect(project.modules.map((module) => module.moduleType)).toEqual([
      'placeholder-synth',
      'placeholder-drumcomputer',
      'pianoroll',
    ]);
    expect(project.modules[0].placeholder.voice).toBe('sine');
    expect(project.modules[1].placeholder.voice).toBe('drumcomputer');
  });

  test('exports project archive as a zip with project.json and wav samples', async () => {
    const pkg = await createProjectPackage(projectSource(), { mode: 'project-archive' });
    const bytes = new Uint8Array(pkg.bytes);
    const zipText = new TextDecoder().decode(bytes);

    expect(pkg.filename).toBe('v11-peer-daw-project.zip');
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
    expect(zipText).toContain('project.json');
    expect(zipText).toContain('samples/sampler-a/sample.wav');
    expect(zipText).toContain('samples/drum-a/kick.wav');
  });

  test('parses JSON text and archive-base64 clipboard payloads', async () => {
    const inline = await createProjectPackage(projectSource(), { mode: 'inline-samples-project' });
    expect(parseProjectPayload(inline.text).exportMode).toBe('inline-samples-project');

    const archive = await createProjectPackage(projectSource(), { mode: 'project-archive' });
    const parsedArchive = parseProjectPayload(archive.text);
    expect(parsedArchive.exportMode).toBe('project-archive');
    expect(parsedArchive.assets).toHaveLength(2);
  });

  test('index exposes copy, upload, paste, and download project controls', () => {
    const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

    for (const id of [
      'projectExportMode',
      'btnCopyProject',
      'projectImportFile',
      'btnPasteProject',
      'projectIoText',
      'btnDownloadProject',
    ]) {
      expect(html).toContain(`id="${id}"`);
    }
    for (const mode of [
      'just-project',
      'inline-samples-project',
      'project-archive',
      'project-replaced',
    ]) {
      expect(html).toContain(`value="${mode}"`);
    }
  });
});
