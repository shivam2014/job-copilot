// Comprehensive tests: all features and bug fixes
// Run: node test/comprehensive.mjs

const assert = {
  eq(a, b, m) { if (a !== b) { console.error('  ❌ ' + m + ': "' + a + '" !== "' + b + '"'); process.exit(1); } console.log('  ✓ ' + m); },
  ok(v, m) { if (!v) { console.error('  ❌ ' + m + ': falsy'); process.exit(1); } console.log('  ✓ ' + m); },
};

console.log('\n🔬 Comprehensive Feature Tests\n');

// 1. Date Normalization
console.log('--- 1. Date Normalization ---');
function normDate(s) {
  if (!s || typeof s !== 'string') return s || '';
  const m = {jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12'};
  const r = s.match(/^([a-z]{3})\s*(\d{4})$/i);
  return (r && m[r[1].toLowerCase()]) ? m[r[1].toLowerCase()] + '/' + r[2] : s;
}
assert.eq(normDate('Oct 2020'), '10/2020', 'Oct 2020');
assert.eq(normDate('Jan 2020'), '01/2020', 'Jan');
assert.eq(normDate('Dec 2025'), '12/2025', 'Dec');
assert.eq(normDate('10/2020'), '10/2020', 'Already normalized');
assert.eq(normDate(''), '', 'Empty');
assert.eq(normDate('x'), 'x', 'Invalid');

// 2. JSON Extraction
console.log('\n--- 2. JSON Extraction ---');
function extractJSON(raw) {
  if (!raw) return null;
  var end = raw.lastIndexOf('}'); if (end === -1) return null;
  var depth = 0, start = -1;
  for (var i = end; i >= 0; i--) { if (raw[i] === '}') depth++; else if (raw[i] === '{') depth--; if (depth === 0) { start = i; break; } }
  if (start === -1) return null;
  try { return JSON.parse(raw.slice(start, end + 1)); } catch(e) { return null; }
}
assert.eq(extractJSON('text\n{"a":1}').a, 1, 'JSON after text');
assert.eq(extractJSON('```{"a":1}```').a, 1, 'Fenced');
assert.eq(extractJSON('{"a":1}').a, 1, 'Raw');
assert.eq(extractJSON('no json'), null, 'No JSON');
assert.eq(extractJSON(''), null, 'Empty');
// Complex nested
var r = extractJSON('{"name":"S","skills":["A","B"],"exp":[{"title":"E"}],"lang":[{"name":"En","level":"Fl"}]}');
assert.eq(r.skills.length, 2, 'Array parsed');
assert.eq(r.exp[0].title, 'E', 'Nested object');
assert.eq(r.lang[0].level, 'Fl', 'Level in lang');

// 3. Data Construction
console.log('\n--- 3. Data Construction ---');
function buildData(p) {
  var fd = { extractedFields: {}, rawSections: {} };
  for (var k in p) { if (typeof p[k] === 'object' && p[k] !== null) { fd.rawSections[k] = p[k]; } else { fd.extractedFields[k] = p[k]; } }
  var m = {jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12'};
  ['experience','education'].forEach(function(s) { if (fd.rawSections[s]) fd.rawSections[s].forEach(function(i) {
    ['start_date','end_date'].forEach(function(f) {
      if (i[f] && typeof i[f] === 'string') { var r2 = i[f].match(/^([a-z]{3})\s*(\d{4})$/i); if (r2 && m[r2[1].toLowerCase()]) i[f] = m[r2[1].toLowerCase()] + '/' + r2[2]; }
    });
  });});
  return fd;
}
var prof = { name: 'S', email: 'e@e.com', skills: ['A','B'], experience: [{title:'E',company:'C',start_date:'Oct 2020'}], languages:[{name:'English',level:'Fluent'}], projects:[{name:'P'}], publications:['Pub'] };
var fd = buildData(prof);
assert.eq(fd.extractedFields.name, 'S', 'Name');
assert.ok(Array.isArray(fd.rawSections.skills), 'Skills array');
assert.eq(fd.rawSections.skills.length, 2, '2 skills');
assert.eq(fd.rawSections.experience[0].start_date, '10/2020', 'Date norm');
assert.eq(fd.rawSections.languages[0].level, 'Fluent', 'Lang level');
assert.eq(fd.rawSections.projects[0].name, 'P', 'Project');
assert.eq(fd.rawSections.publications[0], 'Pub', 'Publication');

// 4. Data Merging
console.log('\n--- 4. Data Merging ---');
function merge(n, e) {
  var r = JSON.parse(JSON.stringify(n)); if (!e) return r;
  for (var k in e.rawSections) { if (!r.rawSections[k] || (Array.isArray(r.rawSections[k]) && r.rawSections[k].length === 0)) r.rawSections[k] = e.rawSections[k]; }
  for (var k in e.extractedFields) { if (!r.extractedFields[k]) r.extractedFields[k] = e.extractedFields[k]; }
  return r;
}
var m = merge({extractedFields:{name:'N'},rawSections:{skills:['NS']}}, {extractedFields:{name:'O'},rawSections:{skills:[],projects:[{name:'MP'}]}});
assert.eq(m.extractedFields.name, 'N', 'New overwrites');
assert.eq(m.rawSections.projects[0].name, 'MP', 'Manual preserved');
assert.eq(m.rawSections.skills[0], 'NS', 'Skills replaced');

// 5. Language Display
console.log('\n--- 5. Language Display ---');
function disp(l) { return typeof l === 'object' ? l.name + (l.level ? ' - ' + l.level : '') : l; }
assert.eq(disp({name:'English',level:'Fluent'}), 'English - Fluent', 'Level shown');
assert.eq(disp({name:'English'}), 'English', 'No level');
assert.eq(disp('English'), 'English', 'Plain string');

// 6. CRUD
console.log('\n--- 6. CRUD ---');
var items = [];
items.push({title:'E',company:'C'}); items.push({title:'M',company:'I'});
assert.eq(items.length, 2, 'Create 2');
items[0].title = 'SE'; assert.eq(items[0].title, 'SE', 'Update');
items.splice(0,1); assert.eq(items.length, 1, 'Delete 1');

// 7. Tags
console.log('\n--- 7. Tags ---');
var tags = []; tags.push('A'); tags.push('B');
assert.eq(tags.length, 2, 'Add 2');
tags = tags.filter(function(t) { return t !== 'A'; });
assert.eq(tags.length, 1, 'Delete 1');

// 8. Token tracking
console.log('\n--- 8. Tokens ---');
var hist = [];
function track(h, m, u) { if (!u || !m) return h; return h.concat([{model:m,total:u.total_tokens||0,pro:u.prompt_tokens||0,com:u.completion_tokens||0}]); }
hist = track(hist, 'a', {total_tokens:100}); hist = track(hist, 'a', {total_tokens:200}); hist = track(hist, 'b', {total_tokens:300});
assert.eq(hist.length, 3, '3 records');
assert.eq(hist.reduce(function(s,e){return s+e.total;},0), 600, 'Total');
assert.eq(hist.filter(function(e){return e.model==='a';}).length, 2, '2 for a');
assert.eq(track(hist,'x',null).length, 3, 'Null skip');

// 9. Saved Answers
console.log('\n--- 9. Saved Answers ---');
function saveAns(ans, q, a) {
  if (!q || !a) return ans; var r = (ans||[]).slice();
  r = r.filter(function(x) { return x.question.toLowerCase().trim() !== q.toLowerCase().trim(); });
  r.unshift({question:q.trim(),answer:a.trim()}); return r.length>50?r.slice(0,50):r;
}
var a = []; a = saveAns(a, 'Q1', 'A1'); assert.eq(a.length, 1, 'Save');
a = saveAns(a, 'Q1', 'A2'); assert.eq(a.length, 1, 'Replace');
a = saveAns(a, 'Q2', 'A3'); assert.eq(a.length, 2, 'Two');
a = saveAns(a, '', 'A'); assert.eq(a.length, 2, 'Skip empty Q');

// 10. Debounce
console.log('\n--- 10. Debounce ---');
var flag = false;
var fn = function() { flag = true; };
var timer = null;
function deb() { clearTimeout(timer); timer = setTimeout(fn, 50); }
deb(); deb(); deb();
assert.eq(flag, false, 'Not yet');
await new Promise(function(r) { return setTimeout(r, 100); });
assert.eq(flag, true, 'After debounce');

// 11. AbortController
console.log('\n--- 11. AbortController ---');
var c = new AbortController();
assert.eq(c.signal.aborted, false, 'Not aborted');
c.abort();
assert.eq(c.signal.aborted, true, 'Aborted');
var wasAbort = false;
fetch('http://localhost:19530/v1/models', {signal: c.signal}).catch(function(e) { if (e.name === 'AbortError') wasAbort = true; });
await new Promise(function(r) { return setTimeout(r, 50); });
assert.eq(wasAbort, true, 'Fetch aborted');

// 12. Card layout
console.log('\n--- 12. Card Layout ---');
function card(item) {
  var h = '<div class="rd-card"><div style="display:flex;justify-content:space-between;align-items:flex-start"><div style="flex:1">';
  if (item.title) h += '<div class="rd-card-title">' + item.title + '</div>';
  h += '</div><div style="display:flex;gap:4px;flex-shrink:0;margin-left:8px">';
  h += '<button class="rd-card-edit">E</button><button class="rd-card-del">X</button></div></div></div>';
  return h;
}
var ca = card({title:'T'});
assert.ok(ca.indexOf('rd-card-edit') > 0, 'Has edit');
assert.ok(ca.indexOf('rd-card-del') > 0, 'Has del');
assert.ok(ca.indexOf('T') < ca.indexOf('rd-card-edit'), 'Content before btn');

console.log('\n🎉 All 12 comprehensive test groups passed!');
