// PeerModGroove/src/ui/patch-canvas.js
export class PatchCanvas {
  constructor(root, graph, { onChange = () => {} } = {}) {
    this.root = root;
    this.graph = graph;
    this.onChange = onChange;
    this.selectedPort = null;
    this.positions = new Map();
    this.drag = null;
  }

  render() {
    if (!this.root) return;
    const data = normalizeGraphForCanvas(this.graph.serialize());
    data.nodes.forEach((n, i) => {
      if (!this.positions.has(n.id))
        this.positions.set(n.id, { x: 24 + (i % 4) * 165, y: 24 + Math.floor(i / 4) * 110 });
    });
    const lines = data.edges.map((e) => this.edgePath(e)).join('');
    this.root.innerHTML = `<div class="patch-canvas"><svg class="patch-lines" aria-hidden="true">${lines}</svg><div class="patch-nodes">${data.nodes.map((n) => this.nodeHtml(n)).join('')}</div><div class="microcopy">Drag nodes. Click an output port then an input port to connect. Shift-click connected port pair to disconnect.</div></div>`;
    this.root.querySelectorAll('.patch-node').forEach((node) => this.bindDrag(node));
    this.root
      .querySelectorAll('.patch-port')
      .forEach((port) => (port.onclick = (e) => this.clickPort(port, e.shiftKey)));
  }

  nodeHtml(node) {
    const p = this.positions.get(node.id) || { x: 0, y: 0 };
    return `<div class="patch-node" data-id="${escapeAttr(node.id)}" style="left:${p.x}px;top:${p.y}px"><strong>${escapeHtml(node.title || node.id)}</strong><small>${escapeHtml(node.kind || 'module')}</small><div><span class="patch-port in" data-port="in" title="audio in">I</span><span class="patch-port out" data-port="out" title="audio out">O</span></div></div>`;
  }

  edgePath(edge) {
    const a = this.positions.get(edge.from) || { x: 0, y: 0 };
    const b = this.positions.get(edge.to) || { x: 280, y: 80 };
    const x1 = a.x + 128;
    const y1 = a.y + 62;
    const x2 = b.x + 12;
    const y2 = b.y + 62;
    const mid = (x1 + x2) / 2;
    return `<path d="M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}" data-from="${escapeAttr(edge.from)}" data-to="${escapeAttr(edge.to)}"></path>`;
  }

  bindDrag(el) {
    el.onpointerdown = (e) => {
      if (e.target.closest('.patch-port')) return;
      const id = el.dataset.id;
      const p = this.positions.get(id) || { x: 0, y: 0 };
      this.drag = { id, sx: e.clientX, sy: e.clientY, ox: p.x, oy: p.y };
      el.setPointerCapture?.(e.pointerId);
    };
    el.onpointermove = (e) => {
      if (!this.drag || this.drag.id !== el.dataset.id) return;
      this.positions.set(this.drag.id, {
        x: Math.max(0, this.drag.ox + e.clientX - this.drag.sx),
        y: Math.max(0, this.drag.oy + e.clientY - this.drag.sy),
      });
      this.render();
    };
    el.onpointerup = () => {
      this.drag = null;
    };
  }

  serializePositions() {
    return Object.fromEntries(
      [...this.positions.entries()].map(([id, position]) => [
        id,
        { x: Number(position.x) || 0, y: Number(position.y) || 0 },
      ])
    );
  }

  restorePositions(positions = {}) {
    this.positions.clear();
    for (const [id, position] of Object.entries(positions || {})) {
      this.positions.set(id, {
        x: Math.max(0, Number(position?.x) || 0),
        y: Math.max(0, Number(position?.y) || 0),
      });
    }
  }

  clickPort(port, disconnect = false) {
    const id = port.closest('.patch-node')?.dataset.id;
    const type = port.dataset.port;
    if (!id || !type) return;
    const current = { id, type };
    if (!this.selectedPort) {
      this.selectedPort = current;
      port.classList.add('selected');
      return;
    }
    const from = this.selectedPort.type === 'out' ? this.selectedPort.id : current.id;
    const to = this.selectedPort.type === 'out' ? current.id : this.selectedPort.id;
    if (from === to) {
      this.selectedPort = null;
      this.render();
      return;
    }
    if (disconnect) this.graph.disconnect(from, to, 'audio');
    else this.graph.connect(from, to, 'audio');
    this.selectedPort = null;
    this.onChange(this.graph);
    this.render();
  }
}
function normalizeGraphForCanvas(data) {
  const nodes = [...(data.nodes || [])];
  const edges = [...(data.edges || [])];
  const knownNodes = new Set(nodes.map((node) => node.id));
  const missingNodeIds = new Set();
  for (const edge of edges) {
    if (edge.from && !knownNodes.has(edge.from)) missingNodeIds.add(edge.from);
    if (edge.to && !knownNodes.has(edge.to)) missingNodeIds.add(edge.to);
  }
  for (const id of missingNodeIds) {
    nodes.push({
      id,
      title: id === 'destination' ? 'Audio Out' : id,
      kind: id === 'destination' ? 'system-output' : 'external',
    });
  }
  return { ...data, nodes, edges };
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
}
function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, '&quot;');
}

export const __patchCanvasTest = { normalizeGraphForCanvas, escapeHtml, escapeAttr };
