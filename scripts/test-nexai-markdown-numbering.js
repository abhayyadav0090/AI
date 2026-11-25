#!/usr/bin/env node
'use strict';
// NexOS 4.5.1: Regression tests for NexAI Markdown ordered/unordered list numbering,
// nested lists, explanatory paragraphs, code protection, and Classic + Enterprise parity.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

const classicSrc = read('public/app.js');
const entHtml = read('public/index-redesign.html');
const classicCss = read('public/style.css');
const serverSrc = read('server.js');

// Load the exact production Classic renderer (formatChat) into an isolated VM.
const cStart = classicSrc.indexOf('function formatChat(text) {');
const cEnd = classicSrc.indexOf('\nfunction appendChatMsg', cStart);
assert.ok(cStart >= 0 && cEnd > cStart, 'formatChat renderer must exist');
const escHtml = (v) => String(v || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const cCtx = { escHtml };
vm.runInNewContext(classicSrc.slice(cStart, cEnd) + '\nthis.render = formatChat;', cCtx);
const renderClassic = cCtx.render;

// Load the exact production Enterprise renderer (renderSimpleMarkdown) into an isolated VM.
const eStart = entHtml.indexOf('function renderSimpleMarkdown(md) {');
const eEnd = entHtml.indexOf('\n}\n', eStart) + 2;
assert.ok(eStart >= 0 && eEnd > eStart, 'renderSimpleMarkdown must exist');
const escapeHtml = (v) => String(v || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const eCtx = { escapeHtml };
vm.runInNewContext(entHtml.slice(eStart, eEnd) + '\nthis.render = renderSimpleMarkdown;', eCtx);
const renderEnterprise = eCtx.render;

const countMatches = (str, re) => (str.match(re) || []).length;

const renderers = [
  ['Classic', renderClassic],
  ['Enterprise', renderEnterprise],
];

for (const [label, render] of renderers) {
  // 0) Working Control: "hello 3 things, anything" consecutive list (must always stay 1, 2, 3)
  {
    const controlMd = [
      'Hello! Here are 3 quick things:',
      '',
      '1. Honey never spoils.',
      '2. Octopuses have three hearts.',
      '3. Bananas are berries, while strawberries are not.',
    ].join('\n');
    const controlHtml = render(controlMd);
    assert.equal(countMatches(controlHtml, /<ol\b/g), 1, `${label}: control consecutive list uses ONE <ol>`);
    assert.equal(countMatches(controlHtml, /<li>/g), 3, `${label}: control renders 3 consecutive <li> items (1, 2, 3)`);
    assert.ok(controlHtml.includes('<ol><li>Honey never spoils.</li><li>Octopuses have three hearts.</li><li>Bananas are berries'), `${label}: control DOM matches clean <ol>`);
  }

  // 1a) Three sequential numbered items (1., 2., 3.) with explanatory paragraphs & sub-bullets
  {
    const md = [
      'Here is how LinkedIn helps students and professionals:',
      '',
      '1. **Job Search & Internships**',
      '',
      'Recruiters actively browse profiles and job boards every day.',
      '',
      '- Optimize your headline',
      '- Enable Open to Work alerts',
      '',
      '2. **Content Sharing & Learning (Building in Public)**',
      '',
      'Documenting weekly lessons attracts mentors and opportunities.',
      '',
      '3. **Upskilling & Knowledge**',
      '',
      'Follow engineers and industry practitioners to stay current.',
    ].join('\n');
    const html = render(md);
    assert.equal(countMatches(html, /<ol\b/g), 1, `${label}: 3 LinkedIn sections must render inside ONE <ol>`);
    assert.equal(countMatches(html, /<\/ol>/g), 1, `${label}: must close ONE </ol>`);
    assert.ok(html.includes('<li><strong>Job Search &amp; Internships</strong><p>Recruiters actively browse'), `${label}: explanation attaches inside item 1 <li>`);
    assert.ok(html.includes('<ul><li>Optimize your headline</li><li>Enable Open to Work alerts</li></ul></li><li><strong>Content Sharing'), `${label}: sub-bullets nest cleanly inside item 1 <li>`);
    assert.ok(html.includes('<li><strong>Upskilling &amp; Knowledge</strong></li></ol><p>Follow engineers'), `${label}: trailing summary paragraph closes list cleanly`);
  }

  // 1b) Three sequential numbered sections when the model repeats "1." on each section
  {
    const md = [
      '1. **Job Search & Internships**',
      '',
      'Many companies post internships directly here.',
      '',
      '1. **Content Sharing & Learning (Building in Public)**',
      '',
      'Posting project notes builds credibility.',
      '',
      '1. **Upskilling & Knowledge**',
      '',
      'Learn from peers and experts.',
    ].join('\n');
    const html = render(md);
    assert.equal(countMatches(html, /<ol\b/g), 1, `${label}: loose repeated 1. sections merge into ONE sequential <ol>`);
    assert.equal(countMatches(html, /<li>/g), 3, `${label}: all 3 items become consecutive <li> elements (1, 2, 3)`);
  }

  // 2) Five numbered items with blank lines between descriptions
  {
    const md = [
      '1. First item',
      '',
      'Description one.',
      '',
      '2. Second item',
      '',
      'Description two.',
      '',
      '3. Third item',
      '',
      'Description three.',
      '',
      '4. Fourth item',
      '',
      'Description four.',
      '',
      '5. Fifth item',
    ].join('\n');
    const html = render(md);
    assert.equal(countMatches(html, /<ol\b/g), 1, `${label}: 5 items with blank lines keep ONE <ol>`);
    assert.equal(countMatches(html, /<li>/g), 5, `${label}: 5 <li> items rendered`);
  }

  // 3) Numbered lists containing multiline paragraphs (tight & loose)
  {
    const md = [
      '1. Plan your week',
      'Line one of explanation.',
      'Line two of explanation.',
      '',
      '2. Execute daily focus sprints',
      'Pick one priority.',
      'Protect 50 minutes without distractions.',
    ].join('\n');
    const html = render(md);
    assert.equal(countMatches(html, /<ol\b/g), 1, `${label}: multiline items stay in ONE <ol>`);
    assert.ok(html.includes('Line one of explanation.<br>Line two of explanation.'), `${label}: multiline lines preserve break inside <li>`);
    assert.ok(html.includes('Pick one priority.<br>Protect 50 minutes'), `${label}: multiline lines in item 2 stay in item 2`);
  }

  // 4) Nested ordered and unordered lists
  {
    const md = [
      '1. Phase One',
      '  - Sub-bullet A',
      '  - Sub-bullet B',
      '    1. Deep step one',
      '    2. Deep step two',
      '2. Phase Two',
      '  1. Nested step one',
      '  2. Nested step two',
    ].join('\n');
    const html = render(md);
    assert.equal(countMatches(html, /<ol>/g), 3, `${label}: 1 parent <ol> + 2 nested <ol> lists`);
    assert.equal(countMatches(html, /<ul>/g), 1, `${label}: 1 nested <ul>`);
    assert.ok(html.includes('<li>Sub-bullet B<ol><li>Deep step one</li><li>Deep step two</li></ol></li>'), `${label}: deep ordered list nests inside <ul> item`);
  }

  // 5) Two independent lists that must both start at 1
  {
    const byHeading = [
      '### Morning Routine',
      '1. Drink water',
      '2. Stretch for 5 minutes',
      '',
      '### Evening Routine',
      '1. Review your day',
      '2. Sleep on time',
    ].join('\n');
    const htmlH = render(byHeading);
    assert.equal(countMatches(htmlH, /<ol\b/g), 2, `${label}: headings split independent <ol> lists so both start at 1`);

    const byContext = [
      '1. Finish sprint report',
      '2. Email stakeholders',
      '',
      'Now for your separate reading list:',
      '1. Clean Code',
      '2. Designing Data-Intensive Applications',
    ].join('\n');
    const htmlC = render(byContext);
    assert.equal(countMatches(htmlC, /<ol\b/g), 2, `${label}: intro with colon / completed 1..2 list splits second independent list at 1`);

    const byBoldHeading = [
      '1. Step A',
      '',
      '**Independent Part Two**',
      '1. Step B1',
      '2. Step B2',
    ].join('\n');
    const htmlB = render(byBoldHeading);
    assert.equal(countMatches(htmlB, /<ol\b/g), 2, `${label}: standalone bold heading resets independent list at 1`);

    const singleThenMulti = [
      '1. Standalone point from topic one.',
      '',
      'Here is an unrelated topic with its own numbered steps.',
      '',
      '1. New step one',
      '2. New step two',
    ].join('\n');
    const htmlS = render(singleThenMulti);
    assert.equal(countMatches(htmlS, /<ol\b/g), 2, `${label}: single-item list followed by prose and a new 1., 2. list stays independent`);

    const streamingUnclosedCode = [
      '1. First step',
      '```js',
      '1. keep inside code during stream',
      '2. also inside code',
    ].join('\n');
    const htmlCodeMidStream = render(streamingUnclosedCode);
    assert.equal(countMatches(htmlCodeMidStream, /<ol\b/g), 1, `${label}: unclosed streaming code fence keeps 1./2. inside code block`);
    assert.ok(htmlCodeMidStream.includes('<pre class="chat-code"><code>1. keep inside code during stream\n2. also inside code</code></pre>'));
  }

  // 6) Numbered lists inside fenced code blocks (must remain unchanged)
  {
    const md = [
      'Example steps inside code:',
      '```markdown',
      '1. Keep this literal',
      '2. And this literal too',
      '```',
      '',
      'Actual steps:',
      '1. Run tests',
      '2. Inspect diff',
    ].join('\n');
    const html = render(md);
    assert.ok(html.includes('<pre class="chat-code"><code>1. Keep this literal\n2. And this literal too</code></pre>'), `${label}: code block keeps raw 1. and 2.`);
    assert.equal(countMatches(html, /<ol\b/g), 1, `${label}: only the non-code list renders as <ol>`);
  }

  // 7) Mixed headings, bullets, explicit start="4", dates/decimals/version numbers
  {
    const md = [
      '## Release v4.5.1 Notes',
      '2026. This release weighs 3.14 MB and ships cleanly.',
      '',
      '4. Verify existing checks',
      '5. Publish changelog',
      '',
      '- Quick check A',
      '- Quick check B',
    ].join('\n');
    const html = render(md);
    assert.ok(html.includes('<ol start="4"><li>Verify existing checks</li><li>Publish changelog</li></ol>'), `${label}: preserves explicit start="4" numbering`);
    assert.ok(html.includes('v4.5.1'), `${label}: version number unchanged`);
    assert.ok(html.includes('3.14 MB'), `${label}: decimal unchanged`);
    assert.ok(!html.includes('2026. <'), `${label}: 4-digit year 2026. not converted into <ol>`);
  }

  // 8) Long streamed response simulated delta-by-delta with multiple lists
  {
    const full = [
      '1. **Discovery Phase**',
      '',
      'Interview users to map real bottlenecks.',
      '',
      '2. **Build Phase**',
      '',
      'Ship small increments daily.',
      '',
      '3. **Verification Phase**',
      '',
      'Run automated checks.',
      '',
      '### Bonus Checklist',
      '1. Backup database',
      '2. Tag release',
    ].join('\n');
    let finalHtml = '';
    for (let cut = 15; cut <= full.length; cut += 19) {
      finalHtml = render(full.slice(0, cut));
    }
    finalHtml = render(full);
    assert.equal(countMatches(finalHtml, /<ol\b/g), 2, `${label}: streamed multi-list answer keeps first 1..3 list unified and splits bonus list`);
  }

  // 9) Hindi and English mixed-language answer
  {
    const md = [
      'LinkedIn का सही उपयोग:',
      '',
      '1. **Job Search & Internships**',
      '',
      'यहाँ recruiters आपकी profile और skills देखकर सीधा संपर्क करते हैं।',
      '',
      '2. **Content Sharing & Learning**',
      '',
      'अपने projects और सीखने की यात्रा share करने से network मजबूत होता है।',
      '',
      '3. **Upskilling & Knowledge**',
      '',
      'Industry experts को follow करके नई skills सीख सकते हैं।',
    ].join('\n');
    const html = render(md);
    assert.equal(countMatches(html, /<ol\b/g), 1, `${label}: Hindi+English mixed sections stay in ONE <ol>`);
    assert.equal(countMatches(html, /<li>/g), 3, `${label}: all 3 Hindi+English points render sequentially`);
  }
}

// 10) Inspect representative HTML output & verify CSS/prompt invariants
{
  const sampleHtmlClassic = renderClassic('1. **Job Search**\n\nExplain jobs.\n\n- Tip A\n\n2. **Content**\n\nExplain content.\n\n3. **Upskilling**');
  const sampleHtmlEnt = renderEnterprise('1. **Job Search**\n\nExplain jobs.\n\n- Tip A\n\n2. **Content**\n\nExplain content.\n\n3. **Upskilling**');
  assert.equal(sampleHtmlClassic, sampleHtmlEnt, 'Classic and Enterprise render identical HTML for sequential ordered lists');
  assert.equal(countMatches(sampleHtmlClassic, /<ol\b/g), 1);

  assert.ok(classicCss.includes('.msg-bubble ol, .msg-bubble ul') && classicCss.includes('padding-left: 22px'), 'Classic CSS restores list indentation after universal reset');
  assert.ok(entHtml.includes('.chat-bubble-card ol') && entHtml.includes('padding-left: 22px'), 'Enterprise CSS restores list indentation after universal reset');
  assert.ok(serverSrc.includes('MARKDOWN FORMATTING:') && serverSrc.includes('1., 2., 3.'), 'Server system prompt guides Gemini toward continuous numbered lists');
}

console.log('NexAI Markdown ordered-list numbering and formatting tests passed (Classic + Enterprise).');
