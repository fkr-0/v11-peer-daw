/* peernet-session-manager.js
 * Headless shared session manager for Peernet apps.
 * Additive: binds to PeernetUserManager + PeernetSharedCore, but owns neither.
 */
(function (global) {
  'use strict';

  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function id(prefix) { return prefix + '-' + Math.random().toString(36).slice(2, 10); }
  function now() { return Date.now(); }

  function SessionManager(opts) {
    opts = opts || {};
    this.storageKey = opts.storageKey || 'peernet-session-manager-v1';
    this.userManager = opts.userManager || null;
    this.core = opts.core || null;
    this.listeners = {};
    this.sessions = this.load();
    this.activeSessionId = localStorage.getItem(this.storageKey + ':active') || '';
  }

  SessionManager.prototype.on = function (event, fn) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(fn);
    return this;
  };

  SessionManager.prototype.emit = function (event, payload) {
    (this.listeners[event] || []).forEach(function (fn) { try { fn(payload); } catch (e) { console.warn('[PeernetSessionManager]', e); } });
    (this.listeners['*'] || []).forEach(function (fn) { try { fn(event, payload); } catch (e) { console.warn('[PeernetSessionManager]', e); } });
  };

  SessionManager.prototype.load = function () {
    try { return JSON.parse(localStorage.getItem(this.storageKey) || '[]'); }
    catch (_) { return []; }
  };

  SessionManager.prototype.save = function () {
    localStorage.setItem(this.storageKey, JSON.stringify(this.sessions));
    localStorage.setItem(this.storageKey + ':active', this.activeSessionId || '');
    this.emit('change', this.snapshot());
  };

  SessionManager.prototype.snapshot = function () {
    return {
      sessions: clone(this.sessions),
      activeSessionId: this.activeSessionId,
      activeSession: clone(this.getActiveSession())
    };
  };

  SessionManager.prototype.bind = function (opts) {
    var self = this;
    opts = opts || {};
    if (opts.userManager) this.userManager = opts.userManager;
    if (opts.core) this.core = opts.core;
    if (this.core && typeof this.core.on === 'function') {
      this.core.on('message:session-invite', function (payload) { self.receiveInvite(payload); });
      this.core.on('message:session-update', function (payload) { self.receiveUpdate(payload); });
      this.core.on('message:session-leave', function (payload) { self.receiveLeave(payload); });
    }
    return this;
  };

  SessionManager.prototype.currentProfile = function () {
    return this.userManager ? this.userManager.snapshot().profile : { id: 'local', username: 'local' };
  };

  SessionManager.prototype.createSession = function (meta, state) {
    var profile = this.currentProfile();
    var session = {
      id: id('session'),
      title: (meta && meta.title) || 'Untitled session',
      app: (meta && meta.app) || 'nexus-v9',
      ownerId: profile.id,
      createdAt: now(),
      updatedAt: now(),
      participants: [{ id: profile.id, username: profile.username, color: profile.color, role: 'owner', joinedAt: now() }],
      state: state || {},
      sharedSaveIds: [],
      log: [{ at: now(), type: 'create', by: profile.username }]
    };
    this.sessions.unshift(session);
    this.activeSessionId = session.id;
    this.save();
    this.announceUpdate(session);
    this.emit('session:create', clone(session));
    return session;
  };

  SessionManager.prototype.getActiveSession = function () {
    var idv = this.activeSessionId;
    return this.sessions.find(function (s) { return s.id === idv; }) || null;
  };

  SessionManager.prototype.joinSession = function (session) {
    if (!session || !session.id) return null;
    var profile = this.currentProfile();
    var existing = this.sessions.find(function (s) { return s.id === session.id; });
    if (!existing) {
      existing = clone(session);
      this.sessions.unshift(existing);
    }
    if (!existing.participants.some(function (p) { return p.id === profile.id; })) {
      existing.participants.push({ id: profile.id, username: profile.username, color: profile.color, role: 'participant', joinedAt: now() });
      existing.log = existing.log || [];
      existing.log.push({ at: now(), type: 'join', by: profile.username });
    }
    existing.updatedAt = now();
    this.activeSessionId = existing.id;
    this.save();
    this.announceUpdate(existing);
    this.emit('session:join', clone(existing));
    return existing;
  };

  SessionManager.prototype.leaveActiveSession = function () {
    var session = this.getActiveSession();
    if (!session) return;
    var profile = this.currentProfile();
    session.participants = (session.participants || []).filter(function (p) { return p.id !== profile.id; });
    session.updatedAt = now();
    session.log = session.log || [];
    session.log.push({ at: now(), type: 'leave', by: profile.username });
    this.announce({ type: 'session-leave', sessionId: session.id, profile: profile, at: now() });
    this.activeSessionId = '';
    this.save();
    this.emit('session:leave', clone(session));
  };

  SessionManager.prototype.updateActiveState = function (patch) {
    var session = this.getActiveSession();
    if (!session) return null;
    session.state = Object.assign({}, session.state || {}, patch || {});
    session.updatedAt = now();
    session.log = session.log || [];
    session.log.push({ at: now(), type: 'state-update', by: this.currentProfile().username });
    this.save();
    this.announceUpdate(session);
    this.emit('session:update', clone(session));
    return session;
  };

  SessionManager.prototype.invitePeer = function (peerId, sessionId) {
    var session = this.sessions.find(function (s) { return s.id === sessionId; }) || this.getActiveSession();
    if (!session || !this.core || typeof this.core.send !== 'function') return false;
    this.core.send(peerId, { type: 'session-invite', session: session, from: this.currentProfile(), at: now() });
    this.emit('session:invite', { peerId: peerId, session: clone(session) });
    return true;
  };

  SessionManager.prototype.receiveInvite = function (payload) {
    this.emit('session:invite-received', payload);
    if (payload && payload.data && payload.data.session) this.joinSession(payload.data.session);
  };

  SessionManager.prototype.receiveUpdate = function (payload) {
    var incoming = payload && payload.data && payload.data.session;
    if (!incoming || !incoming.id) return;
    var existing = this.sessions.find(function (s) { return s.id === incoming.id; });
    if (!existing) this.sessions.unshift(clone(incoming));
    else if ((incoming.updatedAt || 0) >= (existing.updatedAt || 0)) Object.assign(existing, clone(incoming));
    this.save();
    this.emit('session:remote-update', clone(incoming));
  };

  SessionManager.prototype.receiveLeave = function (payload) {
    var data = payload && payload.data;
    if (!data || !data.sessionId || !data.profile) return;
    var session = this.sessions.find(function (s) { return s.id === data.sessionId; });
    if (!session) return;
    session.participants = (session.participants || []).filter(function (p) { return p.id !== data.profile.id; });
    session.updatedAt = now();
    this.save();
    this.emit('session:remote-leave', clone(session));
  };

  SessionManager.prototype.announceUpdate = function (session) {
    this.announce({ type: 'session-update', session: session, at: now() });
  };

  SessionManager.prototype.announce = function (msg) {
    if (this.core && typeof this.core.broadcast === 'function') this.core.broadcast(msg);
  };

  global.PeernetSessionManager = SessionManager;
})(window);
