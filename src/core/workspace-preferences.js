// V11 Peer DAW/src/core/workspace-preferences.js
// Pure persistence helper for workspace and sidebar UI preferences.

const WORKSPACE_VIEW_KEY = 'v11-daw-workspace-view';
const DRAWER_STATES_KEY = 'v11-daw-drawer-states';

function drawerKey(drawer) {
  return drawer?.querySelector?.('summary')?.textContent?.trim() || '';
}

export class WorkspacePreferences {
  constructor({ storage = globalThis.localStorage } = {}) {
    this.storage = storage;
  }

  saveWorkspaceView(view = 'session') {
    const normalized = view || 'session';
    try {
      this.storage?.setItem?.(WORKSPACE_VIEW_KEY, normalized);
    } catch (_) {}
    return normalized;
  }

  restoreWorkspaceView() {
    try {
      return this.storage?.getItem?.(WORKSPACE_VIEW_KEY) || null;
    } catch (_) {
      return null;
    }
  }

  saveDrawerStates(drawers = []) {
    const states = {};
    for (const drawer of drawers || []) {
      const key = drawerKey(drawer);
      if (key) states[key] = Boolean(drawer.open);
    }
    try {
      this.storage?.setItem?.(DRAWER_STATES_KEY, JSON.stringify(states));
    } catch (_) {}
    return states;
  }

  restoreDrawerStates(drawers = []) {
    let states = {};
    try {
      states = JSON.parse(this.storage?.getItem?.(DRAWER_STATES_KEY) || '{}');
    } catch (_) {
      states = {};
    }
    for (const drawer of drawers || []) {
      const key = drawerKey(drawer);
      if (key && states[key]) drawer.open = true;
    }
    return states;
  }
}
