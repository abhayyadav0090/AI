/* NexOS 4.1.0 — Study Studio (dialog redesigned in 4.1.1): upload notes, then ask NexAI to tutor you from them.
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

  /* Colours come from whichever page is open: Classic (--surface, --text, --accent ...) or Enterprise (--bg-surface-elevated, --text-main ...). */
  const CSS = `
#nexos-study-modal{--k-bg:var(--surface,var(--bg-surface-elevated,#1c1c1e));--k-bg2:var(--surface-2,var(--bg-card-hover,rgba(255,255,255,.08)));--k-text:var(--text,var(--text-main,#f5f5f7));--k-text2:var(--text-2,var(--text-secondary,#a1a1a6));--k-line:var(--outline,var(--border-subtle,rgba(255,255,255,.16)));--k-accent:var(--accent-fill,var(--accent-primary,#0a84ff));--k-on:var(--on-accent,var(--text-on-accent,#fff));--k-soft:var(--accent-container,rgba(10,132,255,.16));--k-hover:var(--hover,rgba(255,255,255,.07));--k-danger:var(--danger,var(--priority-high,#ff453a));position:fixed;inset:0;z-index:2100;display:none;align-items:center;justify-content:center;padding:16px;background:var(--scrim,rgba(0,0,0,.55));font-family:inherit}
#nexos-study-modal[data-open="1"]{display:flex}
#nexos-study-modal *{box-sizing:border-box}
#nexos-study-modal .ns-card{width:min(720px,100%);height:min(720px,92vh);display:flex;flex-direction:column;border-radius:20px;background:var(--k-bg);color:var(--k-text);border:1px solid var(--k-line);box-shadow:var(--shadow-3,0 24px 70px rgba(0,0,0,.45));overflow:hidden;outline:0}
#nexos-study-modal .ns-head{display:flex;align-items:center;gap:12px;padding:16px 16px 10px}
#nexos-study-modal .ns-badge{width:38px;height:38px;border-radius:12px;display:grid;place-items:center;background:var(--k-soft);color:var(--k-accent);flex:none}
#nexos-study-modal .ns-badge svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
#nexos-study-modal .ns-ht{flex:1;min-width:0}
#nexos-study-modal h3{margin:0;font-size:17px;font-weight:600;line-height:1.25}
#nexos-study-modal .ns-sub{font-size:12.5px;color:var(--k-text2);margin-top:2px}
#nexos-study-modal .ns-x{width:34px;height:34px;border-radius:50%;border:0;background:transparent;color:var(--k-text2);font-size:16px;cursor:pointer}
#nexos-study-modal .ns-x:hover{background:var(--k-hover);color:var(--k-text)}
#nexos-study-modal .ns-tabs{display:grid;grid-template-columns:1fr 1fr;gap:4px;margin:0 16px 10px;padding:4px;border-radius:14px;background:var(--k-bg2)}
#nexos-study-modal .ns-tab{min-height:38px;border:0;border-radius:10px;background:transparent;color:var(--k-text2);font-size:13.5px;font-weight:500;cursor:pointer;font-family:inherit}
#nexos-study-modal .ns-tab[aria-selected="true"]{background:var(--k-bg);color:var(--k-text);font-weight:600;box-shadow:0 1px 3px rgba(0,0,0,.18)}
#nexos-study-modal .ns-panel{flex:1;min-height:0;display:none;flex-direction:column}
#nexos-study-modal .ns-panel[data-on="1"]{display:flex}
#nexos-study-modal .ns-scroll{flex:1;min-height:0;overflow:auto;padding:4px 16px 12px}
#nexos-study-modal .ns-p{margin:0 0 12px;font-size:13px;line-height:1.55;color:var(--k-text2)}
#nexos-study-modal .ns-drop{display:flex;flex-direction:column;align-items:center;gap:6px;text-align:center;padding:22px 14px;border:2px dashed var(--k-line);border-radius:16px;background:var(--k-bg2);cursor:pointer;margin-bottom:10px}
#nexos-study-modal .ns-drop[data-over="1"],#nexos-study-modal .ns-drop:hover{border-color:var(--k-accent);background:var(--k-soft)}
#nexos-study-modal .ns-drop strong{font-size:14px}
#nexos-study-modal .ns-drop span{font-size:12px;color:var(--k-text2)}
#nexos-study-modal .ns-drop input{display:none}
#nexos-study-modal .ns-fields{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px}
#nexos-study-modal input[type=text],#nexos-study-modal textarea,#nexos-study-modal select{width:100%;min-width:0;border:1px solid var(--k-line);background:var(--k-bg2);color:var(--k-text);border-radius:12px;padding:10px 12px;font-size:13.5px;font-family:inherit}
#nexos-study-modal select option{color:#111}
#nexos-study-modal textarea{resize:none;min-height:44px;max-height:110px;line-height:1.4}
#nexos-study-modal .ns-btn{min-height:42px;border:1px solid var(--k-line);background:transparent;color:var(--k-text);border-radius:12px;padding:0 18px;font-size:13.5px;font-weight:500;cursor:pointer;font-family:inherit}
#nexos-study-modal .ns-btn:hover{background:var(--k-hover)}
#nexos-study-modal .ns-btn.ns-primary{background:var(--k-accent);border-color:transparent;color:var(--k-on);font-weight:600}
#nexos-study-modal .ns-btn.ns-primary:hover{filter:brightness(1.07)}
#nexos-study-modal .ns-btn.ns-small{min-height:34px;padding:0 12px;font-size:12.5px}
#nexos-study-modal .ns-btn[disabled]{opacity:.45;cursor:default;filter:none}
#nexos-study-modal .ns-meter{height:6px;border-radius:99px;background:var(--k-bg2);overflow:hidden;margin:6px 0 4px}
#nexos-study-modal .ns-meter i{display:block;height:100%;background:var(--k-accent);border-radius:99px}
#nexos-study-modal .ns-dm{font-size:12px;color:var(--k-text2);line-height:1.45}
#nexos-study-modal .ns-doc{display:flex;align-items:center;gap:10px;padding:11px 12px;border:1px solid var(--k-line);border-radius:14px;background:var(--k-bg2);margin-top:8px}
#nexos-study-modal .ns-doc .ns-dt{flex:1;min-width:0;font-size:13.5px;font-weight:600;overflow-wrap:anywhere}
#nexos-study-modal .ns-status{display:flex;align-items:flex-start;gap:10px;font-size:12.5px;line-height:1.5;color:var(--k-text2);padding:0 16px;white-space:pre-wrap}
#nexos-study-modal .ns-status:not(:empty){padding-bottom:8px}
#nexos-study-modal .ns-status.ns-busy::before{content:"";flex:none;width:15px;height:15px;margin-top:2px;border-radius:50%;border:2px solid var(--k-line);border-top-color:var(--k-accent);animation:ns-spin .8s linear infinite}
@keyframes ns-spin{to{transform:rotate(360deg)}}
#nexos-study-modal .ns-empty{text-align:center;padding:34px 18px;color:var(--k-text2);font-size:13.5px;line-height:1.55}
#nexos-study-modal .ns-empty strong{display:block;color:var(--k-text);font-size:15px;margin-bottom:6px}
#nexos-study-modal .ns-empty .ns-btn{margin-top:12px}
#nexos-study-modal .ns-log{display:flex;flex-direction:column;gap:10px}
#nexos-study-modal .ns-msg{padding:10px 13px;border-radius:16px;font-size:13.5px;line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere}
#nexos-study-modal .ns-msg.ns-user{align-self:flex-end;max-width:88%;background:var(--k-accent);color:var(--k-on);border-bottom-right-radius:5px}
#nexos-study-modal .ns-msg.ns-ai{align-self:flex-start;max-width:96%;background:var(--k-bg2);border-bottom-left-radius:5px}
#nexos-study-modal .ns-msg.ns-miss{border:1px dashed var(--k-line);background:transparent;color:var(--k-text2)}
#nexos-study-modal .ns-msg code{background:var(--k-hover);padding:1px 5px;border-radius:5px}
#nexos-study-modal .ns-srcs{display:flex;flex-wrap:wrap;gap:6px;margin-top:9px}
#nexos-study-modal .ns-src{font-size:11.5px;padding:3px 9px;border-radius:999px;background:var(--k-soft);color:var(--k-accent);font-weight:600;white-space:normal}
#nexos-study-modal .ns-dots{display:inline-flex;gap:4px;padding:3px 0}
#nexos-study-modal .ns-dots i{width:7px;height:7px;border-radius:50%;background:var(--k-text2);opacity:.5;animation:ns-bounce 1s infinite ease-in-out}
#nexos-study-modal .ns-dots i:nth-child(2){animation-delay:.15s}#nexos-study-modal .ns-dots i:nth-child(3){animation-delay:.3s}
@keyframes ns-bounce{0%,80%,100%{transform:translateY(0)}40%{transform:translateY(-5px)}}
#nexos-study-modal .ns-tools{display:flex;gap:8px;align-items:center;padding:4px 16px 8px}
#nexos-study-modal .ns-tools select{flex:1;padding:7px 10px;font-size:12.5px}
#nexos-study-modal .ns-starters{display:flex;gap:6px;overflow-x:auto;padding:0 16px 8px}
#nexos-study-modal .ns-starters button{flex:none;border:1px solid var(--k-line);background:var(--k-bg2);color:var(--k-text);border-radius:999px;padding:6px 12px;font-size:12px;cursor:pointer;font-family:inherit}
#nexos-study-modal .ns-starters button:hover{background:var(--k-hover)}
#nexos-study-modal .ns-bar{display:flex;gap:8px;align-items:flex-end;padding:8px 16px 14px;border-top:1px solid var(--k-line)}
#nexos-study-modal .ns-foot{display:flex;justify-content:flex-end;gap:8px;padding:10px 16px 14px;border-top:1px solid var(--k-line)}
#nexos-study-modal button:focus-visible,#nexos-study-modal input:focus-visible,#nexos-study-modal textarea:focus-visible,#nexos-study-modal select:focus-visible,#nexos-study-modal .ns-drop:focus-visible{outline:2px solid var(--k-accent);outline-offset:2px}
@media (max-width:560px){#nexos-study-modal{align-items:flex-end;padding:0}#nexos-study-modal .ns-card{width:100%;height:94vh;border-radius:22px 22px 0 0}#nexos-study-modal .ns-fields{grid-template-columns:1fr}}
@media (prefers-reduced-motion:reduce){#nexos-study-modal .ns-status.ns-busy::before,#nexos-study-modal .ns-dots i{animation:none}}`;

  const ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6.5C10 5 7 4.5 4 5v13c3-.5 6 0 8 1.5 2-1.5 5-2 8-1.5V5c-3-.5-6 0-8 1.5zM12 6.5v13"/></svg>';
  const STARTERS = [
    { label: 'Explain simply', text: 'Explain in simple words: ' },
    { label: 'Practice questions', text: 'Give me 5 practice questions about: ' },
    { label: 'Solve step by step', text: 'Solve step by step: ' },
    { label: 'Key definitions', text: 'List the key definitions about: ' }
  ];

  let modal = null, adapter = null, busy = false, tab = 'tutor';
  let docs = [], usage = null, history = [], thinking = false, pending = null;

  const $ = (id) => modal.querySelector('#' + id);
  const setStatus = (text, isBusy) => { const el = modal && modal.querySelector('#ns-status'); if (!el) return; el.textContent = text || ''; el.classList.toggle('ns-busy', !!isBusy); };

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
    modal.innerHTML = '<div class="ns-card" tabindex="-1"><div class="ns-head"><span class="ns-badge">' + ICON + '</span>' +
      '<div class="ns-ht"><h3 id="ns-title">Study Studio</h3><div class="ns-sub">Learn from your own notes</div></div>' +
      '<button type="button" class="ns-x" data-ns="close" aria-label="Close">\u2715</button></div>' +
      '<div id="ns-root" style="display:flex;flex-direction:column;flex:1;min-height:0"></div></div>';
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) return close();
      const t = e.target.closest('[data-ns]');
      if (!t) return;
      const act = t.getAttribute('data-ns');
      if (act === 'close') close();
      else if (act === 'signin') { close(); if (adapter && adapter.signIn) adapter.signIn(); }
      else if (act === 'tab') setTab(t.getAttribute('data-tab'));
      else if (act === 'upload') upload();
      else if (act === 'ask') ask();
      else if (act === 'delete') remove(t.getAttribute('data-id'));
      else if (act === 'starter') { const box = $('ns-question'); box.value = STARTERS[Number(t.getAttribute('data-i'))].text; box.focus(); }
    });
    modal.addEventListener('change', (e) => { if (e.target && e.target.id === 'ns-file') pickFile(e.target.files && e.target.files[0]); });
    modal.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && e.target && e.target.id === 'ns-question') { e.preventDefault(); ask(); }
      if ((e.key === 'Enter' || e.key === ' ') && e.target && e.target.id === 'ns-drop') { e.preventDefault(); $('ns-file').click(); }
    });
    modal.addEventListener('dragover', (e) => { const z = e.target.closest && e.target.closest('#ns-drop'); if (z) { e.preventDefault(); z.dataset.over = '1'; } });
    modal.addEventListener('dragleave', (e) => { const z = e.target.closest && e.target.closest('#ns-drop'); if (z) z.dataset.over = '0'; });
    modal.addEventListener('drop', (e) => {
      const z = e.target.closest && e.target.closest('#ns-drop');
      if (!z) return;
      e.preventDefault(); z.dataset.over = '0';
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) pickFile(f);
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

  const srcChips = (list) => (list || []).length
    ? '<div class="ns-srcs">' + list.map((s) => '<span class="ns-src">[' + s.n + '] ' + esc(sourceLabel(s)) + '</span>').join('') + '</div>' : '';

  function renderGuest() {
    $('ns-root').innerHTML =
      '<div class="ns-scroll"><p class="ns-p">Upload your notes or a chapter, then ask NexAI questions. It answers only from your material, shows the page it used, and says so when the answer is not there. This is a sample: nothing is uploaded and no AI is called.</p>' +
      '<div class="ns-doc"><div class="ns-dt">' + esc(SAMPLE.material) + '</div></div>' +
      '<div class="ns-log" style="margin-top:12px"><div class="ns-msg ns-user">' + esc(SAMPLE.question) + '</div>' +
      '<div class="ns-msg ns-ai">' + formatAnswer(SAMPLE.answer) + srcChips(SAMPLE.sources) + '</div></div></div>' +
      '<div class="ns-foot"><button type="button" class="ns-btn ns-primary" data-ns="signin">Sign in with Google to use your notes</button>' +
      '<button type="button" class="ns-btn" data-ns="close">Close</button></div>';
  }

  function renderMain() {
    $('ns-root').innerHTML =
      '<div class="ns-tabs" role="tablist"><button type="button" class="ns-tab" role="tab" data-ns="tab" data-tab="tutor" id="ns-tab-tutor">Tutor</button>' +
      '<button type="button" class="ns-tab" role="tab" data-ns="tab" data-tab="library" id="ns-tab-library">Library</button></div>' +
      '<div class="ns-status" id="ns-status" role="status" aria-live="polite"></div>' +
      '<div class="ns-panel" id="ns-panel-tutor">' +
        '<div class="ns-tools"><select id="ns-scope" aria-label="Ask about"></select></div>' +
        '<div class="ns-scroll" id="ns-chat"></div>' +
        '<div class="ns-starters" id="ns-starters">' + STARTERS.map((st, i) => '<button type="button" data-ns="starter" data-i="' + i + '">' + esc(st.label) + '</button>').join('') + '</div>' +
        '<div class="ns-bar"><textarea id="ns-question" maxlength="600" rows="1" placeholder="Ask about your material" aria-label="Question"></textarea>' +
        '<button type="button" class="ns-btn ns-primary" id="ns-ask" data-ns="ask">Ask</button></div></div>' +
      '<div class="ns-panel" id="ns-panel-library"><div class="ns-scroll">' +
        '<p class="ns-p">Add notes or a chapter: a text PDF, TXT or Markdown file up to 4 MB. Only the text is kept, not the file. Scanned PDFs (photos of pages) are not supported yet.</p>' +
        '<div class="ns-drop" id="ns-drop" tabindex="0" role="button" aria-label="Choose a file"><strong id="ns-dropname">Tap to choose a file</strong><span id="ns-dropsub">or drag and drop it here</span>' +
        '<input type="file" id="ns-file" accept="' + ACCEPT + '" aria-label="Study file"></div>' +
        '<div class="ns-fields"><input type="text" id="ns-title-in" maxlength="80" placeholder="Title (optional)" aria-label="Title"><input type="text" id="ns-subject" maxlength="60" placeholder="Subject (optional)" aria-label="Subject"></div>' +
        '<button type="button" class="ns-btn ns-primary" id="ns-upload" data-ns="upload" style="width:100%">Add to my library</button>' +
        '<div style="margin-top:16px"><div class="ns-dm" id="ns-usage"></div><div class="ns-meter"><i id="ns-meter" style="width:0"></i></div></div>' +
        '<div id="ns-docs"></div></div></div>';
    $('ns-drop').addEventListener('click', () => { if (!busy) $('ns-file').click(); });
    $('ns-question').addEventListener('input', (e) => { e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 110) + 'px'; });
    renderDocs(); renderChat(); setTab(tab);
  }

  function setTab(name) {
    tab = name === 'library' ? 'library' : 'tutor';
    ['tutor', 'library'].forEach((t) => {
      const on = t === tab;
      $('ns-tab-' + t).setAttribute('aria-selected', String(on));
      $('ns-panel-' + t).dataset.on = on ? '1' : '0';
    });
    if (tab === 'tutor') renderChat();
  }

  function renderDocs() {
    const box = $('ns-docs');
    if (!box) return;
    box.innerHTML = docs.map((d) => '<div class="ns-doc"><div class="ns-dt">' + esc(d.title) + '<div class="ns-dm">' +
      esc((d.subject ? d.subject + ' \u00b7 ' : '') + (d.pages ? d.pages + ' pages \u00b7 ' : '') + d.chunkCount + ' sections \u00b7 ' + sizeLabel(d.size) + (d.truncated ? ' \u00b7 shortened' : '')) +
      '</div></div><button type="button" class="ns-btn ns-small" data-ns="delete" data-id="' + esc(d.id) + '" aria-label="Delete ' + esc(d.title) + '">Delete</button></div>').join('');
    const scope = $('ns-scope'), keep = scope.value;
    scope.innerHTML = '<option value="">All my material</option>' + docs.map((d) => '<option value="' + esc(d.id) + '">' + esc(d.title) + '</option>').join('');
    if (docs.some((d) => d.id === keep)) scope.value = keep;
    if (usage) {
      $('ns-usage').textContent = usage.docs + ' of ' + usage.maxDocs + ' documents \u00b7 ' + usage.chunks + ' of ' + usage.maxChunks + ' sections used';
      $('ns-meter').style.width = Math.min(100, Math.round(usage.chunks / usage.maxChunks * 100)) + '%';
      $('ns-upload').disabled = busy || usage.docs >= usage.maxDocs || usage.chunks >= usage.maxChunks;
    }
  }

  function renderChat() {
    const chat = modal.querySelector('#ns-chat');
    if (!chat) return;
    if (!docs.length) {
      chat.innerHTML = '<div class="ns-empty"><strong>Your library is empty</strong>Add a chapter or your notes, then ask NexAI to explain, quiz you or solve a problem from them.<br>' +
        '<button type="button" class="ns-btn ns-primary" data-ns="tab" data-tab="library">Add your first document</button></div>';
      return;
    }
    if (!history.length && !thinking) {
      chat.innerHTML = '<div class="ns-empty"><strong>Ask about your material</strong>Try a starter below, or type your own question. Answers show the page they came from.</div>';
      return;
    }
    chat.innerHTML = '<div class="ns-log">' + history.map((m) => {
      if (m.role === 'user') return '<div class="ns-msg ns-user">' + esc(m.content) + '</div>';
      return '<div class="ns-msg ns-ai' + (m.found === false ? ' ns-miss' : '') + '">' + formatAnswer(m.content) + srcChips(m.sources) + '</div>';
    }).join('') + (thinking ? '<div class="ns-msg ns-ai"><span class="ns-dots" aria-label="NexAI is reading your material"><i></i><i></i><i></i></span></div>' : '') + '</div>';
    chat.scrollTop = chat.scrollHeight;
  }

  async function refresh() {
    const data = await call('GET', '/docs');
    docs = Array.isArray(data.docs) ? data.docs : [];
    usage = data.usage || null;
    renderDocs();
  }

  function pickFile(file) {
    pending = file || null;
    if (!file) { $('ns-dropname').textContent = 'Tap to choose a file'; $('ns-dropsub').textContent = 'or drag and drop it here'; return; }
    const problem = checkFile(file);
    $('ns-dropname').textContent = file.name;
    $('ns-dropsub').textContent = problem || sizeLabel(file.size);
    if (problem) { pending = null; setStatus(problem); } else { setStatus(''); }
  }

  async function upload() {
    if (busy) return;
    const file = pending;
    const problem = checkFile(file);
    if (problem) { setStatus(problem); return; }
    busy = true;
    $('ns-upload').disabled = true;
    setStatus('Reading "' + file.name + '". This can take a few seconds.', true);
    try {
      const data = await readBase64(file);
      const out = await call('POST', '/docs', { name: file.name, data, title: $('ns-title-in').value, subject: $('ns-subject').value });
      $('ns-file').value = ''; pickFile(null);
      $('ns-title-in').value = ''; $('ns-subject').value = '';
      busy = false;
      await refresh();
      setStatus('Added "' + out.doc.title + '" (' + out.doc.chunkCount + ' sections). Switching to the tutor.');
      setTimeout(() => { if (modal.dataset.open === '1') { setTab('tutor'); setStatus(''); $('ns-question').focus(); } }, 900);
    } catch (e) {
      setStatus((e && e.message) || 'Upload failed.');
    } finally {
      busy = false;
      renderDocs();
    }
  }

  async function remove(id) {
    if (busy || !id) return;
    const doc = docs.find((d) => d.id === id);
    if (!window.confirm('Delete "' + (doc ? doc.title : 'this document') + '" and its sections? This cannot be undone.')) return;
    busy = true;
    try {
      await call('DELETE', '/docs/' + encodeURIComponent(id));
      busy = false;
      await refresh();
      setStatus('Deleted.');
    } catch (e) {
      setStatus((e && e.message) || 'Could not delete.');
    } finally { busy = false; }
  }

  async function ask() {
    if (busy) return;
    const box = $('ns-question');
    const question = box.value.replace(/\s+/g, ' ').trim();
    if (question.length < 2) { setStatus('Type a question first.'); return; }
    if (!docs.length) { setStatus('Add some study material first.'); setTab('library'); return; }
    busy = true; thinking = true;
    $('ns-ask').disabled = true;
    const prior = history.slice(-6).map((m) => ({ role: m.role, content: m.content }));
    history.push({ role: 'user', content: question });
    box.value = ''; box.style.height = 'auto';
    setStatus('');
    renderChat();
    try {
      const out = await call('POST', '/ask', { question, docId: $('ns-scope').value || undefined, history: prior });
      history.push({ role: 'assistant', content: out.answer, sources: out.sources || [], found: !!out.found });
    } catch (e) {
      history.pop();
      box.value = question;
      setStatus((e && e.message) || 'NexAI could not answer right now.');
    } finally {
      busy = false; thinking = false;
      $('ns-ask').disabled = false;
      renderChat();
    }
  }

  function open(a) {
    adapter = a; build();
    history = []; docs = []; usage = null; pending = null; busy = false; thinking = false;
    modal.dataset.open = '1';
    if (a.isGuest()) { renderGuest(); return; }
    tab = 'tutor';
    renderMain();
    setStatus('Loading your library.', true);
    refresh().then(() => { setStatus(''); if (!docs.length) setTab('library'); else renderChat(); })
      .catch((e) => setStatus((e && e.message) || 'Could not load your library.'));
    const card = modal.querySelector('.ns-card'); if (card) card.focus();
  }

  const api = { open, formatAnswer, sourceLabel, checkFile, sizeLabel, SAMPLE, MAX_BYTES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.NexStudy = api;
})(typeof window !== 'undefined' ? window : globalThis);
