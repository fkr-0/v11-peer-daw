import { describe, expect, test } from '@jest/globals';
import { WorkspacePreferences } from '../../src/core/workspace-preferences.js';

class MemoryStorage {
  constructor(entries = {}) {
    this.map = new Map(Object.entries(entries));
  }

  getItem(key) {
    return this.map.get(key) ?? null;
  }

  setItem(key, value) {
    this.map.set(key, String(value));
  }
}

describe('WorkspacePreferences', () => {
  test('persists and restores the selected workspace view with safe fallback', () => {
    const storage = new MemoryStorage();
    const preferences = new WorkspacePreferences({ storage });

    expect(preferences.restoreWorkspaceView()).toBeNull();
    expect(preferences.saveWorkspaceView('arrangement')).toBe('arrangement');
    expect(preferences.restoreWorkspaceView()).toBe('arrangement');
    expect(preferences.saveWorkspaceView('')).toBe('session');
    expect(preferences.restoreWorkspaceView()).toBe('session');
  });

  test('persists drawer open states from summaries and ignores invalid storage', () => {
    const storage = new MemoryStorage({ 'v11-daw-drawer-states': '{bad json' });
    const preferences = new WorkspacePreferences({ storage });
    const drawers = [
      { open: false, querySelector: () => ({ textContent: 'Modules' }) },
      { open: true, querySelector: () => ({ textContent: 'Routes' }) },
      { open: true, querySelector: () => null },
    ];

    expect(preferences.restoreDrawerStates(drawers)).toEqual({});
    expect(drawers[0].open).toBe(false);
    expect(drawers[1].open).toBe(true);

    expect(preferences.saveDrawerStates(drawers)).toEqual({ Modules: false, Routes: true });
    drawers[0].open = true;
    drawers[1].open = false;
    expect(preferences.restoreDrawerStates(drawers)).toEqual({ Modules: false, Routes: true });
    expect(drawers[0].open).toBe(false);
    expect(drawers[1].open).toBe(true);
  });

  test('persists panel visibility and focus mode with safe defaults', () => {
    const storage = new MemoryStorage();
    const preferences = new WorkspacePreferences({ storage });

    expect(preferences.restoreLayoutState()).toEqual({ left: true, right: true, focus: false });
    expect(preferences.saveLayoutState({ left: false, right: true, focus: true })).toEqual({
      left: false,
      right: true,
      focus: true,
    });
    expect(preferences.restoreLayoutState()).toEqual({ left: false, right: true, focus: true });

    storage.setItem('v11-daw-layout-state', '{bad json');
    expect(preferences.restoreLayoutState({ left: false, right: false })).toEqual({
      left: false,
      right: false,
      focus: false,
    });
  });

  test('persists patch-canvas and rack expansion independently', () => {
    const storage = new MemoryStorage();
    const preferences = new WorkspacePreferences({ storage });

    expect(preferences.saveSurfaceStates({ patch: false, rack: true })).toEqual({
      patch: false,
      rack: true,
    });
    expect(preferences.restoreSurfaceStates()).toEqual({ patch: false, rack: true });
  });

  test('fails closed when storage is unavailable', () => {
    const preferences = new WorkspacePreferences({
      storage: {
        getItem() {
          throw new Error('blocked');
        },
        setItem() {
          throw new Error('blocked');
        },
      },
    });

    expect(preferences.saveWorkspaceView('mixer')).toBe('mixer');
    expect(preferences.restoreWorkspaceView()).toBeNull();
    expect(
      preferences.saveDrawerStates([{ open: true, querySelector: () => ({ textContent: 'X' }) }])
    ).toEqual({ X: true });
    expect(preferences.saveLayoutState({ left: false })).toEqual({
      left: false,
      right: true,
      focus: false,
    });
    expect(preferences.restoreLayoutState()).toEqual({ left: true, right: true, focus: false });
  });
});
