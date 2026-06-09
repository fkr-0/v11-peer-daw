import { describe, expect, test } from '@jest/globals';
import { PortType } from '../../src/core/contracts.js';
import {
  clipCapableModules,
  isPatternModule,
  isSamplerModule,
  mixerModules,
  workspaceModules,
} from '../../src/core/module-selectors.js';

describe('module selector helpers', () => {
  const modules = [
    {
      id: 'clocked',
      kind: 'clock-consumer',
      inputs: [{ type: PortType.CLOCK }],
      outputs: [],
    },
    {
      id: 'midi-out',
      kind: 'controller',
      inputs: [],
      outputs: [{ type: PortType.MIDI }],
    },
    {
      id: 'audio',
      kind: 'effect',
      inputs: [{ type: PortType.AUDIO }],
      outputs: [{ type: PortType.AUDIO }],
    },
    {
      id: 'sampler',
      kind: 'audio-source',
      fileName: 'sample.wav',
      setSampleMetadata() {},
      inputs: [],
      outputs: [{ type: PortType.AUDIO }],
    },
    {
      id: 'pattern',
      kind: 'sequencer',
      rows: [],
      inputs: [],
      outputs: [],
    },
  ];

  test('returns workspace modules from maps and arrays without leaking iterators', () => {
    expect(workspaceModules(new Map(modules.map((module) => [module.id, module])))).toEqual(
      modules
    );
    expect(workspaceModules(modules)).toEqual(modules);
    expect(workspaceModules(null)).toEqual([]);
  });

  test('selects clip-capable and mixer modules by port/domain contract', () => {
    expect(clipCapableModules(modules).map((module) => module.id)).toEqual([
      'clocked',
      'midi-out',
      'pattern',
    ]);
    expect(mixerModules(modules, { mixer: modules[0] }).map((module) => module.id)).toEqual([
      'clocked',
      'audio',
      'sampler',
    ]);
  });

  test('classifies sampler and pattern modules for focused editors', () => {
    expect(isSamplerModule(modules[3])).toBe(true);
    expect(isSamplerModule({ kind: 'audio-source' })).toBe(false);
    expect(isSamplerModule({ pads: new Map(), assignPad() {} })).toBe(true);
    expect(isSamplerModule({ zones: [], sliceCount: 0 })).toBe(true);
    expect(isPatternModule({ rows: [] })).toBe(true);
    expect(isPatternModule({ grid: [] })).toBe(true);
    expect(isPatternModule({ arpPattern() {} })).toBe(true);
    expect(isPatternModule({ kind: 'effect' })).toBe(false);
  });
});
