import { describe, expect, test } from '@jest/globals';
import { AudioGraphSync } from '../../src/core/audio-graph-sync.js';
import { RoutingGraph } from '../../src/core/routing-graph.js';

function fakeAudioModule(id) {
  return {
    id,
    input: { id: `${id}-input` },
    connectedTo: [],
    disconnected: 0,
    connectAudio(destination) {
      this.connectedTo.push(destination);
    },
    disconnectAudio() {
      this.disconnected += 1;
      this.connectedTo = [];
    },
  };
}

describe('AudioGraphSync', () => {
  test('applies serialized routing graph audio edges to module connections', () => {
    const source = fakeAudioModule('source');
    const effect = fakeAudioModule('effect');
    const destination = { id: 'destination-node' };
    const graph = new RoutingGraph();
    graph.connect('source', 'effect', 'audio');
    graph.connect('effect', 'destination', 'audio');
    graph.connect('source', 'effect', 'midi');

    const sync = new AudioGraphSync({
      modules: new Map([
        ['source', source],
        ['effect', effect],
      ]),
      destination,
    });

    sync.apply(graph);

    expect(source.connectedTo).toEqual([effect.input]);
    expect(effect.connectedTo).toEqual([destination]);
    expect(sync.connections).toHaveLength(2);
  });

  test('disconnects previous graph-owned connections before reapplying new graph', () => {
    const source = fakeAudioModule('source');
    const destination = { id: 'destination-node' };
    const graph = new RoutingGraph();
    graph.connect('source', 'destination', 'audio');

    const sync = new AudioGraphSync({ modules: new Map([['source', source]]), destination });
    sync.apply(graph);
    sync.apply(graph);

    expect(source.disconnected).toBe(1);
    expect(source.connectedTo).toEqual([destination]);
    expect(sync.connections).toHaveLength(1);
  });
});
