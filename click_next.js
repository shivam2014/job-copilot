const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const context = browser.contexts()[0];
  const page = context.pages().find(p => p.url().includes('oraclecloud'));
  
  // First dismiss the session dialog
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const cont = btns.find(b => b.textContent.trim() === 'Continue Working');
    if (cont) cont.click();
  });
  await new Promise(r => setTimeout(r, 1000));
  
  // Now check the page state and click Next
  const state = await page.evaluate(() => {
    const email = document.getElementById('primary-email-0');
    const parent = email?.closest('[class*="input"]') || email?.parentElement;
    const errors = parent ? parent.querySelectorAll('[class*="error"], [class*="message"]') : [];
    
    return {
      emailVal: email?.value || 'nf',
      parentHTML: parent ? parent.outerHTML.substring(0, 500) : 'no parent',
      errors: Array.from(errors).map(e => e.textContent.trim()),
      allText: document.body.textContent.substring(0, 300),
    };
  });
  console.log('Page state:', JSON.stringify(state, null, 2));
  
  // Now try clicking Next using various approaches
  console.log('\n--- Trying to click Next ---');
  
  // Approach 1: Direct click on button
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Next');
    if (btn) {
      console.log('Next button found, clicking...');
      btn.click();
    }
  });
  await new Promise(r => setTimeout(r, 2000));
  console.log('URL after direct click:', page.url().substring(0, 150));
  
  // Approach 2: Try clicking parent form
  if (!page.url().includes('apply/email')) {
    console.log('SUCCESS: Navigated away!');
  } else {
    // Try using Playwright's click with position
    console.log('Still on same page, trying Playwright click at center...');
    const nextBtn = page.locator('button:has-text("Next")');
    const box = await nextBtn.boundingBox();
    if (box) {
      await page.mouse.click(box.x + box.width/2, box.y + box.height/2);
      await new Promise(r => setTimeout(r, 2000));
      console.log('URL after mouse click:', page.url().substring(0, 150));
    }
  }
  
  // Check if we navigated
  const finalUrl = page.url();
  if (!finalUrl.includes('apply/email')) {
    console.log('SUCCESS: Navigated to', finalUrl.substring(0, 150));
    const heading = await page.evaluate(() => {
      const h = document.querySelector('h1, h2, h3');
      return h ? h.textContent.trim() : 'no heading';
    });
    console.log('New page heading:', heading);
  }
  
  await browser.close();
})();
