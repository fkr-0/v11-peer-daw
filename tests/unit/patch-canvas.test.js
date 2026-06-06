import { describe, expect, test } from '@jest/globals';
import { PatchCanvas, __patchCanvasTest } from '../../src/ui/patch-canvas.js';

function inertRoot() {
  return {
    innerHTML: '',
    querySelectorAll() {
      return [];
    },
  };
}

describe('PatchCanvas', () => {
  test('normalizes missing graph edge endpoints into visible external nodes', () => {
    const normalized = __patchCanvasTest.normalizeGraphForCanvas({
      nodes: [{ id: 'source', title: 'Source' }],
      edges: [{ from: 'source', to: 'destination', type: 'audio' }],
      chains: [],
    });

    expect(normalized.nodes).toEqual([
      { id: 'source', title: 'Source' },
      { id: 'destination', title: 'Audio Out', kind: 'system-output' },
    ]);
  });

  test('serializes and restores canvas node positions', () => {
    const root = inertRoot();
    const graph = {
      serialize() {
        return {
          nodes: [{ id: 'source', title: 'Source' }],
          edges: [],
          chains: [],
        };
      },
    };
    const canvas = new PatchCanvas(root, graph);
    canvas.render();
    canvas.positions.set('source', { x: 123, y: 234 });

    expect(canvas.serializePositions()).toEqual({ source: { x: 123, y: 234 } });

    const restored = new PatchCanvas(root, graph);
    restored.restorePositions({ source: { x: 456, y: 567 } });
    expect(restored.serializePositions()).toEqual({ source: { x: 456, y: 567 } });
  });

  test('renders positioned nodes and svg edge paths for canvas styling', () => {
    const root = inertRoot();
    const graph = {
      serialize() {
        return {
          nodes: [
            { id: 'source', title: 'Source', kind: 'audio-source' },
            { id: 'effect', title: 'Effect', kind: 'effect' },
          ],
          edges: [{ from: 'source', to: 'effect', type: 'audio' }],
          chains: [],
        };
      },
    };

    const canvas = new PatchCanvas(root, graph);
    canvas.render();

    expect(root.innerHTML).toContain('class="patch-canvas"');
    expect(root.innerHTML).toContain('class="patch-lines"');
    expect(root.innerHTML).toContain('class="patch-node"');
    expect(root.innerHTML).toContain('style="left:24px;top:24px"');
    expect(root.innerHTML).toContain('<path');
    expect(root.innerHTML).toContain('data-from="source"');
    expect(root.innerHTML).toContain('data-to="effect"');
  });
});
