// Test: UI structure — verify all expected elements exist in options.html
// Catches: missing IDs, broken selectors, structural issues
// Run: node test/ui_structure.mjs

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..', 'extension');

// Simple HTML parser — extracts element IDs and tag info
function parseHTML(html) {
  const elements = [];
  // Match tags with IDs: <tag id="xxx" ...>
  const idRegex = /<(\w+)[^>]*\bid=["']([^"']+)["'][^>]*>/g;
  let match;
  while ((match = idRegex.exec(html)) !== null) {
    elements.push({ tag: match[1], id: match[2] });
  }
  // Match script and link src/href
  const srcRegex = /<(script|link)[^>]*(?:src|href)=["']([^"']+)["'][^>]*>/g;
  while ((match = srcRegex.exec(html)) !== null) {
    elements.push({ tag: match[1], src: match[2] });
  }
  return elements;
}

function find(els, id) {
  return els.filter(e => e.id === id);
}

const assert = {
  equal(a, b, m) { if (a !== b) { throw new Error(`${m}: ${a} !== ${b}`); } console.log(`  ✓ ${m}`); },
  ok(v, m) { if (!v) { throw new Error(`${m}: falsy`); } console.log(`  ✓ ${m}`); },
};

console.log('\n🔬 UI Structure Tests\n');

// Load options.html
const html = readFileSync(join(root, 'options/options.html'), 'utf8');
const els = parseHTML(html);

// Test 1: Critical elements exist
const required = [
  'llm_base_url', 'llm_api_key', 'llm_model',
  'resume_file', 'resume_text', 'extract-btn', 'save-btn',
  'upload-area', 'model-dropdown', 'model-count',
  'profile_name', 'profile_email', 'profile_phone',
  'profile_linkedin', 'profile_github', 'profile_website',
  'profile_address', 'profile_work_authorization', 'profile_skills', 'profile_languages', 'profile_summary',
  'saved-answers-list', 'token-usage-content',
  'show-paste-link', 'reset-tokens-btn',
];

let found = 0;
let missing = [];
for (const id of required) {
  if (find(els, id).length > 0) {
    found++;
  } else {
    missing.push(id);
  }
}
assert.equal(found, required.length, `All ${required.length} required elements exist`);
if (missing.length > 0) {
  console.log(`  ❌ Missing: ${missing.join(', ')}`);
}
console.log(`  ✅ ${found}/${required.length} IDs verified`);

// Test 2: Scripts loaded
const scripts = els.filter(e => e.tag === 'script');
assert.ok(scripts.length >= 2, `At least 2 scripts loaded (found ${scripts.length})`);

const loadedScripts = scripts.map(s => s.src || '(inline)').join(', ');
console.log(`  Scripts: ${loadedScripts}`);

// Test 3: CSS loaded
const cssLinks = els.filter(e => e.tag === 'link' && e.src?.endsWith('.css'));
assert.ok(cssLinks.length >= 1, `CSS loaded (${cssLinks.length})`);

// Test 4: Buttons have correct text
const buttonTexts = [];
const btnRegex = /<button[^>]*id=["']([^"']+)["'][^>]*>([^<]+)<\/button>/g;
let bm;
while ((bm = btnRegex.exec(html)) !== null) {
  buttonTexts.push({ id: bm[1], text: bm[2].trim() });
}
assert.ok(buttonTexts.length >= 2, `At least 2 buttons (found ${buttonTexts.length})`);
buttonTexts.forEach(b => console.log(`  Button: ${b.id} → "${b.text}"`));

// Test 5: Upload area exists with file input
const fileInputs = els.filter(e => e.id === 'resume_file' && e.tag === 'input');
assert.ok(fileInputs.length === 1, 'File input for PDF upload exists');

// Test 6: Verify profile fields have correct pattern
const profileFields = ['profile_name', 'profile_email', 'profile_phone', 'profile_linkedin', 'profile_github', 'profile_website', 'profile_address', 'profile_work_authorization'];
for (const id of profileFields) {
  const f = find(els, id);
  assert.ok(f.length === 1, `Profile field "${id}" exists`);
}
console.log(`  ✅ All ${profileFields.length} profile fields present`);

// Test 7: Textarea exists (even if hidden)
const textareas = els.filter(e => e.tag === 'textarea');
assert.ok(textareas.length >= 1, 'Textarea exists');
console.log(`  ✅ Textarea found`);

console.log(`\n🎉 All UI structure tests passed!`);
console.log(`   ${els.length} total elements found in HTML\n`);
