'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);

function findBrowser() {
  for (const p of CHROME_CANDIDATES) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

class CDPClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.seq = 0;
    this.pending = new Map();
    this.exceptions = [];
    this.consoleErrors = [];
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', reject, { once: true });
    });
    this.ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        else resolve(msg.result);
        return;
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        const desc = msg.params?.exceptionDetails?.exception?.description || msg.params?.exceptionDetails?.text || 'Uncaught exception';
        if (!/accounts\.google\.com|cdn\.jsdelivr\.net|fonts\.googleapis/i.test(desc)) {
          this.exceptions.push(desc);
        }
      } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params?.type === 'error') {
        const text = (msg.params.args || []).map((a) => a.value || a.description || '').join(' ');
        if (!/Failed to load resource: net::ERR|accounts\.google\.com|fonts\.googleapis|cdn\.jsdelivr\.net/i.test(text)) {
          this.consoleErrors.push(text);
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
    const res = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (res.exceptionDetails) {
      throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text || 'Eval failed');
    }
    return res.result?.value;
  }

  async waitFor(predicateJs, timeoutMs = 7000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (await this.eval(`Boolean(${predicateJs})`)) return;
      await new Promise((r) => setTimeout(r, 35));
    }
    throw new Error('Timed out waiting for: ' + predicateJs);
  }

  close() {
    try { this.ws.close(); } catch (_) {}
  }
}

async function waitForDevToolsWs(port, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
      const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 80));
  }
  throw new Error('Chrome DevTools JSON endpoint did not become ready');
}

(async function main() {
  // Verify 4.6.0 release consistency across package/lockfile/docs/HTML/SW while preserving historical references
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
  const compose = fs.readFileSync(path.join(ROOT, 'docker-compose.yml'), 'utf8');
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const sw = fs.readFileSync(path.join(ROOT, 'public', 'sw.js'), 'utf8');
  const classicHtml = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  const entHtml = fs.readFileSync(path.join(ROOT, 'public', 'index-redesign.html'), 'utf8');
  assert.equal(pkg.version, '4.6.0', 'package.json version must be 4.6.0');
  assert.equal(lock.version, '4.6.0', 'package-lock.json version must be 4.6.0');
  assert.equal(lock.packages[''].version, '4.6.0', 'package-lock root package version must be 4.6.0');
  assert.ok(compose.includes('com.nexos.version=4.6.0'), 'docker-compose label matches 4.6.0');
  assert.ok(readme.includes('Current source release: 4.6.0.'), 'README identifies 4.6.0 as current release');
  assert.ok(readme.includes('[Notes](RELEASE-NOTES/NexOS-4.6.0.md)'), 'README links 4.6.0 release notes');
  assert.ok(fs.existsSync(path.join(ROOT, 'RELEASE-NOTES', 'NexOS-4.6.0.md')), '4.6.0 release notes file exists');
  assert.ok(sw.includes("const CACHE = 'nexos-shell-v39'"), 'SW cache namespace bumped to v39');
  assert.ok(!/v=4\.5\.1/.test(sw) && !/v=4\.5\.1/.test(classicHtml) && !/v=4\.5\.1/.test(entHtml), 'No stale ?v=4.5.1 asset queries in active shell/SW');
  assert.ok(entHtml.includes('PHONE FIXES (2.5.1)'), 'Historical 2.5.1 comment preserved');
  // Verify about.html does not exist and CORS supports PATCH
  assert.equal(fs.existsSync(path.join(ROOT, 'public', 'about.html')), false, 'about.html must not exist on disk');

  const app = require('../server.js');
  const httpServer = http.createServer(app);
  await new Promise((r) => httpServer.listen(0, '127.0.0.1', r));
  const urlBase = `http://127.0.0.1:${httpServer.address().port}`;

  try {
    // 1. Real HTTP checks: PATCH in CORS preflight + 404 for /about.html
    const preflight = await fetch(`${urlBase}/api/study/plans/123/topics/0`, {
      method: 'OPTIONS',
      headers: { Origin: urlBase, 'Access-Control-Request-Method': 'PATCH' },
    });
    const allowMethods = preflight.headers.get('access-control-allow-methods') || '';
    assert.ok(allowMethods.includes('PATCH'), `CORS preflight must allow PATCH, got: ${allowMethods}`);
    const contactHtmlRes = await fetch(`${urlBase}/contact.html`).then((r) => r.text());
    assert.ok(contactHtmlRes.includes('Abhay Yadav') && contactHtmlRes.includes('About NexOS'), '/contact.html serves creator/About summary');

    if (process.env.NEXOS_SKIP_BROWSER === '1') {
      console.log('Study Studio 4.6.0 full-page browser checks skipped (NEXOS_SKIP_BROWSER=1); HTTP/CORS checks passed.');
      return;
    }
    const browserPath = findBrowser();
    if (!browserPath) {
      console.log('Study Studio 4.6.0 full-page browser checks skipped (Chrome/Edge binary not found); HTTP/CORS checks passed.');
      return;
    }

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexos-cdp-460-'));
    const port = 19522 + Math.floor(Math.random() * 1000);
    const chrome = spawn(browserPath, [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${tmpDir}`,
      'about:blank',
    ], { stdio: 'ignore' });

    let cdp = null;
    try {
      const wsUrl = await waitForDevToolsWs(port);
      cdp = new CDPClient(wsUrl);
      await cdp.send('Page.enable');
      await cdp.send('Runtime.enable');
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });

      // ── 2. CLASSIC (/): Full-page Study Studio, scroll isolation, navigation, back, themes & NexAI ──
      await cdp.send('Page.navigate', { url: `${urlBase}/` });
      await cdp.waitFor('document.readyState === "complete" && typeof startGuest === "function"');
      await cdp.eval('startGuest()');
      await cdp.eval(`(async () => {
        if (typeof finishQuickStart === 'function') await finishQuickStart(true);
        if (typeof closeQuickStart === 'function') closeQuickStart();
        document.querySelectorAll('.modal-overlay.is-open').forEach((el) => el.classList.remove('is-open'));
      })()`);
      await cdp.waitFor('document.getElementById("nexos-study-btn") !== null && typeof NexStudy !== "undefined"');

      // Check toast z-index > Study Studio z-index
      const toastStack = await cdp.eval(`(() => {
        const host = document.getElementById('toasts');
        return { z: host ? Number(getComputedStyle(host).zIndex || 0) : 0 };
      })()`);
      assert.ok(toastStack.z > 2100, `Classic .toasts z-index (${toastStack.z}) must exceed Study Studio 2100`);

      // Test scroll lock & restoration across Desktop, Tablet, Mobile
      for (const vp of [
        { name: 'desktop', width: 1280, height: 800, mobile: false },
        { name: 'tablet', width: 768, height: 1024, mobile: false },
        { name: 'mobile', width: 360, height: 740, mobile: true },
      ]) {
        await cdp.send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: vp.mobile });
        await cdp.eval(`(() => {
          switchView('dashboard');
          let spacer = document.getElementById('cdp-bg-spacer');
          if (!spacer) {
            spacer = document.createElement('div');
            spacer.id = 'cdp-bg-spacer';
            spacer.style.height = '2600px';
            document.getElementById('view-dashboard').appendChild(spacer);
          }
          window.scrollTo({ top: 540, left: 0, behavior: 'instant' });
        })()`);
        const beforeY = await cdp.eval('Math.round(window.scrollY)');
        assert.ok(beforeY >= 400, `Classic ${vp.name} background must scroll before opening (${beforeY})`);

        // Focus trigger without scrolling away from saved scroll position, then open Study Studio
        await cdp.eval(`(() => {
          const btn = document.getElementById('nexos-study-btn');
          btn.focus({ preventScroll: true });
          openStudyStudio();
        })()`);
        await cdp.waitFor('document.querySelector("#nexos-study-modal[data-open=\\"1\\"]") !== null');

        const geom = await cdp.eval(`(() => {
          const m = document.getElementById('nexos-study-modal');
          const c = m.querySelector('.ns-card');
          const back = m.querySelector('.ns-back');
          const x = m.querySelector('.ns-x');
          const mr = m.getBoundingClientRect();
          const cr = c.getBoundingClientRect();
          const csM = getComputedStyle(m);
          const csC = getComputedStyle(c);
          return {
            iw: window.innerWidth, ih: window.innerHeight,
            mRect: { l: Math.round(mr.left), t: Math.round(mr.top), r: Math.round(mr.right), b: Math.round(mr.bottom) },
            cRect: { l: Math.round(cr.left), t: Math.round(cr.top), r: Math.round(cr.right), b: Math.round(cr.bottom) },
            borderRadius: csC.borderRadius,
            boxShadow: csC.boxShadow,
            bgAlpha: csM.backgroundColor,
            backVisible: Boolean(back && back.getBoundingClientRect().width > 0),
            closeVisible: Boolean(x && x.getBoundingClientRect().width > 0),
            bodyPos: document.body.style.position,
            bodyTop: document.body.style.top,
            winY: Math.round(window.scrollY),
            docOverflow: document.documentElement.scrollWidth - window.innerWidth,
            cardFocus: m.contains(document.activeElement),
          };
        })()`);
        assert.deepEqual(geom.mRect, { l: 0, t: 0, r: geom.iw, b: geom.ih }, `Classic ${vp.name} #nexos-study-modal fills full viewport`);
        assert.deepEqual(geom.cRect, { l: 0, t: 0, r: geom.iw, b: geom.ih }, `Classic ${vp.name} .ns-card fills full viewport (not popup)`);
        assert.equal(geom.borderRadius, '0px', `Classic ${vp.name} .ns-card must have 0px border-radius`);
        assert.equal(geom.boxShadow, 'none', `Classic ${vp.name} .ns-card must have no popup shadow`);
        assert.equal(geom.backVisible && geom.closeVisible, true, `Classic ${vp.name} Back and Close buttons visible`);
        assert.equal(geom.bodyPos, 'fixed', `Classic ${vp.name} body locked while Study Studio open`);
        assert.equal(geom.bodyTop, `-${beforeY}px`, `Classic ${vp.name} background visual offset preserved`);
        assert.equal(geom.cardFocus, true, `Classic ${vp.name} focus moves inside Study Studio`);
        assert.ok(geom.docOverflow <= 1, `Classic ${vp.name} zero horizontal overflow`);

        // Make foreground scroll container genuinely scrollable + add a nested scroll box
        await cdp.eval(`(() => {
          const sc = document.querySelector('#nexos-study-modal .ns-scroll');
          const fill = document.createElement('div');
          fill.id = 'cdp-fg-spacer';
          fill.style.height = '1800px';
          fill.innerHTML = '<div id="cdp-nested-box" style="height:100px;overflow-y:auto;border:1px solid #888"><div style="height:400px">Nested content</div></div>';
          sc.appendChild(fill);
        })()`);

        // Wheel inside foreground advances .ns-scroll; boundary wheel & touchmove get prevented & background stays fixed
        const scrollIsolation = await cdp.eval(`(() => {
          const m = document.getElementById('nexos-study-modal');
          const sc = m.querySelector('.ns-scroll');
          const head = m.querySelector('.ns-head');
          const nested = document.getElementById('cdp-nested-box');

          // 1) Top boundary wheel up should be prevented
          sc.scrollTop = 0;
          const evTop = new WheelEvent('wheel', { deltaY: -120, cancelable: true, bubbles: true });
          sc.dispatchEvent(evTop);

          // 2) Nested panel scrolls internally and prevents chaining at bottom
          nested.scrollTop = 20;
          const evNestedMid = new WheelEvent('wheel', { deltaY: 60, cancelable: true, bubbles: true });
          nested.dispatchEvent(evNestedMid);
          nested.scrollTop = nested.scrollHeight - nested.clientHeight;
          const evNestedBot = new WheelEvent('wheel', { deltaY: 120, cancelable: true, bubbles: true });
          nested.dispatchEvent(evNestedBot);

          // 3) Foreground .ns-scroll scrolls down to bottom boundary
          const evMid = new WheelEvent('wheel', { deltaY: 120, cancelable: true, bubbles: true });
          sc.dispatchEvent(evMid);
          sc.scrollTop = sc.scrollHeight - sc.clientHeight;
          const maxFg = Math.round(sc.scrollTop);
          const evBot = new WheelEvent('wheel', { deltaY: 180, cancelable: true, bubbles: true });
          sc.dispatchEvent(evBot);

          // 4) Non-scrollable header wheel prevented
          const evHead = new WheelEvent('wheel', { deltaY: 120, cancelable: true, bubbles: true });
          head.dispatchEvent(evHead);

          // 5) Touch boundary checks (down swipe at scrollTop=0 & up swipe at bottom boundary)
          sc.scrollTop = 0;
          const tStartTop = new TouchEvent('touchstart', { cancelable: true, bubbles: true, touches: [new Touch({ identifier: 1, target: sc, clientX: 160, clientY: 300 })] });
          sc.dispatchEvent(tStartTop);
          const tMoveTop = new TouchEvent('touchmove', { cancelable: true, bubbles: true, touches: [new Touch({ identifier: 1, target: sc, clientX: 160, clientY: 380 })] });
          sc.dispatchEvent(tMoveTop);

          sc.scrollTop = sc.scrollHeight - sc.clientHeight;
          const tStartBot = new TouchEvent('touchstart', { cancelable: true, bubbles: true, touches: [new Touch({ identifier: 2, target: sc, clientX: 160, clientY: 400 })] });
          sc.dispatchEvent(tStartBot);
          const tMoveBot = new TouchEvent('touchmove', { cancelable: true, bubbles: true, touches: [new Touch({ identifier: 2, target: sc, clientX: 160, clientY: 310 })] });
          sc.dispatchEvent(tMoveBot);

          // 6) Attempt programmatic scroll on background while open
          window.scrollBy(0, 300);

          return {
            topPrevented: evTop.defaultPrevented,
            nestedMidPrevented: evNestedMid.defaultPrevented,
            nestedBotPrevented: evNestedBot.defaultPrevented,
            fgMidPrevented: evMid.defaultPrevented,
            maxFg,
            botPrevented: evBot.defaultPrevented,
            headPrevented: evHead.defaultPrevented,
            touchTopPrevented: tMoveTop.defaultPrevented,
            touchBotPrevented: tMoveBot.defaultPrevented,
            bodyTopAfter: document.body.style.top,
            winYAfter: Math.round(window.scrollY),
          };
        })()`);

        assert.equal(scrollIsolation.topPrevented, true, `Classic ${vp.name} prevents scroll chaining at top boundary`);
        assert.equal(scrollIsolation.nestedMidPrevented, false, `Classic ${vp.name} allows nested box scrolling`);
        assert.equal(scrollIsolation.nestedBotPrevented, true, `Classic ${vp.name} prevents nested box bottom chaining`);
        assert.equal(scrollIsolation.fgMidPrevented, false, `Classic ${vp.name} allows Study Studio content scrolling`);
        assert.ok(scrollIsolation.maxFg > 100, `Classic ${vp.name} Study Studio scrolls long content (max=${scrollIsolation.maxFg})`);
        assert.equal(scrollIsolation.botPrevented, true, `Classic ${vp.name} prevents scroll chaining at bottom boundary`);
        assert.equal(scrollIsolation.headPrevented, true, `Classic ${vp.name} blocks wheel on non-scroll header`);
        assert.equal(scrollIsolation.touchTopPrevented, true, `Classic ${vp.name} prevents touch pull-down chaining at top boundary`);
        assert.equal(scrollIsolation.touchBotPrevented, true, `Classic ${vp.name} prevents touch swipe-up chaining at bottom boundary`);
        assert.equal(scrollIsolation.bodyTopAfter, `-${beforeY}px`, `Classic ${vp.name} background stays stationary`);
        assert.equal(scrollIsolation.winYAfter, 0, `Classic ${vp.name} window.scrollY stays 0 during lock`);

        // Also fire real Chrome CDP touch swipe + mouseWheel events on mobile/desktop
        if (vp.mobile) {
          await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true });
          const cx = Math.round(vp.width / 2), cy = Math.round(vp.height / 2);
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy }] });
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx, y: cy - 160 }] });
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
          await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });
        }
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: Math.round(vp.width / 2), y: Math.round(vp.height / 2), deltaX: 0, deltaY: 400 });
        await new Promise((r) => setTimeout(r, 40));
        const realWheelCheck = await cdp.eval(`(() => ({ bodyTop: document.body.style.top, winY: Math.round(window.scrollY) }))()`);
        assert.equal(realWheelCheck.bodyTop, `-${beforeY}px`, `Classic ${vp.name} real CDP mouseWheel cannot move background`);
        assert.equal(realWheelCheck.winY, 0);

        // Switch guest preview to Mindmap preview & test Escape in node edit vs Study Studio
        await cdp.eval(`(() => {
          document.querySelector('[data-ns="guest-mode"][data-g="mindmap"]').click();
        })()`);
        await cdp.waitFor('document.getElementById("ns-mm-stage") !== null');
        const mmZoomCheck = await cdp.eval(`(() => {
          const st = document.getElementById('ns-mm-stage');
          st.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, clientX: 180, clientY: 160, cancelable: true, bubbles: true }));
          const lbl1 = document.getElementById('ns-mm-zoom-label')?.textContent || '';
          document.querySelector('[data-ns="mm-edit-open"]').click();
          const hasEditInput = Boolean(document.getElementById('ns-mm-edit-label'));
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          const stillOpenAfterEditEsc = document.getElementById('nexos-study-modal').dataset.open === '1';
          const editClosed = !document.getElementById('ns-mm-edit-label');
          // Ctrl+K must NOT open background #search-modal behind Study Studio
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
          const bgPaletteOpened = document.getElementById('search-modal')?.classList.contains('is-open');
          return { lbl1, hasEditInput, stillOpenAfterEditEsc, editClosed, bgPaletteOpened, bodyTop: document.body.style.top };
        })()`);
        assert.ok(mmZoomCheck.hasEditInput && mmZoomCheck.editClosed && mmZoomCheck.stillOpenAfterEditEsc, 'Escape cancels mindmap node editor before closing Study Studio');
        assert.equal(mmZoomCheck.bgPaletteOpened, false, 'Ctrl+K does not open background search palette behind Study Studio');
        assert.equal(mmZoomCheck.bodyTop, `-${beforeY}px`, 'Mindmap zoom does not disturb background scroll');

        // Close via Back button & confirm exact scroll + body style + focus restoration
        await cdp.eval('document.querySelector("#nexos-study-modal .ns-back").click()');
        await cdp.waitFor('document.getElementById("nexos-study-modal").dataset.open === "0"');
        const afterClose = await cdp.eval(`(() => ({
          winY: Math.round(window.scrollY),
          bodyPos: document.body.style.position,
          bodyOverflow: document.body.style.overflow,
          htmlOverflow: document.documentElement.style.overflow,
          focusRestored: document.activeElement && document.activeElement.id === 'nexos-study-btn',
        }))()`);
        assert.equal(afterClose.winY, beforeY, `Classic ${vp.name} restores exact background scrollY (${afterClose.winY} === ${beforeY})`);
        assert.equal(afterClose.bodyPos, '', `Classic ${vp.name} restores body position`);
        assert.equal(afterClose.bodyOverflow, '', `Classic ${vp.name} restores body overflow`);
        assert.equal(afterClose.htmlOverflow, '', `Classic ${vp.name} restores html overflow`);
        assert.equal(afterClose.focusRestored, true, `Classic ${vp.name} restores focus to trigger element`);
      }

      // Desktop: repeated open/close, browser back (popstate), switchView navigation, Day Derailed scroll lock, theme opacity
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
      const classicExtra = await cdp.eval(`(async () => {
        window.scrollTo({ top: 380, left: 0, behavior: 'instant' });
        for (let i = 0; i < 4; i++) {
          openStudyStudio();
          NexStudy.close();
        }
        const afterLoopY = Math.round(window.scrollY);

        // Browser Back (popstate) closes open Study Studio
        openStudyStudio();
        await new Promise((r) => setTimeout(r, 40));
        history.back();
        await new Promise((r) => setTimeout(r, 120));
        const closedByBack = document.getElementById('nexos-study-modal').dataset.open === '0';
        const afterBackY = Math.round(window.scrollY);

        // switchView closes active Study Studio cleanly
        openStudyStudio();
        switchView('kanban');
        const closedByNav = document.getElementById('nexos-study-modal').dataset.open === '0';

        // Day Derailed also locks and restores scroll
        switchView('dashboard');
        window.scrollTo({ top: 310, left: 0, behavior: 'instant' });
        openDayDerailed();
        const derailPos = document.body.style.position;
        document.querySelector('#nexos-derail-modal [data-nd="close"]').click();
        const derailRestoredY = Math.round(window.scrollY);

        // Apple Glass dark theme check on Study Studio background (must remain opaque)
        if (window.NexUI) { NexUI.setDesign('apple'); NexUI.setTheme('dark'); }
        openStudyStudio();
        const glassBg = getComputedStyle(document.getElementById('nexos-study-modal')).backgroundColor;
        NexStudy.close();
        if (window.NexUI) { NexUI.setDesign('google'); NexUI.setTheme('dark'); }

        return { afterLoopY, closedByBack, afterBackY, closedByNav, derailPos, derailRestoredY, glassBg };
      })()`);
      assert.equal(classicExtra.afterLoopY, 380, 'Repeated open/close preserves exact scrollY');
      assert.equal(classicExtra.closedByBack, true, 'Browser Back (popstate) closes Study Studio');
      assert.equal(classicExtra.afterBackY, 380, 'Browser Back restores original scrollY');
      assert.equal(classicExtra.closedByNav, true, 'switchView closes active Study Studio');
      assert.equal(classicExtra.derailPos, 'fixed', 'Day Derailed locks background scroll');
      assert.equal(classicExtra.derailRestoredY, 310, 'Day Derailed restores scroll position');
      assert.ok(!/rgba\([^)]+,\s*0(\.\d+)?\)/.test(classicExtra.glassBg), `Study Studio background opaque in Glass mode (${classicExtra.glassBg})`);

      // ── 3. Authenticated Study Studio 6 tabs + Mindmap CRUD + Summarize Note + NexAI Continue in Classic ──
      const classicFlow = await cdp.eval(`(async () => {
        // Test summarizeNote race protection (switching notes mid-summarization)
        state.notes = [
          { id: 'nA', title: 'Note A', content: 'Alpha notes about scheduling.', tags: [] },
          { id: 'nB', title: 'Note B', content: 'Beta note stays untouched.', tags: [] }
        ];
        state.currentNoteId = 'nA';
        switchView('notes');
        renderNotes();

        const savedFetch = window.fetch;
        const mmStore = new Map();
        let mmCounter = 0;
        const SSE_RESP = (events) => {
          const txt = events.map((ev) => 'event: ' + ev.event + '\\ndata: ' + JSON.stringify(ev.data) + '\\n\\n').join('');
          return new Response(new ReadableStream({
            start(ctrl) { ctrl.enqueue(new TextEncoder().encode(txt)); ctrl.close(); }
          }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
        };

        window.fetch = async (url, init = {}) => {
          const u = String(url);
          const m = (init.method || 'GET').toUpperCase();
          if (u === '/api/complete') {
            await new Promise((r) => setTimeout(r, 80));
            return new Response(JSON.stringify({ text: 'Concise alpha summary.' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
          }
          if (u === '/api/study/docs' && m === 'GET') {
            return new Response(JSON.stringify({
              docs: [{ id: 'd1', title: 'OS Notes', subject: 'CS', pageCount: 2, chunkCount: 4, charCount: 400 }],
              usage: { used: 1, limit: 10, maxChars: 20000 }
            }), { status: 200, headers: { 'Content-Type': 'application/json' } });
          }
          if (u === '/api/study/mindmaps' && m === 'GET') {
            return new Response(JSON.stringify({ mindmaps: [...mmStore.values()].map((x) => ({ id: x.id, title: x.title, nodeCount: 3 })) }), { status: 200, headers: { 'Content-Type': 'application/json' } });
          }
          if (u === '/api/study/mindmaps/generate' && m === 'POST') {
            return new Response(JSON.stringify({
              draft: { title: 'OS Concepts', sourceTitle: 'OS Notes', documentId: 'd1', root: { id: 'r1', label: 'OS Concepts', children: [{ id: 'c1', label: 'Scheduling', children: [] }] } }
            }), { status: 200, headers: { 'Content-Type': 'application/json' } });
          }
          if (u === '/api/study/mindmaps' && m === 'POST') {
            const body = JSON.parse(init.body);
            const item = { id: 'mm_' + (++mmCounter), ...body };
            mmStore.set(item.id, item);
            return new Response(JSON.stringify({ mindmap: item }), { status: 201, headers: { 'Content-Type': 'application/json' } });
          }
          if (u.startsWith('/api/study/mindmaps/mm_') && m === 'GET') {
            const id = u.split('/').pop();
            return new Response(JSON.stringify({ mindmap: mmStore.get(id) }), { status: 200, headers: { 'Content-Type': 'application/json' } });
          }
          if (u.startsWith('/api/study/mindmaps/mm_') && m === 'PUT') {
            const id = u.split('/').pop();
            const body = JSON.parse(init.body);
            const item = { ...mmStore.get(id), ...body, id };
            mmStore.set(id, item);
            return new Response(JSON.stringify({ mindmap: item }), { status: 200, headers: { 'Content-Type': 'application/json' } });
          }
          if (u.startsWith('/api/study/mindmaps/mm_') && m === 'DELETE') {
            const id = u.split('/').pop();
            mmStore.delete(id);
            return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
          }
          if (u === '/api/study/reviews') return new Response(JSON.stringify({ items: [], due: 0 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
          if (u === '/api/study/plans') return new Response(JSON.stringify({ plans: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
          if (u === '/api/study/calendar/status') return new Response(JSON.stringify({ connected: false, configured: false }), { status: 200, headers: { 'Content-Type': 'application/json' } });
          if (u === '/api/push/config') return new Response(JSON.stringify({ enabled: false }), { status: 200, headers: { 'Content-Type': 'application/json' } });
          if (u === '/api/push/preferences') return new Response(JSON.stringify({ enabled: true, reminderTime: '09:00' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
          if (u === '/api/chat' && m === 'POST') {
            const body = JSON.parse(init.body || '{}');
            if (/Continue from/i.test(body.message || '')) {
              return SSE_RESP([
                { event: 'delta', data: { text: 'Continuation completed clearly.' } },
                { event: 'done', data: { chatId: 'c1', title: 'Test Chat', updatedAt: Date.now(), incomplete: false, finishReason: 'STOP' } }
              ]);
            }
            if (/truncate/i.test(body.message || '')) {
              return SSE_RESP([
                { event: 'delta', data: { text: '1. Plan sprint\\n2. Review (' } },
                { event: 'done', data: { chatId: 'c1', title: 'Test Chat', updatedAt: Date.now(), incomplete: true, incompleteReason: 'MAX_TOKENS', finishReason: 'MAX_TOKENS' } }
              ]);
            }
            return SSE_RESP([
              { event: 'delta', data: { text: 'Here is a complete answer with no truncation.' } },
              { event: 'done', data: { chatId: 'c1', title: 'Test Chat', updatedAt: Date.now(), incomplete: false, finishReason: 'STOP' } }
            ]);
          }
          return savedFetch(url, init);
        };

        try {
          // Run summarizeNote on Note A while authenticated
          currentUser = { email: 'test@nexos.local', name: 'Test' };
          const sumP = summarizeNote();
          openNote('nB'); // switch note immediately before resolve
          await sumP;
          const noteAAfter = state.notes.find((n) => n.id === 'nA').content;
          const noteBAfter = state.notes.find((n) => n.id === 'nB').content;
          const editorDisabledAfter = document.getElementById('note-content').disabled;

          // Study Studio all 6 tabs + Mindmap generate -> edit -> add -> delete -> save -> reopen -> delete
          openStudyStudio({ tab: 'mindmap' });
          await new Promise((r) => setTimeout(r, 80));
          for (const t of ['tutor', 'quiz', 'cards', 'revision', 'library', 'mindmap']) {
            document.getElementById('ns-tab-' + t).click();
          }
          await new Promise((r) => setTimeout(r, 80));
          document.querySelector('[data-ns="mm-generate"]').click();
          await new Promise((r) => setTimeout(r, 80));
          document.querySelector('[data-ns="mm-add-child"]').click();
          document.getElementById('ns-mm-edit-label').value = 'Edited Branch';
          document.querySelector('[data-ns="mm-edit-apply"]').click();
          document.querySelector('[data-ns="mm-save"]').click();
          await new Promise((r) => setTimeout(r, 80));
          const savedChipsAfterSave = document.querySelectorAll('.ns-mm-chip').length;
          // Reopen saved mindmap & delete a child node, then delete whole map
          document.querySelector('.ns-mm-chip').click();
          await new Promise((r) => setTimeout(r, 60));
          const childNode = Array.from(document.querySelectorAll('.ns-mm-node')).find((n) => n.getAttribute('data-depth') !== '0');
          childNode.click();
          document.querySelector('[data-ns="mm-del-node"]').click();
          const origConfirm = window.confirm;
          window.confirm = () => true;
          document.querySelector('[data-ns="mm-delete-saved"]').click();
          await new Promise((r) => setTimeout(r, 60));
          window.confirm = origConfirm;
          const savedChipsAfterDel = document.querySelectorAll('.ns-mm-chip').length;
          NexStudy.close();

          // Priority 2: NexAI complete response vs MAX_TOKENS Continue button -> click Continue
          switchView('ai');
          document.getElementById('chat-input').value = 'normal complete question';
          await sendMessage();
          const completeContinueCount = document.querySelectorAll('#chat-messages .nx-incomplete-bar button').length;
          document.getElementById('chat-input').value = 'truncate this reply';
          await sendMessage();
          const truncContinueBtn = document.querySelector('#chat-messages .chat-msg.assistant:last-of-type .nx-incomplete-bar button');
          const truncActionBtns = document.querySelectorAll('#chat-messages .chat-msg.assistant:last-of-type .nx-addtasks button').length;
          const hasContinueBtn = Boolean(truncContinueBtn);
          if (truncContinueBtn) {
            truncContinueBtn.click();
            await new Promise((r) => setTimeout(r, 80));
          }
          const lastText = document.querySelector('#chat-messages .chat-msg.assistant:last-of-type .msg-bubble')?.textContent || '';

          return {
            noteAHasSummary: noteAAfter.includes('Concise alpha summary.'),
            noteBIntact: noteBAfter === 'Beta note stays untouched.',
            editorEnabled: !editorDisabledAfter,
            savedChipsAfterSave,
            savedChipsAfterDel,
            completeContinueCount,
            hasContinueBtn,
            truncActionBtns,
            continuedTextOk: lastText.includes('Continuation completed clearly.'),
          };
        } finally {
          window.fetch = savedFetch;
          currentUser = { guest: true, name: 'Guest' };
        }
      })()`);

      assert.equal(classicFlow.noteAHasSummary, true, 'Classic summarizeNote saves summary onto original Note A');
      assert.equal(classicFlow.noteBIntact, true, 'Classic summarizeNote does not overwrite Note B when user switches notes');
      assert.equal(classicFlow.editorEnabled, true, 'Classic note editor stays enabled after switching during summarize');
      assert.equal(classicFlow.savedChipsAfterSave, 1, 'Authenticated Study Studio generates, edits, and saves Mindmap');
      assert.equal(classicFlow.savedChipsAfterDel, 0, 'Authenticated Study Studio reopens, deletes node, and deletes saved Mindmap');
      assert.equal(classicFlow.completeContinueCount, 0, 'Complete NexAI reply shows zero Continue buttons');
      assert.equal(classicFlow.hasContinueBtn, true, 'Truncated MAX_TOKENS reply shows Continue button');
      assert.equal(classicFlow.truncActionBtns, 0, 'Truncated reply suppresses premature Add actions');
      assert.equal(classicFlow.continuedTextOk, true, 'Clicking Continue sends continuation and renders completed reply');

      // ── 4. ENTERPRISE (/enterprise): Full-page Study Studio, scroll isolation, Alt+8, Ctrl+K, switchNexusView ──
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
      await cdp.send('Page.navigate', { url: `${urlBase}/enterprise` });
      await cdp.waitFor('document.readyState === "complete" && typeof openStudyStudio === "function" && typeof switchNexusView === "function"');

      const entCheck = await cdp.eval(`(async () => {
        switchNexusView('dashboard');
        let sp = document.getElementById('cdp-ent-bg-spacer');
        if (!sp) {
          sp = document.createElement('div');
          sp.id = 'cdp-ent-bg-spacer';
          sp.style.height = '2400px';
          document.getElementById('pane-dashboard').appendChild(sp);
        }
        window.scrollTo({ top: 420, left: 0, behavior: 'instant' });
        const beforeY = Math.round(window.scrollY);

        openStudyStudio();
        const m = document.getElementById('nexos-study-modal');
        const c = m.querySelector('.ns-card');
        const mr = m.getBoundingClientRect();
        const cr = c.getBoundingClientRect();
        const shelfZ = Number(getComputedStyle(document.getElementById('toast-shelf')).zIndex || 0);

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
        const paletteBehindOpen = document.getElementById('modal-command-palette')?.classList.contains('open');

        // Alt+8 opens Study Studio on Enterprise too, and switchNexusView closes it
        NexStudy.close();
        document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit8', altKey: true, bubbles: true }));
        const openedByAlt8 = m.dataset.open === '1';
        switchNexusView('kanban');
        const closedByEnterpriseNav = m.dataset.open === '0';

        // Test Enterprise aiSummarizeActiveNote race safety when switching notes mid-flight
        const origEntFetch = window.fetch;
        const origMode = enterpriseSession.mode;
        enterpriseSession.mode = 'account';
        state.notes = [
          { id: 'eA', title: 'Ent Note A', content: 'Enterprise alpha content.', updated: Date.now() },
          { id: 'eB', title: 'Ent Note B', content: 'Enterprise beta untouched.', updated: Date.now() }
        ];
        switchNexusView('notes');
        openNoteInEditor('eA');
        window.fetch = async (url, init) => {
          if (String(url) === '/api/complete') {
            await new Promise((r) => setTimeout(r, 80));
            return new Response(JSON.stringify({ text: 'Ent alpha summary.' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
          }
          return origEntFetch(url, init);
        };
        let entNoteAOk = false, entNoteBOk = false;
        try {
          const sumP = aiSummarizeActiveNote();
          openNoteInEditor('eB');
          await sumP;
          entNoteAOk = state.notes.find((n) => n.id === 'eA').content.includes('Ent alpha summary.');
          entNoteBOk = state.notes.find((n) => n.id === 'eB').content === 'Enterprise beta untouched.';
        } finally {
          window.fetch = origEntFetch;
          enterpriseSession.mode = origMode;
        }

        // Re-open Study Studio at Y=420 then close via Back and verify restoration
        switchNexusView('dashboard');
        window.scrollTo({ top: 420, left: 0, behavior: 'instant' });
        openStudyStudio();
        const sc = m.querySelector('.ns-scroll');
        const fg = document.createElement('div');
        fg.style.height = '1800px';
        sc.appendChild(fg);
        sc.scrollTop = sc.scrollHeight - sc.clientHeight;
        const botEv = new WheelEvent('wheel', { deltaY: 160, cancelable: true, bubbles: true });
        sc.dispatchEvent(botEv);
        const topDuringLock = document.body.style.top;
        m.querySelector('.ns-back').click();
        const restoredY = Math.round(window.scrollY);

        return {
          beforeY,
          iw: window.innerWidth, ih: window.innerHeight,
          mRect: { l: Math.round(mr.left), t: Math.round(mr.top), r: Math.round(mr.right), b: Math.round(mr.bottom) },
          cRect: { l: Math.round(cr.left), t: Math.round(cr.top), r: Math.round(cr.right), b: Math.round(cr.bottom) },
          shelfZ,
          paletteBehindOpen,
          openedByAlt8,
          closedByEnterpriseNav,
          entNoteAOk,
          entNoteBOk,
          botPrevented: botEv.defaultPrevented,
          topDuringLock,
          restoredY,
        };
      })()`);

      assert.ok(entCheck.beforeY >= 300);
      assert.deepEqual(entCheck.mRect, { l: 0, t: 0, r: entCheck.iw, b: entCheck.ih }, 'Enterprise #nexos-study-modal fills full viewport');
      assert.deepEqual(entCheck.cRect, { l: 0, t: 0, r: entCheck.iw, b: entCheck.ih }, 'Enterprise .ns-card fills full viewport');
      assert.ok(entCheck.shelfZ > 2100, 'Enterprise toast shelf sits above Study Studio');
      assert.equal(entCheck.paletteBehindOpen, false, 'Enterprise Ctrl+K does not open palette behind Study Studio');
      assert.equal(entCheck.openedByAlt8, true, 'Enterprise Alt+8 opens Study Studio');
      assert.equal(entCheck.closedByEnterpriseNav, true, 'Enterprise switchNexusView closes active Study Studio');
      assert.equal(entCheck.entNoteAOk && entCheck.entNoteBOk, true, 'Enterprise aiSummarizeActiveNote saves onto original note without overwriting switched note');
      assert.equal(entCheck.botPrevented, true, 'Enterprise Study Studio blocks bottom boundary wheel chaining');
      assert.equal(entCheck.topDuringLock, `-${entCheck.beforeY}px`);
      assert.equal(entCheck.restoredY, entCheck.beforeY, 'Enterprise closing Study Studio restores exact scrollY');

      // Enterprise Tablet (768x1024) & Mobile (360x740) Study Studio full-page geometry
      for (const vp of [{ width: 768, height: 1024, mobile: false }, { width: 360, height: 740, mobile: true }]) {
        await cdp.send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: vp.mobile });
        const entVp = await cdp.eval(`(() => {
          openStudyStudio();
          const m = document.getElementById('nexos-study-modal');
          const c = m.querySelector('.ns-card');
          const mr = m.getBoundingClientRect();
          const cr = c.getBoundingClientRect();
          NexStudy.close();
          return {
            iw: window.innerWidth, ih: window.innerHeight,
            mRect: { l: Math.round(mr.left), t: Math.round(mr.top), r: Math.round(mr.right), b: Math.round(mr.bottom) },
            cRect: { l: Math.round(cr.left), t: Math.round(cr.top), r: Math.round(cr.right), b: Math.round(cr.bottom) },
          };
        })()`);
        assert.deepEqual(entVp.mRect, { l: 0, t: 0, r: entVp.iw, b: entVp.ih }, `Enterprise ${vp.width}px Study Studio modal fills viewport`);
        assert.deepEqual(entVp.cRect, { l: 0, t: 0, r: entVp.iw, b: entVp.ih }, `Enterprise ${vp.width}px Study Studio card fills viewport`);
      }

      // ── 5. Standalone HTML checks (contact, privacy, recover) ──
      for (const pagePath of ['/contact.html', '/privacy.html', '/recover.html']) {
        for (const vp of [{ width: 1280, height: 800, mobile: false }, { width: 360, height: 740, mobile: true }]) {
          await cdp.send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: vp.mobile });
          await cdp.send('Page.navigate', { url: `${urlBase}${pagePath}` });
          await cdp.waitFor('document.readyState === "complete"');
          const pInfo = await cdp.eval(`(() => ({
            overflow: document.documentElement.scrollWidth - window.innerWidth,
            hasMain: Boolean(document.querySelector('.legal-page, main, #recovery-app, .recover-wrap, body > *')),
          }))()`);
          assert.ok(pInfo.overflow <= 2, `${pagePath} at ${vp.width}px horizontal overflow=${pInfo.overflow}`);
          assert.equal(pInfo.hasMain, true, `${pagePath} renders main content cleanly`);
        }
      }

      assert.deepEqual(cdp.exceptions, [], `Zero uncaught runtime exceptions: ${JSON.stringify(cdp.exceptions)}`);
      assert.deepEqual(cdp.consoleErrors, [], `Zero console errors: ${JSON.stringify(cdp.consoleErrors)}`);
      console.log('Study Studio 4.6.0 full-page, scroll isolation, NexAI & module regression browser suite passed.');
    } finally {
      if (cdp) cdp.close();
      try { chrome.kill('SIGKILL'); } catch (_) {}
      setTimeout(() => { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {} }, 150);
    }
  } finally {
    await new Promise((r) => httpServer.close(r));
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
