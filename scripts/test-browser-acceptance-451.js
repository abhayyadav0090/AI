'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

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
    this.events = [];
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
        // Ignore third-party Google/CDN fetch noise offline
        if (!/accounts\.google\.com|cdn\.jsdelivr\.net|fonts\.googleapis/i.test(desc)) {
          this.exceptions.push(desc);
        }
      } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params?.type === 'error') {
        const text = (msg.params.args || []).map(a => a.value || a.description || '').join(' ');
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

  async waitFor(predicateJs, timeoutMs = 6000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (await this.eval(`Boolean(${predicateJs})`)) return;
      await new Promise(r => setTimeout(r, 40));
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
      const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json());
      const page = targets.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch (_) {}
    await new Promise(r => setTimeout(r, 80));
  }
  throw new Error('Chrome DevTools JSON endpoint did not become ready');
}

(async function main() {
  if (process.env.NEXOS_SKIP_BROWSER === '1') {
    console.log('Browser acceptance skipped (NEXOS_SKIP_BROWSER=1).');
    return;
  }
  const browserPath = findBrowser();
  if (!browserPath) {
    console.log('Browser acceptance skipped (Chrome/Edge binary not found).');
    return;
  }

  const app = require('../server.js');
  const httpServer = http.createServer(app);
  await new Promise(r => httpServer.listen(0, '127.0.0.1', r));
  const urlBase = `http://127.0.0.1:${httpServer.address().port}`;

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexos-cdp-'));
  const port = 19222 + Math.floor(Math.random() * 1000);
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

    // ── 1) Classic Interface (/) Desktop & Mobile Acceptance ──
    await cdp.send('Page.navigate', { url: urlBase + '/' });
    await cdp.waitFor('document.readyState === "complete" && typeof startGuest === "function"');
    await cdp.eval('startGuest()');
    await cdp.waitFor('document.querySelector(".main-shell, #app-shell, #view-dashboard") !== null');

    const classicCheck = await cdp.eval(`(() => {
      // Navigate core views cleanly
      for (const v of ['dashboard', 'kanban', 'habits', 'notes', 'analytics', 'nexai', 'study']) {
        if (typeof switchView === 'function') switchView(v);
      }
      // Add a Kanban task via state/render flow & render real Markdown in #chat-messages
      if (Array.isArray(state.tasks)) {
        state.tasks.push({ id: 'cdp-t1', title: 'Browser Verified Task', desc: 'From Chrome', col: 'todo', priority: 'high', due: '2026-11-30', created: Date.now() });
        saveState();
        renderKanban();
        if (typeof switchView === 'function') switchView('kanban');
      }
      const chatBox = document.getElementById('chat-messages');
      let mdHtml = '';
      let fakeActionCount = 0;
      let explicitActionLabel = '';
      let incompleteBarCount = 0;
      let incompleteActionCount = 0;
      if (chatBox && typeof formatChat === 'function') {
        const linkedInMd = [
          'LinkedIn is a professional networking platform used to connect with colleagues and find jobs.\\n\\n1. **Job Search & Internships**\\n\\nApply systematically every week.',
          '2. **Content Sharing & Learning**\\n\\nDocument insights publicly.',
          '3. **Upskilling & Knowledge**\\n\\nFollow structured roadmaps.\\n\\n| Area | Status |\\n|---|---|\\n| Classic | Verified |\\n\\n> Focus beats noise.'
        ].join('\\n\\n');
        chatBox.innerHTML = '<div class="msg-bubble">' + formatChat(linkedInMd) + '</div>';
        const infoBubble = chatBox.querySelector('.msg-bubble');
        if (window.NexChatTasks && infoBubble) {
          NexChatTasks.attach(infoBubble, linkedInMd, 'what it is', nexChatTasksCtx());
          fakeActionCount = infoBubble.querySelectorAll('.nx-addtasks button').length;
        }
        const taskBubble = document.createElement('div');
        taskBubble.className = 'msg-bubble';
        const taskMd = 'Here is your plan:\\n1. Update resume (high priority)\\n2. Apply to 3 internships due tomorrow';
        taskBubble.innerHTML = formatChat(taskMd);
        if (window.NexChatTasks) {
          NexChatTasks.attach(taskBubble, taskMd, 'create 2 tasks for internships', nexChatTasksCtx());
          explicitActionLabel = taskBubble.querySelector('.nx-addtasks button')?.textContent || '';
        }
        const incBubble = document.createElement('div');
        incBubble.className = 'msg-bubble';
        incBubble.dataset.nxIncomplete = '1';
        incBubble.innerHTML = formatChat('Action plan:\\n1. Finish resume (J');
        if (window.NexChatTasks) {
          NexChatTasks.attach(incBubble, 'Action plan:\\n1. Finish resume (J', 'what it is', nexChatTasksCtx({ onContinue() {} }));
          incompleteBarCount = incBubble.querySelectorAll('.nx-incomplete-bar button').length;
          incompleteActionCount = incBubble.querySelectorAll('.nx-addtasks button').length;
        }
        mdHtml = chatBox.innerHTML;
      }
      const nav = performance.getEntriesByType('navigation')[0];
      return {
        overflowDesktop: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        olCount: chatBox ? chatBox.querySelectorAll('ol').length : 0,
        liCount: chatBox ? chatBox.querySelectorAll('ol > li').length : 0,
        tableCount: chatBox ? chatBox.querySelectorAll('table.chat-table').length : 0,
        quoteCount: chatBox ? chatBox.querySelectorAll('blockquote').length : 0,
        fakeActionCount,
        explicitActionLabel,
        incompleteBarCount,
        incompleteActionCount,
        kanbanHasTask: document.body.innerText.includes('Browser Verified Task'),
        domReadyMs: nav ? Math.round(nav.domContentLoadedEventEnd) : 0,
      };
    })()`);

    assert.ok(classicCheck.overflowDesktop <= 2, `Classic desktop overflow=${classicCheck.overflowDesktop}`);
    assert.equal(classicCheck.olCount, 1, 'Classic DOM renders LinkedIn answer as 1 unified <ol>');
    assert.equal(classicCheck.liCount, 3, 'Classic DOM renders all 3 numbered items inside <ol>');
    assert.equal(classicCheck.tableCount, 1, 'Classic DOM renders GFM table');
    assert.equal(classicCheck.quoteCount, 1, 'Classic DOM renders blockquote');
    assert.equal(classicCheck.fakeActionCount, 0, 'Classic DOM must not show + Add tasks or Save as note on LinkedIn explanation');
    assert.equal(classicCheck.explicitActionLabel, '＋ Add 2 tasks', 'Classic DOM shows explicit task action button cleanly');
    assert.equal(classicCheck.incompleteBarCount, 1, 'Classic DOM renders Continue button on incomplete reply');
    assert.equal(classicCheck.incompleteActionCount, 0, 'Classic DOM suppresses task/note actions on incomplete reply');
    assert.equal(classicCheck.kanbanHasTask, true, 'Classic Kanban DOM reflects added task');

    // Classic Mobile (360x740 small viewport + NexAI large content scroll + keyboard shortcuts)
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 360, height: 740, deviceScaleFactor: 2, mobile: true });
    const classicMobile = await cdp.eval(`(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: '7', code: 'Digit7', altKey: true, bubbles: true }));
      const box = document.getElementById('chat-messages');
      let canScroll = false;
      if (box && typeof formatChat === 'function') {
        const bigMd = Array.from({ length: 30 }, (_, i) => (i + 1) + '. **Section ' + (i + 1) + '**\\n\\nExplanation text.\\n\\n| ColA | ColB | ColC | ColD |\\n|---|---|---|---|\\n| val' + i + '_long_token | data' + i + ' | extra' + i + ' | ok |').join('\\n\\n');
        const wrap = document.createElement('div');
        wrap.className = 'msg-bubble';
        wrap.innerHTML = formatChat(bigMd);
        box.appendChild(wrap);
        box.scrollTop = box.scrollHeight;
        canScroll = box.scrollHeight > box.clientHeight && box.scrollTop > 0;
      }
      return {
        aiActive: document.getElementById('view-ai')?.classList.contains('active') === true,
        overflowMobile: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        canScroll,
      };
    })()`);
    assert.equal(classicMobile.aiActive, true, 'Classic Alt+7 keyboard shortcut opens NexAI view');
    assert.ok(classicMobile.overflowMobile <= 2, `Classic small mobile (360px) horizontal overflow=${classicMobile.overflowMobile}`);
    assert.equal(classicMobile.canScroll, true, 'Classic NexAI chat box scrolls cleanly on large multi-table Markdown');

    // ── 2) Enterprise Interface (/enterprise) Desktop & Mobile Acceptance ──
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Page.navigate', { url: urlBase + '/enterprise' });
    await cdp.waitFor('document.readyState === "complete" && typeof renderSimpleMarkdown === "function" && typeof switchNexusView === "function"');
    await new Promise(r => setTimeout(r, 250));

    const entCheck = await cdp.eval(`(() => {
      for (const v of Object.keys(NEXUS_VIEWS || { dashboard: 1, kanban: 1, pomodoro: 1, habits: 1, notes: 1, analytics: 1, ai: 1, settings: 1 })) {
        switchNexusView(v);
      }
      state.tasks.push({ id: 'cdp-ent-1', title: 'Enterprise Browser Task', desc: 'CDP check', stage: 'inprogress', priority: 'high', due: '2026-12-01', created: Date.now(), tags: [], subtasks: [] });
      renderKanban();
      switchNexusView('kanban');
      const chatFeed = document.getElementById('ai-messages-scroll-area') || document.body;
      const dockFeed = document.getElementById('floating-copilot-messages');
      const linkedInMd = [
        'LinkedIn is a professional networking platform used for career growth.\\n\\n1. **Job Search & Internships**\\n\\nApply systematically every week.',
        '2. **Content Sharing & Learning**\\n\\nDocument insights publicly.',
        '3. **Upskilling & Knowledge**\\n\\nFollow structured roadmaps.\\n\\n| Area | Status |\\n|---|---|\\n| Enterprise | Verified |\\n\\n> Focus beats noise.'
      ].join('\\n\\n');
      const host = document.createElement('div');
      host.className = 'chat-bubble-card';
      host.innerHTML = renderSimpleMarkdown(linkedInMd);
      chatFeed.appendChild(host);
      if (window.NexChatTasks) NexChatTasks.attach(host, linkedInMd, 'what is it', nexChatTasksCtx(chatFeed));

      let dockFakeActions = -1;
      let dockIncompleteBar = 0;
      let dockIncompleteActions = 0;
      if (dockFeed && window.NexChatTasks) {
        const dockBubble = appendEnterpriseChatBubble(dockFeed, 'assistant', linkedInMd);
        attachNexChatTasks(dockBubble, linkedInMd, 'linkedin', dockFeed);
        dockFakeActions = dockBubble.querySelectorAll('.nx-addtasks button').length;
        const dockInc = appendEnterpriseChatBubble(dockFeed, 'assistant', 'Main benefits:\\n- **');
        attachNexChatTasks(dockInc, 'Main benefits:\\n- **', 'what it is', dockFeed, { incomplete: true, incompleteReason: 'TRUNCATED_MID_RESPONSE' });
        dockIncompleteBar = dockInc.querySelectorAll('.nx-incomplete-bar button').length;
        dockIncompleteActions = dockInc.querySelectorAll('.nx-addtasks button').length;
      }

      const nav = performance.getEntriesByType('navigation')[0];
      return {
        overflowDesktop: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        olCount: host.querySelectorAll('ol').length,
        liCount: host.querySelectorAll('ol > li').length,
        tableCount: host.querySelectorAll('table.chat-table').length,
        quoteCount: host.querySelectorAll('blockquote').length,
        fullFakeActions: host.querySelectorAll('.nx-addtasks button').length,
        dockFakeActions,
        dockIncompleteBar,
        dockIncompleteActions,
        hasFloatingSendBtn: Boolean(document.getElementById('floating-send-btn')),
        kanbanHasTask: document.body.innerText.includes('Enterprise Browser Task'),
        domReadyMs: nav ? Math.round(nav.domContentLoadedEventEnd) : 0,
      };
    })()`);

    assert.ok(entCheck.overflowDesktop <= 2, `Enterprise desktop overflow=${entCheck.overflowDesktop}`);
    assert.equal(entCheck.olCount, 1, 'Enterprise DOM renders LinkedIn answer as 1 unified <ol>');
    assert.equal(entCheck.liCount, 3, 'Enterprise DOM renders all 3 numbered items inside <ol>');
    assert.equal(entCheck.tableCount, 1, 'Enterprise DOM renders GFM table');
    assert.equal(entCheck.quoteCount, 1, 'Enterprise DOM renders blockquote');
    assert.equal(entCheck.fullFakeActions, 0, 'Enterprise full-page DOM suppresses fake task/note buttons on informational replies');
    assert.equal(entCheck.dockFakeActions, 0, 'Enterprise side-dock DOM suppresses fake task/note buttons on informational replies');
    assert.equal(entCheck.dockIncompleteBar, 1, 'Enterprise side-dock renders Continue bar on incomplete "- **" reply');
    assert.equal(entCheck.dockIncompleteActions, 0, 'Enterprise side-dock suppresses action chips on incomplete reply');
    assert.equal(entCheck.hasFloatingSendBtn, true, 'Enterprise side-dock send button ID present');
    assert.equal(entCheck.kanbanHasTask, true, 'Enterprise Kanban DOM reflects added task');

    // Enterprise Mobile (360x740 small viewport + fixed topbar/nav + large Markdown chat scroll + Escape/Ctrl+K keyboard)
    const entDesktopKb = await cdp.eval(`(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
      const palette = document.getElementById('modal-command-palette');
      const opened = palette ? palette.classList.contains('open') : false;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      const closed = palette ? !palette.classList.contains('open') : true;
      return { opened, closed };
    })()`);
    assert.ok(entDesktopKb.opened && entDesktopKb.closed, 'Enterprise Ctrl+K opens command palette and Escape closes it');

    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 360, height: 740, deviceScaleFactor: 2, mobile: true });
    const entMobile = await cdp.eval(`(() => {
      switchNexusView('ai');
      const feed = document.getElementById('ai-messages-scroll-area');
      let canScroll = false;
      if (feed) {
        const bigMd = Array.from({ length: 30 }, (_, i) => (i + 1) + '. **Topic ' + (i + 1) + '**\\n\\nDetailed overview.\\n\\n| Field | Value | Notes | Extra |\\n|---|---|---|---|\\n| long_key_' + i + ' | 12345 | verified | ok |').join('\\n\\n');
        const bubble = appendEnterpriseChatBubble(feed, 'assistant', bigMd);
        feed.scrollTop = feed.scrollHeight;
        canScroll = feed.scrollHeight > feed.clientHeight && feed.scrollTop > 0;
      }
      const topbar = document.querySelector('header.topbar');
      const topRect = topbar ? topbar.getBoundingClientRect() : null;
      return {
        overflowMobile: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        canScroll,
        topbarVisible: Boolean(topRect && topRect.height >= 40 && topRect.right <= 362),
      };
    })()`);
    assert.ok(entMobile.overflowMobile <= 2, `Enterprise small mobile (360px) horizontal overflow=${entMobile.overflowMobile}`);
    assert.equal(entMobile.canScroll, true, 'Enterprise NexAI chat container scrolls cleanly on large multi-table Markdown');
    assert.equal(entMobile.topbarVisible, true, 'Enterprise fixed header fits cleanly inside 360px mobile viewport');

    assert.deepEqual(cdp.exceptions, [], 'Zero uncaught runtime exceptions across Classic & Enterprise');
    assert.deepEqual(cdp.consoleErrors, [], 'Zero console errors across Classic & Enterprise');
    console.log(`Browser acceptance passed in Chrome headless (Classic DOM ready ${classicCheck.domReadyMs}ms, Enterprise DOM ready ${entCheck.domReadyMs}ms).`);
  } finally {
    if (cdp) cdp.close();
    try { chrome.kill('SIGKILL'); } catch (_) {}
    await new Promise(r => httpServer.close(r));
    setTimeout(() => { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {} }, 100);
  }
})().catch(err => {
  console.error(err);
  process.exit(1);
});
