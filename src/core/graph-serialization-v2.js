export function serializeGraphV2({ modules = [], connections = [] } = {}) {
  return {
    schemaVersion: 2,
    modules: modules.map((module) => ({
      id: module.id,
      manifest: module.manifest,
      state: module.serialize?.() ?? {},
    })),
    connections: connections.map((connection) => ({ ...connection })),
  };
}
