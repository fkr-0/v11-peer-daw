// PeerModGroove/src/core/patchbay.js

import { PortType } from './contracts.js';

export class PatchBay extends EventTarget {
  constructor() {
    super();
    this.modules = new Map();
    this.routes = [];
  }

  addModule(module) {
    this.modules.set(module.id, module);
    module.addEventListener('packet', (event) => this.route(event.detail));
    this.dispatchEvent(new CustomEvent('module:add', { detail: module }));
    return module;
  }

  removeModule(moduleId) {
    const module = this.modules.get(moduleId);
    if (!module) return false;
    module.stop?.();
    module.disconnectAudio?.();
    module.unmount?.();
    this.modules.delete(moduleId);
    this.routes = this.routes.filter(
      (r) => r.from.moduleId !== moduleId && r.to.moduleId !== moduleId
    );
    this.dispatchEvent(new CustomEvent('module:remove', { detail: module }));
    return true;
  }

  connect(from, to) {
    const route = { from, to };
    this.routes.push(route);
    this.dispatchEvent(new CustomEvent('route:add', { detail: route }));
    return route;
  }

  route({ module, outputId, packet }) {
    this.dispatchEvent(
      new CustomEvent('packet', { detail: { from: module.id, outputId, packet } })
    );
    for (const route of this.routes) {
      if (route.from.moduleId !== module.id || route.from.outputId !== outputId) continue;
      const target = this.modules.get(route.to.moduleId);
      if (!target) continue;
      target.receive(packet, route.to.inputId);
    }
  }

  connectAudioTo(moduleId, destination, outputId = 'audio') {
    const module = this.modules.get(moduleId);
    if (module?.outputs?.some((p) => p.type === PortType.AUDIO)) {
      module.connectAudio(destination, outputId);
    }
  }
}
