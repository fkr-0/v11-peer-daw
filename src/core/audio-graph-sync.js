// PeerModGroove/src/core/audio-graph-sync.js
export class AudioGraphSync {
  constructor({ modules, destination }) {
    this.modules = modules;
    this.destination = destination;
    this.connections = [];
  }
  disconnectAll() {
    for (const connection of this.connections) {
      try {
        connection.from.disconnectAudio?.();
      } catch (_) {}
    }
    this.connections = [];
  }
  connectModules(from, to) {
    if (!from || !to) return false;
    const dest = to.input || to.output || this.destination;
    if (!dest || !from.connectAudio) return false;
    from.connectAudio(dest);
    this.connections.push({ from, to });
    return true;
  }
  apply(graph) {
    this.disconnectAll();
    for (const edge of graph.edges || []) {
      if (edge.type !== 'audio') continue;
      const from = this.modules.get(edge.from);
      const to =
        edge.to === 'destination' ? { input: this.destination } : this.modules.get(edge.to);
      this.connectModules(from, to);
    }
  }
  applyChain(sourceId, chainIds = [], finalId = 'destination') {
    let prev = this.modules.get(sourceId);
    for (const id of chainIds) {
      const next = this.modules.get(id);
      this.connectModules(prev, next);
      prev = next;
    }
    const final =
      finalId === 'destination' ? { input: this.destination } : this.modules.get(finalId);
    this.connectModules(prev, final);
  }
}
