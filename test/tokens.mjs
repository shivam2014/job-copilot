// Unit test: Token tracking logic
// Run: node test/tokens.mjs

const assert = {
  equal(a, b, m) { if (a !== b) { console.error(`❌ ${m}: ${a} !== ${b}`); process.exit(1); } console.log(`  ✓ ${m}`); },
  ok(v, m) { if (!v) { console.error(`❌ ${m}`); process.exit(1); } console.log(`  ✓ ${m}`); },
};

console.log('\n🔬 Token Tracker Tests\n');

// Simulated tracker logic (mirrors lib/token-tracker.js)
function formatTokens(n) {
  if (!n) return '0';
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toString();
}

function record(history, model, usage) {
  if (!usage || !model) return history;
  const entry = {
    model,
    promptTokens: usage.prompt_tokens || 0,
    completionTokens: usage.completion_tokens || 0,
    totalTokens: usage.total_tokens || 0,
    timestamp: Date.now(),
    date: new Date().toISOString().split('T')[0],
  };
  const h = [...history, entry];
  if (h.length > 1000) h.splice(0, h.length - 1000);
  return h;
}

function getSummary(history) {
  if (history.length === 0) return null;
  const total = history.reduce((s, e) => ({
    promptTokens: s.promptTokens + e.promptTokens,
    completionTokens: s.completionTokens + e.completionTokens,
    totalTokens: s.totalTokens + e.totalTokens,
    calls: s.calls + 1,
  }), { promptTokens: 0, completionTokens: 0, totalTokens: 0, calls: 0 });

  const byModel = {};
  for (const entry of history) {
    if (!byModel[entry.model]) byModel[entry.model] = { calls: 0, totalTokens: 0 };
    byModel[entry.model].calls++;
    byModel[entry.model].totalTokens += entry.totalTokens;
  }
  return { total, byModel };
}

// Test 1: Record entries
let h = [];
h = record(h, 'gpt-4o-mini', { prompt_tokens: 50, completion_tokens: 30, total_tokens: 80 });
assert.equal(h.length, 1, 'Record 1 entry');
assert.equal(h[0].model, 'gpt-4o-mini', 'Model name stored');
assert.equal(h[0].totalTokens, 80, 'Total tokens recorded');

// Test 2: Null usage skipped (no entry added)
const h2 = record(h, 'test', null);
assert.equal(h2.length, 1, 'Null usage skipped — no entry added');

// Test 3: Multi-model summary
h = [];
h = record(h, 'model-a', { total_tokens: 100 });
h = record(h, 'model-a', { total_tokens: 200 });
h = record(h, 'model-b', { total_tokens: 300 });
const summary = getSummary(h);
assert.ok(summary !== null, 'Summary generated');
assert.equal(summary.total.calls, 3, '3 total calls');
assert.equal(summary.total.totalTokens, 600, '600 total tokens');
assert.equal(summary.byModel['model-a'].calls, 2, 'Model A: 2 calls');
assert.equal(summary.byModel['model-a'].totalTokens, 300, 'Model A: 300 tokens');
assert.equal(summary.byModel['model-b'].calls, 1, 'Model B: 1 call');
assert.equal(summary.byModel['model-b'].totalTokens, 300, 'Model B: 300 tokens');

// Test 4: Empty
assert.equal(getSummary([]), null, 'Empty history returns null');

// Test 5: Format
assert.equal(formatTokens(0), '0', '0');
assert.equal(formatTokens(500), '500', '500');
assert.equal(formatTokens(1500), '1.5K', '1.5K');
assert.equal(formatTokens(1500000), '1.5M', '1.5M');

// Test 6: Cap
h = [];
for (let i = 0; i < 1010; i++) h = record(h, 'x', { total_tokens: 1 });
assert.ok(h.length <= 1000, 'Capped at 1000');

console.log('\n🎉 All token tracker tests passed!\n');
