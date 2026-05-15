// V11 Peer DAW/tests/unit/composed-soundscape-presets.test.js
// Composed soundscape preset designs for moving experimental noise/effect groups.

import { describe, expect, test } from '@jest/globals';
import {
  COMPOSED_SOUNDSCAPE_PRESETS,
  exportComposedPresetBankJson,
  findComposedPreset,
  importComposedPresetBankJson,
  normalizeComposedPreset,
} from '../../src/modules/composed-soundscape-presets.js';

describe('composed experimental soundscape presets', () => {
  test('provides moving noise/drone/atmosphere presets with sources, chains, feedback and automation', () => {
    const slugs = COMPOSED_SOUNDSCAPE_PRESETS.map((preset) => preset.slug);

    expect(slugs).toEqual(
      expect.arrayContaining([
        'moving-dub-nebula',
        'ion-storm-feedback-field',
        'granular-water-memory',
        'cracked-radio-drone',
        'blade-runner-rain-feedback-atmosphere',
      ])
    );

    const preset = findComposedPreset('moving-dub-nebula');
    expect(preset.sources.length).toBeGreaterThanOrEqual(2);
    expect(preset.effectChain.map((effect) => effect.type)).toEqual(
      expect.arrayContaining(['delay', 'dubecho', 'phaser', 'reverb'])
    );
    expect(preset.automation.lanes.length).toBeGreaterThan(3);
    expect(preset.routing).toEqual(expect.arrayContaining([expect.objectContaining({ feedback: true })]));
  });

  test('normalizes and round-trips composed preset banks as JSON', () => {
    const normalized = normalizeComposedPreset({
      slug: 'custom-field',
      title: 'Custom Field',
      sources: [{ moduleType: 'wavetablesynth', preset: 'experimental-water-drop' }],
      effectChain: [{ id: 'delay-a', type: 'delay', params: { feedback: 0.7 } }],
      automation: { lanes: [] },
      routing: [],
    });

    expect(normalized).toEqual(
      expect.objectContaining({
        schemaVersion: 1,
        type: 'v11.composed-soundscape-preset',
        slug: 'custom-field',
      })
    );

    const imported = importComposedPresetBankJson(exportComposedPresetBankJson());
    expect(imported).toHaveLength(COMPOSED_SOUNDSCAPE_PRESETS.length);
    expect(imported[0].automation.lanes).toEqual(expect.any(Array));
  });
});
