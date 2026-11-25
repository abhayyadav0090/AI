/* NexOS 4.1.0 — Study Studio (dialog redesigned in 4.1.1; Quiz and Cards tabs and tappable sources in 4.4.0): upload notes, then ask NexAI to tutor you from them, quiz you and make flashcards.
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

  const SAMPLE_MINDMAP = {
    id: 'sample-mm',
    title: 'Photosynthesis (Sample)',
    topic: 'Photosynthesis',
    sourceTitle: 'Sample notes: Biology, Chapter 2',
    root: {
      id: 'mm_root',
      label: 'Photosynthesis',
      summary: 'Process by which plants convert light energy into chemical energy.',
      sourceRef: { title: 'Sample notes: Biology, Chapter 2', page: 4, excerpt: 'Photosynthesis takes place in the chloroplasts, where chlorophyll absorbs light energy to convert CO2 and H2O into glucose and oxygen.' },
      children: [
        {
          id: 'mm_1',
          label: 'Chloroplast & Chlorophyll',
          summary: 'Light-capturing site inside plant cells.',
          sourceRef: { title: 'Sample notes: Biology, Chapter 2', page: 4 },
          children: [
            { id: 'mm_1a', label: 'Thylakoid membranes', summary: 'Capture photons cleanly.' },
            { id: 'mm_1b', label: 'Stroma', summary: 'Fluid site for sugar synthesis.' }
          ]
        },
        {
          id: 'mm_2',
          label: 'Light-Dependent Reactions',
          summary: 'Split water into O2 and generate ATP + NADPH.',
          sourceRef: { title: 'Sample notes: Biology, Chapter 2', page: 5 },
          children: [
            { id: 'mm_2a', label: 'Inputs: Light + H2O' },
            { id: 'mm_2b', label: 'Outputs: O2, ATP, NADPH' }
          ]
        },
        {
          id: 'mm_3',
          label: 'Calvin Cycle',
          summary: 'Uses ATP & NADPH to fix CO2 into glucose.',
          sourceRef: { title: 'Sample notes: Biology, Chapter 2', page: 6 },
          children: []
        }
      ]
    }
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
#nexos-study-modal input[type=text],#nexos-study-modal input[type=date],#nexos-study-modal input[type=number],#nexos-study-modal input[type=time],#nexos-study-modal textarea,#nexos-study-modal select{width:100%;min-width:0;border:1px solid var(--k-line);background:var(--k-bg2);color:var(--k-text);border-radius:12px;padding:10px 12px;font-size:13.5px;font-family:inherit}
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

  const CSS2 = `
#nexos-study-modal{--k-ok:#2e9e5b;--k-bad:#d9453f}
#nexos-study-modal .ns-tabs{grid-template-columns:repeat(6,minmax(0,1fr))}
#nexos-study-modal[data-tab="mindmap"] .ns-card{width:min(940px,100%)}
#nexos-study-modal .ns-mm-toolbar{display:grid;grid-template-columns:minmax(130px,1fr) minmax(130px,1fr) auto;gap:8px;margin-bottom:8px}
#nexos-study-modal .ns-mm-actions-row{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:8px}
#nexos-study-modal .ns-mm-saved{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px}
#nexos-study-modal .ns-mm-chip{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;border:1px solid var(--k-line);background:var(--k-bg2);color:var(--k-text);font-size:12px;cursor:pointer;font-family:inherit}
#nexos-study-modal .ns-mm-chip[data-active="1"]{background:var(--k-soft);border-color:var(--k-accent);color:var(--k-accent);font-weight:600}
#nexos-study-modal .ns-mm-stage{position:relative;height:330px;min-height:260px;border:1px solid var(--k-line);border-radius:16px;background:var(--k-bg2);background-image:radial-gradient(var(--k-line) 1px,transparent 1px);background-size:20px 20px;overflow:hidden;touch-action:none;user-select:none;cursor:grab}
#nexos-study-modal .ns-mm-stage[data-pan="1"]{cursor:grabbing}
#nexos-study-modal .ns-mm-world{position:absolute;top:0;left:0;transform-origin:0 0;will-change:transform}
#nexos-study-modal .ns-mm-links{position:absolute;top:0;left:0;overflow:visible;pointer-events:none}
#nexos-study-modal .ns-mm-links path{fill:none;stroke:var(--k-accent);stroke-opacity:.42;stroke-width:2}
#nexos-study-modal .ns-mm-node{position:absolute;box-sizing:border-box;display:flex;flex-direction:column;justify-content:center;gap:3px;padding:8px 10px;border-radius:12px;border:1.5px solid var(--k-line);background:var(--k-bg);color:var(--k-text);font-size:12px;line-height:1.3;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.12)}
#nexos-study-modal .ns-mm-node[data-depth="0"]{background:var(--k-accent);color:var(--k-on);border-color:transparent;font-weight:700}
#nexos-study-modal .ns-mm-node[data-selected="1"]{outline:2.5px solid var(--k-accent);outline-offset:2px}
#nexos-study-modal .ns-mm-node[data-depth="0"][data-selected="1"]{outline-color:var(--k-text)}
#nexos-study-modal .ns-mm-nhead{display:flex;align-items:flex-start;justify-content:space-between;gap:6px}
#nexos-study-modal .ns-mm-ntitle{font-weight:600;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
#nexos-study-modal .ns-mm-toggle{flex:none;width:20px;height:20px;border-radius:50%;border:1px solid currentColor;background:transparent;color:inherit;font-size:12px;line-height:1;display:grid;place-items:center;cursor:pointer;opacity:.85}
#nexos-study-modal .ns-mm-nsrc{font-size:10.5px;opacity:.78;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#nexos-study-modal .ns-mm-hud{position:absolute;right:10px;bottom:10px;display:flex;flex-wrap:wrap;gap:4px;padding:4px;border-radius:12px;background:var(--k-bg);border:1px solid var(--k-line);box-shadow:0 4px 12px rgba(0,0,0,.18);z-index:2}
#nexos-study-modal .ns-mm-hud button{min-height:28px;min-width:28px;padding:0 8px;border:0;border-radius:8px;background:transparent;color:var(--k-text);font-size:12px;font-weight:600;cursor:pointer;font-family:inherit}
#nexos-study-modal .ns-mm-hud button:hover{background:var(--k-hover)}
#nexos-study-modal .ns-mm-inspector{margin-top:10px;padding:11px 12px;border:1px solid var(--k-line);border-radius:14px;background:var(--k-bg2)}
#nexos-study-modal .ns-mm-editgrid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px}
@media (max-width:560px){#nexos-study-modal .ns-tabs{grid-template-columns:repeat(3,1fr)}#nexos-study-modal .ns-tab{font-size:12px;min-height:34px}#nexos-study-modal .ns-mm-toolbar,#nexos-study-modal .ns-mm-editgrid{grid-template-columns:1fr}#nexos-study-modal .ns-mm-stage{height:270px}}
#nexos-study-modal .ns-fields3{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;margin-bottom:8px}
#nexos-study-modal .ns-qhead{display:flex;justify-content:space-between;font-size:12.5px;color:var(--k-text2);margin-bottom:2px}
#nexos-study-modal .ns-qtext{font-size:15.5px;font-weight:600;line-height:1.45;margin:12px 0;overflow-wrap:anywhere}
#nexos-study-modal .ns-opt{display:flex;gap:10px;align-items:flex-start;width:100%;text-align:left;margin-bottom:8px;padding:11px 12px;border:1px solid var(--k-line);border-radius:14px;background:var(--k-bg2);color:var(--k-text);font-size:13.5px;line-height:1.45;cursor:pointer;font-family:inherit}
#nexos-study-modal .ns-opt b{flex:none;width:24px;height:24px;border-radius:50%;display:grid;place-items:center;font-size:12px;background:var(--k-hover)}
#nexos-study-modal .ns-opt span{min-width:0;overflow-wrap:anywhere}
#nexos-study-modal .ns-opt:not([disabled]):hover{border-color:var(--k-accent)}
#nexos-study-modal .ns-opt.ns-ok{border-color:var(--k-ok);background:color-mix(in srgb,var(--k-ok) 16%,transparent)}
#nexos-study-modal .ns-opt.ns-bad{border-color:var(--k-bad);background:color-mix(in srgb,var(--k-bad) 16%,transparent)}
#nexos-study-modal .ns-opt.ns-dim{opacity:.55}
#nexos-study-modal .ns-opt[disabled]{cursor:default}
#nexos-study-modal .ns-expl{margin:6px 0 4px;padding:11px 13px;border-radius:14px;background:var(--k-soft);font-size:13px;line-height:1.55}
#nexos-study-modal .ns-expl strong.ns-yes{color:var(--k-ok)}#nexos-study-modal .ns-expl strong.ns-no{color:var(--k-bad)}
#nexos-study-modal .ns-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
#nexos-study-modal .ns-score{font-size:42px;font-weight:700;text-align:center;margin:10px 0 2px}
#nexos-study-modal .ns-miss-item{padding:10px 12px;border:1px solid var(--k-line);border-radius:14px;margin-top:8px;font-size:13px;line-height:1.5}
#nexos-study-modal .ns-flash{display:flex;flex-direction:column;justify-content:center;align-items:center;gap:8px;width:100%;min-height:210px;margin:14px 0 8px;padding:20px;border:1px solid var(--k-line);border-radius:20px;background:var(--k-bg2);color:var(--k-text);font-size:17px;font-weight:600;line-height:1.45;text-align:center;cursor:pointer;font-family:inherit;overflow-wrap:anywhere}
#nexos-study-modal .ns-flash small{font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--k-accent)}
#nexos-study-modal .ns-flash[data-back="1"]{background:var(--k-soft);border-color:var(--k-accent)}
#nexos-study-modal .ns-srcd{display:inline-block}
#nexos-study-modal .ns-srcd[open]{flex-basis:100%}
#nexos-study-modal .ns-srcd summary{cursor:pointer;list-style:none}
#nexos-study-modal .ns-srcd summary::-webkit-details-marker{display:none}
#nexos-study-modal .ns-excerpt{margin-top:6px;padding:9px 11px;border-left:3px solid var(--k-accent);border-radius:6px;background:var(--k-bg);font-size:12px;line-height:1.55;color:var(--k-text2)}`;
  const ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6.5C10 5 7 4.5 4 5v13c3-.5 6 0 8 1.5 2-1.5 5-2 8-1.5V5c-3-.5-6 0-8 1.5zM12 6.5v13"/></svg>';
  const STARTERS = [
    { label: 'Explain simply', text: 'Explain in simple words: ' },
    { label: 'Practice questions', text: 'Give me 5 practice questions about: ' },
    { label: 'Solve step by step', text: 'Solve step by step: ' },
    { label: 'Key definitions', text: 'List the key definitions about: ' }
  ];

  let modal = null, adapter = null, busy = false, tab = 'tutor';
  let docs = [], usage = null, history = [], thinking = false, pending = null;
  let quiz = null, deck = null, building = null, revisionData = null, revisionBusy = false, planStartTime = '18:00';
  let qopts = { docId: '', count: 5, level: 'medium', topic: '' }, copts = { docId: '', count: 10, topic: '' };
  let mindmapList = [], mindmapCurrent = null, mindmapSelectedId = null, mindmapDirty = false, mindmapEditing = false, mindmapBusy = false;
  let mindmapOpts = { docId: '', topic: '' }, mindmapView = { scale: 1, tx: 20, ty: 20 }, guestPreviewTab = 'tutor', mmSeq = 0;

  function localTimeZone() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata'; }
    catch (_) { return 'Asia/Kolkata'; }
  }

  const $ = (id) => modal.querySelector('#' + id);
  const setStatus = (text, isBusy) => { const el = modal && modal.querySelector('#ns-status'); if (!el) return; el.textContent = text || ''; el.classList.toggle('ns-busy', !!isBusy); };

  function build() {
    if (modal) return;
    const style = document.createElement('style');
    style.id = 'nexos-study-styles';
    style.textContent = CSS + CSS2;
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
      else if (ACTIONS[act]) ACTIONS[act](t);
      else if (act === 'starter') { const box = $('ns-question'); box.value = STARTERS[Number(t.getAttribute('data-i'))].text; box.focus(); }
    });
    modal.addEventListener('change', (e) => {
      if (e.target && e.target.id === 'ns-file') pickFile(e.target.files && e.target.files[0]);
      if (e.target && e.target.matches('[data-ns="plan-topic"]')) {
        const id = e.target.getAttribute('data-id'), index = e.target.getAttribute('data-index');
        call('PATCH', '/plans/' + encodeURIComponent(id) + '/topics/' + index, {}).then(() => loadRevision()).catch((err) => setStatus(err.message));
      }
    });
    const keepOption = (e) => {
      const t = e.target, key = t && t.dataset && t.dataset.opt;
      if (!key) return;
      const o = t.closest('#ns-panel-cards') ? copts : qopts;
      o[key] = (key === 'count') ? Number(t.value) : t.value;
    };
    modal.addEventListener('change', keepOption);
    modal.addEventListener('input', keepOption);
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

  /* Each source is a chip; when the server sent the passage, tapping the chip opens it (native <details>, no script). */
  const srcChips = (list) => (list || []).length
    ? '<div class="ns-srcs">' + list.map((s) => s.excerpt
      ? '<details class="ns-srcd"><summary class="ns-src">[' + s.n + '] ' + esc(sourceLabel(s)) + '</summary><div class="ns-excerpt">' + esc(s.excerpt) + '</div></details>'
      : '<span class="ns-src">[' + s.n + '] ' + esc(sourceLabel(s)) + '</span>').join('') + '</div>' : '';
  const oneChip = (src) => src ? '<div class="ns-srcs"><span class="ns-src">' + esc(sourceLabel(src)) + '</span></div>' : '';

  function cloneMindmapTree(node) {
    return node ? JSON.parse(JSON.stringify(node)) : null;
  }

  function countMindmapNodes(node) {
    if (!node || typeof node !== 'object') return 0;
    let total = 1;
    if (Array.isArray(node.children)) node.children.forEach((c) => { total += countMindmapNodes(c); });
    return total;
  }

  function findMindmapNode(node, id, parent = null, depth = 0) {
    if (!node || typeof node !== 'object') return null;
    if (String(node.id) === String(id)) return { node, parent, depth };
    const kids = Array.isArray(node.children) ? node.children : [];
    for (let i = 0; i < kids.length; i++) {
      const hit = findMindmapNode(kids[i], id, node, depth + 1);
      if (hit) return { ...hit, index: hit.parent === node ? i : hit.index };
    }
    return null;
  }

  function setAllMindmapCollapsed(node, collapsed, depth = 0) {
    if (!node || typeof node !== 'object') return;
    if (depth >= 1) node.collapsed = Boolean(collapsed);
    if (Array.isArray(node.children)) node.children.forEach((c) => setAllMindmapCollapsed(c, collapsed, depth + 1));
  }

  /* Deterministic non-overlapping left-to-right tidy tree layout. */
  function layoutMindmapTree(root) {
    if (!root || typeof root !== 'object') return { nodes: [], links: [], minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
    const NODE_W = 176, NODE_H = 58, COL_GAP = 54, ROW_GAP = 14;
    const nodes = [], links = [];
    const measureUnits = (n) => {
      const kids = (!n.collapsed && Array.isArray(n.children)) ? n.children : [];
      if (!kids.length) return 1;
      return kids.reduce((sum, c) => sum + measureUnits(c), 0);
    };
    const place = (n, depth, topUnit, parentLayout) => {
      const units = measureUnits(n);
      const kids = (!n.collapsed && Array.isArray(n.children)) ? n.children : [];
      const x = depth * (NODE_W + COL_GAP);
      const y = (topUnit + units / 2) * (NODE_H + ROW_GAP) - NODE_H / 2;
      const item = {
        id: String(n.id),
        node: n,
        depth,
        parentId: parentLayout ? parentLayout.id : null,
        x, y, w: NODE_W, h: NODE_H,
        hasChildren: Array.isArray(n.children) && n.children.length > 0,
        childCount: Array.isArray(n.children) ? n.children.length : 0,
        collapsed: Boolean(n.collapsed),
      };
      nodes.push(item);
      if (parentLayout) links.push({ from: parentLayout, to: item });
      let cursor = topUnit;
      for (const c of kids) {
        const cUnits = measureUnits(c);
        place(c, depth + 1, cursor, item);
        cursor += cUnits;
      }
    };
    place(root, 0, 0, null);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of nodes) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x + p.w > maxX) maxX = p.x + p.w;
      if (p.y + p.h > maxY) maxY = p.y + p.h;
    }
    return { nodes, links, minX, minY, maxX, maxY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
  }

  function applyMindmapTransform(stage) {
    const world = stage && stage.querySelector('.ns-mm-world');
    if (world) world.style.transform = `translate(${mindmapView.tx.toFixed(1)}px,${mindmapView.ty.toFixed(1)}px) scale(${mindmapView.scale.toFixed(3)})`;
    const pct = modal && modal.querySelector('#ns-mm-zoom-label');
    if (pct) pct.textContent = Math.round(mindmapView.scale * 100) + '%';
  }

  function fitMindmapToStage(layout, stage) {
    if (!stage || !layout || !layout.nodes.length) return;
    const sw = Math.max(260, stage.clientWidth || 620);
    const sh = Math.max(220, stage.clientHeight || 320);
    const pad = 28;
    const sx = (sw - pad * 2) / layout.width;
    const sy = (sh - pad * 2) / layout.height;
    const scale = Math.max(0.42, Math.min(1.15, Math.min(sx, sy)));
    mindmapView.scale = scale;
    mindmapView.tx = (sw - layout.width * scale) / 2 - layout.minX * scale;
    mindmapView.ty = (sh - layout.height * scale) / 2 - layout.minY * scale;
    applyMindmapTransform(stage);
  }

  function resetMindmapView(stage) {
    mindmapView = { scale: 1, tx: 22, ty: 24 };
    applyMindmapTransform(stage);
  }

  function renderGuest() {
    const guestMap = mindmapCurrent || cloneMindmapTree(SAMPLE_MINDMAP.root);
    if (!mindmapCurrent) mindmapCurrent = guestMap;
    if (!mindmapSelectedId) mindmapSelectedId = guestMap.id;
    $('ns-root').innerHTML =
      '<div class="ns-starters" style="padding:4px 16px 6px">' +
        '<button type="button" data-ns="guest-mode" data-g="tutor"' + (guestPreviewTab === 'tutor' ? ' style="border-color:var(--k-accent);color:var(--k-accent);font-weight:600"' : '') + '>Tutor sample</button>' +
        '<button type="button" data-ns="guest-mode" data-g="mindmap"' + (guestPreviewTab === 'mindmap' ? ' style="border-color:var(--k-accent);color:var(--k-accent);font-weight:600"' : '') + '>Mindmap preview</button>' +
      '</div>' +
      (guestPreviewTab === 'mindmap'
        ? '<div class="ns-scroll"><p class="ns-p">Explore how Study Studio organizes uploaded chapters into an editable concept map. Sign in to generate and save mindmaps from your own PDFs.</p><div id="ns-mindmap-host"></div></div>'
        : '<div class="ns-scroll"><p class="ns-p">Upload your notes or a chapter, then ask NexAI questions. It answers only from your material, shows the page it used, and says so when the answer is not there. This is a sample: nothing is uploaded and no AI is called.</p>' +
          '<div class="ns-doc"><div class="ns-dt">' + esc(SAMPLE.material) + '</div></div>' +
          '<div class="ns-log" style="margin-top:12px"><div class="ns-msg ns-user">' + esc(SAMPLE.question) + '</div>' +
          '<div class="ns-msg ns-ai">' + formatAnswer(SAMPLE.answer) + srcChips(SAMPLE.sources) + '</div></div></div>') +
      '<div class="ns-foot"><button type="button" class="ns-btn ns-primary" data-ns="signin">Sign in with Google to use your notes</button>' +
      '<button type="button" class="ns-btn" data-ns="close">Close</button></div>';
    if (guestPreviewTab === 'mindmap') renderMindmapBody(modal.querySelector('#ns-mindmap-host'), true);
  }

  function renderMain() {
    $('ns-root').innerHTML =
      '<div class="ns-tabs" role="tablist"><button type="button" class="ns-tab" role="tab" data-ns="tab" data-tab="tutor" id="ns-tab-tutor">Tutor</button>' +
      '<button type="button" class="ns-tab" role="tab" data-ns="tab" data-tab="quiz" id="ns-tab-quiz">Quiz</button>' +
      '<button type="button" class="ns-tab" role="tab" data-ns="tab" data-tab="cards" id="ns-tab-cards">Cards</button>' +
      '<button type="button" class="ns-tab" role="tab" data-ns="tab" data-tab="mindmap" id="ns-tab-mindmap">Mindmap</button>' +
      '<button type="button" class="ns-tab" role="tab" data-ns="tab" data-tab="revision" id="ns-tab-revision">Revision</button>' +
      '<button type="button" class="ns-tab" role="tab" data-ns="tab" data-tab="library" id="ns-tab-library">Library</button></div>' +
      '<div class="ns-status" id="ns-status" role="status" aria-live="polite"></div>' +
      '<div class="ns-panel" id="ns-panel-tutor">' +
        '<div class="ns-tools"><select id="ns-scope" aria-label="Ask about"></select></div>' +
        '<div class="ns-scroll" id="ns-chat"></div>' +
        '<div class="ns-starters" id="ns-starters">' + STARTERS.map((st, i) => '<button type="button" data-ns="starter" data-i="' + i + '">' + esc(st.label) + '</button>').join('') + '</div>' +
        '<div class="ns-bar"><textarea id="ns-question" maxlength="600" rows="1" placeholder="Ask about your material" aria-label="Question"></textarea>' +
        '<button type="button" class="ns-btn ns-primary" id="ns-ask" data-ns="ask">Ask</button></div></div>' +
      '<div class="ns-panel" id="ns-panel-quiz"><div class="ns-scroll" id="ns-quiz"></div></div>' +
      '<div class="ns-panel" id="ns-panel-cards"><div class="ns-scroll" id="ns-cards"></div></div>' +
      '<div class="ns-panel" id="ns-panel-mindmap"><div class="ns-scroll" id="ns-mindmap"></div></div>' +
      '<div class="ns-panel" id="ns-panel-revision"><div class="ns-scroll" id="ns-revision"></div></div>' +
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
    renderDocs(); renderChat(); renderQuiz(); renderCards(); renderMindmap(); setTab(tab);
  }

  const TABS = ['tutor', 'quiz', 'cards', 'mindmap', 'revision', 'library'];
  function setTab(name) {
    tab = TABS.includes(name) ? name : 'tutor';
    if (modal) modal.dataset.tab = tab;
    TABS.forEach((t) => {
      const on = t === tab;
      $('ns-tab-' + t).setAttribute('aria-selected', String(on));
      $('ns-panel-' + t).dataset.on = on ? '1' : '0';
    });
    if (tab === 'tutor') renderChat();
    if (tab === 'quiz') renderQuiz();
    if (tab === 'cards') renderCards();
    if (tab === 'mindmap') { renderMindmap(); if (adapter && !adapter.isGuest() && !mindmapList.length && !mindmapBusy) loadMindmapsList(); }
    if (tab === 'revision') loadRevision();
  }


  async function saveRevision(item) {
    if (!item || !item.topic) return;
    try { await call('POST', '/reviews', { topic: item.topic, prompt: item.prompt || '', answer: item.answer || '', documentId: item.documentId || undefined, sourcePage: item.sourcePage || undefined }); }
    catch (_) { /* scoring remains usable even if the network is temporarily unavailable */ }
  }

  async function fetchPushSummary() {
    try {
      const [cfgRes, prefRes] = await Promise.all([
        fetch('/api/push/config', { credentials: 'same-origin', cache: 'no-store' }),
        fetch('/api/push/preferences', { credentials: 'same-origin', cache: 'no-store' }),
      ]);
      const cfg = cfgRes.ok ? await cfgRes.json().catch(() => ({})) : {};
      const pref = prefRes.ok ? await prefRes.json().catch(() => ({})) : {};
      return { serverEnabled: !!cfg.enabled, userEnabled: pref.enabled !== false, reminderTime: pref.reminderTime || '09:00' };
    } catch (_) { return null; }
  }

  async function loadRevision() {
    const box = modal && modal.querySelector('#ns-revision');
    if (!box || revisionBusy) return;
    revisionBusy = true;
    box.innerHTML = working('Loading your revision plan');
    try {
      const [reviews, plans, pushInfo, calendar] = await Promise.all([
        call('GET', '/reviews'),
        call('GET', '/plans'),
        fetchPushSummary(),
        call('GET', '/calendar/status').catch(() => ({ connected: false, configured: false })),
      ]);
      revisionData = { reviews: reviews.items || [], due: reviews.due || 0, nextDueAt: reviews.nextDueAt || null, plans: plans.plans || [], pushInfo, calendar: calendar || { connected: false, configured: false } };
      renderRevision();
    } catch (e) {
      box.innerHTML = '<div class="ns-empty"><strong>Could not load revision</strong>' + esc(e.message || 'Try again.') + '<br><button class="ns-btn" data-ns="revision-refresh">Retry</button></div>';
    } finally { revisionBusy = false; }
  }

  function renderStudyHabitCard(plans) {
    if (!adapter || typeof adapter.getStudyHabit !== 'function') return '';
    const info = adapter.getStudyHabit() || {};
    const habit = info.habit || null;
    const stats = info.stats || { current: 0, best: 0, doneToday: false, goal: 7, weekDone: 0, mode: 'day' };
    const dailyMins = (plans && plans[0] && plans[0].dailyMinutes) || info.dailyMinutes || 60;
    const goalDays = stats.goal || 7;
    const streakLine = stats.current > 0
      ? '\uD83D\uDD25 ' + stats.current + '-' + (stats.mode === 'week' ? 'week' : 'day') + ' study streak' + (stats.best > stats.current ? ' · best ' + stats.best : '')
      : 'No study streak yet';
    const progressLine = stats.doneToday
      ? 'Today\u2019s goal complete (' + dailyMins + ' min target)' + (stats.mode === 'week' ? ' · ' + stats.weekDone + '/' + goalDays + ' this week' : '')
      : 'Daily target: ' + dailyMins + ' min' + (stats.mode === 'week' ? ' · ' + stats.weekDone + '/' + goalDays + ' days this week' : ' · pending today');
    const goalOptions = [7, 6, 5, 4, 3].map((n) => '<option value="' + n + '"' + (n === goalDays ? ' selected' : '') + '>' + (n === 7 ? 'Every day' : n + ' days/wk') + '</option>').join('');
    return '<div class="ns-miss-item" style="margin-top:0;margin-bottom:14px">' +
      '<div class="ns-qhead"><strong>Study streak &amp; daily goal</strong><span>' + esc(habit ? habit.name : 'Habits sync') + '</span></div>' +
      '<div style="font-size:14px;font-weight:600;margin:4px 0">' + esc(streakLine) + '</div>' +
      '<div class="ns-dm">' + esc(progressLine) + '</div>' +
      '<div class="ns-actions" style="align-items:center">' +
        '<button type="button" class="ns-btn ns-small ' + (stats.doneToday ? '' : 'ns-primary') + '" data-ns="study-checkin">' + (stats.doneToday ? '\u2713 Studied today' : 'Mark today\u2019s study done') + '</button>' +
        '<select id="ns-habit-goal" aria-label="Weekly study goal" style="width:auto;min-height:34px;padding:4px 10px;font-size:12.5px">' + goalOptions + '</select>' +
        '<button type="button" class="ns-btn ns-small" data-ns="habit-save">' + (habit ? 'Update habit goal' : 'Create study habit') + '</button>' +
      '</div></div>';
  }

  function renderRevision() {
    const box = modal && modal.querySelector('#ns-revision');
    if (!box || !revisionData) return;
    const now = Date.now();
    const due = revisionData.reviews.filter((x) => new Date(x.dueAt).getTime() <= now);
    const upcoming = revisionData.reviews.filter((x) => new Date(x.dueAt).getTime() > now);
    const dateText = (d) => new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    const pInfo = revisionData.pushInfo;
    const pushHint = pInfo
      ? (pInfo.serverEnabled
        ? (pInfo.userEnabled ? 'Push alerts active (daily from ' + esc(pInfo.reminderTime) + ' when items are due).' : 'Push alerts are paused in your Settings.')
        : 'Enable Web Push keys on the server to receive background revision reminders.')
      : '';
    box.innerHTML = renderStudyHabitCard(revisionData.plans) +
      '<div class="ns-qhead"><strong>Spaced revision</strong><span>' + due.length + ' due now · ' + revisionData.reviews.length + ' tracked</span></div>' +
      '<p class="ns-p">Missed quiz questions and cards marked “Again” appear here. Review them today, then NexOS automatically sets the next due date (1, 3, 7, 14 or 30 days).' + (pushHint ? ' ' + pushHint : '') + '</p>' +
      (due.length ? due.map((x) => '<div class="ns-miss-item"><strong>' + esc(x.topic) + '</strong>' + (x.prompt ? '<p class="ns-p">' + esc(x.prompt) + '</p>' : '') +
        (x.answer ? '<p class="ns-dm">' + esc(x.answer) + '</p>' : '') +
        '<div class="ns-actions"><button class="ns-btn ns-small" data-ns="rate-review" data-id="' + esc(x.id) + '" data-rating="again">Again · 1 day</button><button class="ns-btn ns-small" data-ns="rate-review" data-id="' + esc(x.id) + '" data-rating="hard">Hard</button><button class="ns-btn ns-primary ns-small" data-ns="rate-review" data-id="' + esc(x.id) + '" data-rating="good">Got it</button></div></div>').join('') : '<div class="ns-empty"><strong>You are caught up</strong>No revision items are due right now.</div>') +
      (upcoming.length ? '<details class="ns-miss-item" style="margin-top:10px"><summary style="cursor:pointer;font-weight:600;font-size:13px">Upcoming scheduled revisions (' + upcoming.length + ')</summary><div style="margin-top:8px">' +
        upcoming.slice(0, 20).map((x) => '<div style="display:flex;justify-content:space-between;gap:8px;padding:4px 0;border-top:1px solid var(--k-line);font-size:12.5px"><span style="min-width:0;overflow-wrap:anywhere">' + esc(x.topic) + '</span><span class="ns-dm" style="white-space:nowrap">Due ' + esc(dateText(x.dueAt)) + ' · ' + (x.intervalDays || 1) + 'd</span></div>').join('') +
      '</div></details>' : '') +
      '<div class="ns-divider" style="height:1px;background:var(--k-line);margin:18px 0"></div><h4 style="margin:0 0 8px">Exam planner &amp; Google Calendar blocks</h4>' +
      '<p class="ns-p">Build a plan around your exam date and daily study time, then schedule daily revision time-blocks in Google Calendar or your task board.</p>' +
      (revisionData.calendar && revisionData.calendar.configured
        ? '<div class="ns-actions" style="margin:6px 0 10px;align-items:center"><span class="ns-dm">Google Calendar API: ' + (revisionData.calendar.connected ? 'Connected' : 'Not connected') + '</span>' +
          (revisionData.calendar.connected ? '<button type="button" class="ns-btn ns-small" data-ns="calendar-disconnect">Disconnect Calendar</button>' : '<button type="button" class="ns-btn ns-small" data-ns="calendar-connect">Connect Google Calendar</button>') + '</div>'
        : '') +
      '<div class="ns-fields"><input id="ns-plan-title" type="text" maxlength="100" placeholder="Exam name (e.g. Data Structures)"><input id="ns-plan-subject" type="text" maxlength="60" placeholder="Subject (optional)">' +
      '<input id="ns-plan-date" type="date"><input id="ns-plan-minutes" type="number" min="10" max="600" value="60" placeholder="Minutes per day"></div>' +
      '<textarea id="ns-plan-topics" rows="3" placeholder="Topics, one per line"></textarea><button class="ns-btn ns-primary" data-ns="plan-create" style="width:100%;margin-top:8px">Create exam plan</button>' +
      (revisionData.plans.length ? '<div style="display:flex;align-items:center;gap:8px;margin-top:12px"><label for="ns-plan-start-time" class="ns-dm">Preferred revision block time:</label><input id="ns-plan-start-time" type="time" value="' + esc(planStartTime) + '" style="width:auto;padding:6px 10px"></div>' : '') +
      (revisionData.plans.map((p) => {
        const complete = new Set(p.completedTopics || []);
        const days = Math.max(0, Math.ceil((new Date(p.examDate).getTime() - now) / 86400000));
        return '<div class="ns-miss-item"><strong>' + esc(p.title) + '</strong><span class="ns-dm"> · ' + days + ' days left · ' + complete.size + '/' + p.topics.length + ' topics · ' + p.dailyMinutes + ' min/day</span>' +
          '<div class="ns-meter"><i style="width:' + Math.round(complete.size / Math.max(1, p.topics.length) * 100) + '%"></i></div>' +
          p.topics.map((topic, i) => '<label style="display:flex;gap:8px;align-items:center;padding:5px 0;font-size:13px"><input type="checkbox" data-ns="plan-topic" data-id="' + esc(p.id) + '" data-index="' + i + '"' + (complete.has(topic) ? ' checked' : '') + '>' + esc(topic) + '</label>').join('') +
          '<div class="ns-actions">' +
            (revisionData.calendar && revisionData.calendar.connected ? '<button type="button" class="ns-btn ns-primary ns-small" data-ns="plan-calendar-sync" data-id="' + esc(p.id) + '">Sync to Google Calendar</button>' : '') +
            '<button type="button" class="ns-btn ' + (revisionData.calendar && revisionData.calendar.connected ? '' : 'ns-primary ') + 'ns-small" data-ns="plan-gcal" data-id="' + esc(p.id) + '">Add to Google Calendar</button>' +
            '<button type="button" class="ns-btn ns-small" data-ns="plan-ics" data-id="' + esc(p.id) + '">Download .ics</button>' +
            (adapter && typeof adapter.addStudyTasks === 'function' ? '<button type="button" class="ns-btn ns-small" data-ns="plan-tasks" data-id="' + esc(p.id) + '">Add today\u2019s block to Tasks</button>' : '') +
            '<button type="button" class="ns-btn ns-small" data-ns="plan-delete" data-id="' + esc(p.id) + '">Delete plan</button>' +
          '</div></div>';
      }).join('') || '<p class="ns-dm">No exam plans yet.</p>');
    const stInput = modal.querySelector('#ns-plan-start-time');
    if (stInput) stInput.addEventListener('change', () => { if (/^([01]\d|2[0-3]):[0-5]\d$/.test(stInput.value)) planStartTime = stInput.value; });
  }

  async function rateReview(id, rating) {
    try {
      const out = await call('POST', '/reviews/' + encodeURIComponent(id) + '/rate', { rating, timeZone: localTimeZone() });
      const dueLabel = out && out.dueAt ? new Date(out.dueAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '';
      let streakMsg = '';
      if (adapter && typeof adapter.recordStudyCheckIn === 'function') {
        const res = adapter.recordStudyCheckIn();
        if (res && res.stats && res.stats.current > 0) streakMsg = ' Study streak: ' + res.stats.current + '!';
      }
      setStatus((dueLabel ? 'Completed — next due ' + dueLabel + ' (' + out.intervalDays + 'd).' : 'Revision updated.') + streakMsg);
      await loadRevision();
    } catch (e) { setStatus(e.message || 'Could not save review.'); }
  }

  async function connectCalendar() {
    try {
      const out = await call('GET', '/calendar/connect');
      if (!out.url) throw new Error('Google did not return an authorization URL.');
      window.location.assign(out.url);
    } catch (e) { setStatus(e.message || 'Could not connect Google Calendar.'); }
  }

  async function syncPlanToGoogleCalendar(id) {
    try {
      const out = await call('POST', '/plans/' + encodeURIComponent(id) + '/calendar/sync', { startTime: planStartTime, timeZone: localTimeZone() });
      setStatus('Google Calendar synced: ' + out.created + ' created, ' + out.updated + ' updated, ' + out.deleted + ' removed.');
    } catch (e) { setStatus(e.message || 'Could not sync Google Calendar.'); }
  }

  async function openPlanGoogleCalendar(id) {
    try {
      const tz = localTimeZone();
      const data = await call('GET', '/plans/' + encodeURIComponent(id) + '/schedule?startTime=' + encodeURIComponent(planStartTime) + '&tz=' + encodeURIComponent(tz));
      if (!data.googleCalendarUrl) { setStatus('No upcoming revision blocks to schedule.'); return; }
      window.open(data.googleCalendarUrl, '_blank', 'noopener,noreferrer');
      setStatus('Opened Google Calendar with your daily ' + data.startTime + ' revision time-block.');
    } catch (e) { setStatus(e.message || 'Could not build Google Calendar event.'); }
  }

  function downloadPlanIcs(id) {
    const tz = localTimeZone();
    window.open('/api/study/plans/' + encodeURIComponent(id) + '/calendar.ics?startTime=' + encodeURIComponent(planStartTime) + '&tz=' + encodeURIComponent(tz), '_blank', 'noopener');
    setStatus('Downloading .ics schedule for Google Calendar / Apple Calendar.');
  }

  async function addPlanBlockToTasks(id) {
    if (!adapter || typeof adapter.addStudyTasks !== 'function') return;
    try {
      const tz = localTimeZone();
      const data = await call('GET', '/plans/' + encodeURIComponent(id) + '/schedule?startTime=' + encodeURIComponent(planStartTime) + '&tz=' + encodeURIComponent(tz));
      const first = data.blocks && data.blocks[0];
      if (!first) { setStatus('No revision blocks available.'); return; }
      const r = adapter.addStudyTasks([{
        title: `${first.title} (${first.startTime}–${first.endTime})`,
        description: first.description,
        priority: 'high',
        due: first.date,
      }]);
      setStatus(r && r.added ? 'Added today\u2019s revision time-block to your Tasks & Calendar.' : 'Today\u2019s revision block is already on your task board.');
    } catch (e) { setStatus(e.message || 'Could not add block to tasks.'); }
  }

  async function createPlan() {
    if (busy) return;
    const title = ($('ns-plan-title').value || '').trim();
    const subject = ($('ns-plan-subject').value || '').trim();
    const examDate = $('ns-plan-date').value;
    const dailyMinutes = Number($('ns-plan-minutes').value);
    const topics = ($('ns-plan-topics').value || '').split(/\n+/).map((x) => x.trim()).filter(Boolean);
    if (title.length < 2 || !examDate || !topics.length) {
      setStatus('Enter an exam title, future date and at least one topic.');
      return;
    }
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata';
    busy = true;
    try {
      await call('POST', '/plans', { title, subject, examDate, dailyMinutes, topics, studyTime: planStartTime, timeZone: tz });
      $('ns-plan-title').value = '';
      $('ns-plan-topics').value = '';
      setStatus('Exam plan created.');
      await loadRevision();
    } catch (e) { setStatus(e.message || 'Could not create plan.'); }
    finally { busy = false; }
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
    if (!docs.some((d) => d.id === qopts.docId)) qopts.docId = '';
    if (!docs.some((d) => d.id === copts.docId)) copts.docId = '';
    if (!quiz) renderQuiz();
    if (!deck) renderCards();
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

  /* ---------- Quiz and Cards (4.4.0). Progress lives in this dialog only; nothing is saved. ---------- */
  const LETTERS = 'ABCD';
  const scopeOptions = (selected) => '<option value="">All my material</option>' + docs.map((d) => '<option value="' + esc(d.id) + '"' + (d.id === selected ? ' selected' : '') + '>' + esc(d.title) + '</option>').join('');
  const emptyLibrary = (what) => '<div class="ns-empty"><strong>Your library is empty</strong>Add a chapter or your notes first. ' + what + '.<br><button type="button" class="ns-btn ns-primary" data-ns="tab" data-tab="library">Add your first document</button></div>';
  const meter = (done, total) => '<div class="ns-meter"><i style="width:' + Math.round(done / Math.max(1, total) * 100) + '%"></i></div>';

  function setupForm(kind, o) {
    const counts = kind === 'quiz' ? [3, 5, 8, 10] : [5, 10, 15, 20];
    const noun = kind === 'quiz' ? ' questions' : ' cards';
    return '<p class="ns-p">' + (kind === 'quiz'
      ? 'NexAI writes multiple-choice questions from your material, marks each answer and explains it with the page it came from.'
      : 'NexAI turns your material into flashcards. Flip each card, then mark whether you knew it.') + '</p>' +
      '<div class="ns-fields3"><select data-opt="docId" aria-label="Material">' + scopeOptions(o.docId) + '</select>' +
      '<select data-opt="count" aria-label="How many">' + counts.map((n) => '<option value="' + n + '"' + (n === o.count ? ' selected' : '') + '>' + n + noun + '</option>').join('') + '</select>' +
      (kind === 'quiz' ? '<select data-opt="level" aria-label="Difficulty">' + ['easy', 'medium', 'hard'].map((l) => '<option value="' + l + '"' + (l === o.level ? ' selected' : '') + '>' + l[0].toUpperCase() + l.slice(1) + '</option>').join('') + '</select>' : '') + '</div>' +
      '<input type="text" data-opt="topic" maxlength="120" placeholder="Topic (optional), for example photosynthesis" aria-label="Topic" value="' + esc(o.topic) + '">' +
      '<button type="button" class="ns-btn ns-primary" data-ns="make-' + kind + '" style="width:100%;margin-top:10px">' + (kind === 'quiz' ? 'Make my quiz' : 'Make my flashcards') + '</button>';
  }
  const working = (title) => '<div class="ns-empty"><strong>' + title + '</strong>NexAI is reading your material. This takes a few seconds.</div>';

  function renderQuiz() {
    const box = modal && modal.querySelector('#ns-quiz');
    if (!box) return;
    if (!docs.length) { box.innerHTML = emptyLibrary('Then NexAI can quiz you on it'); return; }
    if (building === 'quiz') { box.innerHTML = working('Writing your quiz'); return; }
    if (!quiz) { box.innerHTML = setupForm('quiz', qopts); return; }
    const n = quiz.items.length;
    const right = quiz.picks.filter((p, i) => p === quiz.items[i].answer).length;
    if (quiz.done) {
      const missed = quiz.items.filter((q, i) => quiz.picks[i] !== q.answer);
      box.innerHTML = '<div class="ns-score">' + right + ' / ' + n + '</div><p class="ns-p" style="text-align:center">' +
        (right === n ? 'Perfect. Try a harder level or another chapter.' : right >= n * 0.7 ? 'Good work. Review what you missed below.' : 'Keep going. The questions you missed are below.') + '</p>' +
        missed.map((q) => '<div class="ns-miss-item"><strong>' + esc(q.question) + '</strong><br>Answer: ' + esc(q.options[q.answer]) + (q.explanation ? '<br><span class="ns-dm">' + esc(q.explanation) + '</span>' : '') + oneChip(q.source) + '</div>').join('') +
        '<div class="ns-actions">' + (missed.length ? '<button type="button" class="ns-btn ns-primary" data-ns="quiz-retry">Retry the ' + missed.length + ' I missed</button>' : '') +
        '<button type="button" class="ns-btn" data-ns="quiz-new">New quiz</button></div>';
      return;
    }
    const q = quiz.items[quiz.i], picked = quiz.picks[quiz.i], answered = picked !== undefined;
    box.innerHTML = '<div class="ns-qhead"><span>Question ' + (quiz.i + 1) + ' of ' + n + '</span><span>' + right + ' right</span></div>' + meter(quiz.i + (answered ? 1 : 0), n) +
      '<div class="ns-qtext">' + esc(q.question) + '</div>' +
      q.options.map((o, k) => '<button type="button" class="ns-opt' + (answered ? (k === q.answer ? ' ns-ok' : k === picked ? ' ns-bad' : ' ns-dim') : '') + '" data-ns="pick" data-i="' + k + '"' + (answered ? ' disabled' : '') + '><b>' + LETTERS[k] + '</b><span>' + esc(o) + '</span></button>').join('') +
      (answered ? '<div class="ns-expl"><strong class="' + (picked === q.answer ? 'ns-yes">Correct.' : 'ns-no">Not quite.') + '</strong> ' +
        (picked === q.answer ? '' : 'The answer is ' + LETTERS[q.answer] + '. ') + esc(q.explanation) + oneChip(q.source) + '</div>' +
        '<div class="ns-actions"><button type="button" class="ns-btn ns-primary" data-ns="quiz-next">' + (quiz.i + 1 < n ? 'Next question' : 'See my score') + '</button></div>' : '');
  }

  function renderMindmap() {
    const box = modal && modal.querySelector('#ns-mindmap');
    if (!box) return;
    renderMindmapBody(box, false);
  }

  function renderMindmapBody(box, isGuestView) {
    if (!box) return;
    if (mindmapBusy) { box.innerHTML = working('Building your mindmap'); return; }
    const controls = isGuestView ? '' : (
      '<p class="ns-p">Turn uploaded notes or a focus topic into a structured, editable concept map with page references.</p>' +
      '<div class="ns-mm-toolbar">' +
        '<select id="ns-mm-doc" aria-label="Study material">' + scopeOptions(mindmapOpts.docId) + '</select>' +
        '<input type="text" id="ns-mm-topic" maxlength="120" placeholder="Focus topic (optional)" aria-label="Focus topic" value="' + esc(mindmapOpts.topic) + '">' +
        '<button type="button" class="ns-btn ns-primary ns-small" data-ns="mm-generate"' + (!docs.length ? ' disabled' : '') + '>Generate Mindmap</button>' +
      '</div>' +
      '<div class="ns-mm-actions-row">' +
        '<button type="button" class="ns-btn ns-small" data-ns="mm-blank">New blank map</button>' +
        (mindmapCurrent ? '<button type="button" class="ns-btn ns-primary ns-small" data-ns="mm-save">' + (mindmapCurrent.savedId ? (mindmapDirty ? 'Save changes*' : 'Saved ✓') : 'Save mindmap') + '</button>' : '') +
        (mindmapCurrent && mindmapCurrent.savedId ? '<button type="button" class="ns-btn ns-small" data-ns="mm-save-new">Save as new</button><button type="button" class="ns-btn ns-small" data-ns="mm-delete-saved">Delete map</button>' : '') +
      '</div>' +
      (mindmapList.length ? '<div class="ns-mm-saved" aria-label="Saved mindmaps">' + mindmapList.map((m) =>
        '<button type="button" class="ns-mm-chip" data-ns="mm-open" data-id="' + esc(m.id) + '" data-active="' + (mindmapCurrent && mindmapCurrent.savedId === m.id ? '1' : '0') + '">' +
        esc(m.title) + ' <span class="ns-dm">(' + (m.nodeCount || 1) + ')</span></button>'
      ).join('') + '</div>' : '')
    );

    const rootTree = mindmapCurrent ? mindmapCurrent.root : null;
    if (!rootTree) {
      box.innerHTML = controls + (!docs.length && !isGuestView
        ? emptyLibrary('Then NexAI can turn your notes into a mindmap, or start with a blank map above')
        : '<div class="ns-empty"><strong>Build your first mindmap</strong>Pick a document or enter a focus topic above and click <b>Generate Mindmap</b>, or click <b>New blank map</b>.</div>');
      bindMindmapToolbarInputs(box);
      return;
    }

    const layout = layoutMindmapTree(rootTree);
    const totalNodes = countMindmapNodes(rootTree);
    if (!mindmapSelectedId || !findMindmapNode(rootTree, mindmapSelectedId)) mindmapSelectedId = rootTree.id;
    const hit = findMindmapNode(rootTree, mindmapSelectedId);
    const sel = hit ? hit.node : rootTree;
    const selDepth = hit ? hit.depth : 0;

    const linksSvg = layout.links.map((l) => {
      const x1 = l.from.x + l.from.w, y1 = l.from.y + l.from.h / 2;
      const x2 = l.to.x, y2 = l.to.y + l.to.h / 2;
      const mx = (x1 + x2) / 2;
      return `<path d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}"/>`;
    }).join('');

    const nodesHtml = layout.nodes.map((n) => {
      const refText = n.node.sourceRef ? sourceLabel(n.node.sourceRef) : '';
      return '<div class="ns-mm-node" role="treeitem" tabindex="0" data-ns="mm-select" data-id="' + esc(n.id) + '" data-depth="' + n.depth + '" data-selected="' + (n.id === mindmapSelectedId ? '1' : '0') + '" style="left:' + n.x + 'px;top:' + n.y + 'px;width:' + n.w + 'px;min-height:' + n.h + 'px">' +
        '<div class="ns-mm-nhead"><span class="ns-mm-ntitle">' + esc(n.node.label) + '</span>' +
        (n.hasChildren ? '<button type="button" class="ns-mm-toggle" data-ns="mm-toggle" data-id="' + esc(n.id) + '" aria-label="' + (n.collapsed ? 'Expand ' : 'Collapse ') + esc(n.node.label) + '">' + (n.collapsed ? '+' : '−') + '</button>' : '') +
        '</div>' +
        (refText ? '<div class="ns-mm-nsrc">' + esc(refText) + '</div>' : (n.collapsed ? '<div class="ns-mm-nsrc">' + n.childCount + ' hidden</div>' : '')) +
      '</div>';
    }).join('');

    const srcRefHtml = sel.sourceRef
      ? '<div class="ns-srcs" style="margin-top:6px"><span class="ns-src">Source: ' + esc(sourceLabel(sel.sourceRef)) + '</span>' +
        (sel.sourceRef.excerpt ? '<div class="ns-excerpt" style="width:100%">' + esc(sel.sourceRef.excerpt) + '</div>' : '') + '</div>'
      : '';

    const inspector = '<div class="ns-mm-inspector">' +
      '<div class="ns-qhead"><strong>' + esc(sel.label) + '</strong><span>' + totalNodes + ' / 65 nodes' + (mindmapCurrent.sourceTitle ? ' · ' + esc(mindmapCurrent.sourceTitle) : '') + '</span></div>' +
      (sel.summary ? '<p class="ns-dm" style="margin-top:4px">' + esc(sel.summary) + '</p>' : '') +
      srcRefHtml +
      (mindmapEditing
        ? '<div class="ns-mm-editgrid">' +
            '<input type="text" id="ns-mm-edit-label" maxlength="90" value="' + esc(sel.label) + '" aria-label="Node title" placeholder="Node title">' +
            '<input type="text" id="ns-mm-edit-summary" maxlength="220" value="' + esc(sel.summary || '') + '" aria-label="Node note" placeholder="Short note (optional)">' +
          '</div><div class="ns-actions" style="margin-top:8px">' +
            '<button type="button" class="ns-btn ns-primary ns-small" data-ns="mm-edit-apply">Save node</button>' +
            '<button type="button" class="ns-btn ns-small" data-ns="mm-edit-cancel">Cancel</button>' +
          '</div>'
        : '<div class="ns-actions" style="margin-top:8px">' +
            '<button type="button" class="ns-btn ns-small" data-ns="mm-edit-open">Edit node</button>' +
            '<button type="button" class="ns-btn ns-small" data-ns="mm-add-child"' + (selDepth >= 3 || totalNodes >= 65 ? ' disabled' : '') + '>+ Sub-branch</button>' +
            (selDepth > 0 ? '<button type="button" class="ns-btn ns-small" data-ns="mm-add-sibling"' + (totalNodes >= 65 ? ' disabled' : '') + '>+ Sibling</button>' : '') +
            (Array.isArray(sel.children) && sel.children.length ? '<button type="button" class="ns-btn ns-small" data-ns="mm-toggle" data-id="' + esc(sel.id) + '">' + (sel.collapsed ? 'Expand branch' : 'Collapse branch') + '</button>' : '') +
            (selDepth > 0 ? '<button type="button" class="ns-btn ns-small" data-ns="mm-del-node">Delete node</button>' : '') +
          '</div>') +
    '</div>';

    box.innerHTML = controls +
      '<div class="ns-mm-stage" id="ns-mm-stage" role="tree" aria-label="Study mindmap canvas">' +
        '<div class="ns-mm-world"><svg class="ns-mm-links" width="' + Math.max(400, layout.maxX + 80) + '" height="' + Math.max(300, layout.maxY + 80) + '">' + linksSvg + '</svg>' + nodesHtml + '</div>' +
        '<div class="ns-mm-hud">' +
          '<button type="button" data-ns="mm-zoom-out" aria-label="Zoom out">−</button>' +
          '<button type="button" id="ns-mm-zoom-label" data-ns="mm-reset" title="Reset view">100%</button>' +
          '<button type="button" data-ns="mm-zoom-in" aria-label="Zoom in">+</button>' +
          '<button type="button" data-ns="mm-fit">Fit</button>' +
          '<button type="button" data-ns="mm-expand-all">Expand</button>' +
          '<button type="button" data-ns="mm-collapse-all">Collapse</button>' +
        '</div>' +
      '</div>' +
      inspector;

    bindMindmapToolbarInputs(box);
    const stage = box.querySelector('#ns-mm-stage');
    if (mindmapCurrent._needsFit) {
      mindmapCurrent._needsFit = false;
      fitMindmapToStage(layout, stage);
    } else {
      applyMindmapTransform(stage);
    }
    bindMindmapStageInteractions(stage);
  }

  function bindMindmapToolbarInputs(box) {
    const docSel = box.querySelector('#ns-mm-doc');
    const topicIn = box.querySelector('#ns-mm-topic');
    if (docSel) docSel.addEventListener('change', () => { mindmapOpts.docId = docSel.value; });
    if (topicIn) topicIn.addEventListener('input', () => { mindmapOpts.topic = topicIn.value; });
    const editTitle = box.querySelector('#ns-mm-edit-label');
    if (editTitle) {
      editTitle.focus();
      editTitle.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); applyMindmapNodeEdit(); }
      });
    }
  }

  function bindMindmapStageInteractions(stage) {
    if (!stage || stage._mmBound) return;
    stage._mmBound = true;
    let dragging = false, startX = 0, startY = 0, origTx = 0, origTy = 0;
    stage.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button, input, select, .ns-mm-node, .ns-mm-hud')) return;
      dragging = true;
      startX = e.clientX; startY = e.clientY;
      origTx = mindmapView.tx; origTy = mindmapView.ty;
      stage.dataset.pan = '1';
      try { stage.setPointerCapture(e.pointerId); } catch (_) {}
    });
    stage.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      mindmapView.tx = origTx + (e.clientX - startX);
      mindmapView.ty = origTy + (e.clientY - startY);
      applyMindmapTransform(stage);
    });
    const endPan = () => { dragging = false; stage.dataset.pan = '0'; };
    stage.addEventListener('pointerup', endPan);
    stage.addEventListener('pointercancel', endPan);
    stage.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = stage.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const prev = mindmapView.scale;
      const next = Math.max(0.4, Math.min(2, prev * (e.deltaY < 0 ? 1.12 : 0.89)));
      mindmapView.tx = cx - (cx - mindmapView.tx) * (next / prev);
      mindmapView.ty = cy - (cy - mindmapView.ty) * (next / prev);
      mindmapView.scale = next;
      applyMindmapTransform(stage);
    }, { passive: false });
  }

  function rerenderActiveMindmap() {
    if (adapter && adapter.isGuest()) renderGuest();
    else renderMindmap();
  }

  function applyMindmapNodeEdit() {
    if (!mindmapCurrent || !mindmapCurrent.root) return;
    const hit = findMindmapNode(mindmapCurrent.root, mindmapSelectedId);
    if (!hit) return;
    const labelIn = modal.querySelector('#ns-mm-edit-label');
    const summaryIn = modal.querySelector('#ns-mm-edit-summary');
    const nextLabel = String(labelIn ? labelIn.value : '').replace(/\s+/g, ' ').trim().slice(0, 90);
    if (!nextLabel) { setStatus('Node title cannot be empty.'); return; }
    hit.node.label = nextLabel;
    hit.node.summary = String(summaryIn ? summaryIn.value : '').replace(/\s+/g, ' ').trim().slice(0, 220);
    if (hit.depth === 0) mindmapCurrent.title = nextLabel;
    mindmapEditing = false;
    mindmapDirty = true;
    setStatus('');
    rerenderActiveMindmap();
  }

  function addMindmapNode(asSibling) {
    if (!mindmapCurrent || !mindmapCurrent.root) return;
    if (countMindmapNodes(mindmapCurrent.root) >= 65) { setStatus('Mindmap reached the 65-node limit.'); return; }
    const hit = findMindmapNode(mindmapCurrent.root, mindmapSelectedId);
    if (!hit) return;
    const targetParent = asSibling ? hit.parent : hit.node;
    const targetDepth = asSibling ? hit.depth : hit.depth + 1;
    if (!targetParent || targetDepth >= 4) { setStatus('Maximum 4 levels supported.'); return; }
    targetParent.collapsed = false;
    targetParent.children = Array.isArray(targetParent.children) ? targetParent.children : [];
    const newId = 'mm_u_' + Date.now().toString(36) + '_' + (++mmSeq);
    targetParent.children.push({ id: newId, label: 'New concept', summary: '', children: [] });
    mindmapSelectedId = newId;
    mindmapEditing = true;
    mindmapDirty = true;
    setStatus('');
    rerenderActiveMindmap();
  }

  function deleteMindmapSelected() {
    if (!mindmapCurrent || !mindmapCurrent.root) return;
    const hit = findMindmapNode(mindmapCurrent.root, mindmapSelectedId);
    if (!hit || !hit.parent) { setStatus('Central topic cannot be deleted (edit its title instead).'); return; }
    hit.parent.children = (hit.parent.children || []).filter((c) => String(c.id) !== String(hit.node.id));
    mindmapSelectedId = hit.parent.id;
    mindmapEditing = false;
    mindmapDirty = true;
    setStatus('Removed node.');
    rerenderActiveMindmap();
  }

  async function loadMindmapsList() {
    try {
      const data = await call('GET', '/mindmaps');
      mindmapList = Array.isArray(data.mindmaps) ? data.mindmaps : [];
      if (tab === 'mindmap') renderMindmap();
    } catch (_) {}
  }

  async function generateMindmap() {
    if (busy || mindmapBusy) return;
    if (!docs.length) { setStatus('Add study material first.'); setTab('library'); return; }
    const prev = mindmapCurrent;
    busy = true; mindmapBusy = true;
    renderMindmap();
    setStatus('Building a structured mindmap from your notes.', true);
    try {
      const out = await call('POST', '/mindmaps/generate', {
        docId: mindmapOpts.docId || undefined,
        topic: String(mindmapOpts.topic || '').trim() || undefined,
      });
      const draft = out.draft;
      mindmapCurrent = {
        savedId: null,
        title: draft.title || draft.root.label,
        topic: draft.topic || '',
        sourceTitle: draft.sourceTitle || '',
        documentId: draft.documentId || null,
        root: draft.root,
        _needsFit: true,
      };
      mindmapSelectedId = draft.root.id;
      mindmapDirty = true;
      mindmapEditing = false;
      setStatus('Mindmap generated (' + countMindmapNodes(draft.root) + ' nodes). Click Save mindmap to keep it.');
    } catch (e) {
      mindmapCurrent = prev; // Preserve existing map on error!
      setStatus((e && e.message) || 'Could not generate a mindmap right now.');
    } finally {
      busy = false; mindmapBusy = false;
      renderMindmap();
    }
  }

  async function saveCurrentMindmap(asNew) {
    if (busy || !mindmapCurrent || !mindmapCurrent.root) return;
    busy = true;
    setStatus('Saving mindmap.', true);
    try {
      const payload = {
        title: mindmapCurrent.root.label,
        topic: mindmapCurrent.topic || '',
        sourceTitle: mindmapCurrent.sourceTitle || '',
        documentId: mindmapCurrent.documentId || null,
        root: mindmapCurrent.root,
      };
      const out = (mindmapCurrent.savedId && !asNew)
        ? await call('PUT', '/mindmaps/' + encodeURIComponent(mindmapCurrent.savedId), payload)
        : await call('POST', '/mindmaps', payload);
      const saved = out.mindmap;
      mindmapCurrent.savedId = saved.id;
      mindmapCurrent.title = saved.title;
      mindmapCurrent.root = saved.root;
      mindmapDirty = false;
      await loadMindmapsList();
      setStatus('Mindmap saved.');
    } catch (e) {
      setStatus((e && e.message) || 'Could not save mindmap.');
    } finally {
      busy = false;
      renderMindmap();
    }
  }

  async function openSavedMindmap(id) {
    if (busy || !id) return;
    busy = true;
    setStatus('Opening saved mindmap.', true);
    try {
      const out = await call('GET', '/mindmaps/' + encodeURIComponent(id));
      const m = out.mindmap;
      mindmapCurrent = {
        savedId: m.id,
        title: m.title,
        topic: m.topic || '',
        sourceTitle: m.sourceTitle || '',
        documentId: m.documentId || null,
        root: m.root,
        _needsFit: true,
      };
      mindmapSelectedId = m.root.id;
      mindmapDirty = false;
      mindmapEditing = false;
      setStatus('');
    } catch (e) {
      setStatus((e && e.message) || 'Could not open saved mindmap.');
    } finally {
      busy = false;
      renderMindmap();
    }
  }

  async function deleteSavedMindmap() {
    if (busy || !mindmapCurrent || !mindmapCurrent.savedId) return;
    if (!window.confirm('Delete "' + mindmapCurrent.title + '"? This cannot be undone.')) return;
    busy = true;
    try {
      await call('DELETE', '/mindmaps/' + encodeURIComponent(mindmapCurrent.savedId));
      mindmapCurrent = null;
      mindmapSelectedId = null;
      mindmapDirty = false;
      await loadMindmapsList();
      setStatus('Deleted mindmap.');
    } catch (e) {
      setStatus((e && e.message) || 'Could not delete mindmap.');
    } finally {
      busy = false;
      renderMindmap();
    }
  }

  function renderCards() {
    const box = modal && modal.querySelector('#ns-cards');
    if (!box) return;
    if (!docs.length) { box.innerHTML = emptyLibrary('Then NexAI can make flashcards from it'); return; }
    if (building === 'cards') { box.innerHTML = working('Making your flashcards'); return; }
    if (!deck) { box.innerHTML = setupForm('cards', copts); return; }
    const n = deck.cards.length;
    if (deck.done) {
      box.innerHTML = '<div class="ns-score">' + deck.known + ' / ' + n + '</div><p class="ns-p" style="text-align:center">' + (deck.missed.length ? 'cards you knew. Go over the ' + deck.missed.length + ' you missed again.' : 'You knew every card.') + '</p>' +
        '<div class="ns-actions">' + (deck.missed.length ? '<button type="button" class="ns-btn ns-primary" data-ns="cards-retry">Review the ' + deck.missed.length + ' I missed</button>' : '') +
        '<button type="button" class="ns-btn" data-ns="cards-new">New deck</button></div>';
      return;
    }
    const c = deck.cards[deck.i];
    box.innerHTML = '<div class="ns-qhead"><span>Card ' + (deck.i + 1) + ' of ' + n + '</span><span>' + deck.known + ' known</span></div>' + meter(deck.i, n) +
      '<button type="button" class="ns-flash" data-ns="flip" data-back="' + (deck.flipped ? 1 : 0) + '" aria-label="Flip card"><small>' + (deck.flipped ? 'Answer' : 'Question') + '</small><span>' + esc(deck.flipped ? c.back : c.front) + '</span></button>' +
      (deck.flipped ? oneChip(c.source) + '<div class="ns-actions"><button type="button" class="ns-btn" data-ns="card-again">Again</button><button type="button" class="ns-btn ns-primary" data-ns="card-known">Got it</button></div>'
        : '<p class="ns-dm" style="text-align:center">Tap the card to see the answer.</p>');
  }

  async function make(kind) {
    if (busy) return;
    busy = true; building = kind;
    kind === 'quiz' ? renderQuiz() : renderCards();
    const o = kind === 'quiz' ? qopts : copts;
    try {
      const out = await call('POST', kind === 'quiz' ? '/quiz' : '/flashcards', { docId: o.docId || undefined, count: o.count, level: kind === 'quiz' ? o.level : undefined, topic: o.topic || undefined });
      if (kind === 'quiz') quiz = { items: out.questions, i: 0, picks: [], done: false };
      else deck = { cards: out.cards, i: 0, flipped: false, known: 0, missed: [], done: false };
      setStatus('');
    } catch (e) { setStatus((e && e.message) || 'NexAI could not build that right now.'); }
    finally { busy = false; building = null; kind === 'quiz' ? renderQuiz() : renderCards(); }
  }
  const nextCard = (isKnown) => {
    const c = deck.cards[deck.i];
    if (isKnown) deck.known++; else deck.missed.push(c);
    if (deck.i + 1 < deck.cards.length) { deck.i++; deck.flipped = false; } else deck.done = true;
    renderCards();
  };
  const ACTIONS = {
    'make-quiz': () => make('quiz'),
    'make-cards': () => make('cards'),
    pick: (t) => { if (quiz && quiz.picks[quiz.i] === undefined) { quiz.picks[quiz.i] = Number(t.getAttribute('data-i')); renderQuiz(); } },
    'quiz-next': () => { if (!quiz) return; if (quiz.i + 1 < quiz.items.length) quiz.i++; else { quiz.done = true; quiz.items.forEach((q, i) => { if (quiz.picks[i] !== q.answer) saveRevision({ topic: q.question, prompt: 'Correct answer: ' + q.options[q.answer], answer: q.explanation || '' }); }); if (adapter && typeof adapter.recordStudyCheckIn === 'function') adapter.recordStudyCheckIn(); } renderQuiz(); },
    'quiz-retry': () => { if (!quiz) return; const items = quiz.items.filter((q, i) => quiz.picks[i] !== q.answer); quiz = { items, i: 0, picks: [], done: false }; renderQuiz(); },
    'quiz-new': () => { quiz = null; setStatus(''); renderQuiz(); },
    flip: () => { if (deck && !deck.done) { deck.flipped = !deck.flipped; renderCards(); } },
    'card-known': () => { if (deck && deck.flipped) { nextCard(true); if (deck.done && adapter && typeof adapter.recordStudyCheckIn === 'function') adapter.recordStudyCheckIn(); } },
    'card-again': () => { if (deck && deck.flipped) { const c = deck.cards[deck.i]; saveRevision({ topic: c.front, prompt: c.front, answer: c.back }); nextCard(false); } },
    'cards-retry': () => { if (!deck) return; deck = { cards: deck.missed.slice(), i: 0, flipped: false, known: 0, missed: [], done: false }; renderCards(); },
    'cards-new': () => { deck = null; setStatus(''); renderCards(); },
    'revision-refresh': () => loadRevision(),
    'rate-review': (el) => rateReview(el.getAttribute('data-id'), el.getAttribute('data-rating')),
    'plan-create': () => createPlan(),
    'calendar-connect': () => connectCalendar(),
    'calendar-disconnect': async () => { try { await call('DELETE', '/calendar/connection'); setStatus('Google Calendar disconnected.'); await loadRevision(); } catch (e) { setStatus(e.message); } },
    'plan-calendar-sync': (el) => syncPlanToGoogleCalendar(el.getAttribute('data-id')),
    'plan-gcal': (el) => openPlanGoogleCalendar(el.getAttribute('data-id')),
    'plan-ics': (el) => downloadPlanIcs(el.getAttribute('data-id')),
    'plan-tasks': (el) => addPlanBlockToTasks(el.getAttribute('data-id')),
    'plan-delete': async (el) => { try { await call('DELETE', '/plans/' + encodeURIComponent(el.getAttribute('data-id'))); await loadRevision(); } catch (e) { setStatus(e.message); } },
    'study-checkin': () => {
      if (!adapter || typeof adapter.recordStudyCheckIn !== 'function') return;
      const res = adapter.recordStudyCheckIn();
      setStatus(res && res.stats ? ('Today\u2019s study goal marked complete! Streak: ' + res.stats.current + '.') : 'Today\u2019s study goal marked complete.');
      renderRevision();
    },
    'habit-save': () => {
      if (!adapter || typeof adapter.ensureStudyHabit !== 'function') return;
      const goalEl = modal.querySelector('#ns-habit-goal');
      const goal = goalEl ? Number(goalEl.value) : 7;
      adapter.ensureStudyHabit({ goal });
      setStatus('Study habit synced with your Habits tracker.');
      renderRevision();
    },
    'guest-mode': (el) => { guestPreviewTab = el.getAttribute('data-g') === 'mindmap' ? 'mindmap' : 'tutor'; if (guestPreviewTab === 'mindmap' && mindmapCurrent) mindmapCurrent._needsFit = true; renderGuest(); },
    'mm-generate': () => generateMindmap(),
    'mm-blank': () => {
      mindmapCurrent = { savedId: null, title: 'Central Topic', topic: '', sourceTitle: '', documentId: null, root: { id: 'mm_root', label: 'Central Topic', summary: '', children: [{ id: 'mm_b1', label: 'Key Concept 1', children: [] }, { id: 'mm_b2', label: 'Key Concept 2', children: [] }] }, _needsFit: true };
      mindmapSelectedId = 'mm_root'; mindmapDirty = true; mindmapEditing = false; setStatus(''); renderMindmap();
    },
    'mm-save': () => saveCurrentMindmap(false),
    'mm-save-new': () => saveCurrentMindmap(true),
    'mm-open': (el) => openSavedMindmap(el.getAttribute('data-id')),
    'mm-delete-saved': () => deleteSavedMindmap(),
    'mm-select': (el) => { mindmapSelectedId = el.getAttribute('data-id'); mindmapEditing = false; rerenderActiveMindmap(); },
    'mm-toggle': (el) => {
      const id = el.getAttribute('data-id') || mindmapSelectedId;
      const hit = mindmapCurrent && findMindmapNode(mindmapCurrent.root, id);
      if (hit) { hit.node.collapsed = !hit.node.collapsed; mindmapDirty = true; rerenderActiveMindmap(); }
    },
    'mm-edit-open': () => { mindmapEditing = true; rerenderActiveMindmap(); },
    'mm-edit-cancel': () => { mindmapEditing = false; rerenderActiveMindmap(); },
    'mm-edit-apply': () => applyMindmapNodeEdit(),
    'mm-add-child': () => addMindmapNode(false),
    'mm-add-sibling': () => addMindmapNode(true),
    'mm-del-node': () => deleteMindmapSelected(),
    'mm-zoom-in': () => { const st = modal && modal.querySelector('#ns-mm-stage'); mindmapView.scale = Math.min(2, mindmapView.scale * 1.18); applyMindmapTransform(st); },
    'mm-zoom-out': () => { const st = modal && modal.querySelector('#ns-mm-stage'); mindmapView.scale = Math.max(0.4, mindmapView.scale * 0.85); applyMindmapTransform(st); },
    'mm-reset': () => { const st = modal && modal.querySelector('#ns-mm-stage'); resetMindmapView(st); },
    'mm-fit': () => { const st = modal && modal.querySelector('#ns-mm-stage'); if (mindmapCurrent) fitMindmapToStage(layoutMindmapTree(mindmapCurrent.root), st); },
    'mm-expand-all': () => { if (mindmapCurrent) { setAllMindmapCollapsed(mindmapCurrent.root, false); mindmapCurrent._needsFit = true; rerenderActiveMindmap(); } },
    'mm-collapse-all': () => { if (mindmapCurrent) { setAllMindmapCollapsed(mindmapCurrent.root, true); mindmapCurrent._needsFit = true; rerenderActiveMindmap(); } },
  };

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

  function open(a, opts) {
    adapter = a; build();
    history = []; docs = []; usage = null; pending = null; busy = false; thinking = false;
    quiz = null; deck = null; building = null; revisionData = null;
    mindmapList = []; mindmapCurrent = null; mindmapSelectedId = null; mindmapDirty = false; mindmapEditing = false; mindmapBusy = false; guestPreviewTab = 'tutor';
    mindmapOpts = { docId: '', topic: '' }; mindmapView = { scale: 1, tx: 20, ty: 20 };
    qopts = { docId: '', count: 5, level: 'medium', topic: '' }; copts = { docId: '', count: 10, topic: '' };
    modal.dataset.open = '1';
    if (a.isGuest()) { renderGuest(); return; }
    const requestedTab = opts && TABS.includes(opts.tab) ? opts.tab : 'tutor';
    tab = requestedTab;
    renderMain();
    const calParam = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('calendar') : '';
    const calNotice = calParam === 'connected'
      ? 'Google Calendar connected! You can now sync revision time-blocks.'
      : calParam === 'cancelled'
        ? 'Google Calendar connection cancelled.'
        : '';
    if (typeof history !== 'undefined' && typeof location !== 'undefined' && (calParam || new URLSearchParams(location.search).get('study'))) {
      try {
        const cleanUrl = new URL(location.href);
        cleanUrl.searchParams.delete('study');
        cleanUrl.searchParams.delete('calendar');
        history.replaceState(null, '', cleanUrl.pathname + cleanUrl.search + cleanUrl.hash);
      } catch (_) {}
    }
    setStatus(calNotice || 'Loading your library.', !calNotice);
    refresh().then(() => { setStatus(calNotice); if (!docs.length && requestedTab === 'tutor') setTab('library'); else if (tab === 'tutor') renderChat(); })
      .catch((e) => setStatus((e && e.message) || 'Could not load your library.'));
    const card = modal.querySelector('.ns-card'); if (card) card.focus();
  }

  const api = { open, formatAnswer, sourceLabel, checkFile, sizeLabel, SAMPLE, SAMPLE_MINDMAP, MAX_BYTES, layoutMindmapTree, countMindmapNodes };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.NexStudy = api;
})(typeof window !== 'undefined' ? window : globalThis);
