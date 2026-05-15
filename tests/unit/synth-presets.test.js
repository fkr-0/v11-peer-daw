// V11 Peer DAW/tests/unit/synth-presets.test.js
// Import/exportable synth preset bank coverage.

import { describe, expect, test } from '@jest/globals';
import {
  DEFAULT_SYNTH_PRESETS,
  exportSynthPresetBankJson,
  findSynthPreset,
  importSynthPresetBankJson,
  listSynthPresets,
  normalizeSynthPreset,
} from '../../src/modules/synth-presets.js';
import {
  FmPhaseSynthModule,
  SubtractiveAnalogSynthModule,
  WavetableSynthModule,
} from '../../src/modules/synths.js';

describe('default synth preset bank', () => {
  test('contains typical, Vangelis/Blade Runner inspired, electric piano, and experimental sets', () => {
    const slugs = DEFAULT_SYNTH_PRESETS.map((preset) => preset.slug);

    expect(slugs).toEqual(
      expect.arrayContaining([
        'analog-warm-bass',
        'analog-brass-pad',
        'fm-epiano-glass',
        'br-inspired-cs80-brass',
        'br-inspired-rain-pad',
        'br-inspired-dream-lead',
        'experimental-r2d2-voice',
        'experimental-tie-fighter-laser',
        'experimental-cracking-noises',
        'experimental-water-drop',
        'experimental-early-sci-fi-noise-bank',
      ])
    );

    expect(listSynthPresets({ category: 'vangelis-bladerunner' })).toHaveLength(3);
    expect(listSynthPresets({ synth: 'fmsynth' }).some((preset) => preset.slug === 'fm-epiano-glass')).toBe(true);
  });

  test('normalizes presets and round-trips the bank as JSON', () => {
    const normalized = normalizeSynthPreset({
      synth: 'analogsynth',
      slug: 'custom-pad',
      title: 'Custom Pad',
      params: { cutoff: 1000 },
      tags: ['pad', 'pad', 'custom'],
    });

    expect(normalized).toEqual(
      expect.objectContaining({
        schemaVersion: 1,
        type: 'v11.synth-preset',
        synth: 'analogsynth',
        slug: 'custom-pad',
        tags: ['pad', 'custom'],
      })
    );

    const imported = importSynthPresetBankJson(exportSynthPresetBankJson());
    expect(imported).toHaveLength(DEFAULT_SYNTH_PRESETS.length);
    expect(imported[0]).toEqual(expect.objectContaining({ type: 'v11.synth-preset' }));
  });

  test('finds presets by slug and rejects incompatible preset imports', () => {
    expect(findSynthPreset('experimental-r2d2-voice')).toEqual(
      expect.objectContaining({ synth: 'fmsynth', category: 'experimental' })
    );

    const analog = new SubtractiveAnalogSynthModule({ id: 'preset-analog' });
    expect(() => analog.importPreset(findSynthPreset('experimental-r2d2-voice'))).toThrow(
      /incompatible synth preset/i
    );
  });
});

describe('synth module preset import/export APIs', () => {
  test('analog synth imports and exports preset JSON', () => {
    const synth = new SubtractiveAnalogSynthModule({ id: 'analog-preset-test' });

    synth.importPreset(findSynthPreset('br-inspired-cs80-brass'));

    expect(synth.cutoff).toBe(2400);
    expect(synth.resonance).toBe(7);
    expect(synth.oscillatorMix).toEqual(expect.objectContaining({ saw: 0.72, square: 0.42 }));
    expect(JSON.parse(synth.exportPresetJson())).toEqual(
      expect.objectContaining({
        type: 'v11.synth-preset',
        synth: 'analogsynth',
        params: expect.objectContaining({ cutoff: 2400 }),
      })
    );
  });

  test('FM synth imports electric piano and experimental voice presets', () => {
    const synth = new FmPhaseSynthModule({ id: 'fm-preset-test' });

    synth.importPreset(findSynthPreset('fm-epiano-glass'));
    expect(synth.carrierRatio).toBe(1);
    expect(synth.modulatorRatio).toBe(3);
    expect(synth.modulationIndex).toBe(1.65);

    synth.importPresetJson(JSON.stringify(findSynthPreset('experimental-r2d2-voice')));
    expect(synth.modulatorRatio).toBe(7.5);
    expect(synth.modulationIndex).toBe(8.4);
  });

  test('wavetable synth imports sci-fi sound design presets', () => {
    const synth = new WavetableSynthModule({ id: 'wt-preset-test' });

    synth.importPreset(findSynthPreset('experimental-water-drop'));

    expect(synth.wavetable).toBe('glass');
    expect(synth.morph).toBe(0.88);
    expect(synth.cutoff).toBe(7600);
    expect(synth.exportPreset()).toEqual(
      expect.objectContaining({ synth: 'wavetablesynth', params: expect.objectContaining({ wavetable: 'glass' }) })
    );
  });

  test('every default preset can be applied to its target synth and exported back', () => {
    const constructors = {
      analogsynth: SubtractiveAnalogSynthModule,
      fmsynth: FmPhaseSynthModule,
      wavetablesynth: WavetableSynthModule,
    };

    for (const preset of DEFAULT_SYNTH_PRESETS) {
      const SynthClass = constructors[preset.synth];
      const synth = new SynthClass({ id: `${preset.slug}-test` });
      synth.importPreset(preset);
      const exported = synth.exportPreset();

      expect(exported.synth).toBe(preset.synth);
      expect(exported.params).toEqual(expect.objectContaining(preset.params));
    }
  });
});
