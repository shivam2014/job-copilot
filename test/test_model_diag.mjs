import { chromium } from 'playwright';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdtempSync, rmSync } from 'fs';

const cwd = process.cwd();
const ud = mkdtempSync(join(tmpdir(), 'jc-md-'));
const ctx = await chromium.launchPersistentContext(ud, {
  channel: 'chromium', headless: true,
  args: ['--disable-extensions-except=' + cwd + '/extension', '--load-extension=' + cwd + '/extension', '--allow-insecure-localhost', '--disable-web-security'],
});

try {
  const sw = await new Promise(r => ctx.on('serviceworker', r));
  const extId = sw.url().match(/chrome-extension:\/\/([^/]+)/)[1];
  const p = await ctx.newPage();
  await p.goto('chrome-extension://' + extId + '/options/options.html');
  await new Promise(r => setTimeout(r, 2000));

  // Test extraction with small payload first
  const testResult = await p.evaluate(async () => {
    const models = ['deepseek-v4-flash-2', 'ares-gateway', 'Qwen-3.6-35B-A3B-mlx'];
    const results = [];
    for (const model of models) {
      try {
        const resp = await fetch('http://localhost:19530/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer dummy' },
          body: JSON.stringify({
            model: model,
            messages: [{ role: 'user', content: 'Reply: hi' }],
            max_tokens: 10,
          }),
        });
        const ok = resp.ok;
        const status = resp.status;
        let text = '';
        if (ok) {
          const d = await resp.json();
          text = (d.choices?.[0]?.message?.content || '').substring(0, 30);
        }
        results.push({ model, ok, status, text });
      } catch (e) {
        results.push({ model, ok: false, status: 'error', text: e.message });
      }
    }
    return results;
  });

  console.log('Model tests:');
  testResult.forEach(r => console.log(`  ${r.model}: ${r.ok ? '✅' : '❌'} (${r.status}) ${r.text}`));

  await ctx.close();
} finally {
  try { rmSync(ud, { recursive: true, force: true }); } catch {}
}
