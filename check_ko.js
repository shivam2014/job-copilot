const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const page = browser.contexts()[0].pages().find(p => p.url().includes('oraclecloud'));
  
  // Dismiss session dialog first
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Continue Working');
    if (b) b.click();
  });
  await new Promise(r => setTimeout(r, 1000));
  
  // Check Knockout view model
  const koInfo = await page.evaluate(() => {
    const email = document.getElementById('primary-email-0');
    const r = {};
    
    if (typeof ko !== 'undefined') {
      r.koAvailable = true;
      try {
        const context = ko.contextFor(email);
        r.hasContext = !!context;
        if (context) {
          const data = context.$data || {};
          r.modelKeys = Object.keys(data).filter(function(k) { return !k.startsWith('_'); }).slice(0, 15);
          r.elementType = typeof data.element;
          if (data.element && typeof data.element.value === 'function') {
            r.elementValue = data.element.value();
          } else if (data.element) {
            r.elementValue = data.element.value;
          }
        }
      } catch(e) {
        r.koError = e.message;
      }
    } else {
      r.koAvailable = false;
    }
    
    return r;
  });
  console.log('Knockout info:', JSON.stringify(koInfo, null, 2));
  
  // Try to set the value through KO observable
  if (koInfo.koAvailable && koInfo.hasContext) {
    await page.evaluate(() => {
      const email = document.getElementById('primary-email-0');
      const context = ko.contextFor(email);
      if (context && context.$data && context.$data.element) {
        if (typeof context.$data.element.value === 'function') {
          context.$data.element.value('shivam.bhalla07@gmail.com');
        } else {
          context.$data.element.value = 'shivam.bhalla07@gmail.com';
        }
      }
    });
    await new Promise(r => setTimeout(r, 500));
    
    const val = await page.evaluate(() => document.getElementById('primary-email-0').value);
    console.log('Email after KO set:', val);
  }
  
  // Try clicking Next
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(function(b) { return b.textContent.trim() === 'Next'; });
    if (btn) {
      console.log('Next found, clicking...');
      btn.click();
    }
  });
  await new Promise(r => setTimeout(r, 3000));
  console.log('URL:', page.url().substring(0, 150));
  
  // Check if we moved on
  const heading = await page.evaluate(() => {
    const h = document.querySelector('h1, h2, h3');
    return h ? h.textContent.trim() : 'none';
  });
  console.log('Heading:', heading);
  
  await browser.close();
})();
