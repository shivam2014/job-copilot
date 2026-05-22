import { chromium } from 'playwright';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdtempSync, rmSync } from 'fs';

const cwd = process.cwd();
const ud = mkdtempSync(join(tmpdir(), 'jc-ch-'));
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
  
  // Test chat completion with resume-sized payload
  const result = await p.evaluate(async () => {
    const prompt = 'Extract resume JSON: name, email, phone. JSON only.';
    const resumeText = 'Shivam Bhalla\nshivam.bhalla07@gmail.com\n+33-753788537';
    try {
      const resp = await fetch('http://localhost:19530/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer dummy' },
        body: JSON.stringify({
          model: 'deepseek-v4-flash-2',
          messages: [{ role: 'system', content: prompt }, { role: 'user', content: resumeText }],
          max_tokens: 100,
        }),
      });
      const data = await resp.json();
      return { ok: resp.ok, status: resp.status, text: (data.choices?.[0]?.message?.content || '').substring(0, 100) };
    } catch (e) {
      return { error: e.message, name: e.name };
    }
  });
  console.log('Chat test:', JSON.stringify(result));
  
  await ctx.close();
} finally {
  try { rmSync(ud, { recursive: true, force: true }); } catch {}
}
