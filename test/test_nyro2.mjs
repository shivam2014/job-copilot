import { chromium } from 'playwright';
const browser = await chromium.launch({
  headless: true,
  args: ['--allow-insecure-localhost', '--disable-web-security'],
});
const page = await browser.newPage();
const result = await page.evaluate(async () => {
  try {
    const resp = await fetch('http://localhost:19530/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer dummy' },
      body: JSON.stringify({
        model: 'deepseek-v4-flash-2',
        messages: [{ role: 'user', content: 'Reply: ok' }],
        max_tokens: 5,
      }),
    });
    const data = await resp.json();
    return { status: resp.status, ok: resp.ok, text: (data.choices?.[0]?.message?.content || '').substring(0, 50) };
  } catch (e) {
    return { error: e.message, name: e.name };
  }
}, { timeout: 30000 });
console.log(JSON.stringify(result));
await browser.close();
