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

  test('clock module serializes and hydrates bpm for example import/export correctness', () => {
    const clock = new ClockModule({ id: 'clock-test', title: 'Clock Test', bpm: 93 });
    expect(clock.serialize()).toMatchObject({ id: 'clock-test', moduleType: 'clock', bpm: 93 });
    clock.hydrate({ bpm: 96 });
    expect(clock.bpm).toBe(96);
  });
});
