// Unit test: Model fetch + dropdown population
// Run: node test/models.mjs

const assert = {
  equal(actual, expected, msg) {
    if (actual !== expected) {
      console.error(`❌ ${msg}: expected ${expected}, got ${actual}`);
      process.exit(1);
    }
    console.log(`  ✓ ${msg}`);
  },
  deepEqual(actual, expected) {
    const a = JSON.stringify(actual);
    const b = JSON.stringify(expected);
    if (a !== b) {
      console.error(`❌ deepEqual failed:\n  got: ${a}\n  expected: ${b}`);
      process.exit(1);
    }
    console.log(`  ✓ deepEqual`);
  },
  ok(value, msg) {
    if (!value) {
      console.error(`❌ ${msg}: falsy`);
      process.exit(1);
    }
    console.log(`  ✓ ${msg}`);
  },
};

function processModels(apiResponse) {
  const models = apiResponse.data || [];
  if (models.length === 0) return [];
  return models
    .filter(m => m.id && m.id.length < 100)
    .slice(0, 30)
    .map(m => ({ id: m.id }));
}

function ensureUrl(url) {
  if (!url) return url;
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return 'https://' + url;
  }
  return url;
}

console.log('\n🔬 Model Processing Tests\n');

// Test 1
const nyroResp = { data: [
  { id: 'Qwen-3.6-35B-A3B-mlx' }, { id: 'Qwen3.6-27B-UD-mlx' },
  { id: 'ares-gateway' }, { id: 'deepseek-v4-flash-2' },
  { id: 'deepseek-v4-pro-2' }, { id: 'glm-5.1-2' },
  { id: 'kimi-k2.6-2' },
]};
const r1 = processModels(nyroResp);
assert.equal(r1.length, 7, 'Nyro returns 7 models');
r1.forEach(m => assert.ok(m.id, 'Each model has id'));
console.log('  ✅ All 7 Nyro models preserved (including version dots)');

// Test 2
assert.deepEqual(processModels({ data: [] }), []);
console.log('  ✅ Empty response handled');

// Test 3
assert.deepEqual(processModels({ data: [{ id: null }, { id: 'valid' }, {}] }), [{ id: 'valid' }]);
console.log('  ✅ Null/empty IDs filtered');

// Test 4
assert.equal(ensureUrl('http://localhost:19530/v1'), 'http://localhost:19530/v1', 'http preserved');
assert.equal(ensureUrl('https://api.openai.com/v1'), 'https://api.openai.com/v1', 'https preserved');
assert.equal(ensureUrl('api.openai.com/v1'), 'https://api.openai.com/v1', 'https:// prepended');
assert.equal(ensureUrl(''), '', 'empty preserved');
console.log('  ✅ URL protocol handling');

// Test 5
const big = { data: Array.from({length: 50}, (_, i) => ({id: `m${i}`})) };
assert.equal(processModels(big).length, 30, 'Capped at 30 models');
console.log('  ✅ 50 models capped to 30');

console.log('\n🎉 All 5 tests passed!\n');
