import { describe, expect, test } from '@jest/globals';
import { PortType } from '../../src/core/contracts.js';
import { createLegacyModuleAdapter } from '../../src/core/modulebase-adapter.js';
import { OcraV11Module } from '../../src/modules/ocra-v11.js';

describe('OcraV11Module real adapter behavior', () => {
  test('bang operator triggers its east neighbor without touching the south-east cell', () => {
    const ocra = new OcraV11Module({ id: 'orca-test' });
    ocra.loadGrid(['*...............................']);

    const result = ocra.runOrca();

    expect(result.act[0][0]).toBe(true);
    expect(result.act[0][1]).toBe(true);
    expect(result.act[1][0]).toBe(true);
    expect(result.act[1][1]).toBe(false);
  });

  test('D over O produces MIDI packets through the real ModuleBase event path', () => {
    const ocra = new OcraV11Module({ id: 'orca-test' });
    const packets = [];
    ocra.addEventListener('packet', (event) => packets.push(event.detail));
    ocra.loadGrid([
      'D1..............................',
      'O4..............................',
      '3...............................',
    ]);

    ocra.receive({ kind: PortType.CLOCK, type: 'step', at: 10, step: 1 });

    expect(packets.map((entry) => entry.outputId)).toEqual(['midi', 'midi']);
    expect(packets[0].packet.type).toBe('note-on');
    expect(packets[1].packet.type).toBe('note-off');
  });

  test('legacy adapter exposes ORCA as a runtime plugin with real ports and state', async () => {
    const plugin = createLegacyModuleAdapter({
      id: 'orca-v11',
      name: 'ORCA V11',
      version: '1.0.0',
      moduleClass: OcraV11Module,
    });

    const context = {
      createGain: () => ({ gain: { value: 0 }, connect: () => {}, disconnect: () => {} }),
    };
    const instance = await plugin.create({ audioContext: context });

    expect(plugin.manifest.ports.inputs).toEqual([
      { id: 'clock', type: 'clock' },
      { id: 'control', type: 'control' },
    ]);
    expect(plugin.manifest.ports.outputs).toEqual([
      { id: 'midi', type: 'midi' },
      { id: 'audio', type: 'audio' },
    ]);
    expect(instance.serialize().kind).toBe('midi-generator');
  });
});
