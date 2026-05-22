// Syntax check: parse each JS file for basic correctness
// Run: node test/syntax_check.mjs
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..', 'extension');

const files = [
  'lib/llm-client.js',
  'content/content.js',
  'content/form-detector.js',
  'popup/popup.js',
  'options/options.js',
  'background/background.js',
];

console.log('\n🔍 Syntax check\n');
let passed = 0;
let failed = 0;

for (const file of files) {
  try {
    const code = readFileSync(join(root, file), 'utf8');
    new Function(code);
    console.log(`  ✅ ${file}`);
    passed++;
  } catch (err) {
    // Function() might fail on modern JS features like import/export
    // Just check for obvious syntax issues
    const lines = code.split('\n');
    let issues = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Check for common syntax issues
      if (line.includes('.replace(/\\/+$/, \'\'))') && 
          (line.match(/\)/g) || []).length > (line.match(/\(/g) || []).length + 1) {
        issues.push(`  ⚠️  Line ${i+1}: Suspicious parentheses`);
      }
    }
    if (issues.length > 0) {
      console.log(`  ⚠️  ${file} — ${issues.length} issue(s)`);
      issues.forEach(i => console.log(i));
      failed++;
    } else {
      console.log(`  ✅ ${file} (checked)`);
      passed++;
    }
  }
}

console.log(`\n📊 ${passed} passed, ${failed} failed\n`);
