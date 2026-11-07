// Checks NexOS 3.3.0 file upload for NexAI: server-side validation, route wiring, Classic and Enterprise UI.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const { parseAttachments, safeName, AttachmentError, MAX_ATTACHMENTS, MAX_TOTAL_BYTES, MAX_TEXT_CHARS } = require('../lib/attachments');

const b64 = (buf) => Buffer.from(buf).toString('base64');
const pdf = b64(Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('x'.repeat(50))]));
const png = b64(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('data')]));
const jpg = b64(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]));
const webp = b64(Buffer.concat([Buffer.from('RIFF'), Buffer.from([1, 2, 3, 4]), Buffer.from('WEBPVP8 ')]));
const fails = (fn, status) => { try { fn(); } catch (e) { assert.ok(e instanceof AttachmentError, 'should throw AttachmentError'); if (status) assert.strictEqual(e.status, status); return; } assert.fail('expected an AttachmentError'); };

// No attachments: nothing added.
assert.deepStrictEqual(parseAttachments(undefined), { parts: [], names: [] });
assert.deepStrictEqual(parseAttachments(null), { parts: [], names: [] });

// Real content is accepted whatever the name says.
let r = parseAttachments([{ name: 'hw.pdf', data: pdf }, { name: 'photo.png', data: png }, { name: 'p.jpg', data: jpg }]);
assert.deepStrictEqual(r.names, ['hw.pdf', 'photo.png', 'p.jpg']);
assert.strictEqual(r.parts.filter((p) => p.inlineData).length, 3);
assert.strictEqual(r.parts.find((p) => p.inlineData && p.inlineData.mimeType === 'application/pdf').inlineData.data, pdf);
assert.strictEqual(parseAttachments([{ name: 'x.bin', data: webp }]).parts[1].inlineData.mimeType, 'image/webp');

// Text and code files are inlined as text; truncated when huge.
r = parseAttachments([{ name: 'notes.txt', data: b64('hello world') }]);
assert.ok(r.parts[0].text.includes('notes.txt') && r.parts[1].text === 'hello world');
r = parseAttachments([{ name: 'big.txt', data: b64('a'.repeat(MAX_TEXT_CHARS + 10)) }]);
assert.ok(r.parts[1].text.endsWith('[File truncated]'));

// Rejections.
fails(() => parseAttachments('nope'), 400);
fails(() => parseAttachments(Array.from({ length: MAX_ATTACHMENTS + 1 }, () => ({ name: 'a.txt', data: b64('x') }))), 400);
fails(() => parseAttachments([{ name: 'a.txt' }]), 400);
fails(() => parseAttachments([{ name: 'a.txt', data: '***not base64***' }]), 400);
fails(() => parseAttachments([{ name: 'fake.pdf', data: b64('this is not a pdf') }]), 415);
fails(() => parseAttachments([{ name: 'tool.exe', data: b64(Buffer.from([0x4d, 0x5a, 0, 0])) }]), 415);
fails(() => parseAttachments([{ name: 'bin.txt', data: b64(Buffer.from([65, 0, 66])) }]), 415);
fails(() => parseAttachments([{ name: 'huge.txt', data: b64('a'.repeat(MAX_TOTAL_BYTES + 1)) }]), 413);

// Names are cleaned.
assert.strictEqual(safeName('  <b>my\nfile</b>`.pdf '), 'bmyfile/b.pdf');
assert.strictEqual(safeName(''), 'file');
assert.ok(safeName('x'.repeat(200)).length <= 80);

// Server wiring: larger parser only on the chat route, after auth and limits; AI sees the attachments.
const server = read('server.js');
assert.ok(server.includes("req.path === '/api/chat' && req.method === 'POST' ? next() : jsonSmall"), 'global 2 MB parser must skip only POST /api/chat');
assert.ok(/app\.post\('\/api\/chat', requireAuth, aiLimiter, aiDailyLimiter, express\.json\(\{ limit: ATTACHMENT_BODY_LIMIT \}\)/.test(server), 'chat route must parse the large body after auth and rate limits');
assert.ok(server.includes('parseAttachments(attachments)') && server.includes('ATTACHMENT_SYSTEM_NOTE') && server.includes('contents[contents.length - 1].parts.push(...files.parts)'), 'attachments must reach Gemini');
assert.ok(server.includes('typed.length > MAX_MSG_CHARS'), 'message length limit applies to typed text');
assert.ok(!/inlineData|base64/i.test(server.slice(server.indexOf("chat.messages.push({ role: 'user'"), server.indexOf("chat.messages.push({ role: 'user'") + 400)), 'file bytes must not be saved in the chat');

// Classic UI.
const classic = read('public/index.html');
const app = read('public/app.js');
assert.ok(classic.includes('id="chat-attach-btn"') && classic.includes('id="chat-attach-input"') && classic.includes('id="chat-attach-tray"'), 'Classic needs attach controls');
assert.ok(classic.includes('attach.js?v=3.3.2" defer') && classic.indexOf('attach.js?v=') < classic.indexOf('app.js?v='), 'attach.js loads before app.js');
assert.ok(app.includes('NexAttach.create') && app.includes('chatAttach.list()') && app.includes('chatAttach.clear()'), 'Classic chat must send and then clear attachments');
assert.ok(app.includes("{ chatId, message, system, attachments }"), 'Classic must post attachments');

// Enterprise UI.
const ent = read('public/index-redesign.html');
assert.ok(ent.includes('id="ai-attach-btn"') && ent.includes('id="ai-attach-input"') && ent.includes('id="ai-attach-tray"'), 'Enterprise needs attach controls');
assert.ok(ent.includes('attach.js?v=3.3.2'), 'Enterprise must load attach.js');
assert.ok(ent.includes('postEnterpriseChat(message, box, files)') && ent.includes('attachments: files'), 'Enterprise chat must send attachments');
assert.ok(!/postEnterpriseChat\(message, box, files\)/.test(ent.slice(ent.indexOf('async function sendFloatingChatMessage'), ent.indexOf('async function sendFloatingChatMessage') + 400)), 'side panel stays text-only');

// Shared client helper and service worker.
const attach = read('public/attach.js');
assert.ok(attach.includes('MAX_FILES = 3') && attach.includes('6 * 1024 * 1024') && attach.includes('toBlob'), 'client limits and image shrinking');
assert.ok(!attach.includes('innerHTML'), 'file names must never be written as HTML');
assert.ok(read('public/sw.js').includes("'/attach.js?v=3.3.2'"), 'service worker precaches attach.js');

// Recovery Center stays untouched.
assert.ok(!read('public/recover.html').includes('attach'), 'Recovery Center must not contain attachment code');

console.log('NexOS 3.3.0 file upload checks passed.');
