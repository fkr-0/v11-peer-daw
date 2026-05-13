// PeerModGroove/src/core/routing-graph.js
export class RoutingGraph {
  constructor() {
    this.nodes = new Map();
    this.edges = [];
    this.chains = new Map();
  }
  addNode(id, meta = {}) {
    this.nodes.set(id, { id, ...meta });
    return this.nodes.get(id);
  }
  removeNode(id) {
    this.nodes.delete(id);
    this.edges = this.edges.filter((e) => e.from !== id && e.to !== id);
    this.chains.delete(id);
  }
  connect(from, to, type = 'audio') {
    const edge = { from, to, type };
    if (!this.edges.some((e) => e.from === from && e.to === to && e.type === type))
      this.edges.push(edge);
    return edge;
  }
  disconnect(from, to, type = 'audio') {
    this.edges = this.edges.filter((e) => !(e.from === from && e.to === to && e.type === type));
  }
  clearEdges(type = null) {
    this.edges = type ? this.edges.filter((edge) => edge.type !== type) : [];
  }
  setChain(channelId, effects = []) {
    this.chains.set(channelId, [...effects]);
    return this.chains.get(channelId);
  }
  serialize() {
    return {
      nodes: [...this.nodes.values()],
      edges: this.edges,
      chains: [...this.chains.entries()],
    };
  }
}
