/* NexOS 3.4.9 — turn NexAI chat suggestions into tasks.
   Shared by Classic chat, the Enterprise NexAI page and the Enterprise side dock.
   Pure text parsing + a small "Add N tasks" button. Each page supplies its own addTasks(). */
(function (root) {
  'use strict';

  const BULLET = /^(\s*)(?:[-*•–]|\d{1,2}[.)])\s+(?:\[[ xX]?\]\s+)?(.+?)\s*$/;
  const TASK_CUE = /\b(tasks?|to-?dos?|plan|schedule|priorit\w*|deadline|due|action items?|checklist|steps?|goals?|milestones?|assignments?|revise|study|finish|complete|submit|prepare|kaam)\b/i;
  const VERB = /\b(add|create|make|put|save|insert|schedule|enter|include|bana|banao|banado|jod|jodo|daal|daalo|rakh|rakho)\b/i;
  const TASK_WORD = /\b(tasks?|to-?dos?|kaam|action items?|checklist)\b/i;
  const PRONOUN = /\b(these|those|them|above|upar|ye|yeh|yah|inhe|inhen|inko|unhe|unko|ise|isse|sabhi|saare|sare)\b/i;
  const QUESTION_ABOUT = /\bhow\s+(do|to|can|should)\b|\bkaise\b|\bwhy\b|\bkyun\b|\bkyu\b/i;

  const pad = (n) => String(n).padStart(2, '0');
  function isoPlus(todayIso, days) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(todayIso || ''));
    if (!m) return '';
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + days));
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }
  function validDate(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return false;
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
  }
  function stripMd(t) {
    return String(t || '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/(\*\*|__)(.+?)\1/g, '$2')
      .replace(/[*_`]+/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
  function priorityOf(line) {
    if (/priority\W{0,3}(high|urgent|critical)|\b(high|urgent|critical)\s+priority|[(\[]\s*(high|urgent)\b|\b(urgent|asap|critical)\b/i.test(line)) return 'high';
    if (/priority\W{0,3}low|\blow\s+priority|[(\[]\s*low\b/i.test(line)) return 'low';
    return 'medium';
  }
  function dueOf(line, todayIso) {
    const iso = /\b(\d{4}-\d{2}-\d{2})\b/.exec(line);
    if (iso && validDate(iso[1])) return iso[1];
    if (/\btomorrow\b|\bkal\b/i.test(line)) return isoPlus(todayIso, 1);
    if (/\btoday\b|\baaj\b/i.test(line)) return isoPlus(todayIso, 0);
    return '';
  }
  function splitTitle(raw) {
    let title = raw, desc = '';
    let m = /^(?:\*\*|__)(.+?)(?:\*\*|__)\s*[:\-–—]?\s*(.*)$/.exec(raw);
    if (m) { title = m[1]; desc = m[2]; }
    else {
      m = /^(.{3,80}?)(?:\s[–—-]\s|:\s)(.+)$/.exec(raw);
      if (m) { title = m[1]; desc = m[2]; }
    }
    title = stripMd(title)
      .replace(/\s*[(\[]\s*(high|medium|low|urgent)(\s+priority)?\s*[)\]]/ig, '')
      .replace(/\s*[-–—,]?\s*priority\W{0,3}(high|medium|low)\b/ig, '')
      .replace(/[\s:.\-–—]+$/, '')
      .trim();
    return { title: title.slice(0, 120), description: stripMd(desc).slice(0, 600) };
  }

  /* Pull list items out of a reply as task drafts. Never calls the network. */
  function extract(text, opts) {
    opts = opts || {};
    const max = opts.max || 10;
    const out = [];
    const seen = new Set();
    let last = null;
    String(text || '').split(/\r?\n/).forEach((line) => {
      const m = BULLET.exec(line);
      if (!m) return;
      const indent = m[1].replace(/\t/g, '  ').length;
      const body = m[2];
      if (indent >= 2 && last) {                       // sub-bullet: extra detail for the item above
        const extra = stripMd(body);
        if (extra && last.description.length < 500) last.description = (last.description ? last.description + ' · ' : '') + extra;
        return;
      }
      if (/\?\s*$/.test(body) || /:\s*$/.test(body)) { last = null; return; }   // a question or a heading, not a task
      const { title, description } = splitTitle(body);
      if (title.length < 3) { last = null; return; }
      const key = title.toLowerCase();
      if (seen.has(key)) { last = null; return; }
      seen.add(key);
      last = { title, description, priority: priorityOf(body), due: dueOf(body, opts.today) };
      if (out.length < max) out.push(last); else last = null;
    });
    return out;
  }

  function looksLikeTasks(reply, userMsg, opts) {
    if (extract(reply, opts).length < 2) return false;
    return TASK_CUE.test(String(reply || '')) || TASK_CUE.test(String(userMsg || ''));
  }

  /* "add these tasks", "ye tasks add kar do", "inhe add karo" — a short command about the list just shown.
     A fresh request such as "create 3 tasks for my portfolio" is NOT this: that still goes to NexAI. */
  function wantsAdd(msg) {
    const m = String(msg || '').trim();
    if (!m || m.length > 90 || /[:;\n]/.test(m) || QUESTION_ABOUT.test(m)) return false;
    if (!VERB.test(m)) return false;
    const words = m.split(/\s+/).length;
    return PRONOUN.test(m) || (TASK_WORD.test(m) && words <= 4);
  }

  function lastReply(box, assistantSel, bubbleSel) {
    if (!box) return '';
    const all = box.querySelectorAll(assistantSel);
    const lastMsg = all[all.length - 1];
    const bubble = lastMsg && lastMsg.querySelector(bubbleSel);
    return (bubble && bubble.dataset && bubble.dataset.nxReply) || '';
  }

  function report(ctx, r, source) {
    if (!r || !r.added) {
      ctx.toast(r && r.skipped ? 'Those tasks are already on your board.' : 'No tasks were added.');
      return 'Those tasks are already on your board, so nothing was added.';
    }
    const skipped = r.skipped ? ` (${r.skipped} already existed)` : '';
    const msg = `Added ${r.added} task${r.added === 1 ? '' : 's'}${skipped}.`;
    ctx.toast(msg, { action: 'Undo', onAction: r.undo });
    return msg;
  }

  /* True when the message is a short "add these" command and the last reply has a list to add. */
  function canDirectAdd(message, replyText) {
    return !!replyText && wantsAdd(message) && extract(replyText).length > 0;
  }

  /* User typed "add these". Returns true when handled here (caller must not send it to NexAI). */
  function tryDirectAdd(message, replyText, ctx) {
    if (!canDirectAdd(message, replyText)) return false;
    const items = extract(replyText, { today: ctx.today() });
    const r = ctx.addTasks(items);
    const msg = report(ctx, r);
    if (ctx.say) ctx.say(r && r.added ? `✅ ${msg} Find them in To Do on your board.` : msg);
    return true;
  }

  function ensureStyle() {
    if (typeof document === 'undefined' || document.getElementById('nx-addtasks-style')) return;
    const s = document.createElement('style');
    s.id = 'nx-addtasks-style';
    s.textContent = '.nx-addtasks{margin-top:10px}.nx-addtasks button{display:inline-flex;align-items:center;gap:6px;min-height:36px;padding:0 14px;border:0;border-radius:999px;cursor:pointer;font:600 13px/1 inherit;font-family:inherit;background:var(--accent-fill,var(--accent-primary,#4f8cff));color:var(--on-accent,var(--text-on-accent,#fff))}.nx-addtasks button:disabled{opacity:.75;cursor:default}';
    document.head.appendChild(s);
  }

  /* Remember the reply text on its bubble and, when it reads like a task list, add the one-tap button. */
  function attach(bubble, replyText, userMsg, ctx) {
    if (!bubble || !bubble.dataset) return;
    bubble.dataset.nxReply = String(replyText || '');
    bubble.querySelectorAll('.nx-addtasks').forEach((n) => n.remove());
    const items = extract(replyText, { today: ctx.today() });
    if (!looksLikeTasks(replyText, userMsg, { today: ctx.today() }) || !items.length) return;
    ensureStyle();
    const wrap = document.createElement('div');
    wrap.className = 'nx-addtasks';
    const btn = document.createElement('button');
    btn.type = 'button';
    const label = `＋ Add ${items.length} task${items.length === 1 ? '' : 's'}`;
    btn.textContent = label;
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      const r = ctx.addTasks(items);
      const done = r && r.added;
      btn.disabled = true;
      btn.textContent = done ? `✓ ${r.added} added` : '✓ Already on your board';
      const undo = r && r.undo;
      report(ctx, r && Object.assign({}, r, { undo() { if (undo) undo(); btn.disabled = false; btn.textContent = label; } }));
    });
    wrap.appendChild(btn);
    bubble.appendChild(wrap);
  }

  const api = { extract, looksLikeTasks, wantsAdd, canDirectAdd, lastReply, tryDirectAdd, attach };
  root.NexChatTasks = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
