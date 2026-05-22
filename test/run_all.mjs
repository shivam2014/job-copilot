// Test runner — runs all test suites and reports results
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const tests = [
  'syntax_check.mjs',
  'models.mjs',
  'tokens.mjs',
  'integration.mjs',
  'form_detection.mjs',
  'extraction.mjs',
  'llm_prompts.mjs',
];

let passed = 0;
let failed = 0;

console.log('='.repeat(50));
console.log('  Job Copilot — Test Suite');
console.log('='.repeat(50));

async function runTest(file) {
  return new Promise((resolve) => {
    const proc = spawn('node', [join(__dirname, file)], { stdio: 'pipe' });
    let output = '';
    proc.stdout.on('data', d => output += d.toString());
    proc.stderr.on('data', d => output += d.toString());
    
    proc.on('close', (code) => {
      // Extract summary line
      const lines = output.trim().split('\n');
      const summary = lines.filter(l => l.includes('✅') || l.includes('❌') || l.includes('🎉'));
      const pass = code === 0;
      console.log(`  ${pass ? '✅' : '❌'} ${file.padEnd(25)} ${summary.pop() || ''}`);
      if (!pass) {
        // Show first error
        const err = lines.find(l => l.includes('❌') || l.includes('Error'));
        if (err) console.log(`        ${err}`);
      }
      resolve(pass);
    });
  });
}

for (const test of tests) {
  const pass = await runTest(test);
  if (pass) passed++; else failed++;
}

console.log('-'.repeat(50));
console.log(`  Results: ${passed} passed, ${failed} failed, ${tests.length} total`);
console.log('='.repeat(50));
process.exit(failed > 0 ? 1 : 0);
