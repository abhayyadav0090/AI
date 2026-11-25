/* NexOS 4.5.1 — turn NexAI chat replies into tasks, habits or a note.
   Shared by Classic chat, the Enterprise NexAI page and the Enterprise side dock.
   Pure text parsing + small one-tap buttons. Each page supplies addTasks(), addHabits() and addNote(). */
(function (root) {
  'use strict';

  const BULLET = /^(\s*)(?:[-*•–]|\d{1,2}[.)])\s+(?:\[([ xX]?)\]\s+)?(.+?)\s*$/;
  const VERB = /\b(add|create|make|put|save|insert|schedule|enter|include|bana|banao|banado|jod|jodo|daal|daalo|rakh|rakho)\b/i;
  const TASK_WORD = /\b(tasks?|to-?dos?|kaam|action items?|checklist)\b/i;
  const HABIT_WORD = /\b(habits?|routines?)\b/i;
  const PRONOUN = /\b(these|those|them|above|upar|ye|yeh|yah|inhe|inhen|inko|unhe|unko|ise|isse|sabhi|saare|sare)\b/i;
  const SHORT_PRONOUN = /\b(this|it)\b/i;
  const QUESTION_ABOUT = /\bhow\s+(do|to|can|should)\b|\bkaise\b|\bwhy\b|\bkyun\b|\bkyu\b/i;
  // What a reply is about. Habit and task cues are kept strict so informational lists never get action chips.
  const HABIT_CUE = /\b(habits?|routines?|streaks?|rozana|roz|every\s?day|everyday|each\s+(?:morning|day|evening)|every\s+(?:morning|evening|night))\b/i;
  const TASK_STRONG = /\b(tasks?|to-?dos?|deadlines?|due\s+(?:date|by|on|today|tomorrow|this\s+\w+|next\s+\w+|mon\w*|tue\w*|wed\w*|thu\w*|fri\w*|sat\w*|sun\w*|\d{4}-\d{2}-\d{2})|action items?|checklist|kaam)\b/i;
  const TASK_LOOSE = /\b(action plan|step-by-step plan|study plan|to-do list|today'?s plan|your (?:daily |weekly )?plan|plan my|schedule for)\b/i;
  const EXPLICIT_LIST_HEADER = /^(?:#+\s*)?(?:here\s+(?:is|are)\s+)?(?:your\s+)?(?:tasks?|to-?do(?:\s+list)?|action\s+(?:plan|items?)|checklist|habits?|routines?|daily routine and tasks)\b[^.!?\n]*:\s*$/im;
  const SAVE_VERB = /\b(save|add|keep|store|put|rakh|rakho|bana|banao)\b/i;
  const NOTE_TARGET = /\b(?:as|in|to|into)\s+(?:a\s+|my\s+|the\s+)?notes?\b|\bnotes?\s+(?:me|mein|main|m)\b|\bnote\s+(?:bana|banao)/i;
  const NOTE_DRAFT_REQUEST = /\b(?:make|write|create|draft|prepare|summarize|turn\s+(?:this|that|it)\s+into)\b[^.?!\n]{0,40}\b(?:notes?|summary|study\s+guide|cheat\s*sheet)\b/i;
  const NON_TASK_LABEL = /^(?:hook|body|headline|caption|opening|closing|intro|introduction|conclusion|cta|call to action|hashtags?|tone|tip|note|notes|example|examples|definition|meaning|overview|purpose|what it is|how it works|use case|use cases|feature|features|benefit|benefits|advantage|advantages|pros|cons|why|why it matters|profile tip|profile tips|suggestion|suggestions|advice|option\s*\d*|length|audience|target audience|subject|format|summary|key takeaway|takeaway|background|challenge|result|outcome|networking|job search|job hunting|job search & internships|content sharing|content sharing & learning|upskilling|upskilling & knowledge|recruiting|personal branding|career growth)(?:\s*[:\-–—]|\s*$)/i;
  const ACTION_VERB = /^(?:add|apply|ask|audit|book|build|buy|call|cancel|check|clean|close|complete|confirm|connect|contact|create|debug|define|deliver|deploy|design|do|download|draft|edit|email|enroll|establish|explore|file|fill|finalize|find|finish|fix|follow|format|gather|generate|get|go|implement|improve|install|interview|join|keep|launch|learn|list|log|make|measure|meet|message|migrate|monitor|move|network|note|open|optimize|order|organize|outline|pay|pick|plan|polish|post|practice|prepare|prioritize|publish|read|refactor|register|remove|renew|reply|research|reset|resolve|respond|review|revise|run|save|schedule|search|send|set|setup|share|ship|sign|solve|sort|start|study|submit|summarize|sync|take|test|track|try|update|upgrade|upload|verify|visit|watch|write)\b/i;
  const INCOMPLETE_MARKER = /_\(The reply (?:was cut off because the connection stalled|reached the maximum output length)[^)]*\)_\s*$/i;

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

  function isIncompleteReply(text, opts) {
    return Boolean((opts && opts.incomplete) || INCOMPLETE_MARKER.test(String(text || '')));
  }

  function isActionableItem(body, title, hasCheckbox, due, prio, explicitCue) {
    const cleanBody = stripMd(body);
    if (NON_TASK_LABEL.test(cleanBody) || NON_TASK_LABEL.test(title)) return false;
    if (hasCheckbox) return true;
    if (explicitCue) return true;
    if (due || prio !== 'medium') return true;
    return ACTION_VERB.test(title);
  }

  function isInformationalQuestion(userMsg) {
    const m = String(userMsg || '').trim();
    if (!m) return false;
    if (TASK_STRONG.test(m) || TASK_LOOSE.test(m) || HABIT_CUE.test(m) || /\b(?:plan|schedule|checklist)\b/i.test(m) || wantsAdd(m)) return false;
    if (/(?:^\s*(?:what|who|when|where|why|how|explain|define|describe|tell me about|overview of|difference between|hello\b)|what\s+(?:is|are|it\s+is|does)\b|\bexplain\b|\bin\s+detail\b|\bwith\s+examples?\b)/i.test(m)) {
      return true;
    }
    return wordCount(m) <= 3 && !VERB.test(m);
  }

  function hasExplicitActionSignal(reply, userMsg) {
    const raw = String(reply || '');
    const msg = String(userMsg || '');
    if (TASK_STRONG.test(msg) || TASK_LOOSE.test(msg) || HABIT_CUE.test(msg) || /\b(?:plan|schedule|checklist)\b/i.test(msg) || wantsAdd(msg)) return true;
    if (/^\s*(?:[-*•–]|\d{1,2}[.)])\s+\[[ xX]\]/m.test(raw)) return true;
    if (EXPLICIT_LIST_HEADER.test(raw)) return true;
    const firstNonEmpty = (raw.split(/\r?\n/).find((l) => l.trim()) || '').trim();
    if (/^(?:tasks?|to-?do(?:\s+list)?|action\s+(?:plan|items?)|daily routine and tasks|try these habits|do this)\s*:/i.test(firstNonEmpty)) return true;
    return false;
  }

  /* Pull clear actionable list items out of a reply as task drafts. Never calls the network. */
  function extract(text, opts) {
    opts = opts || {};
    const max = opts.max || 10;
    const raw = String(text || '');
    const incomplete = isIncompleteReply(raw, opts);
    if (opts.forActions && incomplete) return [];
    const userMsg = String(opts.userMsg || '');
    const userActionAsk = Boolean(opts.explicitCue) || TASK_STRONG.test(userMsg) || TASK_LOOSE.test(userMsg) || HABIT_CUE.test(userMsg) || /\b(?:plan|schedule|checklist)\b/i.test(userMsg);
    const hasHeaderOrCheckbox = EXPLICIT_LIST_HEADER.test(raw) || /^\s*(?:[-*•–]|\d{1,2}[.)])\s+\[[ xX]\]/m.test(raw) || /^(?:tasks?|to-?do(?:\s+list)?|action\s+(?:plan|items?)|daily routine and tasks|try these habits|do this)\s*:/im.test(raw);
    if (opts.forActions && isInformationalQuestion(userMsg) && !hasHeaderOrCheckbox) return [];
    const explicitCue = Boolean(opts.explicitCue) || userActionAsk || hasHeaderOrCheckbox;
    const out = [];
    const seen = new Set();
    let last = null;
    let inFence = false;
    const lines = raw.split(/\r?\n/);
    lines.forEach((line, idx) => {
      if (/^\s*```/.test(line)) { inFence = !inFence; last = null; return; }
      if (inFence || /^\s*>/.test(line)) { last = null; return; }
      const m = BULLET.exec(line);
      if (!m) { if (line.trim()) last = null; return; }
      const indent = m[1].replace(/\t/g, '  ').length;
      const hasCheckbox = m[2] !== undefined;
      const body = m[3];
      // If the reply was truncated and this is the final non-empty line without clean ending, skip the broken fragment.
      const isLastNonEmpty = lines.slice(idx + 1).every((l) => !l.trim() || INCOMPLETE_MARKER.test(l));
      if (incomplete && isLastNonEmpty && /[,(\[\-–—]$/.test(body.trim())) { last = null; return; }
      if (indent >= 2 && last) {                       // sub-bullet: extra detail for the item above
        const extra = stripMd(body);
        if (extra && last.description.length < 500) last.description = (last.description ? last.description + ' · ' : '') + extra;
        return;
      }
      if (/\?\s*$/.test(body) || /:\s*$/.test(body)) { last = null; return; }   // a question or a heading, not a task
      const { title, description } = splitTitle(body);
      if (title.length < 3) { last = null; return; }
      const priority = priorityOf(body);
      const due = dueOf(body, opts.today);
      if (!isActionableItem(body, title, hasCheckbox, due, priority, explicitCue)) { last = null; return; }
      const key = title.toLowerCase();
      if (seen.has(key)) { last = null; return; }
      seen.add(key);
      last = { title, description, priority, due };
      if (out.length < max) out.push(last); else last = null;
    });
    return out;
  }

  /* What is this reply? 'task' | 'habit' | 'both' | 'none'. `count` is how many list items it has. */
  function classify(reply, userMsg, count) {
    if (!count) return 'none';
    reply = String(reply || ''); userMsg = String(userMsg || '');
    if (isInformationalQuestion(userMsg) && !hasExplicitActionSignal(reply, userMsg)) return 'none';
    if (!hasExplicitActionSignal(reply, userMsg)) {
      const lead = reply.split(/\r?\n/).slice(0, 3).join(' ');
      if (/\b(?:is a|is an|refers to|networking platform|used for|overview|summary|meaning|definition)\b/i.test(lead)) return 'none';
    }
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
    return count >= 2 && (TASK_LOOSE.test(reply + ' ' + userMsg) || hasExplicitActionSignal(reply, userMsg)) ? 'task' : 'none';
  }
  function looksLikeTasks(reply, userMsg, opts) {
    const k = classify(reply, userMsg, extract(reply, Object.assign({ userMsg }, opts || {})).length);
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
    return { title, content: text.slice(0, 60000), tags: ['nexai'] };
  }
  const NOTE_MIN = 150;

  /* Decide what a short command means. Returns { kind: 'note'|'task'|'habit'|'ask', items? } or null. */
  function resolveIntent(message, replyText, opts) {
    if (!replyText) return null;
    if (wantsNote(message)) return { kind: 'note' };
    if (!wantsAdd(message)) return null;
    const items = extract(replyText, Object.assign({ userMsg: message, explicitCue: true }, opts || {}));
    if (!items.length) return null;
    const countMatch = /\b(\d{1,2})\b/.exec(String(message || ''));
    const limit = countMatch ? Math.max(1, Number(countMatch[1])) : items.length;
    const picked = items.slice(0, limit);
    let kind = explicitKind(message) || classify(replyText, '', picked.length);
    if (kind === 'none') kind = 'task';
    return { kind: kind === 'both' ? 'ask' : kind, items: picked };
  }

  function lastReply(box, assistantSel, bubbleSel) {
    if (!box) return '';
    const all = box.querySelectorAll(assistantSel);
    const lastMsg = all[all.length - 1];
    const bubble = lastMsg && lastMsg.querySelector(bubbleSel);
    return (bubble && bubble.dataset && bubble.dataset.nxReply) || '';
  }

  function lastReplyIncomplete(box, assistantSel, bubbleSel) {
    if (!box) return false;
    const all = box.querySelectorAll(assistantSel);
    const lastMsg = all[all.length - 1];
    const bubble = lastMsg && lastMsg.querySelector(bubbleSel);
    return Boolean(bubble && bubble.dataset && bubble.dataset.nxIncomplete === '1');
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
    s.textContent = '.nx-addtasks{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}.nx-addtasks button{display:inline-flex;align-items:center;gap:6px;min-height:36px;padding:0 14px;border:0;border-radius:999px;cursor:pointer;font:600 13px/1 inherit;font-family:inherit;background:var(--accent-fill,var(--accent-primary,#4f8cff));color:var(--on-accent,var(--text-on-accent,#fff))}.nx-addtasks button.nx-sec{background:transparent;color:inherit;border:1px solid rgba(128,128,128,.45)}.nx-addtasks button:disabled{opacity:.75;cursor:default}.nx-incomplete-bar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;margin-top:10px;padding:8px 12px;border-radius:12px;border:1px solid rgba(250,160,0,.45);background:rgba(250,160,0,.1);font-size:12.5px;line-height:1.4}.nx-incomplete-bar button{min-height:30px;padding:0 12px;border-radius:999px;border:0;cursor:pointer;font:600 12px/1 inherit;background:var(--accent-fill,var(--accent-primary,#4f8cff));color:var(--on-accent,var(--text-on-accent,#fff))}';
    document.head.appendChild(s);
  }
  function makeButton(label, secondary, run, ctx, kind) {
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

  function renderIncompleteBar(bubble, opts) {
    if (!bubble || !opts || !opts.incomplete) return;
    ensureStyle();
    bubble.querySelectorAll('.nx-incomplete-bar').forEach((n) => n.remove());
    const bar = document.createElement('div');
    bar.className = 'nx-incomplete-bar';
    const reasonMap = {
      MAX_TOKENS: 'Response reached the output limit before finishing.',
      STREAM_STALLED: 'Connection stalled before the response finished.',
      STREAM_INTERRUPTED: 'Stream was interrupted — partial answer saved.',
      CONTINUATION_FAILED: 'Auto-continuation was interrupted — partial answer saved.',
      SAFETY: 'Response stopped early due to safety guidelines.',
      RECITATION: 'Response stopped early due to content restrictions.',
    };
    const msg = document.createElement('span');
    msg.textContent = '\u26A0 Incomplete response: ' + (reasonMap[opts.incompleteReason] || 'The response did not finish completely.');
    bar.appendChild(msg);
    if (typeof opts.onContinue === 'function' && !['SAFETY', 'RECITATION'].includes(opts.incompleteReason)) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = 'Continue';
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        btn.disabled = true;
        opts.onContinue();
      });
      bar.appendChild(btn);
    }
    bubble.appendChild(bar);
  }

  /* Remember the reply text on its bubble and add the one-tap buttons it deserves:
     Add N tasks / Add N habits (only for complete, genuinely actionable lists) and Save as note only when explicitly drafted as a note. */
  function attach(bubble, replyText, userMsg, ctx) {
    if (!bubble || !bubble.dataset) return;
    bubble.dataset.nxReply = String(replyText || '');
    const incomplete = isIncompleteReply(replyText, ctx) || Boolean(bubble.dataset && bubble.dataset.nxIncomplete === '1');
    bubble.dataset.nxIncomplete = incomplete ? '1' : '0';
    const incompleteReason = (ctx && ctx.incompleteReason) || (bubble.dataset && bubble.dataset.nxIncompleteReason) || '';
    bubble.dataset.nxIncompleteReason = incomplete ? String(incompleteReason) : '';
    bubble.querySelectorAll('.nx-addtasks').forEach((n) => n.remove());
    bubble.querySelectorAll('.nx-incomplete-bar').forEach((n) => n.remove());
    if (incomplete) {
      renderIncompleteBar(bubble, { incomplete: true, incompleteReason, onContinue: ctx && ctx.onContinue });
      return;
    }
    const items = extract(replyText, { today: ctx.today(), userMsg, incomplete: false, forActions: true });
    const kind = classify(replyText, userMsg, items.length);
    const buttons = [];
    const add = (k, label, secondary) => buttons.push(makeButton(label, secondary, () => runKind(k, items, replyText, ctx), ctx, k));
    if (kind === 'task' || kind === 'both') add('task', `＋ ${kind === 'both' ? 'As' : 'Add'} ${plural(items.length, 'task')}`);
    if (kind === 'habit' || kind === 'both') add('habit', `＋ ${kind === 'both' ? 'As' : 'Add'} ${plural(items.length, 'habit')}`);
    if (NOTE_DRAFT_REQUEST.test(String(userMsg || '')) && String(replyText || '').trim().length >= 80) {
      add('note', 'Save as note', true);
    }
    if (buttons.length) buildBar(bubble, buttons);
  }

  /* True when the message is a short "add these" / "save as note" command and the last reply can be used. */
  function canDirectAdd(message, replyText, opts) { return !!resolveIntent(message, replyText, opts); }

  /* Handle that command here, without NexAI. Returns true when handled (caller must not send it on). */
  function tryDirectAdd(message, replyText, ctx) {
    const incomplete = isIncompleteReply(replyText, ctx);
    if (incomplete && (wantsNote(message) || wantsAdd(message))) {
      const msg = 'That response is incomplete, so I did not create actions or notes from it yet. Say "continue" or click Continue to finish it first.';
      if (ctx.toast) ctx.toast(msg);
      if (ctx.say) ctx.say(msg);
      return true;
    }
    const intent = resolveIntent(message, replyText, { today: ctx && ctx.today ? ctx.today() : '', incomplete });
    if (!intent) return false;
    if (intent.kind === 'note' && incomplete) {
      const msg = 'That response is incomplete, so I did not save it as a note yet. Say "continue" or click Continue to finish it first.';
      if (ctx.toast) ctx.toast(msg);
      if (ctx.say) ctx.say(msg);
      return true;
    }
    if (intent.kind === 'ask') {
      const el = ctx.say('This looks like it could be tasks or habits. Where should I add it?');
      if (el) buildBar(el, [
        makeButton(`＋ As ${plural(intent.items.length, 'task')}`, false, () => ctx.addTasks(intent.items), ctx, 'task'),
        makeButton(`＋ As ${plural(intent.items.length, 'habit')}`, false, () => ctx.addHabits(intent.items), ctx, 'habit')
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

  const api = {
    extract, classify, looksLikeTasks, wantsAdd, wantsNote, noteDraft,
    resolveIntent, canDirectAdd, lastReply, lastReplyIncomplete, tryDirectAdd, attach,
    isIncompleteReply, renderIncompleteBar,
  };
  root.NexChatTasks = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
