/* NexOS 4.1.0 — Study Studio: upload notes, then ask NexAI to tutor you from them.
   Shared by Classic and Enterprise. It draws its own dialog; each page passes a small adapter:
   { isGuest() -> bool, signIn(), toast(msg) }.
   Files are read on the server and only their text chunks are kept (never the original file).
   Guests see a scripted sample and make no request. */
(function (root) {
  'use strict';

  const MAX_BYTES = 4 * 1024 * 1024;
  const ACCEPT = '.pdf,.txt,.md,.markdown';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* Safe text formatting: everything is escaped first, then only **bold** and `code` are turned into tags. */
  function formatAnswer(text) {
    return esc(text)
      .replace(/\*\*([^*\n]{1,200})\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`\n]{1,200})`/g, '<code>$1</code>');
  }

  function sourceLabel(src) {
    if (!src) return '';
    const where = src.page ? 'p. ' + src.page : (src.heading || (src.section ? 'section ' + src.section : ''));
    return where ? src.title + ' \u00b7 ' + where : src.title;
  }

  /* Returns an error message, or '' when the file looks acceptable (the server checks the real content again). */
  function checkFile(file) {
    if (!file) return 'Choose a file first.';
    if (!/\.(pdf|txt|md|markdown)$/i.test(file.name || '')) return 'Use a text PDF, TXT or Markdown file.';
    if (file.size > MAX_BYTES) return 'That file is larger than 4 MB. Upload one chapter at a time.';
    if (file.size === 0) return 'That file is empty.';
    return '';
  }

  function sizeLabel(bytes) {
    if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
    return Math.max(1, Math.round(bytes / 1024)) + ' KB';
  }

  const SAMPLE = {
    material: 'Sample notes: Biology, Chapter 2 (page 4)',
    question: 'How do plants make their food?',
    answer: 'Plants make food by **photosynthesis**. Chlorophyll in the chloroplasts captures light energy, and the plant uses it to turn carbon dioxide and water into glucose and oxygen [1].\n\nCheck yourself: where in the cell does this happen?',
    sources: [{ n: 1, title: 'Sample notes: Biology, Chapter 2', page: 4, snippet: 'Photosynthesis takes place in the chloroplasts, where chlorophyll absorbs light...' }]
  };

  const CSS = `
#nexos-study-modal{position:fixed;inset:0;z-index:2100;display:none;align-items:center;justify-content:center;padding:12px;background:rgba(0,0,0,.55)}
#nexos-study-modal[data-open="1"]{display:flex}
#nexos-study-modal .ns-card{width:min(680px,100%);max-height:92vh;display:flex;flex-direction:column;border-radius:16px;padding:16px;background:var(--bg-card,#151a2c);color:var(--text-primary,#f2f4fa);border:1px solid var(--glass-border,var(--border-subtle,rgba(255,255,255,.14)));box-shadow:0 20px 60px rgba(0,0,0,.45);font-family:inherit}
#nexos-study-modal .ns-head{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:6px}
#nexos-study-modal h3{margin:0;font-size:17px}
#nexos-study-modal .ns-x{background:none;border:0;color:inherit;font-size:18px;cursor:pointer;padding:4px 8px}
#nexos-study-modal .ns-body{overflow:auto;min-height:0;flex:1}
#nexos-study-modal .ns-p{margin:0 0 10px;font-size:13px;line-height:1.5;color:var(--text-secondary,#b6bdd2)}
#nexos-study-modal .ns-box{border:1px solid var(--glass-border,var(--border-subtle,rgba(255,255,255,.14)));border-radius:12px;padding:10px;margin-bottom:10px}
#nexos-study-modal .ns-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
#nexos-study-modal input[type=text],#nexos-study-modal select,#nexos-study-modal textarea{flex:1 1 140px;min-width:0;border:1px solid var(--glass-border,var(--border-subtle,rgba(255,255,255,.18)));background:transparent;color:inherit;border-radius:10px;padding:8px 10px;font-size:13px;font-family:inherit}
#nexos-study-modal select option{color:#111}
#nexos-study-modal input[type=file]{flex:1 1 180px;min-width:0;font-size:12px;color:inherit}
#nexos-study-modal textarea{resize:vertical;min-height:44px;max-height:120px}
#nexos-study-modal .ns-btn{border:1px solid var(--glass-border,var(--border-subtle,rgba(255,255,255,.18)));background:transparent;color:inherit;border-radius:10px;padding:8px 14px;font-size:13px;cursor:pointer;font-family:inherit}
#nexos-study-modal .ns-btn.ns-primary{background:var(--accent-primary,var(--accent-violet,#7c5cff));border-color:transparent;color:#fff}
#nexos-study-modal .ns-btn[disabled]{opacity:.5;cursor:default}
#nexos-study-modal .ns-doc{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:7px 0;border-top:1px solid var(--glass-border,var(--border-subtle,rgba(255,255,255,.1)))}
#nexos-study-modal .ns-doc:first-child{border-top:0}
#nexos-study-modal .ns-dt{font-size:13px;font-weight:600;overflow-wrap:anywhere}
#nexos-study-modal .ns-dm{font-size:11.5px;color:var(--text-secondary,#b6bdd2)}
#nexos-study-modal .ns-status{font-size:12.5px;line-height:1.5;color:var(--text-secondary,#b6bdd2);min-height:18px;margin:4px 0;white-space:pre-wrap}
#nexos-study-modal .ns-log{display:flex;flex-direction:column;gap:8px;margin:8px 0}
#nexos-study-modal .ns-msg{padding:9px 11px;border-radius:12px;font-size:13px;line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere;border:1px solid var(--glass-border,var(--border-subtle,rgba(255,255,255,.12)))}
#nexos-study-modal .ns-msg.ns-user{align-self:flex-end;max-width:90%;background:rgba(124,92,255,.18)}
#nexos-study-modal .ns-msg.ns-ai code{background:rgba(255,255,255,.1);padding:1px 4px;border-radius:4px}
#nexos-study-modal .ns-src{display:block;margin-top:6px;font-size:11.5px;color:var(--text-secondary,#b6bdd2);white-space:normal}
#nexos-study-modal .ns-foot{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}`;

  let modal = null, adapter = null, busy = false;
  let docs = [], usage = null, history = [];

  const $ = (id) => modal.querySelector('#' + id);

  function build() {
    if (modal) return;
    const style = document.createElement('style');
    style.id = 'nexos-study-styles';
    style.textContent = CSS;
    document.head.appendChild(style);
    modal = document.createElement('div');
    modal.id = 'nexos-study-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'ns-title');
    modal.innerHTML = '<div class="ns-card"><div class="ns-head"><h3 id="ns-title">Study Studio</h3>' +
      '<button type="button" class="ns-x" data-ns="close" aria-label="Close">\u2715</button></div>' +
      '<div class="ns-body" id="ns-body"></div></div>';
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) return close();
      const t = e.target.closest('[data-ns]');
      if (!t) return;
      const act = t.getAttribute('data-ns');
      if (act === 'close') close();
      else if (act === 'signin') { close(); if (adapter && adapter.signIn) adapter.signIn(); }
      else if (act === 'upload') upload();
      else if (act === 'ask') ask();
      else if (act === 'delete') remove(t.getAttribute('data-id'));
    });
    modal.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && e.target && e.target.id === 'ns-question') { e.preventDefault(); ask(); }
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modal.dataset.open === '1') close(); });
  }

  function close() { if (!modal) return; modal.dataset.open = '0'; }

  /* Calls /api/study. Errors carry the server's message and code. */
  async function call(method, path, body) {
    const opts = { method, credentials: 'same-origin' };
    if (body) { opts.headers = { 'Content-Type': 'application/json' }; opts.body = JSON.stringify(body); }
    let res;
    try { res = await fetch('/api/study' + path, opts); }
    catch (_) { throw new Error('Could not reach NexOS. Check your connection and try again.'); }
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(res.status === 401 ? 'Please sign in again.' : (payload.error || 'Request failed (' + res.status + ').'));
      err.code = payload.code; err.status = res.status;
      throw err;
    }
    return payload;
  }

  function readBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => { const s = String(reader.result || ''); resolve(s.slice(s.indexOf(',') + 1)); };
      reader.onerror = () => reject(new Error('That file could not be read.'));
      reader.readAsDataURL(file);
    });
  }

  function setStatus(text) { const el = modal.querySelector('#ns-status'); if (el) el.textContent = text || ''; }

  function renderGuest() {
    $('ns-body').innerHTML =
      '<p class="ns-p">Upload your notes or a chapter, then ask NexAI questions. It answers only from your material, shows the page it used, and says so when it cannot find the answer. This is a sample: nothing is uploaded and no AI is called.</p>' +
      '<div class="ns-box"><div class="ns-dm">' + esc(SAMPLE.material) + '</div></div>' +
      '<div class="ns-log"><div class="ns-msg ns-user">' + esc(SAMPLE.question) + '</div>' +
      '<div class="ns-msg ns-ai">' + formatAnswer(SAMPLE.answer) +
      '<span class="ns-src">' + SAMPLE.sources.map((s) => '[' + s.n + '] ' + esc(sourceLabel(s))).join('<br>') + '</span></div></div>' +
      '<p class="ns-p">Sign in with Google to upload your own study material.</p>' +
      '<div class="ns-foot"><button type="button" class="ns-btn ns-primary" data-ns="signin">Sign in with Google</button>' +
      '<button type="button" class="ns-btn" data-ns="close">Close</button></div>';
  }

  function renderMain() {
    const full = usage && (usage.docs >= usage.maxDocs || usage.chunks >= usage.maxChunks);
    $('ns-body').innerHTML =
      '<p class="ns-p">Upload notes or a chapter (text PDF, TXT or Markdown, up to 4 MB). Only the text is kept, not the file. Then ask NexAI to explain, quiz you or solve a problem from it.</p>' +
      '<div class="ns-box"><div class="ns-row"><input type="file" id="ns-file" accept="' + ACCEPT + '" aria-label="Study file">' +
      '<input type="text" id="ns-title-in" maxlength="80" placeholder="Title (optional)" aria-label="Title">' +
      '<input type="text" id="ns-subject" maxlength="60" placeholder="Subject (optional)" aria-label="Subject">' +
      '<button type="button" class="ns-btn ns-primary" id="ns-upload" data-ns="upload"' + (full ? ' disabled' : '') + '>Upload</button></div>' +
      '<div class="ns-dm" id="ns-usage"></div></div>' +
      '<div class="ns-box" id="ns-docs"></div>' +
      '<div class="ns-row"><select id="ns-scope" aria-label="Ask about"></select></div>' +
      '<div class="ns-status" id="ns-status" role="status" aria-live="polite"></div>' +
      '<div class="ns-log" id="ns-log"></div>' +
      '<div class="ns-row"><textarea id="ns-question" maxlength="600" rows="2" placeholder="Ask about your material" aria-label="Question"></textarea>' +
      '<button type="button" class="ns-btn ns-primary" id="ns-ask" data-ns="ask">Ask</button></div>' +
      '<div class="ns-foot"><button type="button" class="ns-btn" data-ns="close">Close</button></div>';
    renderDocs();
    renderLog();
  }

  function renderDocs() {
    const box = modal.querySelector('#ns-docs');
    if (!box) return;
    box.innerHTML = docs.length
      ? docs.map((d) => '<div class="ns-doc"><div><div class="ns-dt">' + esc(d.title) + '</div><div class="ns-dm">' +
        esc((d.subject ? d.subject + ' \u00b7 ' : '') + (d.pages ? d.pages + ' pages \u00b7 ' : '') + d.chunkCount + ' sections \u00b7 ' + sizeLabel(d.size) + (d.truncated ? ' \u00b7 shortened' : '')) +
        '</div></div><button type="button" class="ns-btn" data-ns="delete" data-id="' + esc(d.id) + '" aria-label="Delete ' + esc(d.title) + '">Delete</button></div>').join('')
      : '<div class="ns-dm">No study material yet. Upload a file to begin.</div>';
    const scope = modal.querySelector('#ns-scope');
    const keep = scope.value;
    scope.innerHTML = '<option value="">All my material</option>' + docs.map((d) => '<option value="' + esc(d.id) + '">' + esc(d.title) + '</option>').join('');
    if (docs.some((d) => d.id === keep)) scope.value = keep;
    const u = modal.querySelector('#ns-usage');
    if (u && usage) u.textContent = usage.docs + ' of ' + usage.maxDocs + ' documents \u00b7 ' + usage.chunks + ' of ' + usage.maxChunks + ' sections used';
  }

  function renderLog() {
    const log = modal.querySelector('#ns-log');
    if (!log) return;
    log.innerHTML = history.map((m) => {
      if (m.role === 'user') return '<div class="ns-msg ns-user">' + esc(m.content) + '</div>';
      const src = (m.sources || []).length
        ? '<span class="ns-src">' + m.sources.map((s) => '[' + s.n + '] ' + esc(sourceLabel(s))).join('<br>') + '</span>' : '';
      return '<div class="ns-msg ns-ai">' + formatAnswer(m.content) + src + '</div>';
    }).join('');
    log.scrollTop = log.scrollHeight;
    const body = modal.querySelector('#ns-body');
    if (body && history.length) body.scrollTop = body.scrollHeight;
  }

  async function refresh() {
    const data = await call('GET', '/docs');
    docs = Array.isArray(data.docs) ? data.docs : [];
    usage = data.usage || null;
    renderDocs();
  }

  async function upload() {
    if (busy) return;
    const input = modal.querySelector('#ns-file');
    const file = input && input.files && input.files[0];
    const problem = checkFile(file);
    if (problem) { setStatus(problem); return; }
    busy = true;
    const btn = modal.querySelector('#ns-upload');
    btn.disabled = true;
    setStatus('Reading "' + file.name + '". This can take a few seconds.');
    try {
      const data = await readBase64(file);
      const out = await call('POST', '/docs', {
        name: file.name, data,
        title: modal.querySelector('#ns-title-in').value, subject: modal.querySelector('#ns-subject').value
      });
      input.value = '';
      modal.querySelector('#ns-title-in').value = '';
      await refresh();
      setStatus('Added "' + out.doc.title + '" (' + out.doc.chunkCount + ' sections). You can ask questions now.');
    } catch (e) {
      setStatus((e && e.message) || 'Upload failed.');
    } finally {
      busy = false;
      btn.disabled = !!(usage && (usage.docs >= usage.maxDocs || usage.chunks >= usage.maxChunks));
    }
  }

  async function remove(id) {
    if (busy || !id) return;
    const doc = docs.find((d) => d.id === id);
    if (!window.confirm('Delete "' + (doc ? doc.title : 'this document') + '" and its sections?')) return;
    busy = true;
    try {
      await call('DELETE', '/docs/' + encodeURIComponent(id));
      await refresh();
      setStatus('Deleted.');
    } catch (e) {
      setStatus((e && e.message) || 'Could not delete.');
    } finally { busy = false; }
  }

  async function ask() {
    if (busy) return;
    const box = modal.querySelector('#ns-question');
    const question = box.value.replace(/\s+/g, ' ').trim();
    if (question.length < 2) { setStatus('Type a question first.'); return; }
    if (!docs.length) { setStatus('Upload some study material first.'); return; }
    busy = true;
    const btn = modal.querySelector('#ns-ask');
    btn.disabled = true;
    const prior = history.slice(-6).map((m) => ({ role: m.role, content: m.content }));
    history.push({ role: 'user', content: question });
    box.value = '';
    renderLog();
    setStatus('NexAI is reading your material.');
    try {
      const out = await call('POST', '/ask', { question, docId: modal.querySelector('#ns-scope').value || undefined, history: prior });
      history.push({ role: 'assistant', content: out.answer, sources: out.sources || [], found: !!out.found });
      setStatus('');
    } catch (e) {
      history.pop();
      box.value = question;
      setStatus((e && e.message) || 'NexAI could not answer right now.');
    } finally {
      busy = false;
      btn.disabled = false;
      renderLog();
    }
  }

  function open(a) {
    adapter = a; build();
    history = []; docs = []; usage = null;
    modal.dataset.open = '1';
    if (a.isGuest()) { renderGuest(); return; }
    renderMain();
    setStatus('Loading your library.');
    refresh().then(() => setStatus('')).catch((e) => setStatus((e && e.message) || 'Could not load your library.'));
  }

  const api = { open, formatAnswer, sourceLabel, checkFile, sizeLabel, SAMPLE, MAX_BYTES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.NexStudy = api;
})(typeof window !== 'undefined' ? window : globalThis);
