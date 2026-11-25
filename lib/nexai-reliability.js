'use strict';
// NexOS 4.5.1 — NexAI stream reliability, automatic MAX_TOKENS continuation, overlap deduplication,
// and honest incomplete-response detection.

const STALLED_REPLY_NOTE = '\n\n_(The reply was cut off because the connection stalled. Say "continue" to get the rest.)_';
const TRUNCATED_REPLY_NOTE = '\n\n_(The reply reached the maximum output length and could not finish automatically. Say "continue" to get the rest.)_';
const CONTINUATION_PROMPT = [
  'Continue seamlessly from the exact point where your previous message stopped.',
  'Do NOT repeat, summarize, or restart any already-written headings, lists, or sentences.',
  'Begin immediately with the next word or character.',
].join(' ');

function stripIncompleteBanner(text) {
  let out = String(text || '');
  while (true) {
    const next = out
      .replace(/\n*_\(The reply was cut off because the connection stalled\.[^)]*\)_\s*$/i, '')
      .replace(/\n*_\(The reply reached the maximum output length[^)]*\)_\s*$/i, '')
      .trimEnd();
    if (next === out) break;
    out = next;
  }
  return out;
}

function isContinuationMessage(text) {
  const t = String(text || '').trim().toLowerCase().replace(/[.!?,。！？]+$/g, '').replace(/\s+/g, ' ');
  if (!t || t.length > 80) return false;
  return /^(?:continue(?:\s+(?:please|it|this|writing|answering|from\s+where\s+you\s+left\s+off|from\s+there))?|please\s+continue|go\s+on|keep\s+going|carry\s+on|finish(?:\s+(?:it|this|your\s+(?:answer|response|reply)))?|complete(?:\s+(?:it|this|your\s+(?:answer|response|reply)))?|(?:send|give|show)\s+(?:the\s+)?rest(?:\s+of\s+(?:it|the\s+(?:answer|response|reply)))?|rest\s+of\s+(?:it|the\s+answer)|aage(?:\s+(?:batao|bataiye|likho|boliye|karo))?|poora\s+karo|pura\s+karo|baaki(?:\s+(?:batao|likho))?|baki(?:\s+(?:batao|likho))?)$/.test(t);
}

function isBugOrTruncatedReport(text) {
  const t = String(text || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!t || t.length > 220) return false;
  return /\b(?:it'?s\s+(?:a\s+)?bug|its\s+(?:a\s+)?bug|report\s+(?:a\s+)?bug|incomplete|cut\s*off|cutoff|truncat\w*|half\s+(?:answer|reply|response)|unfinished|didn'?t\s+finish|did\s+not\s+finish|why\s+did\s+(?:it|you)\s+stop|ruk\s+gaya|adhoor?a|adhura|not\s+complete)\b/.test(t);
}

function normalizeWs(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

function trimContinuationOverlap(existing, incoming) {
  const base = stripIncompleteBanner(existing);
  let next = String(incoming || '');
  if (!base || !next) return { text: next, trimmedChars: 0 };

  const originalLen = next.length;

  // Strip polite continuation preambles that break seamless stitching.
  next = next.replace(/^(?:sure,?\s*)?(?:here(?:'s| is) the rest|continuing(?: seamlessly)?(?: from where (?:we|i) left off)?)\s*[:\-–—]\s*\n+/i, '');

  // 1. Exact suffix-prefix overlap (handles repeated trailing lines/sentences or mid-word restarts).
  const tail = base.slice(-700);
  const maxCheck = Math.min(tail.length, next.length);
  let overlapLen = 0;
  for (let len = maxCheck; len >= 8; len--) {
    const suffix = tail.slice(-len);
    const prefix = next.slice(0, len);
    if (suffix === prefix) {
      const isMidWordRestart = /[A-Za-z0-9]$/.test(base) && /[A-Za-z0-9]/.test(next[len] || '');
      const hasEnoughTokens = len >= 14 || (len >= 10 && /\s/.test(suffix));
      if (hasEnoughTokens || (isMidWordRestart && len >= 8)) {
        overlapLen = len;
        break;
      }
    }
  }
  if (overlapLen > 0) {
    next = next.slice(overlapLen);
  } else {
    // Try trimming leading whitespace on incoming and checking against trimmed tail.
    const trimmedBase = base.trimEnd();
    const trimmedNext = next.replace(/^[ \t]+/, '');
    const tTail = trimmedBase.slice(-700);
    const tMax = Math.min(tTail.length, trimmedNext.length);
    for (let len = tMax; len >= 14; len--) {
      if (tTail.slice(-len) === trimmedNext.slice(0, len)) {
        next = trimmedNext.slice(len);
        break;
      }
    }
  }

  // 2. Repeated leading paragraph / heading guard (check up to 3 leading blocks against recent paragraphs).
  const recentParagraphs = new Set(
    base.split(/\n{2,}/).slice(-5).map(normalizeWs).filter((p) => p.length >= 16)
  );
  for (let i = 0; i < 3; i++) {
    const leadMatch = /^\s*([^\n]+(?:\n(?!\n)[^\n]+)*)(\n{2,}|$)/.exec(next);
    if (!leadMatch) break;
    const normLead = normalizeWs(leadMatch[1]);
    if (normLead.length >= 16 && recentParagraphs.has(normLead)) {
      next = next.slice(leadMatch[0].length);
      continue;
    }
    break;
  }

  // 3. Repeated single leading line (e.g. a repeated markdown heading or bullet).
  const recentLines = new Set(
    base.split(/\r?\n/).slice(-8).map(normalizeWs).filter((l) => l.length >= 16)
  );
  for (let i = 0; i < 2; i++) {
    const lineMatch = /^\s*([^\r\n]+)(\r?\n|$)/.exec(next);
    if (!lineMatch) break;
    const normLine = normalizeWs(lineMatch[1]);
    if (normLine.length >= 16 && recentLines.has(normLine)) {
      next = next.slice(lineMatch[0].length);
      continue;
    }
    break;
  }

  // Add a space only if base ended with a word character and next begins with a word character and original had space/newline separation?
  // Note: if base ended mid-word (no trailing space) and next trimmed whitespace, don't inject space unless next originally started with whitespace.
  return { text: next, trimmedChars: Math.max(0, originalLen - next.length) };
}

function createStreamOverlapFilter(existingText, onEmit, opts = {}) {
  const bufferLimit = opts.bufferLimit || 320;
  let buffer = '';
  let released = false;

  const release = () => {
    if (released) return;
    released = true;
    const { text } = trimContinuationOverlap(existingText, buffer);
    buffer = '';
    if (text) onEmit(text);
  };

  return {
    push(delta) {
      if (!delta) return;
      if (released) {
        onEmit(delta);
        return;
      }
      buffer += delta;
      if (buffer.length >= bufferLimit || (buffer.length >= 80 && /\n\n/.test(buffer))) {
        release();
      }
    },
    flush() {
      if (!released) release();
    },
  };
}

function buildContinuationContents(baseContents, partialAnswer) {
  const clean = stripIncompleteBanner(partialAnswer);
  if (!clean) return baseContents;
  return [
    ...baseContents,
    { role: 'model', parts: [{ text: clean }] },
    { role: 'user', parts: [{ text: CONTINUATION_PROMPT }] },
  ];
}

function isNonStopIncomplete(finishReason) {
  return Boolean(finishReason && finishReason !== 'STOP');
}

function looksSyntacticallyTruncated(text) {
  const raw = stripIncompleteBanner(text).replace(/[ \t]+$/g, '');
  if (!raw) return false;
  // 1. Unclosed fenced code block
  const fences = raw.match(/(?:^|\n)[ \t]*```/g);
  if (fences && fences.length % 2 === 1) return true;
  const lastLine = (raw.split(/\r?\n/).pop() || '').trimEnd();
  if (!lastLine) return false;
  // 2. Ends on an empty or dangling Markdown bullet/heading/emphasis marker (e.g., "- **", "1. **", "- ")
  if (/^(?:[-*•–]|\d{1,2}[.)])\s*(?:\*{1,3}|_{1,2})?$/.test(lastLine)) return true;
  if (/^#{1,6}\s*$/.test(lastLine)) return true;
  if (/\*\*[A-Za-z0-9][^*\n]{0,60}$/.test(lastLine) && ((lastLine.match(/\*\*/g) || []).length % 2 === 1)) return true;
  // 3. Ends inside an unclosed opening paren/bracket with 0-24 trailing token chars (e.g., "(J", "like (", "(e.g")
  if (/[(\[]$/.test(lastLine)) return true;
  if (/\([A-Za-z0-9.,'"_ -]{1,24}$/.test(lastLine)) return true;
  // 4. Ends on trailing incomplete connector punctuation
  if (/(?:,|;|—|–)\s*$/.test(lastLine) && raw.length >= 20) return true;
  return false;
}

const DEICTIC_FOLLOWUP_RE = /^(?:what\s+(?:is\s+it|it\s+is|is\s+that|is\s+this|are\s+they|does\s+it\s+(?:do|mean))|what'?s\s+(?:it|that|this)|explain(?:\s+(?:it|this|that|more|please|in\s+detail))?|in\s+detail|more\s+(?:details?|info|examples?)|tell\s+me\s+more|go\s+deeper|elaborate|why|how(?:\s+does\s+(?:it|that|this)\s+work)?|examples?)\s*[?!.]*$/i;

function isDeicticFollowUp(text) {
  const t = String(text || '').trim().replace(/\s+/g, ' ');
  return Boolean(t && t.length <= 64 && DEICTIC_FOLLOWUP_RE.test(t));
}

function isBareTopicPrompt(text) {
  const t = String(text || '').trim().replace(/[?!.]+$/g, '').replace(/\s+/g, ' ');
  if (!t || t.length > 40) return false;
  const words = t.split(' ');
  return words.length <= 3 && !/^(?:hi|hey|hello|thanks|thank you|ok|okay|yes|no|continue|help)$/i.test(t);
}

function sanitizeHistoryForModel(history) {
  return (Array.isArray(history) ? history : []).map((m) => ({
    role: m.role,
    content: m.role === 'assistant' ? stripIncompleteBanner(m.content) : String(m.content || ''),
  })).filter((m) => m.content.trim().length > 0);
}

function extractConversationSubjectHint(history) {
  const items = sanitizeHistoryForModel(history);
  for (let i = items.length - 1; i >= 0; i--) {
    const m = items[i];
    if (m.role === 'user' && !isDeicticFollowUp(m.content) && !isContinuationMessage(m.content)) {
      return m.content.slice(0, 160);
    }
  }
  const lastModel = [...items].reverse().find((m) => m.role === 'assistant');
  return lastModel ? lastModel.content.split(/\r?\n/)[0].slice(0, 160) : '';
}

function mergeSegmentTimings(target, seg) {
  target.retryCount = (target.retryCount || 0) + (seg.retryCount || 0);
  target.firstTokenTimeouts = (target.firstTokenTimeouts || 0) + (seg.firstTokenTimeouts || 0);
  target.streamIdleTimeouts = (target.streamIdleTimeouts || 0) + (seg.streamIdleTimeouts || 0);
  if (seg.model) target.model = seg.model;
  if (seg.upstreamStatus) target.upstreamStatus = seg.upstreamStatus;
  if (seg.lastAttemptMs != null) target.lastAttemptMs = seg.lastAttemptMs;
  if (target.firstTokenMs == null && seg.firstTokenMs != null) target.firstTokenMs = seg.firstTokenMs;
}

async function streamWithAutoContinuation({
  askStream,
  system,
  contents,
  timeoutMs = 45000,
  firstTokenTimeoutMs,
  maxAttempts = 2,
  maxContinuations = 3,
  maxChars = 55000,
  continueFrom = '',
  onText,
  timings = {},
}) {
  let answer = '';
  const initialFilter = continueFrom
    ? createStreamOverlapFilter(continueFrom, (delta) => { answer += delta; onText(delta); })
    : null;

  await askStream({
    system,
    contents,
    timeoutMs,
    firstTokenTimeoutMs,
    maxAttempts,
    timings,
    onText: (delta) => {
      if (initialFilter) initialFilter.push(delta);
      else { answer += delta; onText(delta); }
    },
  });
  if (initialFilter) initialFilter.flush();

  const nonRecoverable = new Set(['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII']);
  const missingFinish = !timings.finishReason && !timings.sawFinishReason;
  const isTruncatedStart = () => (
    !nonRecoverable.has(timings.finishReason)
    && (timings.finishReason === 'MAX_TOKENS' || timings.partialReply || missingFinish || looksSyntacticallyTruncated(answer))
  );

  let continuations = 0;
  while (continuations < maxContinuations && answer.length < maxChars && (
    continuations === 0 ? isTruncatedStart() : (
      !nonRecoverable.has(timings.finishReason)
      && (timings.finishReason === 'MAX_TOKENS' || timings.partialReply || timings.finishReason === 'STREAM_INTERRUPTED' || looksSyntacticallyTruncated(answer))
    )
  )) {
    continuations++;
    const hadPartialOnPrior = Boolean(timings.partialReply);
    const segTimings = {};
    let added = '';
    const filter = createStreamOverlapFilter(answer, (delta) => {
      added += delta;
      answer += delta;
      onText(delta);
    });

    try {
      await askStream({
        system,
        contents: buildContinuationContents(contents, answer),
        timeoutMs,
        firstTokenTimeoutMs,
        maxAttempts: 1,
        timings: segTimings,
        onText: (delta) => filter.push(delta),
      });
      filter.flush();
    } catch (err) {
      filter.flush();
      mergeSegmentTimings(timings, segTimings);
      timings.continuations = continuations;
      timings.autoContinued = true;
      timings.incomplete = true;
      timings.incompleteReason = hadPartialOnPrior ? 'STREAM_STALLED' : 'CONTINUATION_FAILED';
      timings.partialReply = true;
      const note = hadPartialOnPrior ? STALLED_REPLY_NOTE : TRUNCATED_REPLY_NOTE;
      if (answer.trim() && !answer.endsWith(note)) { answer += note; onText(note); }
      return {
        text: answer.trim() || "I couldn't produce an answer for that.",
        incomplete: true,
        incompleteReason: timings.incompleteReason,
        finishReason: timings.finishReason || 'MAX_TOKENS',
        continuations,
      };
    }

    mergeSegmentTimings(timings, segTimings);
    timings.continuations = continuations;
    timings.autoContinued = true;

    if (segTimings.partialReply) {
      timings.partialReply = true;
      timings.incomplete = true;
      timings.incompleteReason = 'STREAM_STALLED';
      if (answer.trim() && !answer.endsWith(STALLED_REPLY_NOTE)) {
        answer += STALLED_REPLY_NOTE;
        onText(STALLED_REPLY_NOTE);
      }
      return {
        text: answer.trim() || "I couldn't produce an answer for that.",
        incomplete: true,
        incompleteReason: 'STREAM_STALLED',
        finishReason: segTimings.finishReason || 'STREAM_STALLED',
        continuations,
      };
    }

    // Recovery attempt succeeded cleanly -> clear prior transient partialReply flag!
    timings.partialReply = false;
    timings.finishReason = segTimings.finishReason || (segTimings.sawFinishReason === false ? 'STREAM_INTERRUPTED' : 'STOP');
    timings.sawFinishReason = segTimings.sawFinishReason;
    if (added.trim().length < 12) {
      // Guard against empty or completely repetitive continuation loops.
      if (timings.finishReason === 'MAX_TOKENS' || looksSyntacticallyTruncated(answer) || !added.trim()) {
        timings.incomplete = true;
        timings.incompleteReason = hadPartialOnPrior ? 'STREAM_STALLED' : (timings.finishReason !== 'STOP' ? timings.finishReason : 'TRUNCATED_MID_RESPONSE');
        break;
      }
    }
  }

  const stillSyntacticallyCut = !nonRecoverable.has(timings.finishReason) && looksSyntacticallyTruncated(answer);
  const missingTerminalFinish = !timings.finishReason && timings.sawFinishReason === false;
  if (timings.finishReason === 'MAX_TOKENS') {
    timings.incomplete = true;
    timings.incompleteReason = 'MAX_TOKENS';
    if (!answer.endsWith(TRUNCATED_REPLY_NOTE)) {
      answer += TRUNCATED_REPLY_NOTE;
      onText(TRUNCATED_REPLY_NOTE);
    }
  } else if (timings.partialReply) {
    timings.incomplete = true;
    timings.incompleteReason = 'STREAM_STALLED';
    if (answer.trim() && !answer.endsWith(STALLED_REPLY_NOTE)) {
      answer += STALLED_REPLY_NOTE;
      onText(STALLED_REPLY_NOTE);
    }
  } else if (isNonStopIncomplete(timings.finishReason) || missingTerminalFinish) {
    timings.incomplete = true;
    timings.incompleteReason = timings.finishReason || 'STREAM_INTERRUPTED';
    if (!nonRecoverable.has(timings.finishReason) && !answer.endsWith(TRUNCATED_REPLY_NOTE)) {
      answer += TRUNCATED_REPLY_NOTE;
      onText(TRUNCATED_REPLY_NOTE);
    }
  } else if (stillSyntacticallyCut) {
    timings.incomplete = true;
    timings.incompleteReason = 'TRUNCATED_MID_RESPONSE';
    if (!answer.endsWith(TRUNCATED_REPLY_NOTE)) {
      answer += TRUNCATED_REPLY_NOTE;
      onText(TRUNCATED_REPLY_NOTE);
    }
  } else {
    timings.incomplete = false;
    timings.incompleteReason = null;
  }

  return {
    text: answer.trim() || "I couldn't produce an answer for that.",
    incomplete: Boolean(timings.incomplete),
    incompleteReason: timings.incompleteReason || null,
    finishReason: timings.finishReason || 'STOP',
    continuations,
  };
}

async function askWithAutoContinuation({
  askOnce,
  system,
  contents,
  timeoutMs = 45000,
  maxAttempts = 2,
  maxContinuations = 2,
  maxChars = 55000,
}) {
  const first = await askOnce({ system, contents, timeoutMs, maxAttempts });
  let answer = String(first && first.text != null ? first.text : first || '');
  let finishReason = (first && first.finishReason) || 'STOP';
  let continuations = 0;

  while ((finishReason === 'MAX_TOKENS' || (!['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII'].includes(finishReason) && looksSyntacticallyTruncated(answer))) && continuations < maxContinuations && answer.length < maxChars) {
    continuations++;
    let next;
    try {
      next = await askOnce({
        system,
        contents: buildContinuationContents(contents, answer),
        timeoutMs,
        maxAttempts: 1,
      });
    } catch (_) {
      return {
        text: answer.trim() || "I couldn't produce an answer for that.",
        incomplete: true,
        incompleteReason: 'CONTINUATION_FAILED',
        finishReason,
        continuations,
      };
    }
    const rawText = String(next && next.text != null ? next.text : next || '');
    const { text: deduped } = trimContinuationOverlap(answer, rawText);
    if (!deduped.trim() || deduped.trim().length < 12) {
      finishReason = (next && next.finishReason) || finishReason;
      if (finishReason === 'MAX_TOKENS' || looksSyntacticallyTruncated(answer)) break;
    }
    answer += deduped;
    finishReason = (next && next.finishReason) || 'STOP';
  }

  const syntacticallyTruncated = !['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII'].includes(finishReason) && looksSyntacticallyTruncated(answer);
  const incomplete = isNonStopIncomplete(finishReason) || syntacticallyTruncated;
  const incompleteReason = isNonStopIncomplete(finishReason) ? finishReason : (syntacticallyTruncated ? 'TRUNCATED_MID_RESPONSE' : null);
  return {
    text: answer.trim() || "I couldn't produce an answer for that.",
    incomplete,
    incompleteReason,
    finishReason,
    continuations,
  };
}

module.exports = {
  STALLED_REPLY_NOTE,
  TRUNCATED_REPLY_NOTE,
  CONTINUATION_PROMPT,
  stripIncompleteBanner,
  isContinuationMessage,
  isBugOrTruncatedReport,
  isDeicticFollowUp,
  isBareTopicPrompt,
  sanitizeHistoryForModel,
  extractConversationSubjectHint,
  looksSyntacticallyTruncated,
  trimContinuationOverlap,
  createStreamOverlapFilter,
  buildContinuationContents,
  isNonStopIncomplete,
  streamWithAutoContinuation,
  askWithAutoContinuation,
};
