import { createConnection } from 'net';
import { randomUUID } from 'crypto';

const EXT_PATH = '/Users/shivam94/job-copilot/extension';

// Connect to CDP and send commands
function cdpSend(wsUrl, msg) {
  return new Promise((resolve, reject) => {
    const url = new URL(wsUrl);
    const client = createConnection(url.port || 9222, url.hostname, () => {
      const id = randomUUID().slice(0, 8);
      const payload = JSON.stringify({ ...msg, id });
      client.write(payload + '\n');
    });
    let buf = '';
    client.on('data', (chunk) => {
      buf += chunk.toString();
      try {
        const resp = JSON.parse(buf);
        if (resp.id === msg.id) {
          client.end();
          resolve(resp);
        }
      } catch(e) {}
    });
    client.on('error', reject);
    setTimeout(() => { client.end(); reject(new Error('CDP timeout')); }, 10000);
  });
}

async function main() {
  // Get browser WS URL
  const resp = await fetch('http://localhost:9222/json/version');
  const info = await resp.json();
  const browserWs = info.webSocketDebuggerUrl;
  
  // Get all targets
  const targets = await fetch('http://localhost:9222/json').then(r => r.json());
  
  // Find the about:blank tab to use for extensions page
  let extTab = targets.find(t => t.url === 'about:blank' || t.url === 'chrome://tab-search.top-chrome/');
  if (!extTab) {
    // Create a new tab
    const newTab = await fetch('http://localhost:9222/json/new').then(r => r.json());
    extTab = newTab;
  }
  
  const tabWs = extTab.webSocketDebuggerUrl;
  console.log(`Using tab: ${extTab.id} ${extTab.url}`);
  
  // Navigate to chrome://extensions
  const navResult = await cdpSend(tabWs, {
    method: 'Page.enable'
  });
  console.log('Page.enable:', JSON.stringify(navResult));
  
  const nav = await cdpSend(tabWs, {
    method: 'Page.navigate',
    params: { url: 'chrome://extensions' }
  });
  console.log('Navigate:', JSON.stringify(nav));
  
  // Wait for page to load
  await new Promise(r => setTimeout(r, 2000));
  
  // Inject script to click developer mode toggle and load unpacked
  // First check if developer mode is on, turn it on if not
  const evalResult = await cdpSend(tabWs, {
    method: 'Runtime.evaluate',
    params: {
      expression: `
        (async () => {
          // Wait for extensions manager to load
          await new Promise(r => setTimeout(r, 1000));
          
          // Try to use chrome.developerPrivate API
          if (chrome && chrome.developerPrivate) {
            // Check if dev mode is on
            const profileInfo = await chrome.developerPrivate.getProfileConfiguration();
            if (!profileInfo.isDeveloperModeEnabled) {
              await chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true });
              console.log('Enabled developer mode');
            }
            
            // Load the unpacked extension
            const extId = await chrome.developerPrivate.loadUnpacked({
              path: '${EXT_PATH}',
              failOnLoadError: false
            });
            console.log('Loaded extension with ID:', extId);
            return { ok: true, extId };
          } else {
            // Fallback: click the UI elements
            const devToggle = document.querySelector('#devMode');
            if (devToggle && !devToggle.checked) {
              devToggle.click();
              await new Promise(r => setTimeout(r, 500));
            }
            
            // Click "Load unpacked" button
            const loadBtn = document.querySelector('.extensions-manager .page-container .page-footer button');
            if (loadBtn) {
              loadBtn.click();
              await new Promise(r => setTimeout(r, 500));
              
              // The file dialog is OS-native, so we can't automate this via CDP
              // Return the info so we can use another approach
              return { ok: false, reason: 'File dialog is OS-native' };
            }
            return { ok: false, reason: 'Could not find controls' };
          }
        })()
      `,
      awaitPromise: true,
    }
  });
  console.log('Eval result:', JSON.stringify(evalResult, null, 2));
  
  // Alternative approach: try using Extensions CDP domain
  const extResult = await cdpSend(browserWs, {
    method: 'Extensions.loadUnpacked',
    params: { path: EXT_PATH }
  }).catch(e => ({ error: e.message }));
  console.log('Extensions.loadUnpacked result:', JSON.stringify(extResult));
}

main().catch(console.error);