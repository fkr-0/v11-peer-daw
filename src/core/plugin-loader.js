import { validateModuleManifest } from './module-runtime.js';

export class PluginLoader {
  constructor({ importModule = (path) => import(path) } = {}) {
    this.importModule = importModule;
  }

  async load(path) {
    const plugin = await this.importModule(path);

    if (!plugin?.manifest) {
      throw new Error('Plugin missing manifest');
    }

    const validation = validateModuleManifest(plugin.manifest);

    if (!validation.ok) {
      throw new Error(validation.errors.join(', '));
    }

    return plugin;
  }
}
