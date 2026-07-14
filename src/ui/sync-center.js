function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function stateLabel(state = {}) {
  if (state.conflictCount) return `${state.conflictCount} CONFLICT${state.conflictCount === 1 ? '' : 'S'}`;
  if (state.pendingCount) return `${state.pendingCount} PENDING`;
  if (state.state === 'retrying') return 'RECONNECTING';
  if (state.state === 'recovered') return 'RECOVERED';
  return 'SYNCED';
}

export class SyncCenter {
  constructor({ root, getState = () => ({}), actions = {} } = {}) {
    this.root = root;
    this.getState = getState;
    this.actions = actions;
    this.returnFocus = null;
    this.bound = false;
  }

  bind() {
    if (!this.root || this.bound) return;
    this.bound = true;
    this.root.addEventListener('click', (event) => {
      if (event.target.closest('[data-sync-close]')) return this.close();
      const action = event.target.closest('[data-sync-action]')?.dataset.syncAction;
      if (!action) return;
      if (action === 'retry') this.actions.retry?.();
      if (action === 'snapshot') this.actions.snapshot?.();
      if (action === 'export') this.actions.exportJournal?.();
      if (action === 'clear') this.actions.clearAcknowledged?.();
      if (action === 'resolve') {
        const button = event.target.closest('[data-sync-action="resolve"]');
        this.actions.resolveConflict?.(button.dataset.conflictId, button.dataset.resolution);
      }
      this.render();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.isOpen()) this.close();
    });
  }

  isOpen() {
    return this.root?.classList.contains('open') || false;
  }

  open(trigger = document.activeElement) {
    if (!this.root) return;
    this.returnFocus = trigger;
    this.render();
    this.root.classList.add('open');
    this.root.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
    this.root.querySelector('[data-sync-close]')?.focus?.();
  }

  close() {
    if (!this.root) return;
    this.root.classList.remove('open');
    this.root.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-open');
    this.returnFocus?.focus?.({ preventScroll: true });
    this.returnFocus = null;
  }

  render() {
    if (!this.root) return;
    const state = this.getState() || {};
    const counts = state.counts || {};
    const activities = Array.from(state.activities || []).slice(0, 80);
    const conflicts = Array.from(state.conflicts || []);
    const pending = Array.from(state.entries || []).filter((entry) => entry.status !== 'acknowledged').slice(0, 60);
    this.root.dataset.state = state.state || 'synced';
    this.root.querySelector('[data-sync-state]')?.replaceChildren(document.createTextNode(stateLabel(state)));
    this.root.querySelector('[data-sync-overview]').innerHTML = `
      <div class="sync-metric"><span>Room</span><strong>${escapeHtml(state.roomId || '—')}</strong></div>
      <div class="sync-metric"><span>Actor</span><strong>${escapeHtml(state.actorId || '—')}</strong></div>
      <div class="sync-metric"><span>Revision</span><strong>${Number(state.checkpoint?.revision || 0)}</strong></div>
      <div class="sync-metric"><span>Sequence</span><strong>${Number(state.sequence || 0)}</strong></div>
      <div class="sync-metric"><span>Peers</span><strong>${Number(state.compatiblePeers?.length || 0)}</strong></div>
      <div class="sync-metric"><span>Protocol</span><strong>v${Number(state.protocol || 0)}${state.mixedCompatibility ? ' mixed' : ''}</strong></div>
      <div class="sync-metric"><span>Pending</span><strong>${Number(state.pendingCount || 0)}</strong></div>
      <div class="sync-metric"><span>Conflicts</span><strong>${Number(state.conflictCount || 0)}</strong></div>
      <div class="sync-metric"><span>Last remote</span><strong>${formatTime(state.lastRemoteOperationAt)}</strong></div>
      <div class="sync-metric"><span>Checkpoint</span><strong>${formatTime(state.checkpoint?.at)}</strong></div>
    `;
    this.root.querySelector('[data-sync-counts]').textContent = [
      `${Number(counts.pending || 0)} queued`,
      `${Number(counts.retrying || 0)} retrying`,
      `${Number(counts.partial || 0)} partial`,
      `${Number(counts.acknowledged || 0)} acknowledged`,
      `${Number(counts.rejected || 0)} rejected`,
    ].join(' · ');
    this.root.querySelector('[data-sync-pending]').innerHTML = pending.length
      ? pending
          .map(
            (entry) => `<article class="sync-entry" data-state="${escapeHtml(entry.status)}">
              <div><strong>${escapeHtml(entry.summary || entry.operation?.opId)}</strong><small>${escapeHtml(entry.operation?.opId || '')} · ${escapeHtml(entry.status)} · ${entry.attempts || 0} attempts</small></div>
              <time>${formatTime(entry.updatedAt)}</time>
            </article>`
          )
          .join('')
      : '<p class="sync-empty">No pending operations.</p>';
    this.root.querySelector('[data-sync-activity]').innerHTML = activities.length
      ? activities
          .map(
            (activity) => `<article class="sync-activity" data-type="${escapeHtml(activity.type || 'event')}">
              <span class="sync-activity-dot"></span>
              <div><strong>${escapeHtml(activity.summary || activity.type || 'Activity')}</strong><small>${escapeHtml(activity.status || '')}</small></div>
              <time>${formatTime(activity.at)}</time>
            </article>`
          )
          .join('')
      : '<p class="sync-empty">No collaboration activity yet.</p>';
    this.root.querySelector('[data-sync-conflicts]').innerHTML = conflicts.length
      ? conflicts
          .map(
            (conflict) => `<article class="sync-conflict">
              <div class="sync-conflict-copy"><strong>${escapeHtml(conflict.summary || 'Operation conflict')}</strong><small>${escapeHtml(conflict.reason || conflict.result || '')} · ${formatTime(conflict.at)}</small></div>
              <div class="sync-conflict-actions">
                <button type="button" data-sync-action="resolve" data-conflict-id="${escapeHtml(conflict.id)}" data-resolution="keep-local">KEEP LOCAL</button>
                <button type="button" data-sync-action="resolve" data-conflict-id="${escapeHtml(conflict.id)}" data-resolution="accept-remote">ACCEPT REMOTE</button>
                <button type="button" data-sync-action="resolve" data-conflict-id="${escapeHtml(conflict.id)}" data-resolution="recover-snapshot">RECOVER SNAPSHOT</button>
              </div>
            </article>`
          )
          .join('')
      : '<p class="sync-empty">No unresolved conflicts.</p>';
  }
}

export function compactSyncLabel(state = {}) {
  return stateLabel(state);
}
