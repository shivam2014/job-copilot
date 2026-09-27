
// build: 1781211550
// ═══════════════════════════════════════════════════════════════
// Inject CSS programmatically — more reliable than manifest CSS
// ═══════════════════════════════════════════════════════════════
(function injectJCStyles() {
  if (document.querySelector('#jc-styles')) return;
  const style = document.createElement('style');
  style.id = 'jc-styles';
  style.textContent = `
    #jc-float-btn {
      position: fixed; bottom: 24px; right: 24px; z-index: 2147483647;
      width: 48px; height: 48px; border-radius: 50%;
      background: #3b82f6; color: white; border: none;
      box-shadow: 0 4px 12px rgba(59,130,246,0.4);
      cursor: pointer; font-size: 18px; font-weight: bold;
      display: flex; align-items: center; justify-content: center;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    #jc-float-btn:hover { transform: scale(1.1); box-shadow: 0 6px 20px rgba(59,130,246,0.5); }
    #jc-panel {
      position: fixed; bottom: 84px; right: 24px; z-index: 2147483647;
      width: 320px; background: white; border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.15);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 13px; color: #1f2937; display: none; overflow: hidden;
    }
    #jc-panel.open { display: block; }
    #jc-panel-header { padding: 12px 16px; background: #3b82f6; color: white; font-weight: 600; font-size: 14px; display: flex; justify-content: space-between; align-items: center; }
    #jc-panel-close { background: none; border: none; color: white; cursor: pointer; font-size: 18px; padding: 0 4px; }
    #jc-panel-body { padding: 12px 16px; max-height: 400px; overflow-y: auto; }
    .jc-stat { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #f3f4f6; font-size: 12px; }
    .jc-stat-label { color: #6b7280; }
    .jc-stat-value { font-weight: 500; }
    .jc-btn { width: 100% !important; padding: 12px 16px !important; border: none; border-radius: 8px; font-size: 13px !important; font-weight: 500 !important; cursor: pointer; margin-top: 10px; transition: background 0.2s; }
    .jc-btn-primary { background: #3b82f6 !important; color: white !important; }
    .jc-btn-primary:hover { background: #2563eb; }
    .jc-btn-secondary { background: #f3f4f6 !important; color: #374151 !important; }
    .jc-btn-secondary:hover { background: #e5e7eb; }
    .jc-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .jc-status { padding: 8px; margin-top: 10px; border-radius: 6px; font-size: 12px; text-align: center; }
    .jc-status.success { background: #ecfdf5; color: #065f46; }
    .jc-status.error { background: #fef2f2; color: #991b1b; }
    .jc-status.info { background: #eff6ff; color: #1e40af; }
    .jc-field-fill-btn {
      position: absolute !important;
      right: -28px !important;
      top: 50% !important;
      transform: translateY(-50%) !important;
      width: 22px; height: 22px; border: none; border-radius: 4px;
      background: #3b82f6 !important; color: white !important;
      cursor: pointer; font-size: 10px; font-weight: 700;
      display: flex !important; align-items: center; justify-content: center;
      opacity: 0.4; transition: opacity 0.15s, background 0.15s;
      z-index: 999999; visibility: visible !important;
    }
    .jc-field-fill-btn:hover { opacity: 1; background: #2563eb !important; }
    .jc-field-fill-btn:active { transform: translateY(-50%) scale(0.9); }
  `;
  document.head.appendChild(style);
  console.log('JC: Styles injected');
})();

// ═══════════════════════════════════════════════════════════════
// Content script — THE ORCHESTRATOR
// ═══════════════════════════════════════════════════════════════
//
// FILE ROLE:
//   This file manages the extension's lifecycle, UI, fill orchestration,
//   and the learning system. It does NOT do detection or filling directly —
//   those live in form-detector.js. This file calls FormDetector.detect()
//   to find fields and FormDetector.fillField() to fill them, then handles
//   everything around that: when to detect, what values to fill, how to
//   learn from user corrections, and what the user sees.
//
// WHY THIS FILE EXISTS SEPARATELY:
//   form-detector.js is a pure engine: it takes a DOM and returns field
//   lists, it takes a field and a value and fills it. It has no opinions
//   about UI, timing, storage, or user interaction. Content.js is the
//   orchestrator that decides WHEN to call the engine and WHAT data to
//   feed it. This separation means you can test the fill engine against
//   mock DOMs without needing the panel, the popup, or Chrome storage.
//
//   llm-client.js is separate because the options page and popup also
//   need to call the LLM (for connection testing, for profile extraction).
//   If LLM logic lived here, the options page would have to duplicate it.
//
// EXECUTION TRACE (when user clicks "Fill All"):
//   Step 1:  fillAll() is called → sets __jcFilling guard → calls fillPersonal(), fillAIQuestions(), fillLearnedRadios()
//   Step 2:  fillPersonal() → calls FormDetector.detect() to find fields
//   Step 3:  (in form-detector.js) detect() → identify(el) for each element → scoring game against fieldPatterns
//   Step 4:  fillPersonal() → calls buildFillMap() to read profile from storage, split name/address, merge learned corrections
//   Step 5:  fillPersonal() → for each field, looks up fillMap[field.name], calls FormDetector.fillField(field, value)
//   Step 6:  (in form-detector.js) fillField() → routes to fillSelect/fillTextInput/fillOracleCombobox based on element type
//   Step 7:  (in form-detector.js) fillTextInput() → tries DOM assignment → native setter → char-by-char → InputEvent
//   Step 8:  fillPersonal() → calls listenForCorrections() to attach blur listeners for learning
//   Step 9:  fillAIQuestions() → calls getResumeText() + extractJobDescription(), then LLMClient.generateAnswer() for each textarea
//   Step 10: (in llm-client.js) generateAnswer() → sends question + JD + resume to LLM endpoint → returns answer
//   Step 11: fillLearnedRadios() → reads learned_fields, restores previous radio button selections
//   Step 12: __jcFilling guard removed → MutationObserver resumes → panel shows status message
// ═══════════════════════════════════════════════════════════════

// ── State ──────────────────────────────────────────────────────────
let detectedFields = null;
let jcPanel = null;
let panelWasOpen = false;

// [FIX F] Running totals for the current fill run. Accumulated by the
// runFillSequence() wrapper and rendered as ONE persistent panel summary.
let fillStats = {
  filled: 0, skipped: 0, errors: [], aiFilled: 0, aiTotal: 0, resumeFileStored: null,
};

// Sync fill state to DOM so external scripts (fill.mjs, fill_section.mjs)
// can poll via document.documentElement.dataset.jcFilling
function setFilling(val) {
  window.__jcFilling = val;
  document.documentElement.dataset.jcFilling = val ? 'true' : 'false';
}

// ── Field Category Map ──────────────────────────────────────────────
// Maps portal-specific field names to generic categories.
// When saving a learned correction, we save under BOTH the portal-specific
// key and the generic category. When building the fill map, we check for
// the generic category if the portal-specific key has no value.
// This ensures learnings from Oracle CX work on Workday, Greenhouse, etc.
const fieldCategoryMap = {
  // Address
  'address': 'street_address',
  'region1': 'state',
  'addressline1': 'street_address',
  'addressline2': 'street_address_2',
  'addressline3': 'apt_number',
  'addressLine1': 'street_address', 'addressLine2': 'street_address_2',
  'street_address2': 'street_address_2',
  'addressLine3': 'street_address_3', 'streetAddress': 'street_address',
  'address1': 'street_address', 'address_1': 'street_address',
  'address_line_1': 'street_address', 'street': 'street_address',
  'address2': 'street_address_2', 'address_2': 'street_address_2',
  'address_line_2': 'street_address_2',
  // City
  'city': 'city', 'locality': 'city', 'municipality': 'city',
  // [FIX G2] "Current location" text inputs (Lever uses name="location") resolve
  // to the city parsed from profile_address by buildFillMap() — no new parser.
  'location': 'city', 'current_location': 'city', 'currentLocation': 'city',
  // State
  'region2': 'state', 'state': 'state', 'province': 'state',
  'stateProvince': 'state', 'region': 'state',
  // Postal code
  'postalCode': 'postal_code', 'postal_code': 'postal_code',
  'zip': 'postal_code', 'zipCode': 'postal_code', 'postcode': 'postal_code',
  // Country
  'country': 'country', 'countryCode': 'country',
  'country_code': 'country', 'countryCode-2': 'country',
  // Phone
  'phone': 'phone', 'phoneNumber': 'phone', 'phone_number': 'phone',
  'telephone': 'phone', 'mobile': 'phone',
  'phone_country_code': 'phone_country_code',
  // Email
  'email': 'email', 'emailAddress': 'email', 'email_address': 'email',
  'confirmEmail': 'email', 'confirm_email': 'email',
  // Name
  'firstName': 'first_name', 'first_name': 'first_name', 'givenName': 'first_name',
  'lastName': 'last_name', 'last_name': 'last_name', 'familyName': 'last_name',
  'middleNames': 'middle_name', 'middle_name': 'middle_name',
  'fullName': 'full_name', 'full_name': 'full_name',
  // Links
  'linkedin': 'linkedin',
  // [FIX A] siteLink-1 is Oracle's "Link 1" URL field — it must not be
  // filled from the LinkedIn URL. Map it to website (blank unless the
  // profile has a real website URL).
  'siteLink-1': 'website',
  'github': 'github', 'website': 'website',
  // Employer / Experience
  'employerName': 'employer_name',
  'companyName': 'company_name',
  'jobTitle': 'job_title',
  'startDate-month': 'start_month',
  'startDate-year': 'start_year',
  'endDate-month': 'end_month',
  'endDate-year': 'end_year',
  'responsibilities': 'responsibilities',
};

// Get the generic category for a field name
function getFieldCategory(fieldName) {
  return fieldCategoryMap[fieldName] || fieldName;
}

// ── Fill-scope + learning predicates (Fixes B/C/D) ─────────────────
// Pure helpers shared by the fill path, the learning path, and
// test/fill_mapping.mjs (which loads this file in a vm sandbox).

// [FIX B] Keys the stored profile owns. Learning must never persist these:
// the profile is the source of truth, learning may only cover unknown/custom
// fields. Checked against the raw field name AND its generic category
// (e.g. "emailAddress" → "email"), so aliases are covered too.
const JC_PROFILE_OWNED_KEYS = new Set([
  'name', 'first_name', 'last_name', 'full_name', 'middle_name',
  'email', 'phone', 'phone_country_code', 'linkedin', 'github', 'website',
  'address', 'street_address', 'street_address_2', 'apt_number',
  'city', 'state', 'postal_code', 'country', 'work_authorization',
]);

function isProfileOwnedKey(key) {
  if (!key) return false;
  return JC_PROFILE_OWNED_KEYS.has(key) || JC_PROFILE_OWNED_KEYS.has(getFieldCategory(key));
}

// [FIX B2] Merge learned corrections into a fill map. Learned values apply
// ONLY when the key is not profile-owned and the profile produced no value
// for it. Single merge path for fillPersonal() and fillSingleField().
function mergeLearnedCorrections(fillMap, corrections) {
  for (const [key, val] of Object.entries(corrections || {})) {
    if (!val) continue;
    if (isProfileOwnedKey(key)) continue;
    if (fillMap[key]) continue; // profile value wins
    fillMap[key] = val;
  }
  return fillMap;
}

// [FIX B2] Value resolution used by the fill paths: field name first, then
// the generic category (e.g. "addressLine1" → "street_address").
function resolveFillValue(fillMap, fieldName) {
  return fillMap[fieldName] || fillMap[getFieldCategory(fieldName)] || '';
}

// [FIX G2] Some fields keep the detector's fallback name "unknown" (Lever's
// "Current location" input: the detector has no alias for name="location").
// Resolve those from the label/attributes to an EXISTING fill-map key — the
// city parsed by buildFillMap() — no new address parser.
function resolveLabelBasedValue(field, fillMap) {
  const el = field && field.el;
  const text = [
    field && field.label,
    el && el.name, el && el.id, el && el.placeholder,
  ].filter(Boolean).join(' ').toLowerCase();
  if (!text.trim()) return '';
  if (/\blocation\b/.test(text) || /\bcity\b/.test(text)) return fillMap.city || '';
  return '';
}

// [FIX K2] Resolve a field's fill value: identity → category → label-based.
// The identity "unknown" is NOT a data key: a learned/garbage fillMap['unknown']
// entry (created when a DOM-identifier field got learned) must never shadow the
// real resolution. Live evidence: Lever's "Current location" input (name=
// "location", detector identity "unknown") was being filled with the poisoned
// learned value fillMap['unknown'] — the framework rejected it and the panel
// reported "fill rejected: current location". Label-based resolution maps it to
// fillMap.city = "Gdansk".
function resolveFieldValue(field, fillMap) {
  const name = field && field.name;
  const category = getFieldCategory(name);
  const byName = (name && name !== 'unknown') ? fillMap[name] : '';
  const byCategory = (category && category !== 'unknown') ? fillMap[category] : '';
  return byName || byCategory || resolveLabelBasedValue(field, fillMap);
}

// [FIX C3] Technical/hidden inputs must never be filled or learned from.
function isTechnicalOrHiddenInput(el) {
  if (!el) return true;
  const type = (el.type || '').toLowerCase();
  const text = ((el.name || '') + ' ' + (el.id || '')).toLowerCase();
  if (type === 'hidden') return true;
  if (/g-recaptcha-response/.test(text)) return true;
  if (/csrf/.test(text)) return true;
  if (/[-_]token$/.test(text.trim())) return true;
  if (/\b_ga\b/.test(text) || /utm_/.test(text)) return true;
  if (el.getAttribute && el.getAttribute('aria-hidden') === 'true') return true;
  if (el.getAttribute && el.getAttribute('tabindex') === '-1') return true;
  if (el.style && (el.style.display === 'none' || el.style.visibility === 'hidden')) return true;
  if (typeof el.offsetWidth === 'number' && typeof el.offsetHeight === 'number' &&
      (el.offsetWidth === 0 || el.offsetHeight === 0)) return true;
  return false;
}

// [FIX C2] Search/filter UI must never be filled (Oracle P3: the job-search
// filter box received profile data). Matches the field's own identifiers and
// any ancestor search/filter/nav container.
function isSearchOrFilterInput(el) {
  if (!el) return false;
  const labelText = (el.labels && el.labels[0] && el.labels[0].textContent) || '';
  const text = [el.name, el.id, el.placeholder, el.getAttribute ? el.getAttribute('aria-label') : '', labelText]
    .filter(Boolean).join(' ').toLowerCase();
  if (/\b(keyword|search|q|query|filter)\b/.test(text)) return true;
  if (el.closest) {
    try {
      if (el.closest('[role="search"], header, nav, [class*="search"], [class*="filter"]')) return true;
    } catch (e) { /* invalid selector in non-DOM stubs — ignore */ }
  }
  return false;
}

// [FIX C4] The extension's own injected UI (panel, buttons) must never be
// treated as a form field.
function isJCInjectedElement(el) {
  if (!el) return true;
  if (el.id && String(el.id).indexOf('jc-') === 0) return true;
  if (el.classList && el.classList.contains('jc-field-fill-btn')) return true;
  if (el.closest) {
    try {
      if (el.closest('#jc-panel, #jc-float-btn, .jc-field-fill-btn')) return true;
    } catch (e) { /* non-DOM stub — ignore */ }
  }
  return false;
}

// [FIX C] Combined skip predicate for detected fields.
function shouldSkipDetectedField(field) {
  const el = field && field.el;
  if (!el) return true;
  return isJCInjectedElement(el) || isTechnicalOrHiddenInput(el) || isSearchOrFilterInput(el);
}

// [FIX C1] Does this page actually contain an application form? True when a
// resume/cv file input exists, an application container is present, or the
// page has >= 3 fillable personal fields. Unknown pages → false (fill nothing).
function pageHasApplicationForm(doc) {
  const d = doc || document;
  try {
    const fileInputs = Array.from(d.querySelectorAll('input[type="file"]') || []);
    for (const f of fileInputs) {
      const hint = ((f.name || '') + ' ' + (f.id || '') + ' ' +
        (f.getAttribute ? (f.getAttribute('aria-label') || '') : '')).toLowerCase();
      if (!/resume|cv|upload|attach|document/.test(hint)) continue;
      // A resume-upload widget that lives in the site's search/header/nav
      // chrome is not an application form (Oracle's "recommended jobs"
      // upload on the P3 preview/search page). Same container list that
      // isSearchOrFilterInput() rejects.
      let inSearchChrome = false;
      if (f.closest) {
        try { inSearchChrome = !!f.closest('[role="search"], header, nav, [class*="search"], [class*="filter"]'); }
        catch (err) { inSearchChrome = false; }
      }
      if (!inSearchChrome) return true;
    }
    if (d.querySelector('#application-form, #application_form, form[action*="apply"], [class*="application-form"], .apply-flow, [data-automation-id*="apply"]')) return true;
    const fields = FormDetector.detect();
    const personal = [...fields.personal, ...fields.selects]
      .filter(f => !shouldSkipDetectedField(f));
    return personal.length >= 3;
  } catch (e) {
    console.log('JC: pageHasApplicationForm failed:', e.message);
    return false;
  }
}

// ── Global Learning ──────────────────────────────────────────────────
// Attaches blur listeners to ALL detected text inputs/textareas.
// When you manually fill a field JC didn't touch (address, street, etc.),
// the value is saved to learned_fields. Next Fill All will use it.
//
// [FIX L1] Inert learned keys. 'unknown' and 'custom' are synthetic
// identities, not field identities: resolveFieldValue() above never reads
// them, so an entry learned under one is dead weight that grows on every
// AI-filled field (live case: learned_fields['unknown'] = the AI answer
// written into Lever's cards[uuid][field0] textarea).
const INERT_LEARNED_KEYS = ['unknown', 'custom'];

// A blurred value may be persisted as a learned correction only when its key
// is a REAL field identity. Exact predicate:
//   1. key non-empty after trim;
//   2. key is not an inert synthetic key ('unknown' | 'custom');
//   3. the element exposes a non-empty name or id of its own.
// Anything else is skipped — never written to learned_fields.
function isLearnableFieldKey(key, el) {
  const k = String(key == null ? '' : key).trim();
  if (!k) return false;                                   // empty key
  if (INERT_LEARNED_KEYS.indexOf(k) !== -1) return false; // 'unknown' | 'custom'
  const name = String((el && el.name) || '').trim();
  const id = String((el && el.id) || '').trim();
  if (!name && !id) return false;                         // no real field identity
  return true;
}

// [FIX L2] An AI answer is a JC write, not a user edit. FormDetector.fillField()
// blurs the element (form-detector.js: el.blur()), so the blur fires
// synchronously DURING the fill — the markers must be on the element BEFORE
// the call, otherwise every blur handler reads the answer as a user
// correction. jcFilled/jcValue are the same markers the normal fill path sets
// (listenForCorrections, below); jcOriginal mirrors form-detector's own marker
// so the attachGlobalLearning blur branch compares equal and stays silent.
function markAIFill(el, value) {
  if (!el || !el.dataset) return;
  el.dataset.jcFilled = 'true';
  el.dataset.jcValue = value;
  el.dataset.jcOriginal = value;
}

const _learnedEls = new WeakSet();
function attachGlobalLearning() {
  const fields = FormDetector.detect();
  const allFields = [...fields.personal, ...fields.questions, ...fields.selects, ...fields.unknown];
  for (const field of allFields) {
    // [FIX C] Never learn from search/filter UI, hidden/technical inputs,
    // or the extension's own injected elements.
    if (shouldSkipDetectedField(field)) continue;
    const el = field.el;
    if (!el || _learnedEls.has(el)) continue;
    if (el.dataset.jcFilled) continue; // already handled by listenForCorrections
    _learnedEls.add(el);

    const fieldName = field.name || el.name || el.id;
    // [FIX L1] Non-identifying fields are never learned (see
    // isLearnableFieldKey): inert synthetic key, or no name/id on the element.
    const learnable = isLearnableFieldKey(fieldName, el);
    el.addEventListener('blur', function onUserEdit() {
      // Was filled by extension — only learn if user edited the value
      if (el.dataset.jcFilled === 'true') {
        if (el.value !== el.dataset.jcOriginal) {
          if (learnable) saveLearnedCorrection(fieldName, el.value);
        }
        return;
      }
      const val = el.value?.trim();
      if (val && learnable) {
        saveLearnedCorrection(fieldName, val);
        console.log('JC: Learned from user: "' + fieldName + '" = "' + val + '"');
      } else if (val && !learnable) {
        console.log('JC: Not learning "' + fieldName + '" — no real field identity (name/id)');
      }
      // Don't remove listener — keep saving on every blur so corrections work
    });
  }
}

// ── SPA Navigation Handler ─────────────────────────────────────────
// Oracle CX is a single-page app. When you click "Apply", "Next", or
// "Continue", Oracle destroys the current form and renders a new one.
// This listener catches those clicks, waits 3 seconds for Oracle to
// finish rendering, then re-runs detect() (Step 2-3) and re-injects
// per-field "F" buttons on the new fields. No auto-fill — just buttons.
document.addEventListener('click', function(e) {
  var t = e.target.closest('button, a') || e.target;
  if (t.tagName === 'BUTTON' || t.tagName === 'A') {
    var txt = (t.textContent || '').toLowerCase();
    if (txt.includes('apply') || txt.includes('next') || txt.includes('continue') || txt.includes('add experience')) {
      setTimeout(function() {
        var fields = FormDetector.detect();
        var total = fields.personal.length + fields.questions.length + fields.selects.length;
        if (total > 0) {
          if (!document.getElementById('jc-float-btn')) {
            injectFloatingButton();
          }
          injectPerFieldButtons();
          attachGlobalLearning();
          const p = document.getElementById('jc-panel');
          if (p && panelWasOpen && !p.classList.contains('open')) {
            p.classList.add('open');
            updatePanel();
          }
          chrome.runtime.sendMessage({ type: 'jc_fields_detected', count: total }).catch(function() {});
        }
      }, 3000);
    }
  }
});

// ── Main Init (TRIGGER: page load) ─────────────────────────────────
// Chrome injects this script into the page at document_idle (manifest.json).
// Oracle CX is a single-page app — form fields don't exist in the DOM yet
// when the URL loads. They appear 1-2 seconds later when Oracle's JS renders.
// We wait 1.5s, then call FormDetector.detect() (Step 2-3) to find fields.
// If fields exist, we inject the JC button + per-field "F" buttons.
// NO auto-fill — user clicks Fill All when ready.
async function init() {
  setTimeout(function() {
    // [FIX B] One-time cleanup of learned_fields poisoned by the old
    // website→LinkedIn fallback and by learning profile-owned keys.
    migrateLearnedFieldsOnce();
    // [FIX L1] One-time cleanup of the inert synthetic keys ('unknown'/'custom').
    migrateInertLearnedKeysOnce();
    detectedFields = FormDetector.detect();
    const totalFields = detectedFields.personal.length +
                        detectedFields.questions.length +
                        detectedFields.selects.length;

    if (totalFields === 0) return;

    injectFloatingButton();
    injectPerFieldButtons();
    attachGlobalLearning();

    console.log("%c🔍 Job Copilot loaded", "font-weight:bold;color:#3b82f6");
    setTimeout(() => FormDetector.debugLog(), 2000);

    chrome.runtime.sendMessage({
      type: 'jc_fields_detected',
      count: totalFields,
    }).catch(() => {});
  }, 1500);
}

// ── Floating Button + Panel ────────────────────────────────────────
function injectFloatingButton() {
  if (document.getElementById('jc-float-btn')) return;

  const btn = document.createElement('button');
  btn.id = 'jc-float-btn';
  btn.textContent = 'JC';

  const panel = createPanel();

  btn.onclick = () => {
    panel.classList.toggle('open');
    panelWasOpen = panel.classList.contains('open');
    if (panelWasOpen) updatePanel();
  };

  document.body.appendChild(btn);

  document.addEventListener('click', (e) => {
    if (window.__jcFilling) return;
    if (!btn.contains(e.target) && !panel.contains(e.target)) {
      panel.classList.remove('open');
    }
  });
}

// Panel: Fill All + Clear All only
function createPanel() {
  const existingPanel = document.getElementById('jc-panel');
  if (existingPanel) {
    if (panelWasOpen && !existingPanel.classList.contains('open')) {
      existingPanel.classList.add('open');
      updatePanel();
    }
    return existingPanel;
  }

  jcPanel = document.createElement('div');
  jcPanel.id = 'jc-panel';

  jcPanel.innerHTML = `
    <div id="jc-panel-header">
      <span>Job Copilot</span>
      <button id="jc-panel-close">×</button>
    </div>
    <div id="jc-panel-body">
      <div id="jc-stats"></div>
      <button class="jc-btn jc-btn-primary" id="jc-fill-all">Fill All</button>
      <button class="jc-btn jc-btn-secondary" id="jc-clear-form" style="margin-top:4px;background:#fef2f2!important;color:#991b1b!important;border:1px solid #fecaca!important">Clear All</button>
      <div id="jc-status-msg"></div>
    </div>
  `;

  jcPanel.querySelector('#jc-panel-close').onclick = () => {
    jcPanel.classList.remove('open');
    panelWasOpen = false;
  };

  jcPanel.querySelector('#jc-fill-all').onclick = async () => {
    setFilling(true);
    try {
      // [FIX C1] Gate the whole fill sequence: when the page has no
      // application form, fill nothing (Oracle P3 search page).
      if (!pageHasApplicationForm()) {
        showStatus('No application form detected on this page', 'info');
        return;
      }
      // [FIX F] One stats wrapper for the whole run → one persistent summary.
      await runFillSequence(async () => {
        await fillPersonal();
        await fillExperience();
        await fillEducation();
        await fillSkills();
        await fillLanguages();
        await fillLicenses();
        await fillAIQuestions();
        await fillApplicationQuestions();
        await fillLearnedRadios();
        await reassertClearedFields();
      });
    } catch (err) {
      // [FIX E3] console.warn — console.error raises an extension-error entry
      // for recoverable states (AGENTS.md pitfall).
      console.warn('[JC] Fill All error:', err);
      fillStats.errors.push(shortLLMError(err.message));
      renderFillSummary();
    } finally {
      setFilling(false);
    }
  };

  // TRIGGER: user clicks "Clear All" in the panel.
  // Sets the same guard as Fill All (the clear operation modifies the DOM),
  // runs clearForm() which removes all values from the form, then releases the guard.
  jcPanel.querySelector('#jc-clear-form').onclick = () => {
    setFilling(true);
    clearForm();
    setFilling(false);
  };

  document.body.appendChild(jcPanel);
  return jcPanel;
}

function updatePanel() {
  const stats = document.getElementById('jc-stats');
  if (!stats) return;
  const fields = FormDetector.detect();
  detectedFields = fields;

  stats.innerHTML = `
    <div class="jc-stat">
      <span class="jc-stat-label">Personal fields</span>
      <span class="jc-stat-value">${fields.personal.length}</span>
    </div>
    <div class="jc-stat">
      <span class="jc-stat-label">Questions</span>
      <span class="jc-stat-value">${fields.questions.length}</span>
    </div>
    <div class="jc-stat">
      <span class="jc-stat-label">Dropdowns</span>
      <span class="jc-stat-value">${fields.selects.length}</span>
    </div>
    <div class="jc-stat">
      <span class="jc-stat-label">File uploads</span>
      <span class="jc-stat-value">${fields.files.length}</span>
    </div>
  `;
}

// ── Per-Field "F" Buttons ─────────────────────────────────────────
// When the page loads or Oracle re-renders a section, this function wraps
// each detected field with a small "F" button that appears on hover.
// Each button is bound to the specific field object that detect() returned.
// Clicking it calls fillSingleField(field) which fills just that one field.
//
// This exists so you can fill individual fields without running Fill All.
// Maybe you only want the name and email filled, not the AI questions.
// Maybe you want to re-fill one field you cleared.
function injectPerFieldButtons() {
  // Remove ALL existing F buttons first (prevents duplicates on reload)
  document.querySelectorAll('.jc-field-fill-btn').forEach(b => b.remove());

  const fields = FormDetector.detect();
  const allFields = [...fields.personal, ...fields.questions, ...fields.selects, ...fields.unknown];

  for (const field of allFields) {
    if (field.el.type === 'file') continue;
    // [FIX C] No per-field fill button on non-application targets either.
    if (shouldSkipDetectedField(field)) continue;

    const btn = document.createElement('button');
    btn.className = 'jc-field-fill-btn';
    btn.title = 'Fill this field';
    btn.textContent = 'F';

    btn.onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await fillSingleField(field);
    };

    // Insert F button inside parent with absolute positioning.
    // Override overflow:hidden on ancestor containers so F button
    // renders OUTSIDE the field box to the right.
    const parent = field.el.parentElement;
    if (getComputedStyle(parent).position === 'static') {
      parent.style.position = 'relative';
    }
    // Override overflow:hidden on ALL ancestors up to body
    let ancestor = parent;
    while (ancestor && ancestor !== document.body) {
      if (getComputedStyle(ancestor).overflow !== 'visible') {
        ancestor.style.overflow = 'visible';
      }
      ancestor = ancestor.parentElement;
    }
    parent.appendChild(btn);
  }
}


// Step 9a: reconstruct resume text from resume_full_data.
// resume_full_data is a JSON object with structured sections (summary,
// experience, education, skills, projects) extracted by the LLM when
// you uploaded your resume in settings. We convert it to plain text
// because that's what the LLM expects as context for answering questions.
async function getResumeText() {
  const data = await chrome.storage.sync.get(['resume_full_data']);
  if (data.resume_full_data) {
    try {
      const full = JSON.parse(data.resume_full_data);
      const sections = full.rawSections || {};
      let text = '';
      if (full.summary) text += full.summary + '\n\n';
      if (sections.experience) {
        for (const e of sections.experience) {
          text += (e.title || '') + ' at ' + (e.company || '') + ' (' + (e.start_date || '') + ' - ' + (e.end_date || '') + ')\n';
          if (e.description) text += e.description + '\n';
        }
        text += '\n';
      }
      if (sections.education) {
        for (const ed of sections.education) {
          text += (ed.degree || '') + ' ' + (ed.field || '') + ' at ' + (ed.school || '') + '\n';
        }
        text += '\n';
      }
      if (sections.skills) text += 'Skills: ' + sections.skills.join(', ') + '\n';
      if (sections.projects) {
        for (const p of sections.projects) text += (p.name || '') + ': ' + (p.description || '') + '\n';
      }
      return text.trim();
    } catch(e) { return ''; }
  }
  return '';
}

// Get a specific section from resume_full_data.
// Returns array of items or null if no resume data.
async function getResumeSection(sectionName) {
  const data = await chrome.storage.sync.get('resume_full_data');
  if (!data.resume_full_data) return null;
  try {
    const parsed = JSON.parse(data.resume_full_data);
    return parsed.rawSections?.[sectionName] || [];
  } catch { return null; }
}

// TRIGGER: user clicks the per-field "F" button (hover to reveal).
// Same logic as fillAll but for one field. Textareas go to the LLM
// (Step 9-10 path), everything else goes to the profile fill map
// (Steps 4-5 path). Attaches learning listener (Step 8) either way.
async function fillSingleField(field) {
  const fieldLabel = field.label || field.name || 'field';

  // [FIX C] Refuse non-application targets and pages without a real
  // application form — never write into search/filter or technical inputs.
  if (shouldSkipDetectedField(field)) {
    showStatus('Skipped "' + fieldLabel + '" (not an application field)', 'info');
    return;
  }
  if (!pageHasApplicationForm()) {
    showStatus('No application form detected on this page', 'info');
    return;
  }

  // Textarea → call LLM
  if (field.el instanceof HTMLTextAreaElement) {
  const profile = await chrome.storage.sync.get(['llm_base_url', 'llm_api_key', 'llm_model', 'llm_extra_headers']);
    const resumeText = await getResumeText();
    if (!resumeText) {
      showStatus('No resume — upload PDF in settings first.', 'error');
      makeStatusClickable();
      return;
    }
    // [FIX K1] Derive the real question text from the DOM. Never prompt with
    // the raw DOM name (`cards[uuid][field0]`) — and never write meta-text:
    // no readable question ⇒ skip, blank field, explicit status.
    const question = FormDetector.deriveQuestionText(field);
    if (!question) {
      showStatus('Skipped "' + fieldLabel + '" (no question text)', 'info');
      console.warn('JC: fillSingleField — no readable question text for', (field.el && (field.el.name || field.el.id)) || fieldLabel, '— field left blank');
      return;
    }
    const jd = extractJobDescription();
    LLMClient.getConfig = async () => ({
      baseUrl: (profile.llm_base_url || 'https://api.openai.com/v1').replace(/\/+$/, ''),
      apiKey: profile.llm_api_key || '',
      // [FIX K4] no pinned default — empty surfaces the actionable Settings error
      model: profile.llm_model || '',
      extraHeaders: LLMClient.parseExtraHeaders(profile.llm_extra_headers),
    });
    try {
      showStatus('Generating answer...', 'info');
      fillStats.aiTotal++;
      // [FIX K1] Output guard: meta-commentary/refusal ⇒ one stricter retry ⇒
      // still unusable ⇒ blank field, reported as skipped (never written).
      const result = await LLMClient.generateVerifiedAnswer(question, jd, resumeText);
      if (!result.answer) {
        showStatus('Skipped "' + fieldLabel + '" (unusable answer)', 'info');
        console.warn('JC: fillSingleField — no usable answer for "' + question + '" — field left blank');
        return;
      }
      markAIFill(field && field.el, result.answer); // [FIX L2] markers before the blur inside fillField
      await FormDetector.fillField(field, result.answer);
      fillStats.aiFilled++;
      await saveAnswer(question, result.answer);
      showStatus('Answered!', 'success');
    } catch (err) {
      fillStats.errors.push(shortLLMError(err.message));
      showStatus('LLM error: ' + err.message, 'error');
      makeStatusClickable();
      console.warn('JC: fillSingleField — LLM error for "' + question + '":', err.message);
    }
    return;
  }

  // Everything else → fill from profile
  const fillMap = await buildFillMap();
  const learned = await chrome.storage.sync.get('learned_fields');
  // [FIX B2] Learned values never override profile values (merge helper).
  mergeLearnedCorrections(fillMap, learned.learned_fields || {});

  // [FIX B2] Field name first, then generic category, then label-based
  // resolution (G2: unnamed fields such as "Current location"). [FIX K2] the
  // identity "unknown" is not a data key (see resolveFieldValue).
  const value = resolveFieldValue(field, fillMap);
  if (!value) {
    showStatus('No data for "' + fieldLabel + '"', 'info');
    return;
  }
  if (skipFieldForType(field, value)) {
    showStatus('Skipped "' + fieldLabel + '" (type mismatch)', 'info');
    return;
  }
  const ok = await FormDetector.fillField(field, value);
  if (ok) {
    listenForCorrections([field.el]);
    showStatus('Filled ' + fieldLabel, 'success');
  } else {
    showStatus('Failed to fill ' + fieldLabel, 'error');
  }
}

// ── Fill All — Personal Fields (Steps 2-8) ─────────────────────────
// Step 2: detect fields on page. Step 4: build value map from storage.
// Step 5: look up values and fill. Step 8: attach learning listeners.
async function fillPersonal() {
  // [FIX C1] No application form on this page → fill nothing.
  if (!pageHasApplicationForm()) {
    showStatus('No application form detected on this page', 'info');
    return;
  }
  const fields = FormDetector.detect();
  const fillMap = await buildFillMap();

  const hasProfileData = Object.values(fillMap).some(v => v && typeof v === 'string' && v.trim().length > 0);
  if (!hasProfileData) {
    showStatus('No profile data — open settings.', 'error');
    makeStatusClickable();
    return;
  }

  // [FIX G2] Fields with no recognizable name are included when their LABEL
  // resolves to a fill-map value (e.g. Lever "Current location" → city).

  // [FIX] Smart phone: if form has a separate phone_country_code field,
  // strip the country code prefix from the phone value so each field gets
  // the right portion. If no country code field exists, leave phone as-is
  // (full number with country code). This handles both Oracle CX (split)
  // and Workday/Greenhouse (single field) automatically.
  const hasCountryCodeField = fields.personal.some(f => f.name === 'phone_country_code') ||
                               fields.selects.some(f => f.name === 'phone_country_code');
  if (hasCountryCodeField && fillMap.phone_country_code && fillMap.phone) {
    const cc = fillMap.phone_country_code;
    if (fillMap.phone.startsWith(cc)) {
      fillMap.phone = fillMap.phone.slice(cc.length).replace(/^[-\s]+/, '').trim();
    }
  }

  const learned = await chrome.storage.sync.get('learned_fields');
  // [FIX B2] Profile values win; learned corrections only fill the gaps.
  mergeLearnedCorrections(fillMap, learned.learned_fields || {});

  // Step 5: for each detected field, look up its value in the fill map.
  // fillMap keys match field.name because buildFillMap() uses the same
  // names that FormDetector.identify() returns (first_name, email, etc.)
  let filled = 0;
  const filledEls = [];
  const labelResolved = fields.unknown.filter(f => resolveLabelBasedValue(f, fillMap) !== '');
  const allFields = [...fields.personal, ...fields.selects, ...labelResolved]
    .filter(f => f.name !== 'employer_name' && f.name !== 'company_name')
    // [FIX C2/C3/C4] Skip search/filter UI, hidden/technical inputs, and
    // the extension's own injected elements.
    .filter(f => !shouldSkipDetectedField(f));
  // Sort: text inputs first, then comboboxes, then selects last
  // Prevents country/state combobox re-render from invalidating text field refs
  allFields.sort((a, b) => {
    const isText = (el) => el.type === 'text' || el.type === 'email' || el.type === 'tel' || el.type === 'url' || el.type === 'number';
    const isSelect = (el) => el instanceof HTMLSelectElement;
    const aText = isText(a.el) ? 0 : (isSelect(a.el) ? 2 : 1);
    const bText = isText(b.el) ? 0 : (isSelect(b.el) ? 2 : 1);
    return aText - bText;
  });
  for (const field of allFields) {
    // [FIX K2] 'unknown' cannot shadow label-based resolution (resolveFieldValue)
    const value = resolveFieldValue(field, fillMap); // Step 5: lookup by field identity + category + label
    if (value && !skipFieldForType(field, value)) {
      const ok = await FormDetector.fillField(field, value);
      if (ok) { filled++; filledEls.push(field.el); }
    }
  }

  // Re-detect after Oracle combobox fills may have triggered re-render
  // Country/state combobox fills cause Oracle to recreate address fields
  try {
    const recheck = FormDetector.detect();
    const recheckFields = [...recheck.personal, ...recheck.selects]
      .filter(f => f.name !== 'employer_name' && f.name !== 'company_name');
    for (const field of recheckFields) {
      // Skip if already has value
      if (field.el.value && field.el.value.trim().length > 0) continue;
      const value = resolveFieldValue(field, fillMap);
      if (value && !skipFieldForType(field, value)) {
        const ok = await FormDetector.fillField(field, value);
        if (ok) { filled++; filledEls.push(field.el); }
      }
    }
  } catch (e) {
    console.log('JC: Re-detect pass failed:', e.message);
  }

  if (filledEls.length > 0) listenForCorrections(filledEls);
  if (filled > 0) {
    showStatus('Filled ' + filled + ' personal field(s)', 'success');
  } else if (hasProfileData) {
    showStatus('Profile data exists but no fields matched.', 'error');
  }
}

// [FIX K2] Final re-assert pass. Some widgets (live case: Lever's location
// autocomplete, input[name=location]) clear a programmatically committed value
// when focus moves to a later field — the AI textarea fill right after left
// "Gdansk" empty in the final dump. After all phases, re-detect and re-fill
// fields that are EMPTY but have a resolvable value. Bounded: one pass,
// personal + label-resolved fields only, non-empty fields are untouched.
async function reassertClearedFields() {
  if (!pageHasApplicationForm()) return;
  const fields = FormDetector.detect();
  const fillMap = await buildFillMap();
  const learned = await chrome.storage.sync.get('learned_fields');
  mergeLearnedCorrections(fillMap, learned.learned_fields || {});
  const candidates = [...fields.personal, ...fields.unknown.filter(f => resolveLabelBasedValue(f, fillMap) !== '')]
    .filter(f => f.name !== 'employer_name' && f.name !== 'company_name')
    .filter(f => !shouldSkipDetectedField(f))
    .filter(f => !(f.el.value && f.el.value.trim().length > 0));
  let refilled = 0;
  for (const field of candidates) {
    const value = resolveFieldValue(field, fillMap);
    if (!value || skipFieldForType(field, value)) continue;
    const ok = await FormDetector.fillField(field, value);
    if (ok) refilled++;
  }
  if (refilled > 0) console.log('JC: re-asserted ' + refilled + ' field(s) cleared by late focus changes');
}

// ── Fill All — AI Questions (Steps 9-10) ───────────────────────────
// Step 9: get resume text from storage, scrape job description from page.
// For each textarea, call the LLM (Step 10) and fill the answer.
async function fillAIQuestions() {
  const profile = await chrome.storage.sync.get([
    'llm_base_url', 'llm_api_key', 'llm_model', 'llm_extra_headers', 'profile_name',
  ]);

  // No LLM configured — surface it in the panel instead of failing silently
  if (!profile.llm_base_url && !profile.llm_api_key) {
    fillStats.errors.push('no LLM configured');
    showStatus('AI answers: no LLM configured — open Settings', 'error');
    makeStatusClickable();
    console.warn('JC: fillAIQuestions — no LLM configured (llm_base_url/llm_api_key empty). Open Settings to configure the AI engine.');
    return;
  }

  const resumeText = await getResumeText();

  if (!resumeText) {
    fillStats.errors.push('no resume stored');
    showStatus('No resume — upload PDF in settings first.', 'error');
    makeStatusClickable();
    return;
  }

  const fields = FormDetector.detect();
  const questions = fields.questions;
  if (questions.length === 0) {
    showStatus('AI answers: no questions found on this page', 'info');
    return;
  }

  let jobDescription = extractJobDescription();
  showStatus('Generating ' + questions.length + ' answer(s)...', 'info');
  fillStats.aiTotal = questions.length;

  let filled = 0;
  let skippedNoText = 0;
  let skippedUnusable = 0;
  const failures = [];
  for (const field of questions) {
    try {
      // [FIX K1] Question text comes from the DOM derivation (label chain /
      // aria-* / container heading), never from field.label's identifier
      // fallback. Nothing readable ⇒ no LLM call, nothing written, counted as
      // skipped. Blank is correct; nonsense is not.
      const question = field.questionText || FormDetector.deriveQuestionText(field);
      if (!question || FormDetector.isDomIdentifier(question, field)) {
        skippedNoText++;
        console.warn('JC: skipping question field (no question text):', (field.el && (field.el.name || field.el.id)) || '(unnamed)');
        continue;
      }
      LLMClient.getConfig = async () => ({
        baseUrl: (profile.llm_base_url || 'https://api.openai.com/v1').replace(/\/+$/, ''),
        apiKey: profile.llm_api_key || '',
        // [FIX K4] no pinned default — empty surfaces the actionable Settings error
        model: profile.llm_model || '',
        extraHeaders: LLMClient.parseExtraHeaders(profile.llm_extra_headers),
      });

      // [FIX K1] Output guard: meta-commentary/refusal ⇒ one stricter retry ⇒
      // still unusable ⇒ leave blank and report the skip.
      const result = await LLMClient.generateVerifiedAnswer(question, jobDescription, resumeText);
      if (!result.answer) {
        skippedUnusable++;
        console.warn('JC: no usable answer for "' + question + '" — field left blank');
        continue;
      }
      const answer = result.answer;
      markAIFill(field && field.el, answer); // [FIX L2] markers before the blur inside fillField
      await FormDetector.fillField(field, answer);

      try {
        if (typeof TokenTracker !== 'undefined') {
          const approx = Math.ceil((question.length + answer.length + resumeText.length) / 4);
          TokenTracker.record(profile.llm_model || 'unknown', {
            prompt_tokens: Math.ceil(((question.length + resumeText.length)) / 4),
            completion_tokens: Math.ceil(answer.length / 4),
            total_tokens: approx,
          });
        }
      } catch(e) {}

      await saveAnswer(question, answer);
      filled++;
      fillStats.aiFilled++;
    } catch (err) {
      failures.push((field.label || field.identifiers || 'question') + ': ' + err.message);
      fillStats.errors.push(shortLLMError(err.message));
      console.log('JC: LLM error for field:', field.label, err.message);
    }
  }

  // Actionable panel summary; the status element clears after 5s, so the full
  // per-question detail is also mirrored to console.warn.
  const failedNote = failures.length
    ? ', ' + failures.length + ' failed (' + shortLLMError(failures[0]) + ')'
    : '';
  const skipNote = (skippedNoText ? ', ' + skippedNoText + ' skipped (no question text)' : '') +
                   (skippedUnusable ? ', ' + skippedUnusable + ' skipped (unusable answer)' : '');
  const statusClass = filled > 0 ? 'success' : ((skippedNoText + skippedUnusable) > 0 ? 'info' : 'error');
  showStatus('AI answers: ' + filled + '/' + questions.length + ' filled' + skipNote + failedNote, statusClass);
  if (failures.length) {
    console.warn('JC: fillAIQuestions — ' + failures.length + '/' + questions.length + ' answer(s) failed:\n' + failures.join('\n'));
  }
}

// Short reason for the panel summary (full detail goes to console.warn).
// Gateway errors carry a machine-readable "type" (e.g. MissingSessionID);
// otherwise trim the message to something readable.
function shortLLMError(message) {
  const m = /"type"\s*:\s*"([^"]+)"/.exec(message || '');
  if (m) return m[1];
  const s = String(message || 'error').replace(/\s+/g, ' ').trim();
  return s.length > 40 ? s.slice(0, 40) + '…' : s;
}

// ── Fill Learned Radios (Step 11) ──────────────────────────────────
// Reads learned_fields from storage. For each radio group on the page,
// checks if the question text matches a stored key. If you previously
// answered "Yes" to "Are you authorized to work?", it checks that button again.
async function fillLearnedRadios() {
  let corrections = {};
  try {
    const result = await chrome.storage.sync.get('learned_fields');
    corrections = result.learned_fields || {};

    const radios = document.querySelectorAll('input[type="radio"]');
    const groups = new Map();
    radios.forEach(r => {
      if (!r.name) return;
      if (!groups.has(r.name)) groups.set(r.name, []);
      groups.get(r.name).push(r);
    });

    let filled = 0;
    for (const [name, group] of groups) {
      const container = group[0].closest('.input-row, [class*="field"], [class*="question"], label, .apply-flow');
      const questionText = container ? (container.textContent || '').trim().slice(0, 60) : name;
      const key = 'radio_' + questionText;

      const learnedAnswer = corrections[key];
      if (!learnedAnswer) continue;

      const match = group.find(r => {
        const label = (r.labels?.[0]?.textContent || r.value || '').trim();
        return label.toLowerCase().includes(learnedAnswer.toLowerCase());
      });

      if (match && !match.checked) {
        match.checked = true;
        match.dispatchEvent(new Event('change', { bubbles: true }));
        match.dataset.jcFilled = 'true';
        filled++;
      }
    }
    if (filled > 0) console.log('JC: Filled ' + filled + ' radio question(s) from learned answers');
  } catch(e) {
    console.warn('JC: Error filling radios:', e);
  }

  // --- Oracle CX Pill Button handling ---
  try {
    const pillContainers = document.querySelectorAll('ul[role="list"]');
    for (const ul of pillContainers) {
      const question = ul.getAttribute('aria-label') || '';
      if (!question) continue;
      
      // Find matching learned answer
      let answer = null;
      for (const [key, val] of Object.entries(corrections)) {
        if (key.startsWith('radio_') && val && key.toLowerCase().includes(question.toLowerCase().substring(0, 20))) {
          answer = val;
          break;
        }
      }
      if (!answer) continue;
      
      // Find matching pill button
      const buttons = ul.querySelectorAll('button');
      for (const btn of buttons) {
        const btnText = (btn.textContent || '').trim().toLowerCase();
        if (btnText === answer.toLowerCase() || btnText.startsWith(answer.toLowerCase())) {
          // Click using proven PointerEvent sequence
          btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
          btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
          btn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
          btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
          btn.click();
          console.log(`[JC] Pill clicked: ${question} → ${answer}`);
          break;
        }
      }
    }
  } catch (pillErr) {
    console.warn('[JC] Pill button fill error:', pillErr);
  }
}

// ═══════════════════════════════════════════════════════════════
// fillExperience() — fills work experience entries from resume data
// ═══════════════════════════════════════════════════════════════
// Reads resume_full_data from Chrome storage, iterates over each
// experience entry, clicks "Add Experience" for each one, then fills
// the Employer Name, Job Title, Start/End dates, Employer Country,
// Employer City, and Responsibilities fields.
//
// Oracle CX uses Knockout.js comboboxes for dates and country fields,
// so we reuse FormDetector.fillField() which handles those strategies.
//
// Works across ATS platforms: the field detection (employerName, jobTitle,
// etc.) uses the same identify() scoring, and the combobox strategies
// handle Oracle CX, Workday, and generic dropdowns.
const MONTH_MAP = {
  '01': 'January', '02': 'February', '03': 'March', '04': 'April',
  '05': 'May', '06': 'June', '07': 'July', '08': 'August',
  '09': 'September', '10': 'October', '11': 'November', '12': 'December',
  '1': 'January', '2': 'February', '3': 'March', '4': 'April',
  '5': 'May', '6': 'June', '7': 'July', '8': 'August',
  '9': 'September',
};

async function fillExperience() {
  const _t0 = Date.now();
  const experiences = await getResumeSection('experience');
  if (!experiences || experiences.length === 0) {
    console.log('JC: No experience entries in resume');
    return;
  }

  // Helper: fill an Oracle CX text input.
  // Strategy 1: Paste (InputEvent insertFromPaste) — fast, works for most fields.
  // Strategy 2: Char-by-char fallback — slow but reliable for stubborn fields.
  async function fillExpField(el, value, fieldName) {
    const _t = Date.now();
    if (!el) { console.log('JC: fillExpField — element not found for ' + (fieldName || 'unknown')); return false; }
    if (!value) { console.log('JC: fillExpField — empty value for ' + (fieldName || 'unknown')); return false; }
    try {
      el.focus();

      // Strategy 1: Paste — fast
      el.value = '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.value = value;
      el.dispatchEvent(new InputEvent('input', {
        inputType: 'insertFromPaste',
        data: value,
        bubbles: true,
        cancelable: true,
      }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.blur();
      await new Promise(r => setTimeout(r, 200));
      if (el.value === value) {
        console.log('JC: fillExpField [' + fieldName + '] → paste OK +' + (Date.now()-_t) + 'ms');
        return true;
      }

      // Strategy 2: Char-by-char fallback
      console.log('JC: fillExpField [' + fieldName + '] → paste failed, trying char-by-char');
      el.focus();
      el.value = '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      for (let i = 0; i < value.length; i++) {
        el.value = value.substring(0, i + 1);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise(r => setTimeout(r, 15));
      }
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.blur();
      const ok = el.value === value;
      if (ok) {
        console.log('JC: fillExpField [' + fieldName + '] → char-by-char OK');
      } else {
        console.log('JC: fillExpField [' + fieldName + '] → value did not stick');
      }
      return ok;
    } catch(e) {
      console.log('JC: fillExpField [' + fieldName + '] → error: ' + e.message);
      return false;
    }
  }

  // Helper: find the "Add Experience" SUBMIT button (the one at the bottom of the open form)
  function findSubmitBtn() {
    const btns = Array.from(document.querySelectorAll('button'));
    // The submit button is the visible "Add Experience" button inside the form
    return btns.find(b => b.textContent?.trim() === 'Add Experience' && b.offsetHeight > 0 && b.offsetParent !== null);
  }

  // Helper: find the TRIGGER button (the main "Add Experience" button outside the form)
  function findTriggerBtn() {
    const btns = Array.from(document.querySelectorAll('button'));
    return btns.find(b => {
      const txt = (b.textContent || '').trim();
      const id = b.id || '';
      return txt === 'Add Experience' && id.includes('profileItemsAddButton') && b.offsetHeight > 0;
    });
  }

  let filled = 0;
  for (const exp of experiences) {
    // Step 1: Click trigger button to open the form
    let trigger = findTriggerBtn();
    if (!trigger) {
      // If no trigger, the form might already be open — try submit first
      const submit = findSubmitBtn();
      if (submit) { submit.click(); await new Promise(r => setTimeout(r, 1500)); }
      trigger = findTriggerBtn();
    }
    if (!trigger) {
      console.log('JC: No "Add Experience" trigger found — skipping');
      break;
    }
    trigger.click();
    // Brief wait for Oracle to start rendering, then poll via employerName retry loop
    await new Promise(r => setTimeout(r, 300));

    // Step 2: Fill ALL fields using char-by-char (fillExpField).
    // Wait for the form fields to render (Oracle renders async after Add click).
    // Don't skip optional fields — fill everything we have data for.

    // Employer Name (required)
    let empName = null;
    for (let retry = 0; retry < 8; retry++) {
      const all = document.querySelectorAll('input[name="employerName"]');
      if (all.length > 0) { empName = all[all.length - 1]; break; }
      await new Promise(r => setTimeout(r, 250));
    }
    if (empName && exp.company) await fillExpField(empName, exp.company, "employerName");

    // Inject F buttons on newly-rendered experience form fields
    injectPerFieldButtons();

    // Job Title
    const allJobTitles = document.querySelectorAll('input[name="jobTitle"]');
    const jobTitle = allJobTitles.length > 0 ? allJobTitles[allJobTitles.length - 1] : null;
    if (jobTitle && exp.title) await fillExpField(jobTitle, exp.title, "jobTitle");

    // Fill Start Date (Month + Year comboboxes)
    if (exp.start_date) {
      const parts = exp.start_date.split('/');
      const monthNum = parts[0] || '';
      const yearStr = parts[1] || '';
      const monthName = MONTH_MAP[monthNum] || monthNum;

      // Try to fill month combobox — find the LAST one (most recently added entry)
      const allStartMonths = document.querySelectorAll('input[id*="month-startDate"]');
      const startMonth = allStartMonths.length > 0 ? allStartMonths[allStartMonths.length - 1] : null;
      if (startMonth && monthName) {
        const field = { el: startMonth, name: 'startDate', label: 'Start Month' };
        await FormDetector.fillField(field, monthName);
      }

      const allStartYears = document.querySelectorAll('input[id*="year-startDate"]');
      const startYear = allStartYears.length > 0 ? allStartYears[allStartYears.length - 1] : null;
      if (startYear && yearStr) {
        const field = { el: startYear, name: 'startDate', label: 'Start Year' };
        await FormDetector.fillField(field, yearStr);
      }
    }

    // Fill End Date (Month + Year comboboxes)
    if (exp.end_date && exp.end_date.toLowerCase() !== 'present') {
      const parts = exp.end_date.split('/');
      const monthNum = parts[0] || '';
      const yearStr = parts[1] || '';
      const monthName = MONTH_MAP[monthNum] || monthNum;

      const allEndMonths = document.querySelectorAll('input[id*="month-endDate"]');
      const endMonth = allEndMonths.length > 0 ? allEndMonths[allEndMonths.length - 1] : null;
      if (endMonth && monthName) {
        const field = { el: endMonth, name: 'endDate', label: 'End Month' };
        await FormDetector.fillField(field, monthName);
      }

      const allEndYears = document.querySelectorAll('input[id*="year-endDate"]');
      const endYear = allEndYears.length > 0 ? allEndYears[allEndYears.length - 1] : null;
      if (endYear && yearStr) {
        const field = { el: endYear, name: 'endDate', label: 'End Year' };
        await FormDetector.fillField(field, yearStr);
      }
    }

    // [FIX D] Removed the hardcoded city→country map that inferred Employer
    // Country from the employer city (e.g. "gdansk" → "Poland"). Country is
    // never inferred from a city name; this field stays blank unless the
    // resume data states the country explicitly (the experience schema does
    // not carry a country field, so it stays blank).

    // Fill Employer City — find the LAST one
    const allCities = document.querySelectorAll('input[name="employerCity"]');
    const empCity = allCities.length > 0 ? allCities[allCities.length - 1] : null;
    if (empCity && exp.city) await fillExpField(empCity, exp.city, "employerCity");

    // Fill Responsibilities — find the LAST textarea
    const allResp = document.querySelectorAll('textarea[name="responsibilities"]');
    const resp = allResp.length > 0 ? allResp[allResp.length - 1] : null;
    if (resp) {
      let descText = '';
      if (Array.isArray(exp.description)) {
        descText = exp.description.map(d => '\u2022 ' + d).join('\n');
      } else if (typeof exp.description === 'string') {
        descText = exp.description;
      }
      if (descText) await fillExpField(resp, descText, 'responsibilities');
    }

    // Step 3: Click the SUBMIT button to save this entry.
    // The "Add Experience" button at the bottom of the open form is the submit.
    // After clicking, the form closes and the entry is saved as a tile.
    await new Promise(r => setTimeout(r, 300));
    const submitBtn = findSubmitBtn();
    if (submitBtn) {
      submitBtn.click();
      console.log('JC: Submitted experience entry ' + (filled + 1) + ': ' + (exp.company || 'unknown'));
    } else {
      console.log('JC: No submit button found for experience entry ' + (filled + 1));
    }

    // Step 4: Wait for the form to close and the "Add Experience" trigger to reappear.
    // After submission, Oracle CX may take time to close the form panel and
    // re-render the "Add Experience" trigger button (profileItemsAddButton).
    // A fixed delay is unreliable — poll for the trigger with retries instead.
    // This ensures the next loop iteration finds the trigger immediately.
    for (let retry = 0; retry < 12; retry++) {
      await new Promise(r => setTimeout(r, 300));
      if (findTriggerBtn()) break;
    }

    filled++;
    console.log('JC: exp entry ' + filled + ' done in ' + (Date.now()-_t0) + 'ms');
  }

  if (filled > 0) {
    showStatus('Added ' + filled + ' experience(s)', 'success');
    console.log('JC: Filled ' + filled + ' experience entries in ' + (Date.now()-_t0) + 'ms');
  }
}

// ═══════════════════════════════════════════════════════════════
// fillEducation() — fills education entries from resume data
// ═══════════════════════════════════════════════════════════════
// Similar to fillExperience but for education section.
// Oracle CX education fields use comboboxes for Degree, School,
// and Education Level — all handled by FormDetector.fillField().
async function fillEducation() {
  const education = await getResumeSection('education');
  if (!education || education.length === 0) { console.log('JC: No education entries in resume'); return; }
  console.log('JC: fillEducation — ' + education.length + ' entries found');

  const degreeMap = {
    'masters of science': 'Master of Science', 'master of science': 'Master of Science',
    'msc': 'Master of Science', 'bachelors of technology': 'Bachelor of Engineering',
    'bachelor of technology': 'Bachelor of Engineering', 'btech': 'Bachelor of Engineering',
    'bachelor of science': 'Bachelor of Science', 'phd': 'Doctorate', 'doctorate': 'Doctorate',
    'bachelors': 'Bachelors', 'masters': 'Masters',
  };

  let filled = 0;
  for (const edu of education) {
    // Step 1: Open the education form.
    // Scroll to Education heading first, then find and click the Add button.
    // The form may already be open from a previous iteration — check for degree field.
    const eduHeading = Array.from(document.querySelectorAll('h3')).find(h => h.textContent?.trim() === 'Education');
    if (eduHeading) eduHeading.scrollIntoView({ behavior: 'instant', block: 'start' });
    await new Promise(r => setTimeout(r, 500));

    let formReady = false;
    for (let attempt = 0; attempt < 8; attempt++) {
      const degreeEls = document.querySelectorAll('[name="contentItemId"]');
      if (Array.from(degreeEls).some(el => el.offsetHeight > 0)) { formReady = true; break; }

      // Try clicking the Add Education button (any matching button, visible or not)
      const allBtns = Array.from(document.querySelectorAll('button'));
      const addBtn = allBtns.find(b => {
        const txt = (b.textContent || '').trim();
        return txt === 'Add Education' && (b.id || '').includes('profileItemsAddButton');
      }) || allBtns.find(b => (b.textContent || '').trim() === 'Add Education');
      if (addBtn) {
        // [FIX] Use real mouse events — Oracle's Knockout binding ignores
        // synthetic click() on hidden elements. PointerEvent + mousedown
        // + mouseup simulates a real user click.
        const rect = addBtn.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window, button: 0 };
        addBtn.dispatchEvent(new PointerEvent('pointerdown', opts));
        addBtn.dispatchEvent(new MouseEvent('mousedown', opts));
        await new Promise(r => setTimeout(r, 50));
        addBtn.dispatchEvent(new PointerEvent('pointerup', opts));
        addBtn.dispatchEvent(new MouseEvent('mouseup', opts));
        addBtn.dispatchEvent(new MouseEvent('click', opts));
        console.log('JC: Clicked Add Education (attempt ' + attempt + ')');
      }
      await new Promise(r => setTimeout(r, 700));
    }
    if (!formReady) { console.log('JC: Education form did not open — skipping entry ' + (filled + 1)); continue; }

    // Step 2: Fill fields using fillExpField (char-by-char, works with Knockout)
    // Degree
    const allDegrees = document.querySelectorAll('[name="contentItemId"]');
    const degree = allDegrees.length > 0 ? allDegrees[allDegrees.length - 1] : null;
    if (degree && edu.degree) {
      const normalized = degreeMap[edu.degree.toLowerCase()] || edu.degree;
      const field = { el: degree, name: 'degree', label: 'Degree' };
      const ok = await FormDetector.fillField(field, normalized);
      console.log('JC: edu degree → ' + ok + ' "' + (degree.value || '') + '"');
    }

    // School
    const allSchools = document.querySelectorAll('[name="educationalEstablishment"]');
    const school = allSchools.length > 0 ? allSchools[allSchools.length - 1] : null;
    if (school && edu.school) {
      const field = { el: school, name: 'school', label: 'School' };
      const ok = await FormDetector.fillField(field, edu.school);
      console.log('JC: edu school → ' + ok + ' "' + (school.value || '') + '"');
      // [FIX] Bug #7: School not in Oracle dropdown (e.g., "ISAE-SUPAERO").
      // fillOracleCombobox found 0 options, left partial text in field.
      // Fall back to plain text fill: char-by-char + change + blur, no dropdown.
      if (!ok) {
        console.log('JC: edu school → dropdown failed, falling back to plain text fill');
        school.focus();
        school.value = '';
        school.dispatchEvent(new Event('input', { bubbles: true }));
        for (let i = 0; i < edu.school.length; i++) {
          school.value = edu.school.substring(0, i + 1);
          school.dispatchEvent(new Event('input', { bubbles: true }));
          await new Promise(r => setTimeout(r, 20));
        }
        school.dispatchEvent(new Event('change', { bubbles: true }));
        school.blur();
        console.log('JC: edu school → fallback fill complete, value="' + (school.value || '') + '"');
      }
    }

    // Education Level
    const allLevels = document.querySelectorAll('[name="educationLevel"]');
    const level = allLevels.length > 0 ? allLevels[allLevels.length - 1] : null;
    if (level && edu.degree) {
      const dl = edu.degree.toLowerCase();
      let eduLevel = "Bachelor's Degree";
      if (dl.includes('master') || dl.includes('msc') || dl.includes('m.s')) eduLevel = "Master's Degree";
      else if (dl.includes('phd') || dl.includes('doctor')) eduLevel = "Doctorate Degree";
      const field = { el: level, name: 'level', label: 'Level' };
      const ok = await FormDetector.fillField(field, eduLevel);
      console.log('JC: edu level → ' + ok + ' "' + (level.value || '') + '"');
    }

    // Fill Start Date (Month + Year comboboxes)
    if (edu.start_date) {
      const parts = edu.start_date.split('/');
      const monthNum = parts[0] || '';
      const yearStr = parts[1] || '';
      const monthName = MONTH_MAP[monthNum] || monthNum;

      const allStartMonths = document.querySelectorAll('input[id*="month-startDate"]');
      const startMonth = allStartMonths.length > 0 ? allStartMonths[allStartMonths.length - 1] : null;
      if (startMonth && monthName) {
        const field = { el: startMonth, name: 'startDate', label: 'Start Month' };
        await FormDetector.fillField(field, monthName);
      }

      const allStartYears = document.querySelectorAll('input[id*="year-startDate"]');
      const startYear = allStartYears.length > 0 ? allStartYears[allStartYears.length - 1] : null;
      if (startYear && yearStr) {
        const field = { el: startYear, name: 'startDate', label: 'Start Year' };
        await FormDetector.fillField(field, yearStr);
      }
    }

    // Fill End Date (Month + Year comboboxes)
    if (edu.end_date && edu.end_date.toLowerCase() !== 'present') {
      const parts = edu.end_date.split('/');
      const monthNum = parts[0] || '';
      const yearStr = parts[1] || '';
      const monthName = MONTH_MAP[monthNum] || monthNum;

      const allEndMonths = document.querySelectorAll('input[id*="month-endDate"]');
      const endMonth = allEndMonths.length > 0 ? allEndMonths[allEndMonths.length - 1] : null;
      if (endMonth && monthName) {
        const field = { el: endMonth, name: 'endDate', label: 'End Month' };
        await FormDetector.fillField(field, monthName);
      }

      const allEndYears = document.querySelectorAll('input[id*="year-endDate"]');
      const endYear = allEndYears.length > 0 ? allEndYears[allEndYears.length - 1] : null;
      if (endYear && yearStr) {
        const field = { el: endYear, name: 'endDate', label: 'End Year' };
        await FormDetector.fillField(field, yearStr);
      }
    }

    // Step 3: Submit the entry
    await new Promise(r => setTimeout(r, 500));
    const eduSubmit = Array.from(document.querySelectorAll('button')).find(b =>
      (b.textContent || '').trim() === 'Add Education' && b.offsetHeight > 0
    );
    if (eduSubmit) {
      eduSubmit.click();
      console.log('JC: Submitted education entry ' + (filled + 1) + ': ' + (edu.school || 'unknown'));
      await new Promise(r => setTimeout(r, 2000));
    } else {
      console.log('JC: No submit button for education entry ' + (filled + 1));
    }

    filled++;
  }

  if (filled > 0) {
    showStatus('Added ' + filled + ' education(s)', 'success');
    console.log('JC: Filled ' + filled + ' education entries');
  }
}

// ═══════════════════════════════════════════════════════════════
// fillSkills() — types each skill as plain text and clicks "Add Skill"
// ═══════════════════════════════════════════════════════════════
// Oracle CX skills flow is simple: click "Add More Skills", type the
// skill name into the combobox, click "Add Skill". No typeahead, no
// dropdown matching. This function iterates over all skills and
// performs that flow for each one.
async function fillSkills() {
  const section = await getResumeSection('skills');
  if (!section || section.length === 0) {
    console.log('JC: fillSkills — no skills data');
    return;
  }

  const SKILLS_LIMIT = 15;
  const skillsList = section.slice(0, SKILLS_LIMIT);

  let added = 0;

  for (let i = 0; i < skillsList.length; i++) {
    const skillRaw = (skillsList[i] || '').toString().trim();
    if (!skillRaw) continue;

    // Click "Add More Skills" only if form is not already open
    const addMoreBtn = Array.from(document.querySelectorAll('button')).find(b =>
      (b.textContent || '').trim() === 'Add More Skills' &&
      b.offsetHeight > 0 && b.offsetParent !== null
    );
    if (addMoreBtn) {
      const rect = addMoreBtn.getBoundingClientRect();
      addMoreBtn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: rect.left + rect.width/2, clientY: rect.top + rect.height/2 }));
      addMoreBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      addMoreBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
      addMoreBtn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true }));
      addMoreBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 600));
    }

    // Find the last skill combobox
    const allSkillCombos = document.querySelectorAll('[name="skills"][role="combobox"]');
    const skillCombo = allSkillCombos.length > 0 ? allSkillCombos[allSkillCombos.length - 1] : null;
    if (!skillCombo) {
      console.log('JC: fillSkills — no skill combobox found, stopping');
      break;
    }

    // Use FormDetector's fillOracleCombobox to properly select from dropdown
    const field = { el: skillCombo, name: 'skills', label: skillRaw };
    const filled = await FormDetector.fillField(field, skillRaw);
    if (!filled) {
      console.log('JC: fillSkills — fillField failed for "' + skillRaw + '", trying direct paste fallback');
      // Fallback: direct paste
      skillCombo.focus();
      skillCombo.value = skillRaw;
      skillCombo.dispatchEvent(new InputEvent('input', { inputType: 'insertFromPaste', data: skillRaw, bubbles: true, cancelable: true }));
      skillCombo.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(r => setTimeout(r, 300));
    }

    // Click "Add Skill" button
    const submitBtn = Array.from(document.querySelectorAll('button')).find(b =>
      (b.textContent || '').trim() === 'Add Skill' &&
      b.offsetHeight > 0 && b.offsetParent !== null &&
      !(b.id || '').includes('profileItemsAddButton')
    );
    if (submitBtn) {
      const rect = submitBtn.getBoundingClientRect();
      submitBtn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: rect.left + rect.width/2, clientY: rect.top + rect.height/2 }));
      submitBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 50));
      submitBtn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true }));
      submitBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
      submitBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 800));
      added++;
      console.log('JC: fillSkills — added "' + skillRaw + '" (' + added + '/' + skillsList.length + ')');
    } else {
      console.log('JC: fillSkills — no Add Skill button found for "' + skillRaw + '"');
      break;
    }
  }

  if (added > 0) {
    showStatus('Added ' + added + ' skill(s)', 'success');
    console.log('JC: fillSkills — added ' + added + ' skill(s)');
  }
}

// ═══════════════════════════════════════════════════════════════
// fillApplicationQuestions() — answers Yes/No radio questions
// ═══════════════════════════════════════════════════════════════
// Oracle CX application forms typically have Yes/No radio button
// questions about employment history, government relations, etc.
// Safe default: "No" for all questions. Users can correct via the
// learning system (listenForCorrections picks up manual changes).
//
// The LLM could answer these more accurately, but without it we
// default to the safest answer. This works across all ATS platforms
// that use radio button questions.
async function fillApplicationQuestions() {
  let filled = 0;

  // Strategy 1: Traditional radio buttons
  const radios = document.querySelectorAll('input[type="radio"]');
  const groups = new Map();
  radios.forEach(r => {
    if (!r.name || r.offsetHeight === 0) return;
    if (!groups.has(r.name)) groups.set(r.name, []);
    groups.get(r.name).push(r);
  });

  for (const [name, group] of groups) {
    if (group.some(r => r.checked)) continue;
    const noBtn = group.find(r => {
      const label = (r.labels?.[0]?.textContent || r.value || '').toLowerCase().trim();
      return label === 'no';
    });
    if (noBtn) {
      noBtn.checked = true;
      noBtn.dispatchEvent(new Event('change', { bubbles: true }));
      noBtn.dataset.jcFilled = 'true';
      filled++;
    }
  }

  // Strategy 2: Oracle CX uses <button> Yes/No pairs, not radio inputs.
  // Find the Application Questions section, then click every visible "No" button.
  // These buttons are grouped in pairs — each question has a Yes and No button.
  // We click "No" as the safe default for all employment/government questions.
  const headings = Array.from(document.querySelectorAll('h3'));
  const aqHeading = headings.find(h => h.textContent?.trim() === 'Application Questions');
  if (aqHeading) {
    let container = aqHeading.parentElement;
    // Walk up to find the full section container
    for (let i = 0; i < 5 && container; i++) {
      if (container.querySelectorAll('button').length > 10) break;
      container = container.parentElement;
    }
    if (container) {
      // Find pairs of Yes/No buttons. Each question has exactly one Yes and one No.
      // We click "No" for each pair that doesn't already have a selection.
      const allBtns = Array.from(container.querySelectorAll('button'));
      for (const btn of allBtns) {
        const text = (btn.textContent || '').trim().toLowerCase();
        if (text === 'no' && btn.offsetHeight > 0) {
          // Check if the sibling Yes button is not in a "selected" state
          const parent = btn.parentElement;
          const yesBtn = parent ? Array.from(parent.querySelectorAll('button')).find(b =>
            (b.textContent || '').trim().toLowerCase() === 'yes'
          ) : null;
          // If Yes is not visually selected (no special class), click No
          if (yesBtn && !yesBtn.classList.contains('selected') && !yesBtn.classList.contains('active') &&
              !yesBtn.getAttribute('aria-pressed')?.includes('true')) {
            btn.click();
            filled++;
          } else if (!yesBtn) {
            // No sibling Yes found — just click No
            btn.click();
            filled++;
          }
        }
      }
    }
  }

  if (filled > 0) {
    console.log('JC: Answered ' + filled + ' application question(s)');
  }
}


// ═══════════════════════════════════════════════════════════════
// fillLanguages() — fills language entries from resume data
// ═══════════════════════════════════════════════════════════════
async function fillLanguages() {
  const languages = await getResumeSection('languages');
  if (!languages || languages.length === 0) { console.log('JC: No languages in resume'); return; }
  console.log('JC: fillLanguages — ' + languages.length + ' entries found');

  function mapLevel(level) {
    if (!level) return 'Professional Working Proficiency';
    const l = level.toLowerCase().trim();
    if (l.includes('native') || l === 'c2') return 'Native or Bilingual Proficiency';
    if (l.includes('fluent') || l.includes('full professional') || l === 'c1') return 'Full Professional Proficiency';
    if (l.includes('b2') || l.includes('professional working')) return 'Professional Working Proficiency';
    if (l.includes('b1') || l.includes('limited working')) return 'Limited Working Proficiency';
    if (l.includes('a2') || l.includes('elementary')) return 'Elementary Proficiency';
    if (l.includes('a1') || l.includes('no proficiency')) return 'No Proficiency';
    return 'Professional Working Proficiency';
  }

  let filled = 0;
  for (const lang of languages) {
    const langName = typeof lang === 'string' ? lang : lang.name;
    const langLevel = typeof lang === 'object' ? lang.level : '';
    if (!langName) continue;

    const addBtn = Array.from(document.querySelectorAll('button')).find(b =>
      (b.textContent || '').trim() === 'Add Language' && (b.id || '').includes('profileItemsAddButton')
    );
    if (!addBtn) { console.log('JC: No "Add Language" trigger found'); break; }
    const rect = addBtn.getBoundingClientRect();
    const opts = { bubbles: true, cancelable: true, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, view: window, button: 0 };
    addBtn.dispatchEvent(new PointerEvent('pointerdown', opts));
    addBtn.dispatchEvent(new MouseEvent('mousedown', opts));
    await new Promise(r => setTimeout(r, 50));
    addBtn.dispatchEvent(new PointerEvent('pointerup', opts));
    addBtn.dispatchEvent(new MouseEvent('mouseup', opts));
    addBtn.dispatchEvent(new MouseEvent('click', opts));
    await new Promise(r => setTimeout(r, 1500));

    const allLangCombos = document.querySelectorAll('[name="contentItemId"][role="combobox"]');
    const langCombo = allLangCombos.length > 0 ? allLangCombos[allLangCombos.length - 1] : null;
    if (langCombo) {
      const field = { el: langCombo, name: 'language', label: 'Language' };
      await FormDetector.fillField(field, langName);
    }

    const pillText = mapLevel(langLevel);
    const pills = document.querySelectorAll('.cx-select-pill-section button, button.cx-select-pill');
    for (const pill of pills) {
      if (pill.offsetHeight === 0) continue;
      if ((pill.textContent || '').trim() === pillText) {
        // [FIX] Real mouse events for Oracle React pill buttons
        const rp = pill.getBoundingClientRect();
        const op = { bubbles: true, cancelable: true, clientX: rp.left + rp.width/2, clientY: rp.top + rp.height/2, view: window, button: 0 };
        pill.dispatchEvent(new PointerEvent('pointerdown', op));
        pill.dispatchEvent(new MouseEvent('mousedown', op));
        await new Promise(r => setTimeout(r, 50));
        pill.dispatchEvent(new PointerEvent('pointerup', op));
        pill.dispatchEvent(new MouseEvent('mouseup', op));
        pill.dispatchEvent(new MouseEvent('click', op));
        break;
      }
    }

    await new Promise(r => setTimeout(r, 500));
    const submitBtn = Array.from(document.querySelectorAll('button')).find(b =>
      (b.textContent || '').trim() === 'Add Language' && b.offsetHeight > 0 && b.offsetParent !== null && !(b.id || '').includes('profileItemsAddButton')
    );
    if (submitBtn) {
      // [FIX] Real mouse events for Oracle React submit button
      const rs = submitBtn.getBoundingClientRect();
      const os = { bubbles: true, cancelable: true, clientX: rs.left + rs.width/2, clientY: rs.top + rs.height/2, view: window, button: 0 };
      submitBtn.dispatchEvent(new PointerEvent('pointerdown', os));
      submitBtn.dispatchEvent(new MouseEvent('mousedown', os));
      await new Promise(r => setTimeout(r, 50));
      submitBtn.dispatchEvent(new PointerEvent('pointerup', os));
      submitBtn.dispatchEvent(new MouseEvent('mouseup', os));
      submitBtn.dispatchEvent(new MouseEvent('click', os));
      await new Promise(r => setTimeout(r, 1000));
    }
    filled++;
  }
  if (filled > 0) { showStatus('Added ' + filled + ' language(s)', 'success'); }
}

// ═══════════════════════════════════════════════════════════════
// fillLicenses() — adds license/certification entries
// ═══════════════════════════════════════════════════════════════
// Oracle CX licenses flow: click "Add License", type license name
// into combobox, optionally fill issuer/date, click submit.
// Checks both 'licenses' and 'certifications' sections from resume.
async function fillLicenses() {
  const resumeData = await chrome.storage.sync.get('resume_full_data');
  if (!resumeData.resume_full_data) return;
  let parsed;
  try { parsed = JSON.parse(resumeData.resume_full_data); } catch { return; }

  const licenses = parsed.rawSections?.licenses || parsed.rawSections?.certifications || [];
  if (!licenses || licenses.length === 0) { console.log('JC: No licenses/certifications in resume'); return; }
  console.log('JC: fillLicenses — ' + licenses.length + ' entries found');

  let filled = 0;
  for (const lic of licenses) {
    const licName = typeof lic === 'string' ? lic : (lic.name || lic.title || '');
    if (!licName) continue;

    // 1. Click "Add License" to open the entry form
    const addBtn = Array.from(document.querySelectorAll('button')).find(b =>
      (b.textContent || '').trim() === 'Add License' && (b.id || '').includes('profileItemsAddButton')
    );
    if (!addBtn) { console.log('JC: No "Add License" trigger found'); break; }
    const rect = addBtn.getBoundingClientRect();
    const opts = { bubbles: true, cancelable: true, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, view: window, button: 0 };
    addBtn.dispatchEvent(new PointerEvent('pointerdown', opts));
    addBtn.dispatchEvent(new MouseEvent('mousedown', opts));
    await new Promise(r => setTimeout(r, 50));
    addBtn.dispatchEvent(new PointerEvent('pointerup', opts));
    addBtn.dispatchEvent(new MouseEvent('mouseup', opts));
    addBtn.dispatchEvent(new MouseEvent('click', opts));
    await new Promise(r => setTimeout(r, 1500));

    // 2. Find the license name combobox (last visible one)
    const allCombos = document.querySelectorAll('[role="combobox"]');
    const licCombo = allCombos.length > 0 ? allCombos[allCombos.length - 1] : null;
    if (licCombo) {
      const field = { el: licCombo, name: 'license', label: 'License' };
      await FormDetector.fillField(field, licName);
    }

    // 3. Optionally fill issuing organization if data has it
    const issuer = typeof lic === 'object' ? (lic.issuer || lic.organization || '') : '';
    if (issuer) {
      const issuerField = Array.from(document.querySelectorAll('input, [role="combobox"]')).find(el => {
        const label = (el.closest('[class*=field]') || el.parentElement)?.querySelector('label');
        return label && /issuer|organization|authority/i.test(label.textContent);
      });
      if (issuerField) {
        const field = { el: issuerField, name: 'issuer', label: 'Issuer' };
        await FormDetector.fillField(field, issuer);
      }
    }

    await new Promise(r => setTimeout(r, 500));

    // 4. Click submit button
    const submitBtn = Array.from(document.querySelectorAll('button')).find(b =>
      (b.textContent || '').trim() === 'Add License' && b.offsetHeight > 0 && b.offsetParent !== null && !(b.id || '').includes('profileItemsAddButton')
    );
    if (submitBtn) {
      const rs = submitBtn.getBoundingClientRect();
      const os = { bubbles: true, cancelable: true, clientX: rs.left + rs.width / 2, clientY: rs.top + rs.height / 2, view: window, button: 0 };
      submitBtn.dispatchEvent(new PointerEvent('pointerdown', os));
      submitBtn.dispatchEvent(new MouseEvent('mousedown', os));
      await new Promise(r => setTimeout(r, 50));
      submitBtn.dispatchEvent(new PointerEvent('pointerup', os));
      submitBtn.dispatchEvent(new MouseEvent('mouseup', os));
      submitBtn.dispatchEvent(new MouseEvent('click', os));
      await new Promise(r => setTimeout(r, 1000));
    }
    filled++;
  }

  if (filled > 0) { showStatus('Added ' + filled + ' license(s)/certification(s)', 'success'); }
}

// ── Shared Helpers ─────────────────────────────────────────────────

// [FIX K2] Country names used to disambiguate a two-part address
// ("Gdansk, Poland" is City, Country — not Street, City). Kept as an explicit
// list so no city→country inference happens anywhere else ([FIX D] above).
const JC_COUNTRY_NAMES = new Set([
  'poland', 'germany', 'france', 'spain', 'italy', 'netherlands', 'belgium',
  'portugal', 'austria', 'switzerland', 'sweden', 'norway', 'denmark',
  'finland', 'ireland', 'united kingdom', 'uk', 'great britain',
  'czech republic', 'czechia', 'slovakia', 'slovenia', 'hungary', 'romania',
  'bulgaria', 'croatia', 'estonia', 'latvia', 'lithuania', 'ukraine', 'greece',
  'turkey', 'united states', 'usa', 'canada', 'mexico', 'brazil', 'argentina',
  'chile', 'india', 'china', 'japan', 'south korea', 'korea', 'singapore',
  'australia', 'new zealand', 'south africa', 'israel', 'uae',
  'united arab emirates',
]);
function isCountryName(s) {
  return JC_COUNTRY_NAMES.has(String(s || '').trim().toLowerCase());
}

// Step 4: build a value dictionary from your stored profile data.
// Reads raw values from Chrome storage (set when you extracted your resume),
// splits composite values (full name → first+last, address → street+city+country),
// then merges learned corrections from previous sessions.
// Returns {first_name, last_name, email, phone, country, ...} — keys that
// match what FormDetector.identify() returns as field.name.
async function buildFillMap() {
  const profile = await chrome.storage.sync.get([
    'profile_name', 'profile_email', 'profile_phone', 'profile_linkedin',
    'profile_github', 'profile_website', 'profile_address',
    'profile_work_authorization', 'resume_full_data',
  ]);

  const nameStr = (profile.profile_name || '').trim();
  const nameParts = nameStr ? nameStr.split(/\s+/) : [];
  const firstName = nameParts[0] || '';
  const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : '';
  const middleName = nameParts.length > 2 ? nameParts.slice(1, -1).join(' ') : '';

  const address = (profile.profile_address || '').trim();
  const addrParts = address ? address.split(',').map(s => s.trim()).filter(Boolean) : [];
  // Extract postal code (digits with optional hyphen) from any position
  const postalCodePattern = /^\d{2,6}[-\s]?\d{1,6}$/;  // Matches "80-394", "12345", "SW1A 1AA" variants

  // Detect apartment/unit numbers (short alphanumeric like "7A", "Suite 200", "Apt 3")
  const aptPattern = /^\d{1,4}[A-Za-z]$|^(?:apt|unit|suite|floor|fl|bldg)\s*\d+$/i;
  const isApartment = (s) => aptPattern.test(s.trim());

  // Pre-process: extract apartment number from position [1] if present
  let apartmentNumber = '';
  if (addrParts.length >= 3 && isApartment(addrParts[1])) {
    apartmentNumber = addrParts[1];
    addrParts.splice(1, 1);  // Remove apartment from array
  }

  // Recompute indices after potential splice
  const postalIdx = addrParts.findIndex(p => postalCodePattern.test(p));
  const isPostalCode = postalIdx >= 0;
  const hasProfileAddress = addrParts.length > 0;

  let parseAddr = '';
  let parseAddr2 = '';
  let parseCity = '';
  let parsePostal = '';

  if (addrParts.length === 0) {
    // Empty address
  } else if (addrParts.length === 1) {
    parseAddr = addrParts[0]; // Single value → street
  } else if (addrParts.length === 2) {
    // "Street, City" or "City, Country" — [FIX K2] live case: profile_address
    // "Gdansk, Poland" used to parse as city="Poland", street="Gdansk", so
    // Lever's location widget was handed "Poland" and rejected the fill.
    if (isCountryName(addrParts[1])) {
      parseCity = addrParts[0];
    } else {
      parseAddr = addrParts[0];
      parseCity = addrParts[1];
    }
  } else if (isPostalCode && postalIdx === addrParts.length - 2) {
    // "Street, City, PostalCode" pattern
    parseAddr = addrParts[0];
    parseCity = addrParts[1];
    parsePostal = addrParts[postalIdx];
  } else if (postalIdx >= 0) {
    // "Street, City, PostalCode, [Country]" — postal code present at any
    // position other than the second-to-last slot handled above.
    parseAddr = addrParts[0];
    parseCity = addrParts.length >= 3 ? addrParts[1] : addrParts[0];
    parsePostal = addrParts[postalIdx];
  } else {
    // Fallback: first part is street, second is city. [FIX K2] When the LAST
    // part is a country name ("City, Region, Country"), the city is the first
    // part — never the region/country.
    if (isCountryName(addrParts[addrParts.length - 1])) {
      parseCity = addrParts[0];
    } else {
      parseAddr = addrParts[0];
      parseCity = addrParts.length >= 3 ? addrParts[1] : addrParts[0];
    }
    parsePostal = postalIdx >= 0 ? addrParts[postalIdx] : '';
  }
  // Cache: parse resume_full_data once for extractedFields fallbacks
  let extracted = {};
  try { extracted = JSON.parse(profile.resume_full_data || '{}').extractedFields || {}; } catch {}

  // [FIX D] State/country are used ONLY when profile_address explicitly
  // contains them: a component that matches the resume-extracted value, or
  // (country only) an explicit two-letter code. No city→country inference —
  // "Gdansk" never implies "Poland".
  let parseState = '';
  let parseCountry = '';
  if (hasProfileAddress) {
    for (const part of addrParts) {
      if (!parseState && extracted.state && part.toLowerCase() === String(extracted.state).toLowerCase()) parseState = part;
      if (!parseCountry && extracted.country && part.toLowerCase() === String(extracted.country).toLowerCase()) parseCountry = part;
      if (!parseCountry && /^[A-Z]{2}$/.test(part)) parseCountry = part;
    }
  }

  return {
    name: nameStr,
    first_name: firstName,
    last_name: lastName,
    middle_name: middleName,
    full_name: nameStr,
    email: profile.profile_email,
    // [FIX] Smart phone handling: store BOTH full number and split parts.
    // The fill logic (fillPersonal) decides which to use based on whether
    // the form has a separate phone_country_code field.
    // - Portal with separate country code combobox (Oracle CX): use split
    // - Portal with single phone field (Workday, Greenhouse): use full number
    // This works across all ATS platforms without hardcoding per-vendor logic.
    phone_country_code: (function() {
      const raw = (profile.profile_phone || '').trim();
      const m = raw.match(/^\+(\d{1,3})/);
      return m ? ('+' + m[1]) : '';
    })(),
    phone: (profile.profile_phone || '').trim(),
    linkedin: profile.profile_linkedin,
    github: profile.profile_github,
    // [FIX A] Website/portfolio/urls[Portfolio]/urls[Other] are filled ONLY
    // from a real profile_website value. Empty profile_website → blank field.
    // No cross-field URL fallbacks (the old LinkedIn fallback misfilled P1/P2).
    website: (profile.profile_website || '').trim(),
    address: addrParts.length >= 3 ? '' : address,
    // [FIX D] When a stored address exists it is the ONLY source for address
    // components (profile = source of truth). street/city/postal fall back to
    // resume-extracted values only when there is no stored address at all.
    // state/country never fall back — P2 showed extracted.country ("Poland")
    // leaking into a form although the stored address had no country.
    street_address: hasProfileAddress ? (parseAddr || '') : (extracted.street_address || ''),
    street_address_2: hasProfileAddress ? (apartmentNumber || parseAddr2 || '') : (apartmentNumber || extracted.street_address_2 || ''),
    apt_number: '',
    city: hasProfileAddress ? (parseCity || '') : (extracted.city || ''),
    state: parseState,
    postal_code: hasProfileAddress ? (parsePostal || '') : (extracted.postal_code || ''),
    country: parseCountry,
    work_authorization: profile.profile_work_authorization,
  };
}

// Guard: skip filling a field if the value doesn't match the field type.
// For example, don't put a phone number into a URL field, don't put a full
// address into a city field. Returns true to skip, false to proceed.
function skipFieldForTypeCore(field, value) {
  // [FIX] Allow URL fields to accept values without http prefix.
  // The linkedin/github URLs from profile may or may not have https://.
  // Also allow phone_country_code values (like "+33") through — they're
  // short and look numeric but are valid for combobox fields.
  if (field.name === 'phone_country_code') return false;
  if (field.el.type === 'url' && !value.startsWith('http')) {
    // Auto-prefix if it looks like a URL path (linkedin.com, github.com, etc.)
    if (/^[a-z]+\.com/i.test(value) || /^[a-z]+\.io/i.test(value)) {
      field.el.value = 'https://' + value; // prefix it inline — will be overwritten by fill
    }
    // Don't skip — let fillField() handle it
  }
  if (field.el.type === 'url' && /[\d\s\-+()]{6,}/.test(value)) return true;
  // [FIX] Removed overly aggressive street_address check — many valid addresses
  // don't contain digits (e.g., "Grabiszyńska", "Main Street", "Oak Avenue").
  if (field.name === 'address' && value.includes(',')) return true;
  if (field.name === 'postal_code' && (value.length < 3 || /^[a-zA-Z\s]{3,}$/.test(value))) return true;
  if (field.name === 'state' && value.length > 20) return true;
  return false;
}

// [FIX F] Counting wrapper: the core predicate stays pure; the wrapper only
// records type-mismatch skips for the fill summary.
function skipFieldForType(field, value) {
  const skip = skipFieldForTypeCore(field, value);
  if (skip) fillStats.skipped++;
  return skip;
}

// ── Learning System ────────────────────────────────��──────────────
// The extension learns from you in two ways:
//
// PATH 1 (this function): JC fills a field, you edit it afterward.
// After Fill All or a per-field fill, this function attaches a one-time
// blur listener to each filled element. "Blur" means leaving the field —
// clicking into it, changing the value, then clicking somewhere else.
// The listener compares the new value against what JC set (stored in
// el.dataset.jcValue). If different, it calls saveLearnedCorrection()
// which writes to learned_fields in Chrome storage.
//
// PATH 2 (MutationObserver, bottom of file): You fill a field that JC
// didn't touch. The observer watches for changes to form elements and
// saves user-initiated edits to learned_fields.
//
// Both paths write to the same place: learned_fields in Chrome storage,
// which is a flat key-value object. Next session, buildFillMap() (Step 4)
// reads your profile fields first, then reads learned_fields and merges
// them on top. Corrections always win over defaults.
function listenForCorrections(filledEls) {
  const seen = new WeakSet();
  for (const el of filledEls) {
    if (seen.has(el)) continue;
    seen.add(el);
    if (!el || !el.dataset) continue;

    const fieldName = el.name || el.id || 'custom';
    const filledValue = el.value;
    el.dataset.jcFilled = 'true';
    el.dataset.jcValue = filledValue;

    el.addEventListener('blur', function onBlur() {
      const newValue = el.value.trim();
      const oldValue = el.dataset.jcValue;
      if (newValue && oldValue && newValue !== oldValue) {
        saveLearnedCorrection(fieldName || 'custom', newValue);
        console.log('JC: Learned correction for "' + fieldName + '": "' + newValue + '"');
        el.dataset.jcValue = newValue; // update so next blur compares against new value
      }
      // Don't remove listener — keep saving on every blur so corrections work
    });
  }
}

// Writes one correction to learned_fields in Chrome storage.
// Saves under both the portal-specific key AND the generic category,
// so the same learning works across Oracle CX, Workday, Greenhouse, etc.
async function saveLearnedCorrection(fieldName, value) {
  // [FIX B1] The profile owns these keys — never persist learned values for
  // them. Learning only covers unknown/custom fields. Checked on the raw
  // field name AND its generic category (e.g. "emailAddress" → "email").
  if (!fieldName || !value) return;
  // [FIX L1] Backstop at the single write choke point: inert synthetic keys
  // are never persisted, whoever calls this.
  if (INERT_LEARNED_KEYS.indexOf(String(fieldName).trim()) !== -1) {
    console.log('JC: Refused to learn "' + fieldName + '" — inert synthetic key');
    return;
  }
  if (isProfileOwnedKey(fieldName)) {
    console.log('JC: Refused to learn "' + fieldName + '" — profile owns this field');
    return;
  }
  try {
    const result = await chrome.storage.sync.get('learned_fields');
    const fields = result.learned_fields || {};
    fields[fieldName] = value;
    // Also save under the generic category (e.g., "addressLine1" → "street_address")
    const category = getFieldCategory(fieldName);
    if (category !== fieldName) {
      fields[category] = value;
    }
    await chrome.storage.sync.set({ learned_fields: fields });
  } catch(e) {
    console.log('JC: Failed to save learned correction:', e.message);
  }
}

// [FIX B] One-time migration: remove learned_fields entries that the profile
// owns and any entry whose value is just the LinkedIn URL (the old
// website→LinkedIn misfill). Guarded by a storage flag so it runs once.
async function migrateLearnedFieldsOnce() {
  try {
    const flags = await chrome.storage.sync.get(['jc_learned_migration_v1', 'profile_linkedin']);
    if (flags.jc_learned_migration_v1) return;
    const res = await chrome.storage.sync.get('learned_fields');
    const learned = res.learned_fields || {};
    const linkedin = String(flags.profile_linkedin || '').trim();
    const removed = [];
    const kept = {};
    for (const [key, val] of Object.entries(learned)) {
      const owned = isProfileOwnedKey(key);
      const copiesLinkedin = !!linkedin && typeof val === 'string' && val.trim() === linkedin;
      if (owned || copiesLinkedin) removed.push(key); else kept[key] = val;
    }
    if (removed.length) await chrome.storage.sync.set({ learned_fields: kept });
    await chrome.storage.sync.set({ jc_learned_migration_v1: true });
    console.log('JC: learned_fields migration v1 — removed ' + removed.length + ' key(s)' +
      (removed.length ? ': ' + removed.join(', ') : ''));
  } catch (e) {
    console.log('JC: learned_fields migration failed:', e.message);
  }
}

// [FIX L1] One-time cleanup of the learned_fields entries polluted before the
// inert-key guard existed. ONLY the inert synthetic keys are dropped (exact
// set: INERT_LEARNED_KEYS = ['unknown','custom']); every key a fill could
// actually read (resolveFieldValue / mergeLearnedCorrections) is preserved.
// Guarded by a storage flag so it runs once.
async function migrateInertLearnedKeysOnce() {
  try {
    const flags = await chrome.storage.sync.get('jc_learned_migration_v2');
    if (flags.jc_learned_migration_v2) return;
    const res = await chrome.storage.sync.get('learned_fields');
    const learned = res.learned_fields || {};
    const removed = [];
    const kept = {};
    for (const [key, val] of Object.entries(learned)) {
      if (INERT_LEARNED_KEYS.indexOf(String(key).trim()) !== -1) removed.push(key);
      else kept[key] = val;
    }
    if (removed.length) await chrome.storage.sync.set({ learned_fields: kept });
    await chrome.storage.sync.set({ jc_learned_migration_v2: true });
    console.log('JC: learned_fields migration v2 (inert keys) — removed ' + removed.length + ' key(s)' +
      (removed.length ? ': ' + removed.join(', ') : ''));
  } catch (e) {
    console.log('JC: learned_fields migration v2 failed:', e.message);
  }
}

// ── Clear Form ─────────────────────────────────────────────────────

// TRIGGER: user clicks "Clear All" (see createPanel above).
// This function does NOT touch Chrome storage — it only clears the form on
// the page. Your profile, resume data, learned corrections, and saved answers
// all stay intact. If you click Fill All again after clearing, the same data
// gets filled back in.
//
// Oracle's form has seven different kinds of clearable elements, each
// requiring a different approach. This function handles all seven in sequence.
function clearForm() {
  // Use a custom in-page confirm instead of native confirm().
  // Native confirm() gets auto-dismissed by CDP connections (Playwright).
  const confirmed = window.__jcClearConfirmed || false;
  if (!confirmed) {
    // Show a custom confirmation in the JC panel status
    showStatus('Click Clear All again to confirm.', 'info');
    window.__jcClearConfirmed = true;
    // Reset after 5 seconds if not confirmed
    setTimeout(() => { window.__jcClearConfirmed = false; }, 5000);
    return;
  }
  window.__jcClearConfirmed = false;

  let cleared = 0;

  // 1. Oracle combobox "Remove value" buttons — the small X icons on
  //    combobox fields like country, phone code. Found by the title attribute.
  const removeBtns = document.querySelectorAll('button[title*="Remove value"]');
  for (const btn of removeBtns) {
    if (btn.offsetHeight > 0 || btn.offsetParent !== null) {
      try { btn.click(); cleared++; } catch(e) {}
    }
  }

  // 2. Profile tile delete buttons — the experience and education cards
  //    that Oracle imports from your profile. Each card has a Delete button.
  const deleteBtns = document.querySelectorAll('button[title="Delete"], button[aria-label="Delete"]');
  for (const btn of deleteBtns) {
    try { btn.click(); cleared++; } catch(e) {}
  }

  // 3. All text inputs, textareas, selects, radios, and checkboxes.
  //    For radios/checkboxes: uncheck. For selects: reset to first option.
  //    For text inputs: set value to empty using the native prototype setter
  //    (to bypass any framework interceptors), dispatch input/change events,
  //    and blur the field. Also removes the jcFilled and jcValue data
  //    attributes that the learning system uses to track what JC filled.
  const inputs = document.querySelectorAll('input:not([type="hidden"]):not([type="file"]), textarea, select, [role="combobox"]');
  for (const el of inputs) {
    if (el.hasAttribute('readonly')) el.removeAttribute('readonly');
    el.classList.remove('input-row__control--locked');

    if (el.type === 'radio' || el.type === 'checkbox') {
      if (el.checked) {
        el.checked = false;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        cleared++;
      }
    } else if (el.tagName === 'SELECT') {
      el.selectedIndex = 0;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      cleared++;
    } else if (el.value) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      if (setter) setter.call(el, '');
      el.value = '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.blur();
      cleared++;
    }

    delete el.dataset.jcFilled;
    delete el.dataset.jcValue;
  }

  // 4. Oracle's custom pill-shaped buttons — used for skills, languages,
  //    title selection (Mr./Ms.). Each pill is a clickable button.
  const pills = document.querySelectorAll('.cx-select-pill-section');
  for (const pill of pills) {
    if (pill.offsetHeight > 0 && pill.offsetParent !== null) {
      try { pill.click(); cleared++; } catch(e) {}
    }
  }

  // 5. Oracle's custom combobox text inputs — the editable part of
  //    Oracle-style dropdowns where you type to search for options.
  const comboInputs = document.querySelectorAll('.cx-select-input');
  for (const el of comboInputs) {
    if (el.offsetHeight > 0 && el.offsetParent !== null) {
      el.value = '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      cleared++;
    }
  }

  // 6. Profile-imported tiles — experience, education, and other cards
  //    that Oracle pulled from your profile. Each has internal Delete buttons.
  const profileItems = document.querySelectorAll('.apply-flow-profile-item-tile');
  for (const item of profileItems) {
    const allBtns = item.querySelectorAll('button');
    for (const btn of allBtns) {
      const title = (btn.getAttribute('title') || '').toLowerCase();
      const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
      if (title === 'delete' || aria === 'delete') {
        try { btn.click(); cleared++; } catch(e) {}
      }
    }
  }

  // 7. The "Send me job alerts" checkbox — a standalone checkbox that
  //    isn't part of the application fields but should be cleared too.
  const alertCb = document.getElementById('job-alerts-checkbox');
  if (alertCb && alertCb.checked) {
    alertCb.checked = false;
    alertCb.dispatchEvent(new Event('change', { bubbles: true }));
    cleared++;
  }

  showStatus('Cleared ' + cleared + ' field(s)', 'info');
  console.log('JC: Cleared ' + cleared + ' form field(s)');
}

// ── Job Description Extraction ─────────────────────────────────
// The LLM needs the job description as context to answer questions well.
// This function searches the page for the most likely container element
// using common CSS class patterns. Returns the first match with >200 chars,
// truncated to 4000 chars (to stay within LLM context limits).

function extractJobDescription() {
  const selectors = [
    '[class*="job-description"]',
    '[class*="posting-description"]',
    '[class*="description"]',
    '[data-testid*="job-desc"]',
    '[id*="job-desc"]',
    'article',
    '.show-more-section',
    '[class*="requisition"]',
  ];

  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el && el.textContent.length > 200) {
      return el.textContent.trim().slice(0, 4000);
    }
  }

  const meta = document.querySelector('meta[name="description"]');
  return (meta?.content || document.title || '');
}

// ── Status Messages ─────────────────────────────────────────────
// Shows a message in the panel (e.g., "Filled 5 field(s)"). Plain messages
// auto-clear after 15 s; fill summaries pass {persist:true} and stay until
// the next status. makeStatusClickable() turns the message into a link that
// opens the extension settings page — used when the error is "No resume" so
// the user can upload one.

let statusClearTimer = null;

function showStatus(msg, type, opts) {
  const el = document.getElementById('jc-status-msg');
  if (!el) {
    // [FIX F] Degrade gracefully on pages without the panel element.
    console.warn('JC: #jc-status-msg not found — status not shown: ' + msg);
    return;
  }
  if (statusClearTimer) { clearTimeout(statusClearTimer); statusClearTimer = null; }
  el.className = 'jc-status ' + type;
  el.textContent = msg;
  if (opts && opts.persist) return;
  const ms = (opts && opts.ms) || 15000;
  statusClearTimer = setTimeout(function() { el.textContent = ''; el.className = 'jc-status'; statusClearTimer = null; }, ms);
}

// ── [FIX F] Fill statistics + one persistent summary ───────────────
// Fill All / section fill / AI questions run inside runFillSequence(), which
// records every FormDetector.fillField() outcome and renders a single
// persistent summary like: "Filled 12 fields (3 skipped) · AI answers 2/3 · 1 error (Failed to fetch)".
// [FIX G1] Resume FILE bytes are never stored (checked keys: resume_file,
// resume_data, resume_pdf, resume_base64, resume_blob — only resume_full_data
// TEXT exists), so file inputs are reported, never fabricated.
const RESUME_FILE_KEYS = ['resume_file', 'resume_data', 'resume_pdf', 'resume_base64', 'resume_blob'];

async function hasStoredResumeFile() {
  try {
    const res = await chrome.storage.sync.get(RESUME_FILE_KEYS);
    return RESUME_FILE_KEYS.some(k => !!(res && res[k]));
  } catch (e) {
    return null; // unknown — claim nothing in the summary
  }
}

function resetFillStats() {
  fillStats.filled = 0;
  fillStats.skipped = 0;
  fillStats.errors = [];
  fillStats.aiFilled = 0;
  fillStats.aiTotal = 0;
  fillStats.resumeFileStored = null;
}

function renderFillSummary() {
  const s = fillStats;
  let msg = 'Filled ' + s.filled + ' field' + (s.filled === 1 ? '' : 's');
  if (s.skipped > 0) msg += ' (' + s.skipped + ' skipped)';
  if (s.aiTotal > 0) msg += ' · AI answers ' + s.aiFilled + '/' + s.aiTotal;
  if (s.errors.length) {
    const reasons = [...new Set(s.errors.map(shortLLMError))].slice(0, 2).join(', ');
    msg += ' · ' + s.errors.length + ' error' + (s.errors.length === 1 ? '' : 's') + ' (' + reasons + ')';
  }
  // [FIX G1] File bytes are not stored, so they cannot be attached — say so.
  const hasFileInput = (detectedFields && detectedFields.files && detectedFields.files.length > 0) ||
    document.querySelectorAll('input[type=file]').length > 0;
  if (s.resumeFileStored === false && hasFileInput) {
    msg += ' · resume file not attached (no resume file stored — upload in Settings)';
  }
  showStatus(msg, s.errors.length ? 'error' : 'success', { persist: true });
}

// Run a whole fill sequence with stats and one summary at the end. The
// FormDetector.fillField wrapper is always restored (finally), even on throw.
async function runFillSequence(run) {
  resetFillStats();
  fillStats.resumeFileStored = await hasStoredResumeFile();
  // [FIX F] Refresh detection so the summary can report file inputs.
  try { detectedFields = FormDetector.detect(); } catch (e) { /* keep previous detection */ }
  const originalFillField = FormDetector.fillField;
  FormDetector.fillField = async function(field, value) {
    let ok = false;
    try {
      ok = await originalFillField.call(FormDetector, field, value);
    } catch (err) {
      fillStats.errors.push(shortLLMError(err.message));
      throw err;
    }
    if (ok) fillStats.filled++;
    else fillStats.errors.push(shortLLMError('fill rejected: ' + (field.label || field.name || 'field')));
    return ok;
  };
  try {
    return await run();
  } finally {
    FormDetector.fillField = originalFillField;
    renderFillSummary();
  }
}

function makeStatusClickable() {
  const el = document.getElementById('jc-status-msg');
  if (!el) return;
  el.style.cursor = 'pointer';
  el.style.color = '#2563eb';
  el.style.textDecoration = 'underline';
  el.title = 'Click to open extension settings';
  el.onclick = () => {
    chrome.runtime.sendMessage({ type: 'jc_open_options' }).catch(() => {});
    el.onclick = null;
    el.style.cursor = '';
    el.style.color = '';
    el.style.textDecoration = '';
    el.title = '';
  };
}

// ── Saved Answers Bank ──────────────────────────────────────────
// When the LLM answers a question, the question-answer pair is saved here
// (up to 50 entries). This lets the options page show your answer history
// and could be used to pre-fill questions you've answered before.

async function saveAnswer(question, answer) {
  if (!question || !answer) return;
  const result = await chrome.storage.sync.get("saved_answers");
  let answers = result.saved_answers || [];
  answers = answers.filter(qa => qa.question.toLowerCase().trim() !== question.toLowerCase().trim());
  answers.unshift({
    question: question.trim(),
    answer: answer.trim(),
    date: new Date().toISOString().split("T")[0],
  });
  if (answers.length > 50) answers = answers.slice(0, 50);
  await chrome.storage.sync.set({ saved_answers: answers });
}

// ── Message Listener ─────────────────────────────────────────────
// The popup (popup.js) and background script (background.js) communicate
// with this content script by sending messages. These handlers let the
// popup trigger Fill All or Clear All remotely, and let the popup query
// what fields are on the page.

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'jc_fill_all') {
    setFilling(true);
    (async () => {
      try {
        await runFillSequence(async () => {
          await fillPersonal();
          await fillExperience();
          await fillEducation();
          await fillSkills();
          await fillLanguages();
          await fillLicenses();
          await fillAIQuestions();
          await fillApplicationQuestions();
          await fillLearnedRadios();
        });
      } catch (err) {
        console.warn('[JC] Fill All message error:', err);
      } finally {
        setFilling(false);
      }
    })();
    sendResponse({ ok: true });
    return true;
  }
  // Per-section fills for debugging — call via chrome.tabs.sendMessage
  // e.g. { type: 'jc_fill_section', section: 'experience' }
  if (msg.type === 'jc_fill_section') {
    const section = msg.section;
    const fns = {
      personal: fillPersonal,
      experience: fillExperience,
      education: fillEducation,
      skills: fillSkills,
      languages: fillLanguages,
      licenses: fillLicenses,
      aiQuestions: fillAIQuestions,
      appQuestions: fillApplicationQuestions,
      radios: fillLearnedRadios,
    };
    const fn = fns[section];
    if (!fn) {
      sendResponse({ ok: false, error: `Unknown section: ${section}. Valid: ${Object.keys(fns).join(', ')}` });
      return true;
    }
    setFilling(true);
    (async () => {
      try {
        await runFillSequence(() => fn());
        sendResponse({ ok: true, section });
      } catch (e) {
        sendResponse({ ok: false, error: e.message, section });
      } finally {
        setFilling(false);
      }
    })();
    return true;
  }
  if (msg.type === 'jc_clear_form') {
    setFilling(true);
    clearForm();
    setFilling(false);
    sendResponse({ ok: true });
    return true;
  }
  if (msg.type === 'jc_get_fields') {
    const fields = FormDetector.detect();
    sendResponse(fields);
    return true;
  }
  if (msg.type === 'jc_ping') {
    sendResponse({ ok: true });
    return true;
  }
});

// ── MutationObserver ─────────────────────────────────────────────
// A MutationObserver is a browser API that lets JavaScript watch the page
// for changes. Every time any HTML element is added, removed, or modified
// anywhere on the page, this observer fires. We use it because Oracle's
// SPA can re-render sections at any time — adding new fields, removing
// old ones — without a full page reload. When that happens, we need to
// re-detect fields and re-inject per-field "F" buttons on the new elements.
//
// The observer is debounced (waits 2 seconds after the last change before
// acting) because Oracle often makes many rapid DOM changes during a
// single transition, and we only want to react once they're done.
//
// It checks __jcFilling to avoid interfering with an active fill operation.
// If filling is in progress, the observer returns early and does nothing.
let detectTimeout = null;
const observer = new MutationObserver(function() {
  // Debounce: clear any pending timeout, start a new 2-second timer.
  // This ensures we only react once Oracle finishes making rapid changes.
  clearTimeout(detectTimeout);
  detectTimeout = setTimeout(function() {
    // If a fill or clear operation is running, don't interfere.
    if (window.__jcFilling) return;

    // Re-detect fields — Oracle may have added or removed elements.
    const fields = FormDetector.detect();
    const total = fields.personal.length + fields.questions.length + fields.selects.length;
    if (total === 0) return;  // no fields found, nothing to do

    // Always inject F buttons on newly-rendered fields (regardless of panel state).
    if (!document.getElementById('jc-float-btn')) {
      injectFloatingButton();
    }
    injectPerFieldButtons();
    attachGlobalLearning();

    const panel = document.getElementById('jc-panel');
    if (panel && panel.classList.contains('open')) {
      updatePanel();
    }
  }, 2000);
});
observer.observe(document.body, { childList: true, subtree: true });

// ── Safety-net poller ──────────────────────────────────────────────
// Runs every 3 seconds. Directly checks if any input/combobox is missing
// an F button and creates one on the spot. This is a brute-force backup
// for fields that FormDetector.detect() might miss (e.g., Oracle date
// comboboxes with non-standard naming patterns). Polling stops after 5
// consecutive no-op cycles.
let _pollerQuietCycles = 0;
setInterval(function() {
  if (window.__jcFilling) return;
  var injected = 0;
  document.querySelectorAll('input:not([type=hidden]):not([type=file]), select, textarea, [role=combobox]').forEach(function(el) {
    if (el.type === 'file') return;
    if (el.offsetWidth === 0 || el.offsetHeight === 0) return;
    var parent = el.parentElement;
    if (!parent) return;
    if (parent.querySelector('.jc-field-fill-btn')) return;
    
    // No F button found — inject one
    injected++;
    var btn = document.createElement('button');
    btn.className = 'jc-field-fill-btn';
    btn.title = 'Fill this field';
    btn.textContent = 'F';
    
    // Build a generic field object for fillSingleField
    var label = el.getAttribute('aria-label') || el.placeholder || el.name || el.id || '';
    var lab = el.closest('label') || (el.id && document.querySelector('label[for="' + el.id + '"]'));
    if (lab) label = lab.textContent?.trim() || label;
    var fieldObj = { el: el, name: el.name || el.id || 'unknown', label: label };
    
    btn.onclick = function(e) {
      e.preventDefault();
      e.stopPropagation();
      fillSingleField(fieldObj);
    };
    
    if (getComputedStyle(parent).position === 'static') {
      parent.style.position = 'relative';
    }
    var ancestor = parent;
    while (ancestor && ancestor !== document.body) {
      if (getComputedStyle(ancestor).overflow !== 'visible') {
        ancestor.style.overflow = 'visible';
      }
      ancestor = ancestor.parentElement;
    }
    parent.appendChild(btn);
  });
  if (injected > 0) {
    _pollerQuietCycles = 0;
  } else {
    _pollerQuietCycles++;
  }
}, 3000);

// ── Start ──────────────────────────────────────────────────────────
init();

// ── Hot-reload trigger ──────────────────────────────────────────
// Dispatch a custom "jc-reload" event on document to trigger extension reload.
// Usage from DevTools console or Playwright:
//   document.dispatchEvent(new Event('jc-reload'))
document.addEventListener('jc-reload', function() {
  console.log('JC: Hot-reload triggered via DOM event');
  chrome.runtime.sendMessage({ type: 'jc_reload_extension' }, function(resp) {
    console.log('JC: Reload response:', resp);
  });
});
