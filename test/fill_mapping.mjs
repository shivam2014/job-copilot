// Test: fill-map correctness, learning hygiene, fill-scope predicates
// Run: node test/fill_mapping.mjs
//
// Loads the REAL content script (extension/content/content.js) in a vm
// sandbox with a chrome.storage stub — no duplicated logic. The appended
// export tail grabs the functions declared in that file.

import { readFileSync } from 'fs';
import vm from 'vm';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTENT_SRC = readFileSync(join(__dirname, '..', 'extension', 'content', 'content.js'), 'utf8');
const FORM_DETECTOR_SRC = readFileSync(join(__dirname, '..', 'extension', 'content', 'form-detector.js'), 'utf8');

const assert = {
  equal(a, b, m) { if (a !== b) { console.error(`❌ ${m}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); process.exit(1); } console.log(`  ✓ ${m}`); },
  ok(v, m) { if (!v) { console.error(`❌ ${m}`); process.exit(1); } console.log(`  ✓ ${m}`); },
};

console.log('\n🔬 Fill Mapping / Learning Hygiene / Fill-Scope Tests\n');

// ── vm sandbox helpers ──────────────────────────────────────────────

function makeStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    sync: {
      get(keys) {
        if (keys == null) return Promise.resolve({ ...data });
        if (typeof keys === 'string') return Promise.resolve({ [keys]: data[keys] });
        const out = {};
        for (const k of keys) if (k in data) out[k] = data[k];
        return Promise.resolve(out);
      },
      set(obj) { Object.assign(data, obj); return Promise.resolve(); },
    },
  };
}

function fakeEl(overrides = {}) {
  const attrs = overrides.attrs || {};
  return {
    tagName: 'INPUT',
    type: 'text',
    name: '',
    id: '',
    placeholder: '',
    value: '',
    dataset: {},
    style: {},
    labels: [],
    offsetWidth: 120,
    offsetHeight: 24,
    addEventListener() {},
    getAttribute(a) { return a in attrs ? attrs[a] : null; },
    hasAttribute(a) { return a in attrs; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 120, height: 24, right: 120, bottom: 24 }; },
    closest() { return null; },
    ...overrides,
  };
}

function fakeDetector({ personal = [], selects = [], questions = [], files = [], unknown = [] } = {}) {
  const calls = [];
  return {
    calls,
    detect: () => ({ personal, selects, questions, files, unknown }),
    fillField: async (field, value) => { calls.push({ name: field.name, value }); return true; },
    debugLog() {},
  };
}

function loadContentScript({ storage = {}, detector, doc = {} } = {}) {
  const store = makeStorage(storage);
  const det = detector || fakeDetector();
  const out = {};
  const documentStub = {
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => null,
    createElement: () => ({ style: {}, id: '', textContent: '', appendChild() {}, remove() {} }),
    head: { appendChild() {} },
    body: { appendChild() {} },
    documentElement: { dataset: {} },
    addEventListener() {},
    readyState: 'complete',
    ...doc,
  };
  const sandbox = {
    console,
    document: documentStub,
    chrome: {
      storage: { sync: store.sync },
      runtime: { sendMessage: async () => {}, onMessage: { addListener() {} } },
    },
    setTimeout: () => 0,
    setInterval: () => 0,
    clearInterval: () => {},
    clearTimeout: () => {},
    MutationObserver: class { observe() {} disconnect() {} },
    HTMLSelectElement: class {},
    HTMLTextAreaElement: class {},
    HTMLInputElement: class {},
    HTMLFormElement: class {},
    Event: class {},
    InputEvent: class {},
    PointerEvent: class {},
    MouseEvent: class {},
    FormDetector: det,
    LLMClient: { getConfig: async () => ({}), generateAnswer: async () => '', isBlankAnswer: () => true, parseExtraHeaders: () => ({}) },
    performance: { now: () => Date.now() },
    location: { href: 'https://example.com/', hostname: 'example.com' },
    navigator: { userAgent: 'node' },
    addEventListener() {},
    removeEventListener() {},
    __out: out,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  const exportsTail = [
    ';__out.buildFillMap = buildFillMap;',
    '__out.getFieldCategory = getFieldCategory;',
    '__out.isProfileOwnedKey = isProfileOwnedKey;',
    '__out.mergeLearnedCorrections = mergeLearnedCorrections;',
    '__out.resolveFillValue = resolveFillValue;',
    '__out.isTechnicalOrHiddenInput = isTechnicalOrHiddenInput;',
    '__out.isSearchOrFilterInput = isSearchOrFilterInput;',
    '__out.isJCInjectedElement = isJCInjectedElement;',
    '__out.shouldSkipDetectedField = shouldSkipDetectedField;',
    '__out.pageHasApplicationForm = pageHasApplicationForm;',
    '__out.saveLearnedCorrection = saveLearnedCorrection;',
    '__out.migrateLearnedFieldsOnce = migrateLearnedFieldsOnce;',
    '__out.fillPersonal = fillPersonal;',
  ].join('\n');

  vm.runInNewContext(CONTENT_SRC + exportsTail, sandbox, { filename: 'content.js' });
  return { out, store, detector: det };
}

// Loads form-detector.js AND content.js into one shared vm context — the real
// detect() engine calling the real skip predicate (no stubs for either).
function loadFullEngine({ storage = {}, doc = {} } = {}) {
  const store = makeStorage(storage);
  const out = {};
  const documentStub = {
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => null,
    createElement: () => ({ style: {}, id: '', textContent: '', appendChild() {}, remove() {} }),
    head: { appendChild() {} },
    body: { appendChild() {} },
    documentElement: { dataset: {} },
    addEventListener() {},
    readyState: 'complete',
    ...doc,
  };
  const sandbox = {
    console,
    document: documentStub,
    chrome: {
      storage: { sync: store.sync },
      runtime: { sendMessage: async () => {}, onMessage: { addListener() {} } },
    },
    setTimeout: () => 0,
    setInterval: () => 0,
    clearInterval: () => {},
    clearTimeout: () => {},
    MutationObserver: class { observe() {} disconnect() {} },
    HTMLSelectElement: class {},
    HTMLTextAreaElement: class {},
    HTMLInputElement: class {},
    HTMLFormElement: class {},
    Event: class {},
    InputEvent: class {},
    PointerEvent: class {},
    MouseEvent: class {},
    LLMClient: { getConfig: async () => ({}), generateAnswer: async () => '', isBlankAnswer: () => true, parseExtraHeaders: () => ({}) },
    performance: { now: () => Date.now() },
    location: { href: 'https://example.com/', hostname: 'example.com' },
    navigator: { userAgent: 'node' },
    addEventListener() {},
    removeEventListener() {},
    __out: out,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  const context = vm.createContext(sandbox);
  vm.runInContext(FORM_DETECTOR_SRC, context, { filename: 'form-detector.js' });
  vm.runInContext(CONTENT_SRC + ';__out.FormDetector = FormDetector;', context, { filename: 'content.js' });
  return { out, store };
}

// ── Fixtures ────────────────────────────────────────────────────────

const LINKEDIN = 'https://www.linkedin.com/in/shivambhalla07/';
const PROFILE = {
  profile_name: 'Shivam Bhalla',
  profile_email: 'shivam@example.com',
  profile_phone: '+48 500 100 200',
  profile_linkedin: LINKEDIN,
  profile_github: 'https://github.com/shivambhalla',
  profile_website: '',
  profile_address: '42 Maple Street, 7A, Gdansk, 80-394',
  profile_work_authorization: 'Yes',
  resume_full_data: JSON.stringify({ extractedFields: { country: 'Poland', city: 'Gdansk', state: 'Pomorskie', postal_code: '80-394', street_address: '42 Maple Street' } }),
};

// ═══ A. No LinkedIn→Website/Portfolio misfill ═══════════════════════

console.log('A. Website/Portfolio never borrows the LinkedIn URL');
{
  const a = loadContentScript({ storage: { ...PROFILE } });
  const fillMap = await a.out.buildFillMap();
  assert.equal(fillMap.website, '', 'empty profile_website → fillMap.website is empty');
  assert.ok(fillMap.website !== LINKEDIN, 'fillMap.website is not the LinkedIn URL');
  assert.equal(a.out.resolveFillValue(fillMap, 'website'), '', 'Website field resolves empty');
  assert.equal(a.out.resolveFillValue(fillMap, 'urls[Portfolio]'), '', 'urls[Portfolio] resolves empty');
  assert.equal(a.out.resolveFillValue(fillMap, 'urls[Other]'), '', 'urls[Other] resolves empty');
  assert.equal(fillMap.linkedin, LINKEDIN, 'LinkedIn keeps the LinkedIn URL (no regression)');
  assert.equal(a.out.resolveFillValue(fillMap, 'linkedin'), LINKEDIN, 'urls[LinkedIn] lookup keeps the LinkedIn URL');
  assert.equal(fillMap.github, PROFILE.profile_github, 'GitHub keeps the GitHub URL');
  assert.equal(fillMap.email, PROFILE.profile_email, 'email still filled');
  assert.equal(a.out.getFieldCategory('siteLink-1'), 'website', 'Oracle siteLink-1 maps to website, not linkedin');
}

// ═══ B. Learned-data hygiene ════════════════════════════════════════

console.log('B. Learned-data hygiene');
{
  // B2 merge: learned values never override profile values
  const b = loadContentScript({ storage: { ...PROFILE, learned_fields: { email: 'attack@evil.com', website: LINKEDIN, fav_food: 'pizza' } } });
  const merged = b.out.mergeLearnedCorrections({ ...(await b.out.buildFillMap()) }, { ...b.store.data.learned_fields });
  assert.equal(merged.email, PROFILE.profile_email, 'learned email does not override profile email');
  assert.equal(merged.website, '', 'learned website does not fill website');
  assert.equal(merged.fav_food, 'pizza', 'learned custom/unknown key still applies');

  // B1 refusal: profile-owned keys are never persisted
  const b2 = loadContentScript({ storage: { ...PROFILE } });
  await b2.out.saveLearnedCorrection('emailAddress', 'attack2@evil.com');
  await b2.out.saveLearnedCorrection('website', 'https://evil.example.com');
  await b2.out.saveLearnedCorrection('firstName', 'Evil');
  await b2.out.saveLearnedCorrection('city', 'Berlin');
  const lf = b2.store.data.learned_fields || {};
  assert.ok(!('emailAddress' in lf) && !('email' in lf), 'refused to learn email alias');
  assert.ok(!('website' in lf), 'refused to learn website');
  assert.ok(!('firstName' in lf) && !('first_name' in lf), 'refused to learn firstName alias');
  assert.ok(!('city' in lf), 'refused to learn city');
  await b2.out.saveLearnedCorrection('favourite_stack', 'node');
  assert.equal(b2.store.data.learned_fields.favourite_stack, 'node', 'custom key learning still works');

  // B2 fill-time: profile wins, learned custom value still applied
  const emailEl = fakeEl({ name: 'email', type: 'email' });
  const websiteEl = fakeEl({ name: 'website', type: 'url' });
  const foodEl = fakeEl({ name: 'fav_food', type: 'text' });
  const detB = fakeDetector({ personal: [
    { name: 'email', el: emailEl },
    { name: 'website', el: websiteEl },
    { name: 'fav_food', el: foodEl },
  ] });
  const bFill = loadContentScript({
    storage: { ...PROFILE, learned_fields: { email: 'attack@evil.com', website: 'https://evil.example.com', fav_food: 'pizza' } },
    detector: detB,
  });
  await bFill.out.fillPersonal();
  const valuesByName = Object.fromEntries(detB.calls.map(c => [c.name, c.value]));
  assert.equal(valuesByName.email, PROFILE.profile_email, 'fill: profile email wins over learned email');
  assert.ok(!detB.calls.some(c => String(c.value).includes('evil')), 'fill: no learned override values written');
  assert.ok(!('website' in valuesByName), 'fill: website left untouched (no value)');
  assert.equal(valuesByName.fav_food, 'pizza', 'fill: learned custom value still applied');

  // B2 migration: poisoned data cleaned once, guarded by a flag
  const mig = loadContentScript({ storage: {
    profile_linkedin: LINKEDIN,
    learned_fields: { website: LINKEDIN, email: 'shivam@example.com', full_name: 'Shivam Bhalla', location_filter: 'Gdansk', fav_editor: 'vim' },
  } });
  await mig.out.migrateLearnedFieldsOnce();
  const lfAfter = mig.store.data.learned_fields;
  assert.ok(!('website' in lfAfter), 'migration removed linkedin-valued website key');
  assert.ok(!('email' in lfAfter) && !('full_name' in lfAfter), 'migration removed profile-owned keys');
  assert.equal(lfAfter.location_filter, 'Gdansk', 'migration kept unknown key (location_filter)');
  assert.equal(lfAfter.fav_editor, 'vim', 'migration kept unknown key (fav_editor)');
  assert.equal(mig.store.data.jc_learned_migration_v1, true, 'migration flag set');
  lfAfter.website = 'https://relapsed.example.com';
  await mig.out.migrateLearnedFieldsOnce();
  assert.equal(mig.store.data.learned_fields.website, 'https://relapsed.example.com', 'migration is one-time (flag guard)');
}

// ═══ C. Fill-scope predicates / no application form ═════════════════

console.log('C. Fill-scope predicates');
{
  const c = loadContentScript({ storage: {} });

  // C2: search/filter UI
  assert.ok(c.out.isSearchOrFilterInput(fakeEl({ name: 'keyword' })), 'name=keyword is search UI');
  assert.ok(c.out.isSearchOrFilterInput(fakeEl({ id: 'search' })), 'id=search is search UI');
  assert.ok(c.out.isSearchOrFilterInput(fakeEl({ name: 'q' })), 'name=q is search UI');
  assert.ok(c.out.isSearchOrFilterInput(fakeEl({ name: 'query' })), 'name=query is search UI');
  assert.ok(c.out.isSearchOrFilterInput(fakeEl({ placeholder: 'Filter by location' })), 'placeholder=Filter … is search UI');
  assert.ok(c.out.isSearchOrFilterInput(fakeEl({ labels: [{ textContent: 'Search jobs' }] })), 'label=Search jobs is search UI');
  assert.ok(c.out.isSearchOrFilterInput(fakeEl({ closest: (sel) => (sel.includes('[role="search"]') ? {} : null) })), 'inside [role=search] container is search UI');
  assert.ok(!c.out.isSearchOrFilterInput(fakeEl({ name: 'question_67918484' })), 'Greenhouse question_ id is NOT search UI');
  assert.ok(!c.out.isSearchOrFilterInput(fakeEl({ name: 'email' })), 'email field is NOT search UI');

  // C3: technical/hidden inputs
  assert.ok(c.out.isTechnicalOrHiddenInput(fakeEl({ type: 'hidden' })), 'type=hidden skipped');
  assert.ok(c.out.isTechnicalOrHiddenInput(fakeEl({ name: 'g-recaptcha-response' })), 'g-recaptcha-response skipped');
  assert.ok(c.out.isTechnicalOrHiddenInput(fakeEl({ name: 'csrf_token' })), 'csrf/token skipped');
  assert.ok(c.out.isTechnicalOrHiddenInput(fakeEl({ name: '_ga' })), '_ga skipped');
  assert.ok(c.out.isTechnicalOrHiddenInput(fakeEl({ name: 'utm_source' })), 'utm_* skipped');
  assert.ok(c.out.isTechnicalOrHiddenInput(fakeEl({ attrs: { 'aria-hidden': 'true' } })), 'aria-hidden=true skipped');
  assert.ok(c.out.isTechnicalOrHiddenInput(fakeEl({ attrs: { tabindex: '-1' } })), 'tabindex=-1 skipped');
  assert.ok(c.out.isTechnicalOrHiddenInput(fakeEl({ offsetHeight: 0 })), 'zero-size element skipped');
  assert.ok(!c.out.isTechnicalOrHiddenInput(fakeEl({ name: 'email', type: 'email' })), 'visible email input not technical');

  // C4: the extension's own injected UI
  assert.ok(c.out.isJCInjectedElement(fakeEl({ id: 'jc-float-btn' })), 'JC float button skipped');
  assert.ok(c.out.isJCInjectedElement(fakeEl({ closest: (sel) => (sel.includes('#jc-panel') ? {} : null) })), 'element inside JC panel skipped');
  assert.ok(c.out.shouldSkipDetectedField({ name: 'search', el: fakeEl({ name: 'search' }) }), 'combined predicate skips search field');
  assert.ok(!c.out.shouldSkipDetectedField({ name: 'email', el: fakeEl({ name: 'email' }) }), 'combined predicate keeps email field');

  // C1: no application form → zero fills attempted
  const noForm = loadContentScript({ detector: fakeDetector() });
  assert.equal(noForm.out.pageHasApplicationForm(), false, 'no form inputs → no application form');
  await noForm.out.fillPersonal();
  assert.equal(noForm.detector.calls.length, 0, 'no application form → zero fillField calls');

  // C3 (engine level): real detect() must not emit recaptcha/hidden elements
  const recaptchaTa = fakeEl({ tagName: 'TEXTAREA', type: 'textarea', name: 'g-recaptcha-response', offsetWidth: 0, offsetHeight: 0 });
  const emailInput = fakeEl({ type: 'email', name: 'email', id: 'email' });
  const hiddenInput = fakeEl({ type: 'hidden', name: 'accountId', offsetWidth: 0, offsetHeight: 0 });
  const engine = loadFullEngine({ doc: {
    querySelectorAll: (sel) => (sel === 'input, textarea, select' ? [recaptchaTa, emailInput, hiddenInput] : []),
  } });
  const detected = engine.out.FormDetector.detect();
  const allDetected = [...detected.personal, ...detected.questions, ...detected.selects, ...detected.unknown];
  assert.ok(!allDetected.some(f => f.el === recaptchaTa), 'detect(): g-recaptcha-response textarea NOT queued (C3)');
  assert.ok(!allDetected.some(f => f.el === hiddenInput), 'detect(): type=hidden input NOT queued (C3)');
  assert.ok(detected.personal.some(f => f.el === emailInput), 'detect(): visible email input still detected (no regression)');

  // C1: positive detections
  const withFile = loadContentScript({ doc: { querySelectorAll: (sel) => (sel === 'input[type="file"]' ? [fakeEl({ type: 'file', name: 'resume' })] : []) } });
  assert.equal(withFile.out.pageHasApplicationForm(), true, 'resume file input → application form detected');
  const withPersonal = loadContentScript({ detector: fakeDetector({ personal: [fakeEl(), fakeEl(), fakeEl()].map((el, i) => ({ name: 'field' + i, el })) }) });
  assert.equal(withPersonal.out.pageHasApplicationForm(), true, '>=3 fillable personal fields → application form detected');
  const withContainer = loadContentScript({ doc: { querySelector: (sel) => (sel.includes('application-form') ? {} : null) } });
  assert.equal(withContainer.out.pageHasApplicationForm(), true, 'application-form container → application form detected');

  // C1: Oracle P3 search page — resume-upload widget inside search chrome is NOT a form
  const widgetFile = fakeEl({ type: 'file', attrs: { 'aria-label': 'Upload or drag and drop your resume here to get recommended jobs' }, closest: (sel) => (sel.includes('[class*="search"]') ? {} : null) });
  const widgetPage = loadContentScript({ doc: { querySelectorAll: (sel) => (sel === 'input[type="file"]' ? [widgetFile] : []) } });
  assert.equal(widgetPage.out.pageHasApplicationForm(), false, 'search-chrome resume widget alone → no application form (P3)');
  const genericFile = fakeEl({ type: 'file', name: 'avatar' });
  const genericPage = loadContentScript({ doc: { querySelectorAll: (sel) => (sel === 'input[type="file"]' ? [genericFile] : []) } });
  assert.equal(genericPage.out.pageHasApplicationForm(), false, 'lone generic file input (no resume hint) → no application form');
  const p3Keyword = fakeEl({ type: 'text', id: 'keyword' });
  const p3Location = fakeEl({ type: 'text', id: 'location', placeholder: 'City, state, country', closest: (sel) => (sel.includes('[class*="search"]') ? {} : null) });
  const p3Page = loadContentScript({
    detector: fakeDetector({ personal: [{ name: 'keyword', el: p3Keyword }, { name: 'location', el: p3Location }] }),
    doc: { querySelectorAll: (sel) => (sel === 'input[type="file"]' ? [widgetFile] : []) },
  });
  assert.equal(p3Page.out.pageHasApplicationForm(), false, 'P3 analog (keyword + location in search chrome + widget file) → no application form');
}

// ═══ D. Address parsing — no inferred country/state ═════════════════

console.log('D. Address parsing — no inferred country/state');
{
  const d = loadContentScript({ storage: { ...PROFILE } });
  const dMap = await d.out.buildFillMap();
  assert.equal(dMap.city, 'Gdansk', 'city parsed from stored address');
  assert.equal(dMap.postal_code, '80-394', 'postal code parsed from stored address');
  assert.equal(dMap.street_address, '42 Maple Street', 'street parsed from stored address');
  assert.equal(dMap.street_address_2, '7A', 'apartment parsed from stored address');
  assert.equal(dMap.country, '', 'country EMPTY — "Gdansk" does not imply "Poland"');
  assert.equal(dMap.state, '', 'state EMPTY — not present in the stored address');

  // no city→country map consulted: country stays empty even without extracted country data
  const d2 = loadContentScript({ storage: { ...PROFILE, resume_full_data: JSON.stringify({ extractedFields: { city: 'Gdansk' } }) } });
  const d2Map = await d2.out.buildFillMap();
  assert.equal(d2Map.city, 'Gdansk', 'city still parsed (no extracted data)');
  assert.equal(d2Map.country, '', 'country still empty without explicit country in the address');

  // explicit country present in the address → used
  const d3 = loadContentScript({ storage: {
    ...PROFILE,
    profile_address: '12 Main Street, Springfield, 62704, Poland',
    resume_full_data: JSON.stringify({ extractedFields: { country: 'Poland', state: 'Illinois' } }),
  } });
  const d3Map = await d3.out.buildFillMap();
  assert.equal(d3Map.country, 'Poland', 'explicit country in address is used');
  assert.equal(d3Map.city, 'Springfield', 'city parsed');
  assert.equal(d3Map.postal_code, '62704', 'postal parsed');
}

console.log('\n🎉 All fill mapping tests passed!\n');
