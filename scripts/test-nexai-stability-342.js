#!/usr/bin/env node
'use strict';
// NexOS 3.4.2: first-token timeout, fallback model, auth cache and bounded chat read.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));

assert.equal(pkg.version, '4.2.0');
assert.equal(lock.version, '4.2.0');
assert.equal(lock.packages[''].version, '4.2.0');

// Source checks
assert.match(server, /GEMINI_FIRST_TOKEN_TIMEOUT_MS/, 'a first-token timeout must exist');
assert.match(server, /\{ title: 1, messages: \{ \$slice: -CONTEXT_MESSAGES \} \}/, 'existing chats must read only recent messages unless recall mode is on');
assert.match(server, /invalidateAuthCache\(user\._id\)/, 'sign-in must clear the auth cache');
assert.match(server, /invalidateAuthCache\(req\.userId\)/, 'rename and deletion must clear the auth cache');
assert.match(server, /readAuthCache\(id\)/, 'requireAuth must use the short auth cache');
assert.match(server, /sessionsValidAfter && issuedAt < user\.sessionsValidAfter/, 'old cookies must still be rejected');
assert.match(server, /Never say 'you are my creator'/, 'creator identity safeguards must remain intact');

// Behaviour: load askGeminiStream with a fake Gemini.
const startIdx = server.indexOf('const GEMINI_FIRST_TOKEN_TIMEOUT_MS');
const endIdx = server.indexOf('function writeChatEvent(');
assert.ok(startIdx > 0 && endIdx > startIdx, 'askGeminiStream block must be found');
const block = server.slice(startIdx, endIdx);

function sse(text) {
  const body = `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] })}\n\n`;
  const bytes = new TextEncoder().encode(body);
  return new Response(new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } }), { status: 200 });
}
function hang(signal) {
  return new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  });
}

function load(fetchImpl) {
  class AIError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }
  const ctx = {
    fetch: fetchImpl, AbortController, setTimeout, clearTimeout, TextDecoder, Math, Number, Date, JSON, Promise,
    process: { env: { GEMINI_API_KEY: 'test-key' } },
    AIError,
    aiErrorFor: (status) => new AIError(502, 'AI_UPSTREAM', 'upstream ' + status),
    geminiStreamUrl: (model) => 'https://example.test/' + model,
    GEMINI_MODEL: 'primary', GEMINI_FALLBACK_MODEL: 'fallback',
    NEXAI_IDENTITY: 'identity',
    sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 5))),
  };
  vm.createContext(ctx);
  vm.runInContext(block + '\nthis.askGeminiStream = askGeminiStream;', ctx);
  return ctx.askGeminiStream;
}

(async () => {
  // 1) First attempt hangs; the retry answers quickly. Must not wait for the full timeout.
  {
    const calls = [];
    const ask = load((url, opts) => {
      calls.push(url);
      return calls.length === 1 ? hang(opts.signal) : Promise.resolve(sse('hello'));
    });
    const timings = {}; const out = [];
    const t0 = Date.now();
    const answer = await ask({ system: '', contents: [], timeoutMs: 5000, firstTokenTimeoutMs: 80, onText: (d) => out.push(d), timings });
    assert.equal(answer, 'hello');
    assert.deepEqual(out, ['hello'], 'text must be delivered exactly once');
    assert.equal(timings.retryCount, 1);
    assert.equal(timings.firstTokenTimeouts, 1);
    assert.equal(calls.length, 2);
    assert.ok(Date.now() - t0 < 1500, 'a stuck first attempt must not wait for the long timeout');
  }
  // 2) Both primary attempts hang; the fallback model answers.
  {
    const calls = [];
    const ask = load((url, opts) => {
      calls.push(url);
      return url.endsWith('/primary') ? hang(opts.signal) : Promise.resolve(sse('from fallback'));
    });
    const timings = {};
    const answer = await ask({ system: '', contents: [], timeoutMs: 5000, firstTokenTimeoutMs: 60, onText() {}, timings });
    assert.equal(answer, 'from fallback');
    assert.equal(timings.model, 'fallback');
    assert.equal(calls.filter((u) => u.endsWith('/primary')).length, 2);
    assert.equal(timings.firstTokenTimeouts, 2);
  }
  // 3) Everything hangs: a clear error is thrown (no endless wait).
  {
    const ask = load((url, opts) => hang(opts.signal));
    await assert.rejects(
      ask({ system: '', contents: [], timeoutMs: 5000, firstTokenTimeoutMs: 40, onText() {}, timings: {} }),
      (err) => err.code === 'AI_NETWORK'
    );
  }
  // 4) Normal request: no retries, no timeouts recorded.
  {
    const ask = load(() => Promise.resolve(sse('ok')));
    const timings = {};
    assert.equal(await ask({ system: '', contents: [], onText() {}, timings }), 'ok');
    assert.equal(timings.retryCount, 0);
    assert.equal(timings.firstTokenTimeouts ?? 0, 0);
    assert.ok(typeof timings.firstTokenMs === 'number');
  }
  console.log('NexOS 3.4.2 NexAI stability checks passed.');
})().catch((err) => { console.error(err); process.exit(1); });
