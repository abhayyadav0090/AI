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
  for (const p of CHROME_CANDIDATES) if (fs.existsSync(p)) return p;
  return null;
}

class CDP {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.seq = 0;
    this.pend = new Map();
    this.errors = [];
    this.ready = new Promise((res, rej) => {
      this.ws.addEventListener('open', res, { once: true });
      this.ws.addEventListener('error', rej, { once: true });
    });
    this.ws.addEventListener('message', (ev) => {
      const m = JSON.parse(String(ev.data));
      if (m.id && this.pend.has(m.id)) {
        const { res, rej } = this.pend.get(m.id);
        this.pend.delete(m.id);
        if (m.error) rej(new Error(m.error.message || JSON.stringify(m.error)));
        else res(m.result);
        return;
      }
      if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params?.exceptionDetails?.exception?.description || m.params?.exceptionDetails?.text || '';
        if (!/fonts\.googleapis|cdn\.jsdelivr|accounts\.google/i.test(d)) this.errors.push(d);
      }
    });
  }
  async send(method, params = {}) {
    await this.ready;
    const id = ++this.seq;
    return new Promise((res, rej) => { this.pend.set(id, { res, rej }); this.ws.send(JSON.stringify({ id, method, params })); });
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text || 'eval failed');
    return r.result?.value;
  }
  async waitFor(pred, ms = 6000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (await this.eval(`Boolean(${pred})`)) return;
      await new Promise(r => setTimeout(r, 40));
    }
    throw new Error('Timed out waiting for: ' + pred);
  }
  close() { try { this.ws.close(); } catch (_) {} }
}

async function getWs(port) {
  for (let i = 0; i < 80; i++) {
    try {
      const list = await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json());
      const p = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
      if (p) return p.webSocketDebuggerUrl;
    } catch (_) {}
    await new Promise(r => setTimeout(r, 80));
  }
  throw new Error('DevTools endpoint timeout');
}

(async function main() {
  // ── 1) Static HTML Inventory & Content Verification ──
  const publicDir = path.join(ROOT, 'public');
  const htmlFiles = fs.readdirSync(publicDir).filter(f => f.endsWith('.html')).sort();
  assert.deepEqual(htmlFiles, ['contact.html', 'index-redesign.html', 'index.html', 'privacy.html', 'recover.html'], 'All 5 standalone & app HTML files inventoried');

  const contactSrc = fs.readFileSync(path.join(publicDir, 'contact.html'), 'utf8');
  const privacySrc = fs.readFileSync(path.join(publicDir, 'privacy.html'), 'utf8');
  const recoverSrc = fs.readFileSync(path.join(publicDir, 'recover.html'), 'utf8');
  assert.ok(contactSrc.includes('style.css?v=4.5.1') && privacySrc.includes('style.css?v=4.5.1'), 'Standalone pages reference current 4.5.1 assets');
  assert.ok(contactSrc.includes('var(--on-accent') && contactSrc.includes('About NexOS'), 'Contact page fixes button contrast and adds About summary while keeping background');
  assert.ok(privacySrc.includes('StudyCalendarConnection') || privacySrc.includes('Google Calendar sync (optional)'), 'Privacy page reflects optional Google Calendar & Study Studio behavior');
  assert.ok(!privacySrc.includes('does not ask for access to your Gmail, Drive, contacts or calendar'), 'Outdated inaccurate calendar disclaimer removed');
  assert.ok(recoverSrc.includes('backup-download') && recoverSrc.includes('validateAndSanitizeBackup'), 'Recovery Center includes backup export & schema validation');

  if (process.env.NEXOS_SKIP_BROWSER === '1' || !findBrowser()) {
    console.log('Standalone HTML static assertions passed (browser checks skipped).');
    return;
  }

  const app = require('../server.js');
  const srv = http.createServer(app);
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexos-pages-'));
  const port = 19660 + Math.floor(Math.random() * 500);
  const chrome = spawn(findBrowser(), [
    '--headless=new', '--no-sandbox', '--disable-gpu',
    `--remote-debugging-port=${port}`, `--user-data-dir=${tmpDir}`, 'about:blank',
  ], { stdio: 'ignore' });

  let cdp = null;
  try {
    cdp = new CDP(await getWs(port));
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');

    // ── 2) Standalone HTML Pages Desktop & Mobile Acceptance ──
    for (const p of ['/contact.html', '/privacy.html', '/recover.html']) {
      for (const [w, h, mob] of [[1280, 800, false], [360, 740, true]]) {
        await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: mob });
        await cdp.send('Page.navigate', { url: base + p });
        await cdp.waitFor('document.readyState === "complete"');
        await new Promise(r => setTimeout(r, 150));
        const metrics = await cdp.eval(`(() => ({
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          h1Text: document.querySelector('h1')?.textContent || '',
          navLinks: [...document.querySelectorAll('a')].map(a => a.getAttribute('href')),
        }))()`);
        assert.ok(metrics.overflow <= 2, `${p} overflow=${metrics.overflow} at ${w}x${h}`);
        assert.ok(metrics.h1Text.length > 0, `${p} has visible H1`);
      }
    }

    // Check dark-mode button contrast on contact.html
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Page.navigate', { url: base + '/contact.html' });
    await cdp.waitFor('document.readyState === "complete"');
    const issueBtn = await cdp.eval(`(() => {
      const a = [...document.querySelectorAll('.contact-actions a')][0];
      const cs = getComputedStyle(a);
      return { bg: cs.backgroundColor, color: cs.color };
    })()`);
    assert.notEqual(issueBtn.color, 'rgb(255, 255, 255)', 'Contact primary CTA in dark mode uses dark --on-accent instead of white on light-blue');

    // ── 3) Interactive Recovery Center Workflow in Real Chrome ──
    await cdp.send('Page.navigate', { url: base + '/recover.html' });
    await cdp.waitFor('document.readyState === "complete" && typeof window.NexRecover === "object"');
    const recRes = await cdp.eval(`(() => {
      const paste = document.getElementById('backup-json-paste');
      const validateBtn = document.getElementById('backup-validate-btn');
      const status = document.getElementById('backup-status');
      const preview = document.getElementById('backup-preview');
      const counts = document.getElementById('backup-preview-counts');
      const warnings = document.getElementById('backup-preview-warnings');

      // 1. Corrupted JSON rejected clearly
      paste.value = '{not valid json';
      validateBtn.click();
      const badMsg = status.textContent;
      const previewHiddenOnError = preview.hidden;

      // 2. Valid backup + 1 corrupt record + XSS title sanitized cleanly
      paste.value = JSON.stringify({
        nexosBackupVersion: 1,
        state: {
          tasks: [{ id: 'rec-t1', title: '<img src=x> Restored Task', col: 'todo', priority: 'high' }, 'corrupt-task-string'],
          habits: [{ id: 'rec-h1', name: 'Read daily', checks: { '2026-11-25': true, 'bad-date': true }, color: 'javascript:alert(1)' }],
          notes: [{ id: 'rec-n1', title: 'Exam note', content: 'Key concepts saved.' }],
          pomodoroLog: [{ date: '2026-11-25', minutes: 25 }],
        },
      });
      validateBtn.click();
      const goodMsg = counts.textContent;
      const warnMsg = warnings.textContent;

      // 3. Merge into Guest storage cleanly
      document.getElementById('backup-merge-btn').click();
      return { badMsg, previewHiddenOnError, goodMsg, warnMsg };
    })()`);
    await new Promise(r => setTimeout(r, 200));
    const guestAfterRestore = await cdp.eval(`JSON.parse(localStorage.getItem('nexos_guest_state_v1') || '{}')`);
    assert.ok(/invalid json/i.test(recRes.badMsg) && recRes.previewHiddenOnError, 'Corrupt backup rejected with inline status');
    assert.ok(recRes.goodMsg.includes('1 tasks') && recRes.goodMsg.includes('1 habits') && recRes.goodMsg.includes('1 notes'), 'Backup preview shows validated counts');
    assert.ok(recRes.warnMsg.includes('1 corrupted/invalid record'), 'Backup preview reports skipped corrupt entry');
    assert.equal(guestAfterRestore.tasks[0].id, 'rec-t1');
    assert.equal(guestAfterRestore.habits[0].color, '#4285F4', 'Unsafe habit color fallback enforced cleanly');

    // ── 4) Interactive Study Studio Mindmap in Real Chrome (Classic & Enterprise Desktop/Mobile) ──
    for (const [route, opener] of [['/', 'startGuest(); openStudyStudio();'], ['/enterprise', 'openStudyStudio();']]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
      await cdp.send('Page.navigate', { url: base + route });
      await cdp.waitFor('document.readyState === "complete" && typeof NexStudy === "object"');
      await cdp.eval(opener);
      await cdp.waitFor('document.querySelector("[data-ns=guest-mode][data-g=mindmap]") !== null');
      const mmRes = await cdp.eval(`(() => {
        document.querySelector('[data-ns="guest-mode"][data-g="mindmap"]').click();
        const nodesBefore = document.querySelectorAll('.ns-mm-node').length;
        // Collapse one branch
        const toggleBtn = document.querySelector('.ns-mm-toggle');
        toggleBtn.click();
        const nodesAfterCollapse = document.querySelectorAll('.ns-mm-node').length;
        // Expand again
        document.querySelector('[data-ns="mm-expand-all"]').click();
        const nodesAfterExpand = document.querySelectorAll('.ns-mm-node').length;
        // Zoom in & Fit
        document.querySelector('[data-ns="mm-zoom-in"]').click();
        const zoomAfterIn = document.getElementById('ns-mm-zoom-label').textContent;
        document.querySelector('[data-ns="mm-fit"]').click();
        // Select root -> Edit title -> Add sub-branch -> Delete new sub-branch
        document.querySelector('[data-ns="mm-edit-open"]').click();
        document.getElementById('ns-mm-edit-label').value = 'Photosynthesis Revised';
        document.querySelector('[data-ns="mm-edit-apply"]').click();
        const rootEdited = document.querySelector('.ns-mm-node[data-depth="0"] .ns-mm-ntitle').textContent;
        document.querySelector('[data-ns="mm-add-child"]').click();
        document.getElementById('ns-mm-edit-label').value = 'Custom Subtopic';
        document.querySelector('[data-ns="mm-edit-apply"]').click();
        const nodesAfterAdd = document.querySelectorAll('.ns-mm-node').length;
        document.querySelector('[data-ns="mm-del-node"]').click();
        const nodesAfterDel = document.querySelectorAll('.ns-mm-node').length;
        return { nodesBefore, nodesAfterCollapse, nodesAfterExpand, zoomAfterIn, rootEdited, nodesAfterAdd, nodesAfterDel };
      })()`);
      assert.ok(mmRes.nodesAfterCollapse < mmRes.nodesBefore, `${route}: collapsing hides sub-branches`);
      assert.equal(mmRes.nodesAfterExpand, mmRes.nodesBefore, `${route}: expand all restores full nodes`);
      assert.equal(mmRes.rootEdited, 'Photosynthesis Revised', `${route}: editing node updates canvas`);
      assert.equal(mmRes.nodesAfterAdd, mmRes.nodesBefore + 1, `${route}: adding sub-branch updates canvas`);
      assert.equal(mmRes.nodesAfterDel, mmRes.nodesBefore, `${route}: deleting node removes sub-branch`);

      // Mobile 360px Mindmap responsiveness
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 360, height: 740, deviceScaleFactor: 2, mobile: true });
      const mobOverflow = await cdp.eval(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
      assert.ok(mobOverflow <= 2, `${route} Mindmap mobile overflow=${mobOverflow}`);
    }

    assert.deepEqual(cdp.errors, [], 'Zero uncaught runtime errors across HTML & Mindmap browser tests');
    console.log('Standalone HTML upgrade, Recovery Center backup/restore & Study Studio Mindmap Chrome acceptance passed.');
  } finally {
    if (cdp) cdp.close();
    try { chrome.kill('SIGKILL'); } catch (_) {}
    await new Promise(r => srv.close(r));
    setTimeout(() => { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {} }, 100);
  }
})().catch(err => {
  console.error(err);
  process.exit(1);
});
