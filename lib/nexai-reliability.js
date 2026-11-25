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
  return String(text || '')
    .replace(/\n*_\(The reply was cut off because the connection stalled\.[^)]*\)_\s*$/i, '')
    .replace(/\n*_\(The reply reached the maximum output length[^)]*\)_\s*$/i, '')
    .trimEnd();
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

  if (timings.partialReply) {
    timings.incomplete = true;
    timings.incompleteReason = 'STREAM_STALLED';
    return {
      text: answer.trim() || "I couldn't produce an answer for that.",
      incomplete: true,
      incompleteReason: 'STREAM_STALLED',
      finishReason: timings.finishReason || 'STREAM_STALLED',
      continuations: 0,
    };
  }

  let continuations = 0;
  while (timings.finishReason === 'MAX_TOKENS' && continuations < maxContinuations && answer.length < maxChars) {
    continuations++;
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
      timings.incompleteReason = 'CONTINUATION_FAILED';
      timings.partialReply = true;
      return {
        text: answer.trim() || "I couldn't produce an answer for that.",
        incomplete: true,
        incompleteReason: 'CONTINUATION_FAILED',
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
      return {
        text: answer.trim() || "I couldn't produce an answer for that.",
        incomplete: true,
        incompleteReason: 'STREAM_STALLED',
        finishReason: segTimings.finishReason || 'STREAM_STALLED',
        continuations,
      };
    }

    timings.finishReason = segTimings.finishReason || 'STOP';
    if (added.trim().length < 12) {
      // Guard against empty or completely repetitive continuation loops.
      if (timings.finishReason === 'MAX_TOKENS' || !added.trim()) {
        timings.incomplete = true;
        timings.incompleteReason = 'MAX_TOKENS';
        break;
      }
    }
  }

  if (timings.finishReason === 'MAX_TOKENS') {
    timings.incomplete = true;
    timings.incompleteReason = 'MAX_TOKENS';
    if (!answer.endsWith(TRUNCATED_REPLY_NOTE)) {
      answer += TRUNCATED_REPLY_NOTE;
      onText(TRUNCATED_REPLY_NOTE);
    }
  } else if (isNonStopIncomplete(timings.finishReason)) {
    timings.incomplete = true;
    timings.incompleteReason = timings.finishReason;
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

  while (finishReason === 'MAX_TOKENS' && continuations < maxContinuations && answer.length < maxChars) {
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
      if (finishReason === 'MAX_TOKENS') break;
    }
    answer += deduped;
    finishReason = (next && next.finishReason) || 'STOP';
  }

  const incomplete = isNonStopIncomplete(finishReason);
  return {
    text: answer.trim() || "I couldn't produce an answer for that.",
    incomplete,
    incompleteReason: incomplete ? finishReason : null,
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
  trimContinuationOverlap,
  createStreamOverlapFilter,
  buildContinuationContents,
  isNonStopIncomplete,
  streamWithAutoContinuation,
  askWithAutoContinuation,
};
