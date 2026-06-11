const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const page = browser.contexts()[0].pages().find(p => p.url().includes('oraclecloud'));
  
  // Dismiss dialog
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find(function(b) { return b.textContent.trim() === 'Continue Working'; });
    if (b) b.click();
  });
  await new Promise(r => setTimeout(r, 1500));
  
  const info = await page.evaluate(() => {
    const r = {};
    
    // Check for form element
    const forms = document.querySelectorAll('form');
    r.formCount = forms.length;
    r.forms = Array.from(forms).map(function(f) {
      return {
        id: f.id,
        action: f.action ? f.action.substring(0, 100) : '',
        method: f.method
      };
    });
    
    // Find element with data-bind containing "submit" or "click"
    const submitBindings = [];
    document.querySelectorAll('[data-bind*="click"], [data-bind*="submit"]').forEach(function(el) {
      submitBindings.push({
        tag: el.tagName,
        text: el.textContent.trim().substring(0, 40),
        bind: el.getAttribute('data-bind').substring(0, 100)
      });
    });
    r.submitBindings = submitBindings.slice(0, 5);
    
    // Get the Next button's parent hierarchy for Oracle JET component detection
    const nextBtn = Array.from(document.querySelectorAll('button')).find(function(b) {
      return b.textContent.trim() === 'Next';
    });
    if (nextBtn) {
      r.nextBtn = {
        id: nextBtn.id,
        class: nextBtn.className,
        type: nextBtn.type,
        outerHTML: nextBtn.outerHTML.substring(0, 300),
        dataBind: nextBtn.getAttribute('data-bind') || 'none'
      };
      
      // Walk up parents
      let el = nextBtn;
      let parents = [];
      for (let i = 0; i < 10; i++) {
        el = el.parentElement;
        if (!el) break;
        parents.push({
          tag: el.tagName,
          id: el.id,
          class: el.className.substring(0, 60),
          dataBind: el.getAttribute('data-bind') || '',
          role: el.getAttribute('role') || ''
        });
      }
      r.nextBtnParents = parents;
    }
    
    // Check if oj (Oracle JET) is available
    r.hasOj = (typeof oj !== 'undefined');
    r.hasRequire = (typeof require !== 'undefined');
    
    // Check window.require for Oracle JET
    if (typeof require !== 'undefined') {
      try {
        r.ojVersion = require.s.contexts._.defined['ojs/ojcore'] ? 'loaded' : 'not loaded';
      } catch(e) {
        r.ojError = e.message;
      }
    }
    
    return r;
  });
  console.log(JSON.stringify(info, null, 2));
  
  // If oj is available, try using Oracle JET to trigger button click
  if (info.hasOj) {
    console.log('\n--- oj available, trying oj click ---');
    const result = await page.evaluate(() => {
      // Try using Oracle JET's widget mechanism
      try {
        const nextBtn = document.querySelector('button.theme-color-1, button:has(.button__label)');
        // Oracle JET uses custom events for buttons
        // Try triggering via jQuery if available
        if (typeof jQuery !== 'undefined') {
          jQuery(nextBtn).trigger('click');
          return 'jQuery click done';
        }
        return 'oj but no jquery';
      } catch(e) {
        return 'error: ' + e.message;
      }
    });
    console.log('Result:', result);
    await new Promise(r => setTimeout(r, 2000));
    console.log('URL:', page.url().substring(0, 150));
  }
  
  await browser.close();
})();
