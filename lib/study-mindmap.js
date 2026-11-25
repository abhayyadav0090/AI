'use strict';
// NexOS 4.5.1 — Study Studio Mindmap model, grounded AI generation/parsing, tree normalization,
// and CRUD API router mounted inside /api/study.

const MAX_MINDMAPS = 40;
const MAX_NODES = 65;
const MAX_DEPTH = 4; // root (0) -> main branch (1) -> sub-branch (2) -> leaf (3)
const MAX_CHILDREN_PER_NODE = 8;
const MAX_LABEL_LEN = 90;
const MAX_SUMMARY_LEN = 220;
const MINDMAP_SAMPLE_CHUNKS = 24;

function defineMindmapModel(mongoose) {
  const { Schema } = mongoose;
  const schema = new Schema({
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    documentId: { type: Schema.Types.ObjectId, default: null },
    sourceTitle: { type: String, default: '', maxlength: 100 },
    topic: { type: String, default: '', maxlength: 120 },
    title: { type: String, required: true, maxlength: 120 },
    root: { type: Schema.Types.Mixed, required: true },
  }, { timestamps: true, minimize: false });
  schema.index({ userId: 1, updatedAt: -1 });
  return mongoose.models.StudyMindmap || mongoose.model('StudyMindmap', schema);
}

function cleanNodeText(val, max) {
  return String(val == null ? '' : val)
    .replace(/[\u0000-\u001f\u007f<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function safeNodeId(raw, fallback) {
  const s = String(raw || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
  return s || fallback;
}

function safeSourceRef(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const title = cleanNodeText(raw.title, 90);
  if (!title) return null;
  const page = Number.isInteger(Number(raw.page)) && Number(raw.page) > 0 ? Number(raw.page) : null;
  const section = Number.isInteger(Number(raw.section)) && Number(raw.section) > 0 ? Number(raw.section) : null;
  const heading = cleanNodeText(raw.heading, 80);
  const excerpt = cleanNodeText(raw.excerpt, 320);
  return { title, page, section, heading, ...(excerpt ? { excerpt } : {}) };
}

function countMindmapNodes(node) {
  if (!node || typeof node !== 'object') return 0;
  let total = 1;
  if (Array.isArray(node.children)) {
    for (const child of node.children) total += countMindmapNodes(child);
  }
  return total;
}

function normalizeMindmapTree(raw, fallbackTitle = 'Study Mindmap') {
  let seq = 0;
  let count = 0;
  const walk = (node, depth, isRoot) => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) {
      if (!isRoot) return null;
      node = { label: fallbackTitle };
    }
    if (count >= MAX_NODES || depth >= MAX_DEPTH) return null;
    const id = safeNodeId(node.id, 'mm_' + (++seq));
    const label = cleanNodeText(node.label || node.title || node.name, MAX_LABEL_LEN)
      || (isRoot ? cleanNodeText(fallbackTitle, MAX_LABEL_LEN) || 'Study Mindmap' : '');
    if (!label) return null;
    count++;
    const summary = cleanNodeText(node.summary || node.note || node.description, MAX_SUMMARY_LEN);
    const sourceRef = safeSourceRef(node.sourceRef);
    const collapsed = depth > 0 && Boolean(node.collapsed);
    const children = [];
    if (depth + 1 < MAX_DEPTH && Array.isArray(node.children)) {
      const cap = depth === 0 ? MAX_CHILDREN_PER_NODE : 6;
      for (const rawChild of node.children) {
        if (children.length >= cap || count >= MAX_NODES) break;
        const normalizedChild = walk(rawChild, depth + 1, false);
        if (normalizedChild) children.push(normalizedChild);
      }
    }
    return {
      id,
      label,
      ...(summary ? { summary } : {}),
      ...(sourceRef ? { sourceRef } : {}),
      ...(collapsed ? { collapsed: true } : {}),
      children,
    };
  };
  return walk(raw, 0, true);
}

function mindmapSystem(topicHint) {
  return [
    'You build concise, structured study mindmaps strictly from the provided study excerpts.',
    'ONLY include concepts, facts, and relationships that are present in the excerpts. Do NOT invent unsupported outside facts.',
    'Return ONLY valid JSON matching this exact shape (no markdown commentary outside JSON):',
    '{"title":"Central Topic","summary":"1 concise sentence from notes","branches":[{"label":"Main Branch","summary":"Brief key point","source":1,"children":[{"label":"Sub-concept","summary":"Short detail","source":1,"children":[]}]}]}',
    'Rules:',
    '- Use 3 to 6 top-level branches, each with 2 to 4 concise sub-branches (short readable labels <= 60 chars).',
    '- Set "source" to the 1-based excerpt number [N] where the concept appears.',
    '- Keep summary fields brief (<= 140 chars) or empty if self-explanatory.',
    topicHint ? `- Center the mindmap specifically on the requested focus topic: "${cleanNodeText(topicHint, 100)}".` : '- Summarize the core structure of the material evenly across the excerpts.',
  ].join('\n');
}

function parseJsonObjectLenient(rawText) {
  let s = String(rawText || '').trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
  if (fence) s = fence[1].trim();
  else s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const start = s.indexOf('{');
  if (start < 0) return null;
  s = s.slice(start);
  try {
    return JSON.parse(s);
  } catch (_) {
    // Salvage truncated JSON array/object returned mid-stream by trimming cleanly after last complete object.
    const lastBrace = s.lastIndexOf('}');
    if (lastBrace <= 0) return null;
    for (let cut = lastBrace; cut > 20; cut = s.lastIndexOf('}', cut - 1)) {
      const candidate = s.slice(0, cut + 1);
      let openCurly = 0, openBracket = 0, inStr = false, esc = false;
      for (let i = 0; i < candidate.length; i++) {
        const ch = candidate[i];
        if (esc) { esc = false; continue; }
        if (ch === '\\') { esc = true; continue; }
        if (ch === '"') { inStr = !inStr; continue; }
        if (inStr) continue;
        if (ch === '{') openCurly++;
        else if (ch === '}') openCurly--;
        else if (ch === '[') openBracket++;
        else if (ch === ']') openBracket--;
      }
      if (inStr || openCurly < 0 || openBracket < 0) continue;
      const repaired = candidate.replace(/,\s*$/, '') + ']'.repeat(openBracket) + '}'.repeat(openCurly);
      try { return JSON.parse(repaired); } catch (_) {}
    }
    return null;
  }
}

function resolveChunkSourceRef(sourceIdx, chunks, titleById) {
  const n = Number(sourceIdx);
  if (!Number.isInteger(n) || n < 1 || n > chunks.length) return null;
  const c = chunks[n - 1];
  return {
    title: (titleById && titleById.get(String(c.documentId))) || 'Study material',
    page: c.page || null,
    heading: cleanNodeText(c.heading, 80),
    section: Number.isInteger(c.idx) ? c.idx + 1 : n,
    excerpt: cleanNodeText(c.text, 280),
  };
}

function parseMindmapResponse(rawText, chunks = [], titleById = null, fallbackTitle = 'Study Mindmap') {
  const parsed = parseJsonObjectLenient(rawText);
  let seq = 0;
  const convertNode = (n, depth) => {
    if (!n || typeof n !== 'object') return null;
    const label = cleanNodeText(n.label || n.title || n.name, MAX_LABEL_LEN);
    if (!label) return null;
    const sourceNum = n.source || n.ref;
    const sourceRef = n.sourceRef ? safeSourceRef(n.sourceRef) : resolveChunkSourceRef(sourceNum, chunks, titleById);
    const rawKids = Array.isArray(n.children) ? n.children : (Array.isArray(n.branches) ? n.branches : []);
    const children = depth + 1 < MAX_DEPTH ? rawKids.map(k => convertNode(k, depth + 1)).filter(Boolean) : [];
    return {
      id: 'mm_' + (++seq),
      label,
      summary: cleanNodeText(n.summary || n.note, MAX_SUMMARY_LEN),
      ...(sourceRef ? { sourceRef } : {}),
      children,
    };
  };

  if (parsed && typeof parsed === 'object') {
    const rawBranches = Array.isArray(parsed.branches) ? parsed.branches
      : (Array.isArray(parsed.children) ? parsed.children : []);
    const rootInput = parsed.root && typeof parsed.root === 'object'
      ? parsed.root
      : {
          label: parsed.title || fallbackTitle,
          summary: parsed.summary || '',
          children: rawBranches,
        };
    const tree = normalizeMindmapTree(convertNode(rootInput, 0), fallbackTitle);
    if (tree && Array.isArray(tree.children) && tree.children.length >= 1) return tree;
  }

  // Secondary fallback: parse indented Markdown hierarchy (`- Branch` / `  - Sub-branch [1]`)
  const lines = String(rawText || '').split(/\r?\n/);
  let rootLabel = fallbackTitle;
  const branches = [];
  let current = null;
  for (const line of lines) {
    const h = /^#{1,3}\s+(.+)$/.exec(line.trim());
    if (h && branches.length === 0) {
      rootLabel = cleanNodeText(h[1], MAX_LABEL_LEN) || fallbackTitle;
      continue;
    }
    const b = /^(\s*)(?:[-*]|\d+[.)])\s+(.+)$/.exec(line);
    if (!b) continue;
    const indent = b[1].replace(/\t/g, '  ').length;
    const cite = /\[(\d{1,3})\]/.exec(b[2]);
    const label = cleanNodeText(b[2].replace(/\s*\[\d{1,3}\]\s*$/, '').replace(/\*\*/g, ''), MAX_LABEL_LEN);
    if (!label) continue;
    const sourceRef = cite ? resolveChunkSourceRef(Number(cite[1]), chunks, titleById) : null;
    const item = { id: 'mm_' + (++seq), label, ...(sourceRef ? { sourceRef } : {}), children: [] };
    if (indent >= 2 && current) current.children.push(item);
    else { current = item; branches.push(item); }
  }
  if (branches.length >= 1) {
    return normalizeMindmapTree({ id: 'mm_0', label: rootLabel, children: branches }, fallbackTitle);
  }
  return null;
}

function publicMindmapSummary(doc) {
  return {
    id: String(doc._id),
    title: doc.title,
    topic: doc.topic || '',
    sourceTitle: doc.sourceTitle || '',
    documentId: doc.documentId ? String(doc.documentId) : null,
    nodeCount: countMindmapNodes(doc.root),
    updatedAt: doc.updatedAt,
  };
}

function attachMindmapRoutes(router, deps) {
  const {
    Mindmap, Doc, Chunk, wrap, requireAuth, aiLimiter, aiDailyLimiter, StudyError, sendAIError,
    LIMITS, scopeFilter, sampleChunks, searchQuery, titlesFor, buildExcerpts, askGemini, toGeminiContents,
  } = deps;
  const isValidId = (id) => /^[a-f0-9]{24}$/i.test(String(id || ''));

  router.get('/mindmaps', requireAuth, wrap(async (req, res) => {
    const list = await Mindmap.find({ userId: req.userId }).sort({ updatedAt: -1 }).limit(MAX_MINDMAPS).lean();
    res.json({ mindmaps: list.map(publicMindmapSummary) });
  }));

  router.get('/mindmaps/:id', requireAuth, wrap(async (req, res) => {
    if (!isValidId(req.params.id)) return res.status(404).json({ error: 'Mindmap not found.' });
    const doc = await Mindmap.findOne({ _id: req.params.id, userId: req.userId }).lean();
    if (!doc) return res.status(404).json({ error: 'Mindmap not found.' });
    res.json({
      mindmap: {
        ...publicMindmapSummary(doc),
        root: normalizeMindmapTree(doc.root, doc.title),
      },
    });
  }));

  router.post('/mindmaps/generate', requireAuth, aiLimiter, aiDailyLimiter, wrap(async (req, res) => {
    try {
      const body = req.body || {};
      const filter = await scopeFilter(req, body);
      const topic = cleanNodeText(body.topic, LIMITS.MAX_TOPIC);

      let chunks;
      if (topic) {
        const q = searchQuery(topic);
        chunks = q ? await Chunk.find({ ...filter, $text: { $search: q } }, { score: { $meta: 'textScore' } }).sort({ score: { $meta: 'textScore' } }).limit(14).lean() : [];
        if (!chunks.length) throw new StudyError(404, 'NO_CONTEXT', 'Nothing in your study material matches that topic. Try different keywords or leave the topic blank.');
      } else {
        const all = await Chunk.find(filter).sort({ documentId: 1, idx: 1 }).lean();
        chunks = sampleChunks(all, MINDMAP_SAMPLE_CHUNKS);
      }
      const totalChars = chunks.reduce((n, c) => n + String(c.text || '').length, 0);
      if (!chunks.length || totalChars < LIMITS.MIN_MATERIAL_CHARS) {
        throw new StudyError(400, 'NO_CONTEXT', 'Add more study material first. There is too little text to build a mindmap from.');
      }

      const titleById = await titlesFor(req.userId, chunks);
      let sourceTitle = 'All Study Material';
      if (filter.documentId) {
        sourceTitle = titleById.get(String(filter.documentId)) || 'Selected Document';
      } else if (titleById.size === 1) {
        sourceTitle = [...titleById.values()][0];
      }
      const fallbackTitle = topic || sourceTitle;
      const promptText = `Excerpts from my study material:\n\n${buildExcerpts(chunks, titleById)}\n\nBuild the structured study mindmap JSON now.`;
      const rawAi = await askGemini({
        system: mindmapSystem(topic),
        contents: toGeminiContents([{ role: 'user', content: promptText }]),
      });
      const root = parseMindmapResponse(rawAi, chunks, titleById, fallbackTitle);
      if (!root) {
        throw new StudyError(502, 'AI_ERROR', 'NexAI could not structure a mindmap from that response. Please try again.');
      }
      res.json({
        draft: {
          title: root.label,
          topic,
          sourceTitle,
          documentId: filter.documentId ? String(filter.documentId) : null,
          nodeCount: countMindmapNodes(root),
          root,
        },
      });
    } catch (err) {
      if (err instanceof StudyError) return res.status(err.status).json({ error: err.message, code: err.code });
      return sendAIError(err, res);
    }
  }));

  router.post('/mindmaps', requireAuth, wrap(async (req, res) => {
    const body = req.body || {};
    const existingCount = await Mindmap.countDocuments({ userId: req.userId });
    if (existingCount >= MAX_MINDMAPS) {
      return res.status(409).json({ error: `You can keep up to ${MAX_MINDMAPS} saved mindmaps. Delete an older map first.` });
    }
    const title = cleanNodeText(body.title || body.root?.label, 120);
    if (title.length < 2) return res.status(400).json({ error: 'Enter a mindmap title.' });
    const root = normalizeMindmapTree(body.root, title);
    if (!root) return res.status(400).json({ error: 'Invalid mindmap structure.' });
    let documentId = null;
    if (body.documentId) {
      if (!isValidId(body.documentId)) return res.status(400).json({ error: 'Invalid document ID.' });
      const owned = await Doc.findOne({ _id: body.documentId, userId: req.userId }).select('_id title').lean();
      if (!owned) return res.status(404).json({ error: 'Linked document not found.' });
      documentId = owned._id;
    }
    const doc = await Mindmap.create({
      userId: req.userId,
      documentId,
      sourceTitle: cleanNodeText(body.sourceTitle, 100),
      topic: cleanNodeText(body.topic, 120),
      title,
      root,
    });
    res.status(201).json({ mindmap: { ...publicMindmapSummary(doc), root } });
  }));

  router.put('/mindmaps/:id', requireAuth, wrap(async (req, res) => {
    if (!isValidId(req.params.id)) return res.status(404).json({ error: 'Mindmap not found.' });
    const body = req.body || {};
    const existing = await Mindmap.findOne({ _id: req.params.id, userId: req.userId }).lean();
    if (!existing) return res.status(404).json({ error: 'Mindmap not found.' });
    const title = cleanNodeText(body.title !== undefined ? body.title : (body.root?.label || existing.title), 120);
    if (title.length < 2) return res.status(400).json({ error: 'Mindmap title is too short.' });
    const root = body.root !== undefined ? normalizeMindmapTree(body.root, title) : normalizeMindmapTree(existing.root, title);
    if (!root) return res.status(400).json({ error: 'Invalid mindmap structure.' });
    const updated = await Mindmap.findOneAndUpdate(
      { _id: req.params.id, userId: req.userId },
      { $set: { title, root, ...(body.topic !== undefined ? { topic: cleanNodeText(body.topic, 120) } : {}) } },
      { new: true }
    ).lean();
    if (!updated) return res.status(404).json({ error: 'Mindmap not found.' });
    res.json({ mindmap: { ...publicMindmapSummary(updated), root: normalizeMindmapTree(updated.root, updated.title) } });
  }));

  router.delete('/mindmaps/:id', requireAuth, wrap(async (req, res) => {
    if (!isValidId(req.params.id)) return res.status(404).json({ error: 'Mindmap not found.' });
    const out = await Mindmap.deleteOne({ _id: req.params.id, userId: req.userId });
    res.json({ ok: out.deletedCount === 1 });
  }));
}

module.exports = {
  MAX_MINDMAPS,
  MAX_NODES,
  MAX_DEPTH,
  MAX_CHILDREN_PER_NODE,
  MINDMAP_SAMPLE_CHUNKS,
  defineMindmapModel,
  cleanNodeText,
  countMindmapNodes,
  normalizeMindmapTree,
  mindmapSystem,
  parseMindmapResponse,
  publicMindmapSummary,
  attachMindmapRoutes,
};
