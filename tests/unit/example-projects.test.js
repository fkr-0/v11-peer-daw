import { describe, expect, test } from '@jest/globals';
import {
  clonePeerDawExampleProject,
  findPeerDawExampleProject,
  peerDawExampleProjects,
} from '../../src/examples/peer-daw-example-projects.js';
import { ClockModule } from '../../src/modules/clock.js';

const allowedModuleTypes = new Set([
  'clock',
  'pianoroll',
  'drumsynth',
  'analogsynth',
  'wavetablesynth',
  'polysynth',
  'fmsynth',
  'dubecho',
  'tapeecho',
  'peer',
  'master',
]);

describe('peer DAW example projects', () => {
  test('ships two original, importable tutorial example sets', () => {
    expect(peerDawExampleProjects).toHaveLength(2);
    expect(peerDawExampleProjects.map((example) => example.id)).toEqual([
      'detroit-pocket-conant-gardens-study',
      'fall-in-love-remix-sketch',
    ]);

    for (const example of peerDawExampleProjects) {
      expect(example.type).toBe('v11.peer-daw.project');
      expect(example.exportMode).toBe('just-project');
      expect(example.assets).toEqual([]);
      expect(example.modules.length).toBeGreaterThanOrEqual(8);
      expect(example.routes.length).toBeGreaterThanOrEqual(7);
      expect(example.notes.join(' ')).toMatch(
        /No Slum Village recordings, samples, lyrics, or melody transcriptions/
      );

      const moduleIds = new Set(example.modules.map((module) => module.id));
      expect(moduleIds.has('main-mixer')).toBe(true);
      for (const module of example.modules) {
        expect(module.id).toBeTruthy();
        expect(module.title).toBeTruthy();
        expect(allowedModuleTypes.has(module.moduleType)).toBe(true);
      }
      for (const route of example.routes) {
        expect(moduleIds.has(route.from.moduleId)).toBe(true);
        expect(moduleIds.has(route.to.moduleId)).toBe(true);
        expect(route.from.outputId).toBeTruthy();
        expect(route.to.inputId).toBeTruthy();
      }
    }
  });

  test('returns isolated clones so UI loading cannot mutate bundled examples', () => {
    const clone = clonePeerDawExampleProject('fall-in-love-remix-sketch');
    expect(clone).not.toBe(findPeerDawExampleProject('fall-in-love-remix-sketch'));
    clone.modules[0].title = 'changed locally';
    expect(findPeerDawExampleProject('fall-in-love-remix-sketch').modules[0].title).toBe(
      '96 BPM Remix Clock'
    );
  });

  test('each example can be grouped into visible signal chains with source processor and output labels', () => {
    for (const example of peerDawExampleProjects) {
      const modules = new Map(example.modules.map((module) => [module.id, module]));
      const outbound = new Map(example.modules.map((module) => [module.id, []]));
      const inbound = new Map(example.modules.map((module) => [module.id, []]));
      for (const route of example.routes) {
        outbound.get(route.from.moduleId)?.push(route.to.moduleId);
        inbound.get(route.to.moduleId)?.push(route.from.moduleId);
      }
      const source = example.modules.find((module) => !inbound.get(module.id)?.length);
      const chain = [];
      let current = source?.id;
      while (current && !chain.includes(current)) {
        chain.push(current);
        current = outbound.get(current)?.[0];
      }
      const chainModules = chain.map((id) => modules.get(id)).filter(Boolean);
      expect(chainModules.length).toBeGreaterThanOrEqual(3);
      expect(chainModules[0]?.title).toBeTruthy();
      expect(chainModules.slice(1, -1).map((module) => module.title).join(' → ')).toBeTruthy();
      expect(chainModules.at(-1)?.title).toBeTruthy();
    }
  });

  test('clock module serializes and hydrates bpm for example import/export correctness', () => {
    const clock = new ClockModule({ id: 'clock-test', title: 'Clock Test', bpm: 93 });
    expect(clock.serialize()).toMatchObject({ id: 'clock-test', moduleType: 'clock', bpm: 93 });
    clock.hydrate({ bpm: 96 });
    expect(clock.bpm).toBe(96);
  });
});
