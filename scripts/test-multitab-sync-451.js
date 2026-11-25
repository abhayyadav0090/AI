'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const vm = require('node:vm');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

const ROOT = path.join(__dirname, '..');

function clone(v) {
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
}

function makeQuery(doc) {
  return {
    select() { return this; },
    async lean() { return doc ? clone(doc) : null; },
    then(resolve, reject) { return Promise.resolve(doc ? clone(doc) : null).then(resolve, reject); },
  };
}

function matchesFilter(doc, filter) {
  if (!doc) return false;
  if (filter.userId && String(doc.userId) !== String(filter.userId)) return false;
  if (Object.prototype.hasOwnProperty.call(filter, 'rev')) {
    const cond = filter.rev;
    if (cond && typeof cond === 'object') {
      if (Object.prototype.hasOwnProperty.call(cond, '$gte') && !(Number(doc.rev) >= cond.$gte)) return false;
      if (Object.prototype.hasOwnProperty.call(cond, '$exists')) {
        const exists = Object.prototype.hasOwnProperty.call(doc, 'rev') && doc.rev !== undefined;
        if (Boolean(cond.$exists) !== exists) return false;
      }
    } else if (doc.rev !== cond) {
      return false;
    }
  }
  if (Array.isArray(filter.$or)) {
    const any = filter.$or.some(branch => matchesFilter(doc, branch));
    if (!any) return false;
  }
  return true;
}

function createInMemoryStateStore(userRecord) {
  const states = new Map();
  return {
    states,
    UserMock: {
      findById(id) {
        const matched = String(id) === String(userRecord._id) ? userRecord : null;
        return makeQuery(matched);
      },
    },
    UserStateMock: {
      findOne(filter) {
        const doc = states.get(String(filter.userId)) || null;
        return makeQuery(doc);
      },
      async create(payload) {
        const key = String(payload.userId);
        if (states.has(key)) {
          const err = new Error('E11000 duplicate key error');
          err.code = 11000;
          throw err;
        }
        const doc = {
          _id: 'us-' + key,
          userId: key,
          data: clone(payload.data),
          updatedAt: new Date().toISOString(),
        };
        if (Object.prototype.hasOwnProperty.call(payload, 'rev') && payload.rev !== undefined) {
          doc.rev = payload.rev;
        }
        states.set(key, doc);
        return clone(doc);
      },
      findOneAndUpdate(filter, update, opts = {}) {
        const key = String(filter.userId);
        const existing = states.get(key) || null;
        if (!existing || !matchesFilter(existing, filter)) {
          return makeQuery(null);
        }
        const next = clone(existing);
        if (update.$set) {
          for (const [k, v] of Object.entries(update.$set)) {
            next[k] = clone(v);
          }
        }
        if (update.$inc) {
          for (const [k, delta] of Object.entries(update.$inc)) {
            next[k] = (Number(next[k]) || 0) + Number(delta);
          }
        }
        next.updatedAt = new Date(Date.now() + Math.floor(Math.random() * 5)).toISOString();
        states.set(key, next);
        return makeQuery(opts.new ? next : existing);
      },
    },
  };
}

function makeStorage(sharedMap = new Map()) {
  return {
    getItem(k) { return sharedMap.has(String(k)) ? sharedMap.get(String(k)) : null; },
    setItem(k, v) { sharedMap.set(String(k), String(v)); },
    removeItem(k) { sharedMap.delete(String(k)); },
  };
}

function createClassicTab({ urlBase, cookie, sharedStorage, requestLog }) {
  const src = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
  const start = src.indexOf('const STATE_KEY =');
  const end = src.indexOf('async function retrySync()');
  assert.ok(start >= 0 && end > start, 'Classic state sync slice missing');

  // Extract pure state/sync functions cleanly without full UI boot dependencies
  const syncSlice = src.slice(start, end);
  let seq = 0;
  const toasts = [];
  const ctx = {
    console,
    Date,
    Object,
    Array,
    Map,
    Set,
    Math,
    Number,
    String,
    Boolean,
    JSON,
    Promise,
    Error,
    setTimeout,
    clearTimeout,
    sessionExpiredShown: false,
    uid: () => 'cl-' + (++seq),
    today: () => '2026-11-26',
    isValidClockTime: s => /^\d{2}:\d{2}$/.test(String(s || '')),
    currentUser: { _id: 'user-multi-1', email: 'multi@nexos.test', name: 'Multi Tester' },
    localStorage: makeStorage(sharedStorage),
    document: { activeElement: { tagName: 'BODY' } },
    navigator: { onLine: true },
    window: {},
    NexUI: { setSync() {}, toast(msg) { toasts.push(msg); } },
    notify(msg) { toasts.push(msg); },
    handleSessionExpired() { throw new Error('Unexpected 401'); },
    renderDashboard() {},
    renderKanban() {},
    renderHabits() {},
    renderNotes() {},
    renderAnalytics() {},
    updateContextPanel() {},
    updateStats() {},
    confirm: () => false,
    fetch: async (url, init = {}) => {
      requestLog.push({ client: 'classic', method: init.method || 'GET', url });
      return fetch(urlBase + url, {
        ...init,
        headers: { ...(init.headers || {}), Cookie: cookie },
      });
    },
  };
  ctx.window.NexUI = ctx.NexUI;
  vm.createContext(ctx);
  new vm.Script(
    syncSlice
    + `\nthis.__api = { loadState, pushState, saveState, closeTab: () => { wipingLocalData = true; clearTimeout(saveTimer); clearTimeout(saveRetryTimer); }, setAccountStorageKeys, setCurrentUser: (u) => { currentUser = u; }, getState: () => state, setState: (s) => { state = s; }, getRev: () => classicServerRev, getLoadedOk: () => stateLoadedOk, getToasts: () => toasts };`,
    { filename: 'classic-sync-harness.js' }
  ).runInContext(ctx);
  // Also expose local helpers via eval wrapper using the user key
  ctx.__api.setCurrentUser(ctx.currentUser);
  ctx.__api.setAccountStorageKeys(ctx.currentUser);
  return { ctx, api: ctx.__api, toasts };
}

function createEnterpriseTab({ urlBase, cookie, sharedStorage, requestLog }) {
  const html = fs.readFileSync(path.join(ROOT, 'public', 'index-redesign.html'), 'utf8');
  const start = html.indexOf('const ENTERPRISE_GUEST_FLAG =');
  const end = html.indexOf('// ---- Quick-start (Enterprise):');
  assert.ok(start >= 0 && end > start, 'Enterprise bridge sync slice missing');
  const slice = html.slice(start, end);
  let seq = 0;
  const toasts = [];
  const ctx = {
    console,
    Date,
    Object,
    Array,
    Map,
    Set,
    Math,
    Number,
    String,
    Boolean,
    JSON,
    Promise,
    Error,
    setTimeout,
    clearTimeout,
    location: { origin: urlBase, pathname: '/enterprise', search: '', hash: '' },
    URLSearchParams,
    document: { activeElement: { tagName: 'BODY' }, getElementById: () => null },
    window: { addEventListener() {} },
    localStorage: makeStorage(sharedStorage),
    uid: () => 'ent-' + (++seq),
    today: () => '2026-11-26',
    escapeHtml: s => String(s || ''),
    showToast: msg => toasts.push(msg),
    renderAllViews() {},
    renderCalendarTimeline() {},
    syncGoalTimerInputs() {},
    state: {
      tasks: [], habits: [], notes: [], pomodoroLog: [],
      pomodoroStats: { totalMins: 0, sessions: 0, streak: 0 },
      currentNoteId: null, theme: 'cyber-aubergine', density: 'comfortable',
      uiSoundEnabled: true, pomoTimeRemaining: 1500, pomoTotalTime: 1500,
      pomoMode: 'focus', ambientTrack: 'none', pomoGoalApplied: '', activeChatId: null,
    },
    fetch: async (url, init = {}) => {
      requestLog.push({ client: 'enterprise', method: init.method || 'GET', url });
      return fetch(urlBase + url, {
        ...init,
        headers: { ...(init.headers || {}), Cookie: cookie },
      });
    },
  };
  vm.createContext(ctx);
  new vm.Script(
    slice
    + `\nthis.__api = { loadWorkspaceState, persistEnterpriseWorkspace, adoptMergedIntoState, getState: () => state, setState: (s) => { state = s; }, getSession: () => enterpriseSession, getToasts: () => toasts };`,
    { filename: 'enterprise-sync-harness.js' }
  ).runInContext(ctx);
  return { ctx, api: ctx.__api, toasts };
}

(async function main() {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'nexos-multitab-test-secret';
  const userId = '507f1f77bcf86cd799439011';
  const userRecord = { _id: userId, email: 'multi@nexos.test', name: 'Multi Tester', picture: '' };
  const store = createInMemoryStateStore(userRecord);

  // Patch mongoose readyState & models before exercising routes on real server.js
  const app = require('../server.js');
  Object.defineProperty(mongoose.connection, 'readyState', { value: 1, configurable: true });
  mongoose.models.User.findById = store.UserMock.findById;
  mongoose.models.UserState.findOne = store.UserStateMock.findOne;
  mongoose.models.UserState.create = store.UserStateMock.create;
  mongoose.models.UserState.findOneAndUpdate = store.UserStateMock.findOneAndUpdate;

  const token = jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const cookie = `token=${token}`;

  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const urlBase = `http://127.0.0.1:${server.address().port}`;

  try {
    // ── 1) Race on initial creation (expectedRev: 0) ──
    const createPayloadA = { state: { tasks: [{ id: 't0', title: 'Initial A', col: 'todo' }], habits: [], notes: [] }, expectedRev: 0 };
    const createPayloadB = { state: { tasks: [{ id: 't0b', title: 'Initial B', col: 'todo' }], habits: [], notes: [] }, expectedRev: 0 };
    const [rA, rB] = await Promise.all([
      fetch(urlBase + '/api/state', { method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(createPayloadA) }),
      fetch(urlBase + '/api/state', { method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(createPayloadB) }),
    ]);
    const statuses = [rA.status, rB.status].sort();
    assert.deepEqual(statuses, [200, 409], 'Concurrent initial creation must return one 200 and one 409 Conflict');
    const loserRes = rA.status === 409 ? await rA.json() : await rB.json();
    assert.equal(loserRes.code, 'STATE_CONFLICT');
    assert.equal(loserRes.rev, 1);

    // ── 2) Classic Tab A vs Classic Tab B concurrent edits on SAME record + new records ──
    store.states.set(userId, {
      _id: 'us-1',
      userId,
      rev: 1,
      updatedAt: new Date().toISOString(),
      data: {
        tasks: [
          { id: 't-shared', title: 'Write launch brief', desc: 'orig', col: 'todo', priority: 'medium', due: '', created: 100 },
          { id: 't-keep', title: 'Keep me', desc: '', col: 'todo', priority: 'low', due: '', created: 101 },
        ],
        habits: [{ id: 'h1', name: 'Read 20m', color: '#4285F4', checks: { '2026-11-25': true }, streak: 1 }],
        notes: [{ id: 'n1', title: 'Inbox', content: 'Base content', tags: [], pinned: false, created: 102 }],
        pomodoroLog: [{ date: '2026-11-26', minutes: 25 }],
        pomodoroStats: { totalToday: 25, sessionsToday: 1, longestStreak: 1, lastDate: '2026-11-26' },
      },
    });

    const sharedStorage = new Map();
    const requestLog = [];
    const classicA = createClassicTab({ urlBase, cookie, sharedStorage, requestLog });
    const classicB = createClassicTab({ urlBase, cookie, sharedStorage, requestLog });

    await classicA.api.loadState();
    await classicB.api.loadState();
    assert.equal(classicA.api.getRev(), 1);
    assert.equal(classicB.api.getRev(), 1);

    // Tab A renames t-shared AND adds note n-tab-a -> writes rev 1 -> 2
    const stA = classicA.api.getState();
    stA.tasks.find(t => t.id === 't-shared').title = 'Write Q4 launch brief';
    stA.notes.push({ id: 'n-tab-a', title: 'From Tab A', content: 'Notes A', tags: [], pinned: false, created: 200 });
    assert.equal(await classicA.api.pushState(), true);
    assert.equal(classicA.api.getRev(), 2);

    // Tab B (stale rev=1) completes t-shared (`col: 'done'`), logs 15m focus session, adds habit h-tab-b -> 409 -> merge -> writes rev 2 -> 3
    const stB = classicB.api.getState();
    stB.tasks.find(t => t.id === 't-shared').col = 'done';
    stB.habits.push({ id: 'h-tab-b', name: 'Walk', color: '#34A853', checks: { '2026-11-26': true }, streak: 1 });
    stB.pomodoroLog.push({ date: '2026-11-26', minutes: 15 });
    assert.equal(await classicB.api.pushState(), true);
    assert.equal(classicB.api.getRev(), 3);

    const serverAfterClassic = store.states.get(userId);
    assert.equal(serverAfterClassic.rev, 3);
    const mergedTask = serverAfterClassic.data.tasks.find(t => t.id === 't-shared');
    assert.equal(mergedTask.title, 'Write Q4 launch brief', 'Field-diff merge preserves Tab A rename');
    assert.equal(mergedTask.col, 'done', 'Field-diff merge preserves Tab B column move on SAME task');
    assert.ok(serverAfterClassic.data.notes.some(n => n.id === 'n-tab-a'), 'Tab A note survives Tab B save');
    assert.ok(serverAfterClassic.data.habits.some(h => h.id === 'h-tab-b'), 'Tab B habit survives merge');
    assert.equal(serverAfterClassic.data.pomodoroLog.length, 2, 'Pomodoro logs combined cleanly without loss');

    // ── 3) Classic Tab vs Enterprise Tab concurrent edits + single-round-trip Enterprise happy path ──
    requestLog.length = 0;
    const entTab = createEnterpriseTab({ urlBase, cookie, sharedStorage, requestLog });
    const classicTab = createClassicTab({ urlBase, cookie, sharedStorage, requestLog });

    await entTab.api.loadWorkspaceState();
    await classicTab.api.loadState();
    assert.equal(entTab.api.getSession().serverRev, 3);
    assert.equal(classicTab.api.getRev(), 3);

    // Happy-path Enterprise save must perform 0 GET /api/state calls and 1 PUT /api/state!
    requestLog.length = 0;
    entTab.api.getState().tasks.push({ id: 't-ent-1', title: 'Enterprise item', desc: '', stage: 'inprogress', priority: 'high', due: '', created: 300, tags: [], subtasks: [] });
    entTab.api.getState().theme = 'apple-dark';
    assert.equal(await entTab.api.persistEnterpriseWorkspace(), true);
    assert.equal(entTab.api.getSession().serverRev, 4);
    assert.equal(requestLog.filter(r => r.client === 'enterprise' && r.method === 'GET' && r.url === '/api/state').length, 0, 'Enterprise happy path skips redundant GET /api/state');
    assert.equal(requestLog.filter(r => r.client === 'enterprise' && r.method === 'PUT' && r.url === '/api/state').length, 1);

    // Now simulate simultaneous stale conflict: Classic edits from rev 3 -> gets 409 (server at rev 4) -> merges Enterprise item + Enterprise theme -> saves rev 5!
    const stC = classicTab.api.getState();
    stC.notes.push({ id: 'n-classic-vs-ent', title: 'Classic concurrent note', content: 'Kept', tags: [], pinned: true, created: 310 });
    assert.equal(await classicTab.api.pushState(), true);
    assert.equal(classicTab.api.getRev(), 5);
    const afterCross = store.states.get(userId);
    assert.ok(afterCross.data.tasks.some(t => t.id === 't-ent-1'), 'Enterprise task survived Classic 409 merge');
    assert.ok(afterCross.data.notes.some(n => n.id === 'n-classic-vs-ent'), 'Classic note saved alongside Enterprise task');
    assert.equal(afterCross.data.enterpriseWorkspace?.theme, 'apple-dark', 'Classic save preserved Enterprise UI theme');

    // Now Enterprise (still at stale rev 4!) edits another task & saves -> gets 409 (server rev 5) -> merges Classic note -> saves rev 6!
    entTab.api.getState().tasks.find(t => t.id === 't-ent-1').stage = 'review';
    assert.equal(await entTab.api.persistEnterpriseWorkspace(), true);
    assert.equal(entTab.api.getSession().serverRev, 6);
    assert.ok(entTab.api.getState().notes.some(n => n.id === 'n-classic-vs-ent'), 'Enterprise adopted Classic note seamlessly on 409');
    assert.equal(store.states.get(userId).data.tasks.find(t => t.id === 't-ent-1').col, 'review');

    // ── 4) Enterprise Tab A vs Enterprise Tab B concurrent deletions & additions ──
    const entA = createEnterpriseTab({ urlBase, cookie, sharedStorage, requestLog });
    const entB = createEnterpriseTab({ urlBase, cookie, sharedStorage, requestLog });
    await entA.api.loadWorkspaceState();
    await entB.api.loadWorkspaceState();

    // entA deletes 't-keep' and adds 't-entA-new' -> rev 6 -> 7
    entA.api.getState().tasks = entA.api.getState().tasks.filter(t => t.id !== 't-keep');
    entA.api.getState().tasks.push({ id: 't-entA-new', title: 'Ent A added', desc: '', stage: 'todo', priority: 'low', due: '', created: 400, tags: [], subtasks: [] });
    assert.equal(await entA.api.persistEnterpriseWorkspace(), true);
    assert.equal(entA.api.getSession().serverRev, 7);

    // entB (stale rev 6, did not touch t-keep) adds 't-entB-new' -> 409 -> adopts deletion of t-keep + addition of t-entA-new + keeps t-entB-new -> rev 8
    entB.api.getState().tasks.push({ id: 't-entB-new', title: 'Ent B added', desc: '', stage: 'todo', priority: 'high', due: '', created: 401, tags: [], subtasks: [] });
    assert.equal(await entB.api.persistEnterpriseWorkspace(), true);
    assert.equal(entB.api.getSession().serverRev, 8);
    const finalTasks = store.states.get(userId).data.tasks;
    assert.ok(!finalTasks.some(t => t.id === 't-keep'), 'Deletion by Tab A is respected across merge');
    assert.ok(finalTasks.some(t => t.id === 't-entA-new'), 'Addition by Tab A preserved');
    assert.ok(finalTasks.some(t => t.id === 't-entB-new'), 'Addition by Tab B preserved');

    // ── 5) Legacy DB doc lacking `rev` + Unversioned restore PUT backward compatibility ──
    store.states.set(userId, {
      _id: 'us-legacy',
      userId,
      // Intentionally omit `rev` to simulate pre-4.5.1 MongoDB documents
      updatedAt: new Date().toISOString(),
      data: { tasks: [{ id: 'legacy-1', title: 'Legacy task', col: 'todo' }], habits: [], notes: [] },
    });
    const legacyGet = await fetch(urlBase + '/api/state', { headers: { Cookie: cookie } }).then(r => r.json());
    assert.equal(legacyGet.rev, 1, 'Legacy doc without rev exposes rev=1');

    // Unversioned PUT (e.g., Recovery Center restore) works AND bumps rev to 2
    const unversionedPut = await fetch(urlBase + '/api/state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ state: { tasks: [{ id: 'legacy-1', title: 'Restored legacy', col: 'todo' }], habits: [], notes: [] } }),
    });
    assert.equal(unversionedPut.status, 200);
    const unversionedJson = await unversionedPut.json();
    assert.equal(unversionedJson.rev, 2, 'Unversioned PUT on legacy doc must increment rev to 2 so open tabs detect conflict');

    // Client holding stale expectedRev: 1 gets 409 Conflict
    const staleAfterLegacy = await fetch(urlBase + '/api/state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ state: { tasks: [] }, expectedRev: 1 }),
    });
    assert.equal(staleAfterLegacy.status, 409);

    // Invalid expectedRev returns 400
    const badRev = await fetch(urlBase + '/api/state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ state: { tasks: [] }, expectedRev: -5 }),
    });
    assert.equal(badRev.status, 400);

    // ── 6) Interrupted offline save survives reload & merges concurrent remote edits cleanly ──
    const offlineStorage = new Map();
    const offlineClassic1 = createClassicTab({ urlBase, cookie, sharedStorage: offlineStorage, requestLog });
    await offlineClassic1.api.loadState();
    // Simulate user making a local edit before tab closes/loses network (PENDING_SYNC_KEY = '1', saveState called offline)
    const stOff = offlineClassic1.api.getState();
    stOff.tasks.push({ id: 't-offline-saved', title: 'Offline edited before crash', desc: '', col: 'todo', priority: 'high', due: '', created: 900 });
    offlineClassic1.api.saveState();
    offlineClassic1.api.closeTab(); // Simulate tab closing abruptly before debounced cloud sync runs
    // Meanwhile another tab writes a new note onto the server!
    const currentServerDoc = store.states.get(userId);
    currentServerDoc.data.notes.push({ id: 'n-while-offline', title: 'Remote note while offline', content: 'Safe', tags: [], pinned: false, created: 905 });
    currentServerDoc.rev = (currentServerDoc.rev || 1) + 1;
    // Now tab reloads with PENDING_SYNC_KEY === '1': loadState merges pending offline task + remote note and syncs!
    const offlineClassicReloaded = createClassicTab({ urlBase, cookie, sharedStorage: offlineStorage, requestLog });
    await offlineClassicReloaded.api.loadState();
    const syncedAfterReload = store.states.get(userId);
    assert.ok(syncedAfterReload.data.tasks.some(t => t.id === 't-offline-saved'), 'Interrupted offline edit survives reload');
    assert.ok(syncedAfterReload.data.notes.some(n => n.id === 'n-while-offline'), 'Concurrent remote edit survives interrupted offline recovery');

    console.log('Multi-tab optimistic concurrency + 3-way merge + interrupted recovery tests passed.');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
})().catch(err => {
  console.error(err);
  process.exit(1);
});
