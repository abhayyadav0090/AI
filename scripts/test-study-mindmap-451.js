'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const vm = require('node:vm');
const express = require('express');

const study = require('../lib/study.js');
const mindmap = require('../lib/study-mindmap.js');

const ROOT = path.join(__dirname, '..');

function makeMemModels() {
  let seq = 1;
  const newId = () => String(seq++).padStart(24, '0');
  const makeColl = () => {
    const rows = [];
    const match = (r, f) => Object.entries(f).every(([k, v]) => {
      if (v && typeof v === 'object' && v.$in) return v.$in.map(String).includes(String(r[k]));
      if (v && typeof v === 'object' && v.$search) {
        const terms = String(v.$search).toLowerCase().split(/\s+/).filter(Boolean);
        const hay = (String(r.text || '') + ' ' + String(r.heading || '')).toLowerCase();
        return terms.some(t => hay.includes(t));
      }
      return String(r[k] ?? '') === String(v ?? '');
    });
    class Q {
      constructor(list) { this.list = list; }
      select() { return this; }
      sort() { return this; }
      limit(n) { this.list = this.list.slice(0, n); return this; }
      lean() { return this; }
      then(res, rej) { return Promise.resolve(this.list.map(x => JSON.parse(JSON.stringify(x)))).then(res, rej); }
    }
    return {
      rows,
      async create(doc) { const row = { _id: newId(), createdAt: new Date(), updatedAt: new Date(), ...JSON.parse(JSON.stringify(doc)) }; rows.push(row); return JSON.parse(JSON.stringify(row)); },
      find(f) { return new Q(rows.filter(r => match(r, f))); },
      findOne(f) { const hit = rows.find(r => match(r, f)) || null; return { select() { return this; }, async lean() { return hit ? JSON.parse(JSON.stringify(hit)) : null; } }; },
      async countDocuments(f) { return rows.filter(r => match(r, f)).length; },
      findOneAndUpdate(f, u) {
        const hit = rows.find(r => match(r, f)) || null;
        if (!hit) return { async lean() { return null; } };
        if (u.$set) Object.assign(hit, JSON.parse(JSON.stringify(u.$set)));
        hit.updatedAt = new Date();
        return { async lean() { return JSON.parse(JSON.stringify(hit)); } };
      },
      async deleteOne(f) { const i = rows.findIndex(r => match(r, f)); if (i < 0) return { deletedCount: 0 }; rows.splice(i, 1); return { deletedCount: 1 }; },
    };
  };
  return { StudyDocument: makeColl(), StudyChunk: makeColl(), StudyMindmap: makeColl() };
}

(async function main() {
  // ── 1) Unit tests: parser, truncation recovery, depth/node caps & source provenance ──
  const chunks = [
    { _id: 'c1', documentId: 'd1', idx: 0, page: 4, heading: 'Chloroplasts', text: 'Photosynthesis occurs in chloroplasts using light.' },
    { _id: 'c2', documentId: 'd1', idx: 1, page: 5, heading: 'Calvin Cycle', text: 'The Calvin cycle fixes carbon dioxide in the stroma.' },
  ];
  const titles = new Map([['d1', 'Biology Notes']]);

  // Clean JSON with fence + page citations
  const parsed = mindmap.parseMindmapResponse('```json\n{"title":"Photosynthesis","summary":"Energy conversion","branches":[{"label":"Light Reactions","source":1,"children":[{"label":"Chloroplasts <script>","source":1}]},{"label":"Dark Reactions","source":2,"children":[{"label":"Calvin Cycle","source":2}]}]}\n```', chunks, titles);
  assert.equal(parsed.label, 'Photosynthesis');
  assert.equal(parsed.children.length, 2);
  assert.equal(parsed.children[0].sourceRef.page, 4);
  assert.ok(!parsed.children[0].children[0].label.includes('<script>'), 'XSS brackets stripped from labels');
  assert.equal(parsed.children[1].children[0].sourceRef.title, 'Biology Notes');

  // Truncated partial JSON mid-stream salvaged cleanly
  const truncatedAi = '{"title":"Biology","branches":[{"label":"Cell Structure","source":1,"children":[{"label":"Mitochondria"}]},{"label":"Incomplete';
  const salvaged = mindmap.parseMindmapResponse(truncatedAi, chunks, titles);
  assert.ok(salvaged && salvaged.children.length === 1 && salvaged.children[0].label === 'Cell Structure', 'partial AI JSON salvages completed branches cleanly');

  // Markdown indented bullet fallback
  const mdFallback = '# Neural Networks\n- Perceptron [1]\n  - Activation function [1]\n- Backpropagation [2]';
  const parsedMd = mindmap.parseMindmapResponse(mdFallback, chunks, titles);
  assert.equal(parsedMd.label, 'Neural Networks');
  assert.equal(parsedMd.children[0].children[0].label, 'Activation function');

  // Totally garbage AI output returns null (caller keeps previous user map intact)
  assert.equal(mindmap.parseMindmapResponse('Sorry I cannot help with that.', chunks, titles), null);

  // Normalization caps huge trees cleanly (<= 65 nodes, <= 4 levels)
  const huge = {
    label: 'Huge Root',
    children: Array.from({ length: 12 }, (_, i) => ({
      label: 'Branch ' + i,
      children: Array.from({ length: 10 }, (_, j) => ({
        label: 'Sub ' + i + '-' + j,
        children: Array.from({ length: 6 }, (_, k) => ({
          label: 'Detail ' + k,
          children: [{ label: 'Level 5 too deep' }],
        })),
      })),
    })),
  };
  const capped = mindmap.normalizeMindmapTree(huge);
  assert.ok(mindmap.countMindmapNodes(capped) <= mindmap.MAX_NODES, 'node count bounded for readability');
  assert.equal(capped.children[0].children[0].children[0].children.length, 0, 'depth capped at 4 levels');

  // ── 2) Router HTTP tests: generate from library + topic, save, reopen, edit, delete & IDOR check ──
  const models = makeMemModels();
  const userA = '507f1f77bcf86cd799439011';
  const userB = '507f1f77bcf86cd799439099';
  const docA = await models.StudyDocument.create({ userId: userA, title: 'Operating Systems', subject: 'CS', chunkCount: 30, contentHash: 'h1' });
  for (let i = 0; i < 30; i++) {
    await models.StudyChunk.create({ userId: userA, documentId: docA._id, idx: i, page: i + 1, heading: 'Sec ' + (i + 1), text: `Scheduling algorithms CPU burst quantum slice details section ${i + 1}. ` + 'word '.repeat(25) });
  }

  let geminiPromptChars = 0;
  let forceMalformedAi = false;
  const router = study.createStudyRouter({
    ...models,
    requireAuth: (req, res, next) => { req.userId = req.headers['x-user'] || userA; next(); },
    uploadLimiter: (req, res, next) => next(),
    aiLimiter: (req, res, next) => next(),
    aiDailyLimiter: (req, res, next) => next(),
    askGemini: async ({ contents }) => {
      geminiPromptChars = JSON.stringify(contents).length;
      if (forceMalformedAi) return 'Malformed non-JSON output';
      return JSON.stringify({
        title: 'OS Scheduling',
        summary: 'CPU scheduling basics from Operating Systems',
        branches: [
          { label: 'Preemptive Scheduling', source: 1, children: [{ label: 'Time Quantum', source: 1 }] },
          { label: 'Turnaround Time', source: 2, children: [{ label: 'Burst Duration', source: 2 }] },
        ],
      });
    },
    toGeminiContents: (msgs) => msgs.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
    sendAIError: (err, res) => res.status(502).json({ error: err.message }),
    isValidId: (id) => /^[a-f0-9]{24}$/i.test(String(id || '')),
  });

  const app = express();
  app.use(express.json());
  app.use('/api/study', router);
  const srv = http.createServer(app);
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}/api/study`;

  try {
    // Generate full-doc mindmap: samples cleanly instead of dumping all 30 chunks unnecessarily
    const genRes = await fetch(base + '/mindmaps/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-user': userA },
      body: JSON.stringify({ docId: String(docA._id) }),
    });
    assert.equal(genRes.status, 200);
    const genData = await genRes.json();
    assert.equal(genData.draft.title, 'OS Scheduling');
    assert.equal(genData.draft.sourceTitle, 'Operating Systems');
    assert.equal(genData.draft.root.children.length, 2);
    assert.ok(genData.draft.root.children[0].sourceRef.page >= 1, 'branch retains source page citation');
    assert.ok(geminiPromptChars < 12000, 'prompt samples bounded subset of long document');

    // Focus topic search mindmap generation
    const topicRes = await fetch(base + '/mindmaps/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-user': userA },
      body: JSON.stringify({ docId: String(docA._id), topic: 'Scheduling quantum' }),
    });
    assert.equal(topicRes.status, 200);

    // Malformed AI output returns 502 cleanly
    forceMalformedAi = true;
    const badAi = await fetch(base + '/mindmaps/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-user': userA },
      body: JSON.stringify({ docId: String(docA._id) }),
    });
    assert.equal(badAi.status, 502);
    forceMalformedAi = false;

    // Save mindmap -> list -> reopen -> rename/add node -> cross-user IDOR denied -> delete
    const saveRes = await fetch(base + '/mindmaps', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-user': userA },
      body: JSON.stringify(genData.draft),
    });
    assert.equal(saveRes.status, 201);
    const saved = (await saveRes.json()).mindmap;

    const listRes = await fetch(base + '/mindmaps', { headers: { 'x-user': userA } }).then(r => r.json());
    assert.equal(listRes.mindmaps.length, 1);

    const openRes = await fetch(base + '/mindmaps/' + saved.id, { headers: { 'x-user': userA } }).then(r => r.json());
    assert.equal(openRes.mindmap.title, 'OS Scheduling');

    // Edit & persist updated tree
    openRes.mindmap.root.children.push({ id: 'mm_custom', label: 'Round Robin Notes', children: [] });
    const putRes = await fetch(base + '/mindmaps/' + saved.id, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', 'x-user': userA },
      body: JSON.stringify({ title: 'OS Scheduling v2', root: openRes.mindmap.root }),
    });
    assert.equal(putRes.status, 200);
    const updated = (await putRes.json()).mindmap;
    assert.equal(updated.title, 'OS Scheduling v2');
    assert.equal(updated.root.children.length, 3);

    // User B cannot view, update, or delete User A's saved mindmap
    assert.equal((await fetch(base + '/mindmaps/' + saved.id, { headers: { 'x-user': userB } })).status, 404);
    assert.equal((await fetch(base + '/mindmaps/' + saved.id, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'x-user': userB }, body: JSON.stringify({ title: 'Hacked' }) })).status, 404);

    // Delete cleanly
    const delRes = await fetch(base + '/mindmaps/' + saved.id, { method: 'DELETE', headers: { 'x-user': userA } }).then(r => r.json());
    assert.equal(delRes.ok, true);
  } finally {
    await new Promise(r => srv.close(r));
  }

  // ── 3) Frontend Study UI & layoutMindmapTree non-overlap verification ──
  const studyUiSrc = fs.readFileSync(path.join(ROOT, 'public', 'study.js'), 'utf8');
  const ctx = { window: {}, console, Intl, URL, Date, Math, Object, Array, Number, String, Boolean, JSON };
  ctx.window = ctx;
  vm.createContext(ctx);
  new vm.Script(studyUiSrc, { filename: 'study.js' }).runInContext(ctx);

  const layoutExpanded = ctx.NexStudy.layoutMindmapTree(ctx.NexStudy.SAMPLE_MINDMAP.root);
  assert.ok(layoutExpanded.nodes.length >= 7, 'Sample mindmap expands full concept hierarchy');
  // Assert zero node bounding-box overlap
  for (let i = 0; i < layoutExpanded.nodes.length; i++) {
    for (let j = i + 1; j < layoutExpanded.nodes.length; j++) {
      const a = layoutExpanded.nodes[i], b = layoutExpanded.nodes[j];
      const overlapX = a.x < b.x + b.w && a.x + a.w > b.x;
      const overlapY = a.y < b.y + b.h && a.y + a.h > b.y;
      assert.ok(!(overlapX && overlapY), `Nodes "${a.id}" and "${b.id}" must not overlap`);
    }
  }
  const collapsedRoot = JSON.parse(JSON.stringify(ctx.NexStudy.SAMPLE_MINDMAP.root));
  collapsedRoot.children[0].collapsed = true;
  collapsedRoot.children[1].collapsed = true;
  const layoutCollapsed = ctx.NexStudy.layoutMindmapTree(collapsedRoot);
  assert.ok(layoutCollapsed.nodes.length < layoutExpanded.nodes.length, 'Collapsing branches hides descendant nodes cleanly');

  console.log('Study Studio Mindmap backend, AI parsing, security & UI layout tests passed.');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
