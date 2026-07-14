// V11 Peer DAW/src/core/workspace-preferences.js
// Pure persistence helper for workspace and sidebar UI preferences.

const WORKSPACE_VIEW_KEY = 'v11-daw-workspace-view';
const DRAWER_STATES_KEY = 'v11-daw-drawer-states';
const LAYOUT_STATE_KEY = 'v11-daw-layout-state';
const SURFACE_STATES_KEY = 'v11-daw-surface-states';

function drawerKey(drawer) {
  return drawer?.dataset?.drawerKey || drawer?.querySelector?.('summary')?.textContent?.trim() || '';
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
      if (key && Object.hasOwn(states, key)) drawer.open = Boolean(states[key]);
    }
    return states;
  }

  saveLayoutState(state = {}) {
    const normalized = {
      left: state.left !== false,
      right: state.right !== false,
      focus: Boolean(state.focus),
    };
    try {
      this.storage?.setItem?.(LAYOUT_STATE_KEY, JSON.stringify(normalized));
    } catch (_) {}
    return normalized;
  }

  restoreLayoutState(defaults = {}) {
    const fallback = {
      left: defaults.left !== false,
      right: defaults.right !== false,
      focus: Boolean(defaults.focus),
    };
    try {
      const saved = JSON.parse(this.storage?.getItem?.(LAYOUT_STATE_KEY) || '{}');
      return {
        left: typeof saved.left === 'boolean' ? saved.left : fallback.left,
        right: typeof saved.right === 'boolean' ? saved.right : fallback.right,
        focus: typeof saved.focus === 'boolean' ? saved.focus : fallback.focus,
      };
    } catch (_) {
      return fallback;
    }
  }

  saveSurfaceStates(state = {}) {
    const normalized = {
      patch: state.patch !== false,
      rack: state.rack !== false,
    };
    try {
      this.storage?.setItem?.(SURFACE_STATES_KEY, JSON.stringify(normalized));
    } catch (_) {}
    return normalized;
  }

  restoreSurfaceStates(defaults = {}) {
    const fallback = {
      patch: defaults.patch !== false,
      rack: defaults.rack !== false,
    };
    try {
      const saved = JSON.parse(this.storage?.getItem?.(SURFACE_STATES_KEY) || '{}');
      return {
        patch: typeof saved.patch === 'boolean' ? saved.patch : fallback.patch,
        rack: typeof saved.rack === 'boolean' ? saved.rack : fallback.rack,
      };
    } catch (_) {
      return fallback;
    }
  }
}
