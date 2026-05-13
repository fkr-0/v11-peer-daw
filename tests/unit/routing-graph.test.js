import { describe, expect, test } from '@jest/globals';
import { RoutingGraph } from '../../src/core/routing-graph.js';

describe('RoutingGraph', () => {
  test('serializes nodes, edges, and chains for patch canvas consumption', () => {
    const graph = new RoutingGraph();
    graph.addNode('a', { title: 'A', kind: 'source' });
    graph.addNode('b', { title: 'B', kind: 'effect' });
    graph.connect('a', 'b', 'audio');
    graph.connect('a', 'b', 'audio');
    graph.setChain('channel-a', ['delay', 'reverb']);

    expect(graph.serialize()).toEqual({
      nodes: [
        { id: 'a', title: 'A', kind: 'source' },
        { id: 'b', title: 'B', kind: 'effect' },
      ],
      edges: [{ from: 'a', to: 'b', type: 'audio' }],
      chains: [['channel-a', ['delay', 'reverb']]],
    });
  });

  test('removes graph edges and chains associated with removed nodes', () => {
    const graph = new RoutingGraph();
    graph.addNode('a');
    graph.addNode('b');
    graph.connect('a', 'b', 'audio');
    graph.setChain('a', ['b']);

    graph.removeNode('a');

    expect(graph.serialize()).toEqual({
      nodes: [{ id: 'b' }],
      edges: [],
      chains: [],
    });
  });

  test('clears all edges or only edges of a selected type', () => {
    const graph = new RoutingGraph();
    graph.connect('a', 'b', 'audio');
    graph.connect('a', 'c', 'midi');

    graph.clearEdges('audio');
    expect(graph.serialize().edges).toEqual([{ from: 'a', to: 'c', type: 'midi' }]);

    graph.clearEdges();
    expect(graph.serialize().edges).toEqual([]);
  });
});
