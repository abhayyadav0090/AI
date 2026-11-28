'use strict';
// NexOS 4.9.0 — PROJECT SIGNATURE Verification Suite (Sidebar, Settings Control Center, Brand Assets, Documentation)
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

const ROOT = path.resolve(__dirname, '..');
const PUB = path.join(ROOT, 'public');

function readPngDimensions(filePath) {
  const buf = fs.readFileSync(filePath);
  assert.equal(buf.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${path.basename(filePath)} must be valid PNG`);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), bytes: buf.length };
}

function findBrowser() {
  return [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean).find((p) => fs.existsSync(p));
}

class CDPClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.seq = 0;
    this.pending = new Map();
    this.errors = [];
    this.badResponses = [];
    this.ready = new Promise((res, rej) => {
      this.ws.addEventListener('open', res, { once: true });
      this.ws.addEventListener('error', rej, { once: true });
    });
    this.ws.addEventListener('message', (ev) => {
      const m = JSON.parse(String(ev.data));
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        if (m.error) reject(new Error(m.error.message || JSON.stringify(m.error)));
        else resolve(m.result);
        return;
      }
      if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params?.exceptionDetails;
        this.errors.push(d?.exception?.description || d?.text || 'Uncaught exception');
      } else if (m.method === 'Console.messageAdded' && m.params?.message?.level === 'error') {
        const txt = m.params.message.text || '';
        if (!/status of 401|Failed to load resource: net::ERR|accounts\.google\.com|fonts\.googleapis|cdn\.jsdelivr\.net/i.test(txt)) {
          this.errors.push(txt);
        }
      } else if (m.method === 'Network.responseReceived') {
        const resp = m.params?.response;
        if (resp && resp.url && resp.url.startsWith('http://127.0.0.1:') && resp.status >= 400) {
          const expectedGuest401 = resp.status === 401 && /\/api\/(bootstrap|state|chats|push\/preferences|study\/)/.test(resp.url);
          if (!expectedGuest401) this.badResponses.push(`${resp.status} ${resp.url}`);
        }
      }
    });
  }
  async send(method, params = {}) {
    await this.ready;
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result?.value;
  }
  async waitFor(pred, ms = 9000) {
    const s = Date.now();
    while (Date.now() - s < ms) {
      if (await this.eval(`Boolean(${pred})`)) return;
      await new Promise((r) => setTimeout(r, 35));
    }
    throw new Error(`Timeout waiting for: ${pred}`);
  }
  close() { try { this.ws.close(); } catch (_) {} }
}

async function waitWs(port) {
  const s = Date.now();
  while (Date.now() - s < 9000) {
    try {
      const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
      const p = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (p) return p.webSocketDebuggerUrl;
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 60));
  }
  throw new Error('Timeout waiting for Chrome DevTools');
}

function verifyBrandAssetsAndDocs() {
  const manifest = JSON.parse(fs.readFileSync(path.join(PUB, 'manifest.json'), 'utf8'));
  const hasAny192 = manifest.icons.some((i) => i.src.includes('nexos-icon-192.png') && i.sizes === '192x192' && i.purpose === 'any');
  const hasAny512 = manifest.icons.some((i) => i.src.includes('nexos-icon-512.png') && i.sizes === '512x512' && i.purpose === 'any');
  const hasMaskable = manifest.icons.some((i) => i.src.includes('nexos-icon-maskable-512.png') && i.sizes === '512x512' && i.purpose === 'maskable');
  const hasSvg = manifest.icons.some((i) => i.src.includes('favicon.svg') && i.type === 'image/svg+xml');
  assert.ok(hasAny192 && hasAny512 && hasMaskable && hasSvg, 'manifest.json declares complete any, maskable, and SVG icon family');

  const pngExpectations = [
    ['favicon-16x16.png', 16, 16],
    ['favicon-32x32.png', 32, 32],
    ['apple-touch-icon.png', 180, 180],
    ['nexos-icon-192.png', 192, 192],
    ['nexos-icon-512.png', 512, 512],
    ['nexos-icon-maskable-512.png', 512, 512],
  ];
  for (const [name, w, h] of pngExpectations) {
    const p = path.join(PUB, name);
    assert.ok(fs.existsSync(p), `${name} must exist in public/`);
    const meta = readPngDimensions(p);
    assert.equal(meta.width, w, `${name} width === ${w}`);
    assert.equal(meta.height, h, `${name} height === ${h}`);
  }

  const icoBuf = fs.readFileSync(path.join(PUB, 'favicon.ico'));
  assert.equal(icoBuf.readUInt16LE(0), 0, 'favicon.ico reserved byte === 0');
  assert.equal(icoBuf.readUInt16LE(2), 1, 'favicon.ico image type === 1 (ICO)');
  assert.ok(icoBuf.readUInt16LE(4) >= 2, 'favicon.ico contains multiple sizes');

  const svgStr = fs.readFileSync(path.join(PUB, 'favicon.svg'), 'utf8');
  assert.ok(svgStr.includes('<svg') && svgStr.includes('</svg>'), 'favicon.svg is valid inline vector SVG');

  for (const htmlFile of ['index.html', 'index-redesign.html', 'recover.html', 'contact.html', 'privacy.html']) {
    const src = fs.readFileSync(path.join(PUB, htmlFile), 'utf8');
    assert.ok(src.includes('favicon.svg'), `${htmlFile} declares favicon.svg`);
    assert.ok(src.includes('apple-touch-icon.png'), `${htmlFile} declares apple-touch-icon.png`);
  }
  const contactHtml = fs.readFileSync(path.join(PUB, 'contact.html'), 'utf8');
  assert.ok(contactHtml.includes('class="legal-page"') && contactHtml.includes('contact-about'), 'contact.html visual layout/design preserved');

  const swSrc = fs.readFileSync(path.join(PUB, 'sw.js'), 'utf8');
  for (const iconAsset of ['/favicon.svg', '/favicon.ico', '/favicon-16x16.png', '/favicon-32x32.png', '/apple-touch-icon.png', '/nexos-icon-192.png', '/nexos-icon-512.png', '/nexos-icon-maskable-512.png']) {
    assert.ok(swSrc.includes(`'${iconAsset}'`), `sw.js precaches ${iconAsset}`);
  }

  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  assert.equal(readme.includes('show NexOS 3.5.0'), false, 'README.md outdated 3.5.0 screenshot note replaced');
  const refs = [...readme.matchAll(/!\[[^\]]*\]\((docs\/screenshots\/[^)]+)\)/g)].map((m) => m[1]);
  assert.ok(refs.length >= 24, `README.md embeds modern screenshots across Classic, Enterprise, Settings, and Study Studio (found ${refs.length})`);
  for (const rel of refs) {
    const full = path.join(ROOT, rel);
    assert.ok(fs.existsSync(full), `Referenced README screenshot exists: ${rel}`);
    const dim = readPngDimensions(full);
    assert.ok(dim.width >= 390 && dim.bytes > 20000, `README screenshot ${rel} is valid & crisp (${dim.width}x${dim.height}, ${dim.bytes}B)`);
  }
  for (const requiredDoc of ['enterprise-sidebar-collapsed.png', 'enterprise-settings-center.png', 'classic-settings-center.png', 'study-studio.png', 'enterprise-mobile-settings.png']) {
    assert.ok(readme.includes(`docs/screenshots/${requiredDoc}`), `README embeds ${requiredDoc}`);
  }
  console.log('Brand asset consistency, SW precache, HTML links & README documentation verification passed.');
}

async function runBrowserSignatureSuite() {
  if (process.env.NEXOS_SKIP_BROWSER === '1') {
    console.log('Signature browser checks skipped (NEXOS_SKIP_BROWSER=1).');
    return;
  }
  const browser = findBrowser();
  if (!browser) {
    console.log('Signature browser checks skipped (browser not found).');
    return;
  }

  process.env.JWT_SECRET = process.env.JWT_SECRET || 'nexos-signature-secret';
  const app = require('../server.js');
  const uid = '507f1f77bcf86cd799439333';
  const token = jwt.sign({ id: uid }, process.env.JWT_SECRET, { expiresIn: '2h' });

  const origReady = Object.getOwnPropertyDescriptor(mongoose.connection, 'readyState');
  const User = mongoose.models.User;
  const UserState = mongoose.models.UserState;
  const Chat = mongoose.models.Chat;
  const PushPreference = mongoose.models.PushPreference;
  const origUserFind = User.findById;
  const origStateFindOne = UserState.findOne;
  const origStateCreate = UserState.create;
  const origStateUpdate = UserState.findOneAndUpdate;
  const origChatFind = Chat.find;
  const origPushFindOne = PushPreference.findOne;

  let doc = {
    _id: 'st-sig', userId: uid, rev: 1, updatedAt: new Date(),
    data: {
      tasks: [{ id: 's_t1', title: 'Finalize Launch Checklist', col: 'todo', priority: 'high', due: '2026-12-01', created: Date.now() }],
      habits: [{ id: 's_h1', name: 'Deep Work Block', color: '#6366F1', checks: {}, streak: 4 }],
      notes: [{ id: 's_n1', title: 'Signature Notes', content: 'Hierarchy and settings', tags: ['ux'], pinned: true, created: Date.now() }],
      pomodoroLog: [],
    },
  };
  Object.defineProperty(mongoose.connection, 'readyState', { value: 1, configurable: true });
  User.findById = () => ({ select() { return this; }, async lean() { return { _id: uid, name: 'Jordan Lee', email: 'jordan@signature.test', picture: '' }; } });
  UserState.findOne = () => ({ select() { return this; }, async lean() { return doc; } });
  UserState.create = async (p) => { doc = { ...doc, data: p.data }; return doc; };
  UserState.findOneAndUpdate = (f, u) => ({ select() { return this; }, async lean() { doc = { ...doc, data: u.$set.data }; return doc; } });
  Chat.find = () => ({ sort() { return this; }, limit() { return this; }, select() { return this; }, async lean() { return []; } });
  PushPreference.findOne = () => ({ select() { return this; }, async lean() { return { enabled: true, reminderTime: '09:00' }; } });

  const srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexos-sig-'));
  const port = 19740 + Math.floor(Math.random() * 400);
  const chrome = spawn(browser, [
    '--headless=new', '--no-sandbox', '--disable-gpu',
    `--remote-debugging-port=${port}`, `--user-data-dir=${tmpDir}`, 'about:blank',
  ], { stdio: 'ignore' });

  let cdp;
  try {
    cdp = new CDPClient(await waitWs(port));
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Console.enable');
    await cdp.send('Network.enable');

    // Verify all declared HTTP icon/manifest assets serve 200 OK
    for (const urlPath of ['/favicon.svg', '/favicon.ico', '/favicon-16x16.png', '/favicon-32x32.png', '/apple-touch-icon.png', '/nexos-icon-192.png', '/nexos-icon-512.png', '/nexos-icon-maskable-512.png', '/manifest.json?v=4.8.0']) {
      const res = await fetch(`${base}${urlPath}`);
      assert.equal(res.status, 200, `Asset ${urlPath} serves 200 OK`);
    }

    await cdp.send('Network.setCookie', { name: 'token', value: token, domain: '127.0.0.1', path: '/', httpOnly: true });
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Page.navigate', { url: `${base}/enterprise` });
    await cdp.waitFor('document.readyState === "complete" && typeof enterpriseSession !== "undefined" && enterpriseSession.ready === true');

    // 1. Enterprise Sidebar Section IA, SVG icons, Alerts/Export geometry, Tooltip, Arrow keys, Recent dedup
    const sbCheck = await cdp.eval(`(() => {
      restoreEnterpriseWorkspaceDefaults();
      const brandSvg = document.querySelector('.brand-logo-icon svg')?.getBoundingClientRect();
      const navBtns = [...document.querySelectorAll('#ent-sidebar-nav .nav-btn')];
      const allHaveSvg = navBtns.every(b => {
        const s = b.querySelector('.nav-icon svg');
        return s && s.getBoundingClientRect().width >= 12;
      });
      const alertsSvg = document.querySelector('#ent-sb-alerts-btn svg')?.getBoundingClientRect();
      const exportSvg = document.querySelector('#ent-sb-export-btn svg')?.getBoundingClientRect();

      const gWork = document.querySelector('.nav-group-toggle[data-group="workspace"]')?.getBoundingClientRect().top || 0;
      const gGrowth = document.querySelector('.nav-group-toggle[data-group="growth"]')?.getBoundingClientRect().top || 0;
      const gKnow = document.querySelector('.nav-group-toggle[data-group="knowledge"]')?.getBoundingClientRect().top || 0;
      const dashTop = document.querySelector('#ent-sidebar-nav .nav-btn[data-view="dashboard"]')?.getBoundingClientRect().top || 0;
      const focusTop = document.querySelector('#ent-sidebar-nav .nav-btn[data-view="focus"]')?.getBoundingClientRect().top || 0;
      const notesTop = document.querySelector('#ent-sidebar-nav .nav-btn[data-view="notes"]')?.getBoundingClientRect().top || 0;

      // Collapse group click
      document.querySelector('.nav-group-toggle[data-group="knowledge"]')?.click();
      const notesCollapsed = document.querySelector('#ent-sidebar-nav .nav-btn[data-view="notes"]')?.dataset.navCollapsed === '1';
      document.querySelector('.nav-group-toggle[data-group="knowledge"]')?.click();

      // ArrowDown focus movement
      const firstNav = document.querySelector('#ent-sidebar-nav .nav-btn[data-view="dashboard"]');
      firstNav.focus();
      firstNav.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      const nextFocusedView = document.activeElement?.dataset?.view || '';

      // Compact rail floating tooltip
      setEnterpriseSidebarMode('compact');
      const sbRect = document.getElementById('app-sidebar').getBoundingClientRect();
      const focBtn = document.querySelector('#ent-sidebar-nav .nav-btn[data-view="focus"]');
      showEnterpriseRailTooltip(focBtn);
      const tip = document.getElementById('ent-rail-tooltip');
      const tipRect = tip ? tip.getBoundingClientRect() : null;
      const tipVisBeforeHide = Boolean(tip && tip.classList.contains('visible'));
      const tipText = tip ? tip.textContent : '';
      hideEnterpriseRailTooltip();
      setEnterpriseSidebarMode('expanded');

      // Recent deduplication + constant-node SVG sprite href check
      switchNexusView('calendar');
      switchNexusView('dashboard');
      const recentBtns = [...document.querySelectorAll('#ent-nav-recent .ent-aux-item:not([hidden])')];
      const recentViews = recentBtns.map(b => b.dataset.view);
      const calSlot = recentBtns.find(b => b.dataset.view === 'calendar');
      const spriteId = (calSlot?.querySelector('use')?.getAttribute('href') || '').replace('#', '');
      const recentSpriteOk = Boolean(spriteId && document.getElementById(spriteId));

      return {
        brandSvgOk: !!(brandSvg && brandSvg.width >= 16 && brandSvg.height >= 16),
        allHaveSvg,
        footerIconsOk: !!(alertsSvg && alertsSvg.width >= 12 && exportSvg && exportSvg.width >= 12),
        sectionOrderOk: gWork > 0 && gWork < dashTop && dashTop < gGrowth && gGrowth < focusTop && focusTop < gKnow && gKnow < notesTop,
        notesCollapsed,
        nextFocusedView,
        compactW: Math.round(sbRect.width),
        tipLeft: tipRect ? tipRect.left : -1,
        sbRight: sbRect ? sbRect.right : -1,
        tipVisibleClass: tipVisBeforeHide,
        tipText,
        tipVisibleOutside: !!(tipRect && tipVisBeforeHide && tipRect.left >= sbRect.right && tipText.includes('Deep Focus')),
        recentDedupOk: recentViews.includes('calendar') && !recentViews.includes('dashboard') && !recentViews.includes('notes') && recentSpriteOk,
      };
    })()`);

    assert.equal(sbCheck.brandSvgOk, true, 'Unified NexOS vector brand emblem renders in Enterprise sidebar');
    assert.equal(sbCheck.allHaveSvg, true, 'All 9 Enterprise sidebar views render uniform crisp SVG icons at runtime');
    assert.equal(sbCheck.footerIconsOk, true, 'Sidebar Alerts & Export SVG icons render unclipped with full geometry');
    assert.equal(sbCheck.sectionOrderOk, true, '3 sidebar sections position visually above their own items');
    assert.equal(sbCheck.notesCollapsed, true, 'Clicking Knowledge group header collapses group items');
    assert.equal(sbCheck.nextFocusedView, 'kanban', 'ArrowDown keyboard navigation moves focus to next visible destination');
    assert.ok(sbCheck.compactW <= 80, `Compact rail width <= 80px (got ${sbCheck.compactW}px)`);
    assert.equal(sbCheck.tipVisibleOutside, true, `Floating rail tooltip renders outside sidebar bounds without clipping (got tipLeft=${sbCheck.tipLeft}, sbRight=${sbCheck.sbRight}, visible=${sbCheck.tipVisibleClass}, text=${sbCheck.tipText})`);
    assert.equal(sbCheck.recentDedupOk, true, 'Recent views exclude currently active and pinned items');

    // 2. Enterprise Settings Control Center: header, swatches, live preview, timer sync, search jump + clear, z-index > toast
    const setCheck = await cdp.eval(`(() => {
      openEnterpriseSettingsModal('appearance');
      const previewBefore = document.getElementById('ent-preview-title')?.textContent || '';
      applyNexusTheme('cobalt-lime-dark');
      const cobaltInk = getComputedStyle(document.querySelector('.brand-logo-icon')).color;
      updateEnterpriseAppearancePref('interfaceDensity', 'compact');
      updateEnterpriseAppearancePref('textScale', 110);
      const previewAfter = document.getElementById('ent-preview-title')?.textContent || '';
      const headingSingle = document.getElementById('ent-settings-cat-heading')?.textContent;
      const hiddenSubH4 = getComputedStyle(document.querySelector('[data-sec-cat="appearance"] h4')).display === 'none';

      // Sprint timer input sync inside Workspace
      setEnterpriseSettingsCat('workspace');
      const fInp = document.getElementById('ent-pref-focus-min');
      fInp.value = '45';
      fInp.dispatchEvent(new Event('change', { bubbles: true }));
      const cfgSynced = document.getElementById('cfg-focus-min')?.value === '45' && state.pomoTotalTime === 45 * 60;

      // Cross-category search & jump + clear
      setEnterpriseSettingsCat('appearance');
      const sInp = document.getElementById('ent-settings-search');
      sInp.value = 'reminder';
      sInp.dispatchEvent(new Event('input', { bubbles: true }));
      const hitsVisible = !document.getElementById('ent-settings-search-hits').hidden;
      const firstHit = document.querySelector('#ent-settings-search-hits .ent-settings-hit-btn');
      const hitLabel = firstHit?.textContent || '';
      firstHit?.click();
      const jumpedToNotif = document.querySelector('#ent-settings-cats .ent-settings-tab[data-sec="notifications"]')?.classList.contains('active');

      // Test clear button
      sInp.value = 'xyznonexistent';
      sInp.dispatchEvent(new Event('input', { bubbles: true }));
      const emptyVisible = !document.getElementById('ent-settings-empty').hidden;
      document.getElementById('ent-settings-search-clear')?.click();
      const clearedOk = sInp.value === '' && document.getElementById('ent-settings-empty').hidden;

      // Verify modal z-index > toast shelf z-index
      const modalZ = parseInt(getComputedStyle(document.getElementById('modal-enterprise-settings')).zIndex, 10) || 0;
      const toastZ = parseInt(getComputedStyle(document.querySelector('.toast-shelf')).zIndex, 10) || 0;
      closeModal('modal-enterprise-settings');

      return {
        previewUpdated: previewBefore !== previewAfter && previewAfter.includes('Cobalt Lime') && previewAfter.includes('110%'),
        cobaltHighContrastInk: cobaltInk === 'rgb(3, 4, 7)',
        headingSingle,
        hiddenSubH4,
        cfgSynced,
        hitsVisible,
        hitHasReminder: hitLabel.toLowerCase().includes('reminder'),
        jumpedToNotif,
        emptyVisible,
        clearedOk,
        modalAboveToast: modalZ > toastZ,
      };
    })()`);

    assert.equal(setCheck.previewUpdated, true, 'Appearance live preview card tracks theme, density & scale changes');
    assert.equal(setCheck.cobaltHighContrastInk, true, 'Cobalt Lime brand SVG icon uses crisp dark contrast ink');
    assert.equal(setCheck.hiddenSubH4, true, 'Single-category detail pane suppresses redundant duplicated heading');
    assert.equal(setCheck.cfgSynced, true, 'Settings Focus duration input syncs cleanly to Pomodoro timer');
    assert.equal(setCheck.hitsVisible && setCheck.hitHasReminder && setCheck.jumpedToNotif, true, 'Cross-category settings search jumps straight to matching control category');
    assert.equal(setCheck.emptyVisible && setCheck.clearedOk, true, 'Settings search clear button & empty state restore clean list');
    assert.equal(setCheck.modalAboveToast, true, 'Settings modal stacks above toast notifications without visual overlap');

    // 3. Mobile opaque drawer + crisp 1-word bottom nav labels + Classics Settings Search
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    const mobCheck = await cdp.eval(`(() => {
      applyNexusTheme('apple-dark');
      applyEnterpriseSidebarPrefs();
      document.getElementById('enterprise-menu-toggle')?.click();
      const sbBg = getComputedStyle(document.getElementById('app-sidebar')).backgroundImage;
      const isOpen = document.getElementById('app-sidebar').classList.contains('open');
      closeSidebarDrawer();
      const mobLabels = [...document.querySelectorAll('#mobile-bottom-nav .mob-nav-item .mob-nav-label')].map(el => el.textContent.trim());
      return { isOpen, hasOpaqueBg: sbBg !== 'none', mobLabels };
    })()`);
    assert.equal(mobCheck.isOpen && mobCheck.hasOpaqueBg, true, 'Mobile Enterprise drawer opens with solid opaque elevated surface');
    assert.deepEqual(mobCheck.mobLabels, ['Home', 'Kanban', 'Focus', 'Notes', 'More'], 'Mobile bottom bar shows concise crisp labels');

    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Network.clearBrowserCookies');
    await cdp.send('Page.navigate', { url: `${base}/classic` });
    await cdp.waitFor('document.readyState === "complete" && typeof startGuest === "function"');
    const loginBrandOk = await cdp.eval(`(() => {
      const r = document.querySelector('.login-brand .logo-mark svg')?.getBoundingClientRect();
      return !!(r && r.width >= 20 && r.height >= 20);
    })()`);
    assert.equal(loginBrandOk, true, 'Unified NexOS vector mark renders cleanly on Classic sign-in screen');
    await cdp.eval(`startGuest(); if (typeof finishQuickStart === 'function' && document.getElementById('quickstart-modal')?.classList.contains('is-open')) finishQuickStart(true);`);
    await cdp.waitFor('document.getElementById("sidebar") !== null');
    const clCheck = await cdp.eval(`(() => {
      const sbLogo = document.querySelector('#sidebar .logo-mark svg')?.getBoundingClientRect();
      openProfile('all');
      const searchInp = document.getElementById('classic-settings-search');
      const wrapWidth = searchInp?.closest('.settings-search-wrap')?.getBoundingClientRect().width || 0;
      const inpWidth = searchInp?.getBoundingClientRect().width || 0;
      searchInp.value = 'contrast';
      filterClassicSettings();
      const hitsVis = !document.getElementById('classic-settings-jump-hits').hidden;
      document.querySelector('#classic-settings-jump-hits .classic-hit-pill')?.click();
      const a11ySec = document.getElementById('classic-settings-a11y');
      const a11yVisible = Boolean(a11ySec && !a11ySec.hidden && a11ySec.offsetParent !== null && document.querySelector('#classic-settings-cats [data-cat="accessibility"]')?.classList.contains('active'));
      searchInp.value = 'focus';
      filterClassicSettings();
      document.getElementById('classic-settings-search-clear')?.click();
      const cleared = searchInp.value === '' && document.getElementById('classic-settings-jump-hits').hidden;
      return {
        sbLogoOk: !!(sbLogo && sbLogo.width >= 14),
        fullWidthSearch: wrapWidth > 300 && inpWidth > wrapWidth * 0.85,
        hitsVis,
        a11yVisible,
        cleared,
      };
    })()`);
    assert.equal(clCheck.sbLogoOk, true, 'Unified NexOS vector mark renders in Classic sidebar');
    assert.equal(clCheck.fullWidthSearch, true, 'Classic Settings search bar spans full container width cleanly');
    assert.equal(clCheck.hitsVis && clCheck.a11yVisible && clCheck.cleared, true, 'Classic Settings search jump pills and clear button work cleanly');

    assert.deepEqual(cdp.errors, [], `Zero console/runtime errors (got: ${cdp.errors.join('; ')})`);
    assert.deepEqual(cdp.badResponses, [], `Zero unexpected HTTP >=400 errors (got: ${cdp.badResponses.join('; ')})`);
    console.log('NexOS 4.9.0 Project Signature browser verification passed.');
  } finally {
    if (cdp) cdp.close();
    try { chrome.kill('SIGKILL'); } catch (_) {}
    await new Promise((r) => setTimeout(r, 200));
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    if (origReady) Object.defineProperty(mongoose.connection, 'readyState', origReady);
    User.findById = origUserFind;
    UserState.findOne = origStateFindOne;
    UserState.create = origStateCreate;
    UserState.findOneAndUpdate = origStateUpdate;
    Chat.find = origChatFind;
    PushPreference.findOne = origPushFindOne;
    srv.closeAllConnections?.();
    await new Promise((r) => srv.close(r));
  }
}

(async () => {
  verifyBrandAssetsAndDocs();
  await runBrowserSignatureSuite();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
