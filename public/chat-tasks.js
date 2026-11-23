/* NexOS 3.5.0 — turn NexAI chat replies into tasks, habits or a note.
   Shared by Classic chat, the Enterprise NexAI page and the Enterprise side dock.
   Pure text parsing + small one-tap buttons. Each page supplies addTasks(), addHabits() and addNote(). */
(function (root) {
  'use strict';

  const BULLET = /^(\s*)(?:[-*•–]|\d{1,2}[.)])\s+(?:\[[ xX]?\]\s+)?(.+?)\s*$/;
  const VERB = /\b(add|create|make|put|save|insert|schedule|enter|include|bana|banao|banado|jod|jodo|daal|daalo|rakh|rakho)\b/i;
  const TASK_WORD = /\b(tasks?|to-?dos?|kaam|action items?|checklist)\b/i;
  const HABIT_WORD = /\b(habits?|routines?)\b/i;
  const PRONOUN = /\b(these|those|them|above|upar|ye|yeh|yah|inhe|inhen|inko|unhe|unko|ise|isse|sabhi|saare|sare)\b/i;
  const SHORT_PRONOUN = /\b(this|it)\b/i;
  const QUESTION_ABOUT = /\bhow\s+(do|to|can|should)\b|\bkaise\b|\bwhy\b|\bkyun\b|\bkyu\b/i;
  // What a reply is about. Habit and task cues are kept strict so that a plain bullet list never gets a button.
  const HABIT_CUE = /\b(habits?|routines?|streaks?|rozana|roz|every\s?day|everyday|each\s+(?:morning|day|evening)|every\s+(?:morning|evening|night))\b/i;
  const TASK_STRONG = /\b(tasks?|to-?dos?|deadlines?|due|action items?|checklist|assignments?|milestones?|kaam)\b/i;
  const TASK_LOOSE = /\b(plan|schedule|priorit\w*|steps?|goals?|revise|study|finish|complete|submit|prepare)\b/i;
  const SAVE_VERB = /\b(save|add|keep|store|put|rakh|rakho|bana|banao)\b/i;
  const NOTE_TARGET = /\b(?:as|in|to|into)\s+(?:a\s+|my\s+|the\s+)?notes?\b|\bnotes?\s+(?:me|mein|main|m)\b|\bnote\s+(?:bana|banao)/i;

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

  /* What is this reply? 'task' | 'habit' | 'both' | 'none'. `count` is how many list items it has. */
  function classify(reply, userMsg, count) {
    if (!count) return 'none';
    reply = String(reply || ''); userMsg = String(userMsg || '');
    const h = HABIT_CUE.test(reply) || HABIT_CUE.test(userMsg);
    const t = TASK_STRONG.test(reply) || TASK_STRONG.test(userMsg);
    if (h && t) {
      const uh = HABIT_CUE.test(userMsg), ut = TASK_STRONG.test(userMsg);
      if (uh && !ut) return 'habit';
      if (ut && !uh) return 'task';
      return 'both';
    }
    if (h) return 'habit';
    if (t) return 'task';
    return count >= 2 && TASK_LOOSE.test(reply + ' ' + userMsg) ? 'task' : 'none';
  }
  function looksLikeTasks(reply, userMsg, opts) {
    const k = classify(reply, userMsg, extract(reply, opts).length);
    return k === 'task' || k === 'both';
  }

  function wordCount(m) { return m.split(/\s+/).length; }
  /* "add these", "ye tasks add kar do", "inhe habits mein add karo", "add this" — a short command about the list just shown.
     A fresh request such as "create 3 tasks for my portfolio" is NOT this: that still goes to NexAI. */
  function wantsAdd(msg) {
    const m = String(msg || '').trim();
    if (!m || m.length > 90 || /[:;\n]/.test(m) || QUESTION_ABOUT.test(m)) return false;
    if (!VERB.test(m)) return false;
    const words = wordCount(m);
    return PRONOUN.test(m) || (words <= 3 && SHORT_PRONOUN.test(m)) || (words <= 4 && (TASK_WORD.test(m) || HABIT_WORD.test(m)));
  }
  /* "save this as a note", "isse note mein save karo", "add to notes". */
  function wantsNote(msg) {
    const m = String(msg || '').trim();
    return !!m && m.length <= 90 && !/[:;\n]/.test(m) && !QUESTION_ABOUT.test(m) && SAVE_VERB.test(m) && NOTE_TARGET.test(m) && wordCount(m) <= 9;
  }
  function explicitKind(msg) {
    const h = HABIT_WORD.test(msg), t = TASK_WORD.test(msg);
    return h && !t ? 'habit' : t && !h ? 'task' : null;
  }

  /* Draft a note from a whole reply: title from its first heading or line. */
  function noteDraft(reply, todayIso) {
    const text = String(reply || '').trim();
    const first = (text.split(/\r?\n/).find((l) => stripMd(l.replace(/^#+\s*/, '')).length >= 3) || '').replace(/^#+\s*/, '');
    let title = stripMd(first).replace(/^(?:[-*•–]|\d{1,2}[.)])\s+/, '').replace(/[\s:.\-–—]+$/, '').slice(0, 60).trim();
    if (!title) title = 'NexAI note ' + (todayIso || '');
    return { title, content: text.slice(0, 20000), tags: ['nexai'] };
  }
  const NOTE_MIN = 150;

  /* Decide what a short command means. Returns { kind: 'note'|'task'|'habit'|'ask', items? } or null. */
  function resolveIntent(message, replyText) {
    if (!replyText) return null;
    if (wantsNote(message)) return { kind: 'note' };
    if (!wantsAdd(message)) return null;
    const items = extract(replyText);
    if (!items.length) return null;
    let kind = explicitKind(message) || classify(replyText, '', items.length);
    if (kind === 'none') kind = 'task';
    return { kind: kind === 'both' ? 'ask' : kind, items };
  }

  function lastReply(box, assistantSel, bubbleSel) {
    if (!box) return '';
    const all = box.querySelectorAll(assistantSel);
    const lastMsg = all[all.length - 1];
    const bubble = lastMsg && lastMsg.querySelector(bubbleSel);
    return (bubble && bubble.dataset && bubble.dataset.nxReply) || '';
  }

  const NOUN = { task: ['task', 'tasks', 'To Do on your board'], habit: ['habit', 'habits', 'Habits'], note: ['note', 'notes', 'Notes'] };
  function report(ctx, r, kind) {
    const n = NOUN[kind] || NOUN.task;
    if (!r || !r.added) {
      const msg = kind === 'note' ? 'That is already saved in your notes.' : `Those ${n[1]} are already there, so nothing was added.`;
      ctx.toast(msg);
      return msg;
    }
    const skipped = r.skipped ? ` (${r.skipped} already existed)` : '';
    const msg = kind === 'note' ? 'Saved as a note.' : `Added ${r.added} ${r.added === 1 ? n[0] : n[1]}${skipped}.`;
    ctx.toast(msg, { action: 'Undo', onAction: r.undo });
    return msg;
  }
  function runKind(kind, items, replyText, ctx) {
    if (kind === 'note') return ctx.addNote(noteDraft(replyText, ctx.today()));
    return kind === 'habit' ? ctx.addHabits(items) : ctx.addTasks(items);
  }

  function ensureStyle() {
    if (typeof document === 'undefined' || document.getElementById('nx-addtasks-style')) return;
    const s = document.createElement('style');
    s.id = 'nx-addtasks-style';
    s.textContent = '.nx-addtasks{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}.nx-addtasks button{display:inline-flex;align-items:center;gap:6px;min-height:36px;padding:0 14px;border:0;border-radius:999px;cursor:pointer;font:600 13px/1 inherit;font-family:inherit;background:var(--accent-fill,var(--accent-primary,#4f8cff));color:var(--on-accent,var(--text-on-accent,#fff))}.nx-addtasks button.nx-sec{background:transparent;color:inherit;border:1px solid rgba(128,128,128,.45)}.nx-addtasks button:disabled{opacity:.75;cursor:default}';
    document.head.appendChild(s);
  }
  function makeButton(label, secondary, run, ctx, kind, replyText) {
    const btn = document.createElement('button');
    btn.type = 'button';
    if (secondary) btn.className = 'nx-sec';
    btn.textContent = label;
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      const r = run();
      btn.disabled = true;
      btn.textContent = r && r.added ? (kind === 'note' ? '✓ Saved' : `✓ ${r.added} added`) : '✓ Already there';
      const undo = r && r.undo;
      report(ctx, r && Object.assign({}, r, { undo() { if (undo) undo(); btn.disabled = false; btn.textContent = label; } }), kind);
    });
    return btn;
  }
  function buildBar(bubble, specs) {
    ensureStyle();
    const wrap = document.createElement('div');
    wrap.className = 'nx-addtasks';
    specs.forEach((b) => wrap.appendChild(b));
    bubble.appendChild(wrap);
  }
  const plural = (n, kind) => `${n} ${n === 1 ? NOUN[kind][0] : NOUN[kind][1]}`;

  /* Remember the reply text on its bubble and add the one-tap buttons it deserves:
     Add N tasks / Add N habits (or both when it is unclear) and Save as note for longer replies. */
  function attach(bubble, replyText, userMsg, ctx) {
    if (!bubble || !bubble.dataset) return;
    bubble.dataset.nxReply = String(replyText || '');
    bubble.querySelectorAll('.nx-addtasks').forEach((n) => n.remove());
    const items = extract(replyText, { today: ctx.today() });
    const kind = classify(replyText, userMsg, items.length);
    const buttons = [];
    const add = (k, label, secondary) => buttons.push(makeButton(label, secondary, () => runKind(k, items, replyText, ctx), ctx, k, replyText));
    if (kind === 'task' || kind === 'both') add('task', `＋ ${kind === 'both' ? 'As' : 'Add'} ${plural(items.length, 'task')}`);
    if (kind === 'habit' || kind === 'both') add('habit', `＋ ${kind === 'both' ? 'As' : 'Add'} ${plural(items.length, 'habit')}`);
    if (String(replyText || '').trim().length >= NOTE_MIN) add('note', 'Save as note', true);
    if (buttons.length) buildBar(bubble, buttons);
  }

  /* True when the message is a short "add these" / "save as note" command and the last reply can be used. */
  function canDirectAdd(message, replyText) { return !!resolveIntent(message, replyText); }

  /* Handle that command here, without NexAI. Returns true when handled (caller must not send it on). */
  function tryDirectAdd(message, replyText, ctx) {
    const intent = resolveIntent(message, replyText);
    if (!intent) return false;
    if (intent.kind === 'ask') {
      const el = ctx.say('This looks like it could be tasks or habits. Where should I add it?');
      if (el) buildBar(el, [
        makeButton(`＋ As ${plural(intent.items.length, 'task')}`, false, () => ctx.addTasks(intent.items), ctx, 'task', replyText),
        makeButton(`＋ As ${plural(intent.items.length, 'habit')}`, false, () => ctx.addHabits(intent.items), ctx, 'habit', replyText)
      ]);
      return true;
    }
    const items = (intent.items || []).map((i) => Object.assign({}, i));
    if (intent.kind !== 'note') items.forEach((i) => { i.due = i.due || ''; });
    const r = runKind(intent.kind, items, replyText, ctx);
    const msg = report(ctx, r, intent.kind);
    if (ctx.say) ctx.say(r && r.added ? `✅ ${msg} Find ${intent.kind === 'note' ? 'it' : 'them'} in ${NOUN[intent.kind][2]}.` : msg);
    return true;
  }

  const api = { extract, classify, looksLikeTasks, wantsAdd, wantsNote, noteDraft, resolveIntent, canDirectAdd, lastReply, tryDirectAdd, attach };
  root.NexChatTasks = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
