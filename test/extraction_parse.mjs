// Test: resume-extraction parse layer (options.js).
//
// The functions under test are loaded from extension/options/options.js into a
// vm sandbox as a plain script — the same way the options page loads them — so
// this suite exercises the REAL implementation. No parsing logic is duplicated
// here (see test/llm_config.mjs for the same approach).
//
// Each case maps to a defect measured on the live extension; the comment above
// each group says which observation it pins down.
//
// Run: node test/extraction_parse.mjs

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import vm from 'vm';

const assert = {
  equal(a, b, m) { if (a !== b) { console.error(`❌ ${m}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); process.exit(1); } console.log(`  ✓ ${m}`); },
  ok(v, m) { if (!v) { console.error(`❌ ${m}`); process.exit(1); } console.log(`  ✓ ${m}`); },
  deepEqual(a, b, m) { if (JSON.stringify(a) !== JSON.stringify(b)) { console.error(`❌ ${m}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); process.exit(1); } console.log(`  ✓ ${m}`); },
  throws(fn, re, m) {
    let err = null;
    try { fn(); } catch (e) { err = e; }
    if (!err) { console.error(`❌ ${m}: did not throw`); process.exit(1); }
    if (re && !re.test(err.message)) { console.error(`❌ ${m}: message ${JSON.stringify(err.message)} does not match ${re}`); process.exit(1); }
    console.log(`  ✓ ${m}`);
    return err;
  },
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

console.log('\n🔬 Resume Extraction Parse Tests\n');

// ── Sandbox: load the real options.js ───────────────────────────────
const src = readFileSync(join(root, 'extension/options/options.js'), 'utf8');

function stubEl() {
  return {
    value: '', textContent: '', innerHTML: '', className: '', disabled: false,
    style: {}, dataset: {}, files: [],
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {}, removeEventListener() {}, appendChild() {}, querySelector() { return null; },
    querySelectorAll() { return []; }, focus() {}, click() {}, remove() {},
  };
}

const sandbox = {
  console,
  setTimeout, clearTimeout, setInterval, clearInterval,
  document: {
    addEventListener() {}, removeEventListener() {},
    getElementById() { return stubEl(); },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    createElement() { return stubEl(); },
    body: stubEl(),
  },
  window: {},
  chrome: {
    storage: {
      sync: { get: async () => ({}), set: async () => {}, remove: async () => {} },
      onChanged: { addListener() {} },
    },
    runtime: { getURL: (p) => p, sendMessage: async () => ({}) },
  },
  fetch: async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '' }),
  AbortController,
  Event: class { constructor() {} },
  TokenTracker: { record() {} },
};

const X = vm.runInNewContext(
  src + '\n;({ parseLLMProfileJSON, repairJsonStructure, normalizeProfile, missingProfileKeys, ' +
        'jsonBraceBalance, composeAddress, readChatMessage, PROFILE_REQUIRED_KEYS })',
  sandbox,
);

// ── 1. String bodies are never rewritten ────────────────────────────
// Measured: the unconditional unquoted-key pass turned the valid value
// `"matching, torch: nimble"` into `"matching,"torch": nimble"` (unparseable),
// and the recovery pass turned `Master's Degree` into `Master"s Degree`.
console.log('1) String values survive byte-for-byte');
{
  const apostrophe = '{"education":[{"school":"ISAE","degree":"Master\'s Degree"}]}';
  const p1 = X.parseLLMProfileJSON(apostrophe);
  assert.equal(p1.profile.education[0].degree, "Master's Degree", "apostrophe inside a string value is unchanged");
  assert.equal(p1.repaired, false, 'valid JSON is not passed through the repair step');
  assert.equal(X.repairJsonStructure(apostrophe), apostrophe, 'repairJsonStructure leaves a fully valid document untouched');

  const colon = '{"note":"matching, torch: nimble","other":"a, b: c"}';
  const p2 = X.parseLLMProfileJSON(colon);
  assert.equal(p2.profile.note, 'matching, torch: nimble', '", word:" inside a value is not rewritten');
  assert.equal(p2.profile.other, 'a, b: c', 'a second ", word:" value is not rewritten');

  const curly = '{"title":"CycloTech Presents the \u2018BlackBird\u2019 Demonstrator","note":"Japan\u2019s largest"}';
  const p3 = X.parseLLMProfileJSON(curly);
  assert.equal(p3.profile.title, 'CycloTech Presents the \u2018BlackBird\u2019 Demonstrator', 'curly quotes inside values are preserved');
  assert.equal(p3.profile.note, 'Japan\u2019s largest', 'curly apostrophe inside a value is preserved');

  // …and repair still fixes genuinely broken structure, without touching bodies.
  const broken = "{name: 'Shivam', degree: \"Master's Degree\", note: 'a, b: nope', city:'Gdansk',}";
  const p4 = X.parseLLMProfileJSON(broken);
  assert.equal(p4.repaired, true, 'single-quoted/unquoted-key JSON is repaired');
  assert.equal(p4.profile.name, 'Shivam', 'unquoted value parsed');
  assert.equal(p4.profile.degree, "Master's Degree", 'apostrophe survived the repair path');
  assert.equal(p4.profile.note, 'a, b: nope', '", word:" survived the repair path');
  assert.equal(p4.profile.city, 'Gdansk', 'trailing comma dropped');
}

// ── 2. null is dropped, never stored ────────────────────────────────
// Measured: nothing validated the response, so `null` and the string "null"
// were written straight into resume_full_data.
console.log('2) null / "null" values are dropped');
{
  const p = X.parseLLMProfileJSON('{"name":"Shivam Bhalla","github":null,"website":"null","work_authorization":"undefined","city":"Gdansk","experience":[null,{"company":"CycloTech","end_date":null}],"skills":["MATLAB",null]}');
  assert.ok(!('github' in p.profile), 'JSON null is dropped');
  assert.ok(!('website' in p.profile), 'the string "null" is dropped');
  assert.ok(!('work_authorization' in p.profile), 'the string "undefined" is dropped');
  assert.equal(p.profile.city, 'Gdansk', 'real values are kept');
  assert.equal(JSON.stringify(p.profile).includes('null'), false, 'no null survives anywhere in the object graph');
  assert.deepEqual(p.profile.experience, [{ company: 'CycloTech' }], 'null array elements and nested nulls are dropped');
  assert.deepEqual(p.profile.skills, ['MATLAB'], 'null kept out of string arrays');
}

// ── 3. Missing keys are reported ────────────────────────────────────
// Measured: the UI only said "Extracted 6 field(s)"; a field the model never
// returned was indistinguishable from one the resume does not contain.
console.log('3) Missing keys are reported, not silently omitted');
{
  const p = X.parseLLMProfileJSON('{"name":"Shivam Bhalla","email":"a@b.c","phone":"+33","linkedin":"l","github":"g"}');
  assert.ok(p.missing.includes('experience'), 'missing array keys reported');
  assert.ok(p.missing.includes('website'), 'missing scalar keys reported');
  assert.equal(p.missing.includes('name'), false, 'present keys are not reported');
  const empty = X.parseLLMProfileJSON('{}');
  assert.equal(empty.missing.length, X.PROFILE_REQUIRED_KEYS.length, 'an empty object reports every required key');
  assert.equal(empty.missing.length, 19, 'required-key list covers the prompt schema');
}

// ── 4. choices: [] → clear error ────────────────────────────────────
// Measured: background.js did `data.choices[0].message` and threw
// "Cannot read properties of undefined (reading 'message')"; options.js threw
// the vague "Empty response from API".
console.log('4) Empty choices yields a clear error');
{
  const err = assert.throws(() => X.readChatMessage({ choices: [] }, 'deepseek-v4-flash-2'),
    /choices: \[\]/, 'choices: [] reports the empty choices array');
  assert.ok(!/Cannot read propert/.test(err.message), 'no TypeError-style message');
  assert.throws(() => X.readChatMessage({}, 'm'), /choices: \[\]/, 'a response with no choices field is reported the same way');
  assert.throws(() => X.readChatMessage(null, 'm'), /non-JSON body/, 'a non-object body is reported clearly');
  const ok = X.readChatMessage({ choices: [{ message: { content: ' {"a":1} ' }, finish_reason: 'stop' }] }, 'm');
  assert.equal(ok.content, '{"a":1}', 'content is returned trimmed');
  assert.equal(ok.finishReason, 'stop', 'finish_reason is surfaced');
  const ronly = X.readChatMessage({ choices: [{ message: { reasoning_content: 'thinking' }, finish_reason: 'length' }] }, 'm');
  assert.equal(ronly.reasoning, 'thinking', 'reasoning-only replies are surfaced');
}

// ── 5. Error attribution ────────────────────────────────────────────
// Measured: EVERY parse failure was reported as
// "JSON response was truncated (max_tokens too low)" — including failures caused
// by the recovery regexes mangling an apostrophe.
console.log('5) Truncation is reported as a likely cause, malformed JSON as malformed');
{
  const cut = X.parseLLMProfileJSON;
  const e1 = assert.throws(() => cut('{"name":"Shivam","education":[{"school":"ISAE-SUA'),
    /truncation is the likely cause/, 'incomplete reply names truncation as the likely cause');
  assert.ok(!/max_tokens too low/.test(e1.message), 'the old certainty ("max_tokens too low") is gone');

  const e2 = assert.throws(() => cut('{"a": "b",,, "c": }'), /NOT a truncation|not valid JSON/,
    'a complete-but-malformed reply is NOT blamed on the token limit');
  assert.ok(!/truncation is the likely cause/.test(e2.message), 'malformed JSON does not claim truncation');

  const e3 = assert.throws(() => cut('{"name":"Shivam"', { finishReason: 'length' }),
    /output limit \(finish_reason=length\)/, 'finish_reason=length is reported as the cause');
  assert.throws(() => cut('no json here at all'), /No JSON object/, 'prose with no object is reported as such');
  assert.throws(() => cut(''), /Empty response/, 'empty reply reported');
  assert.throws(() => cut('[1,2,3]'), /No JSON object/, 'a non-object reply is rejected');
}

// ── 6. Fenced + reasoning-only replies ──────────────────────────────
console.log('6) Fenced ```json blocks and reasoning-only replies parse');
{
  const fenced = X.parseLLMProfileJSON('```json\n{"name":"Shivam Bhalla","city":"Gdansk"}\n```');
  assert.equal(fenced.profile.name, 'Shivam Bhalla', 'fenced ```json block parses');
  const fenced2 = X.parseLLMProfileJSON('```\n{"name":"A"}\n```');
  assert.equal(fenced2.profile.name, 'A', 'bare ``` fence parses');
  const reasoning = X.parseLLMProfileJSON('I need to output JSON only.\nHere it is:\n{"name":"B","email":"e@x.y"}\nDone.');
  assert.equal(reasoning.profile.name, 'B', 'prose around the object is ignored (reasoning-model reply)');
  assert.equal(reasoning.profile.email, 'e@x.y', 'the whole first object is taken');
  assert.equal(X.jsonBraceBalance('{"a":[1,2]}'), 0, 'balanced JSON reports depth 0');
  assert.ok(X.jsonBraceBalance('{"a":[1,2') > 0, 'unbalanced JSON reports depth > 0');
}

// ── 7. Address assembly ─────────────────────────────────────────────
// Measured: the prompt returns street/city/state/postal_code/country but the
// form has one `profile_address`; nothing merged them, so the box kept a stale
// unrelated value ("42 Maple Street, 7A, Gdansk, 80-394") after extraction even
// though the model reported "Gdansk, Poland".
console.log('7) One-line address is assembled from the model\'s parts');
{
  assert.equal(X.composeAddress({ city: 'Gdansk', country: 'Poland' }), 'Gdansk, Poland', 'city + country assembled');
  assert.equal(X.composeAddress({ street: '1 A St', city: 'Gdansk', state: 'PM', postal_code: '80-394', country: 'Poland' }),
    '1 A St, Gdansk, PM, 80-394, Poland', 'all parts assembled in order');
  assert.equal(X.composeAddress({ city: 'Gdansk', address: 'Official line' }), 'Official line', 'an explicit address wins');
  assert.equal(X.composeAddress({}), '', 'no location data → empty string (never a stale or invented value)');
  assert.equal(X.composeAddress({ city: '  ' }), '', 'whitespace-only parts are ignored');
}

// ── 8. Regression: the real captured extraction ─────────────────────
// Fixture = the verbatim `choices[0].message.content` from the live run against
// the real resume (deepseek-v4-flash-2, 2026-05-22 PDF). Ground truth for the
// core fields was read independently from the PDF text (pdftotext -layout).
const REAL_REPLY = `{
  "name": "Shivam Bhalla",
  "email": "shivam.bhalla07@gmail.com",
  "phone": "+33-753788537",
  "linkedin": "https://www.linkedin.com/in/shivambhalla07/",
  "github": "https://github.com/shivam2014",
  "website": "",
  "street": "",
  "city": "Gdansk",
  "state": "",
  "postal_code": "",
  "country": "Poland",
  "work_authorization": "",
  "summary": "Systems Engineer with 5+ years in requirements-driven aerospace development, from requirements analysis through system integration and validation. Architected a mission-critical simulation platform at an eVTOL startup, integrating multi-disciplinary data sources. Co-led Agile performance tooling at Airbus supporting safety-critical flight analysis within CS-23/CS-25 certification frameworks.",
  "skills": [
    "Requirements management",
    "interface management",
    "integration",
    "Verification & Validation",
    "modular architecture design",
    "Agile development",
    "system-level trade studies",
    "Python (Pandas, NumPy, SciPy, Multiprocessing)",
    "PyQt5 (GUI)",
    "MATLAB",
    "Simulink/SimScape",
    "Git",
    "Docker",
    "Linux",
    "Flight performance modeling",
    "propulsion-aero-control integration",
    "battery/hybrid systems",
    "wind tunnel data analysis",
    "Simulation data pipelines",
    "trade-off studies",
    "sensitivity analysis",
    "Spotfire dashboards"
  ],
  "experience": [
    {
      "title": "Lead Systems Engineer - Aircraft Performance & Controls",
      "company": "CycloTech GmbH",
      "city": "Linz, Austria",
      "start_date": "Oct 2020",
      "end_date": "Jul 2024",
      "description": [
        "Rebuilt simulation capability from scratch: Reverse-engineered the undocumented physics model and built a Python tool, cutting simulation time from ~1 week to 30 seconds per run and enabling 3,000 configurations per day.",
        "Designed modular systems architecture: Architected the FPT as independent modules (rotor, propulsion, mission profiles, battery) with parallel execution, enabling rapid design-space exploration and trade-off analysis.",
        "Unified multi-department data streams: Integrated wind tunnel data, battery characteristics, structural constraints, and flight test telemetry into a single simulation platform, closing the validation loop between hardware testing and system-level performance predictions.",
        "Led client-facing aircraft design programs: Systems performance lead on the Yamato Cargo Drone project (Japan\u2019s largest delivery company); defined requirements and presented trade-off analyses to Japanese clients.",
        "Assumed full program leadership: Promoted to Lead Engineer (Aug 2023); absorbed roadmap ownership and CTO-level stakeholder alignment without program disruption."
      ]
    },
    {
      "title": "Aircraft Performance Engineer (1GFC) - Fixed term contract",
      "company": "Airbus Operations SAS",
      "city": "Toulouse, France",
      "start_date": "Nov 2018",
      "end_date": "Mar 2020",
      "description": [
        "85% workflow speed improvement: Co-led Agile development of PerfoRevolution, automating flight performance workflows across the Flight Physics group.",
        "Safety-critical systems analysis: Conducted takeoff/landing incident analyses using OCTOPUS (Airbus certified performance tool), supporting airworthiness compliance within CS-23/CS-25 frameworks.",
        "Built certification-support dashboards: Developed Spotfire dashboards for incident analysis and case report visualisation, supporting safety and certification workflows."
      ]
    },
    {
      "title": "Aircraft Engineer (Internship) - System Analysis & Simulation",
      "company": "Aeroconseil, Akkodis",
      "city": "Toulouse, France",
      "start_date": "Apr 2018",
      "end_date": "Oct 2018",
      "description": [
        "Independently conceived Predictive Maintenance framework: Developed a degradation model for Airbus FCS (ATA27) in MATLAB to optimise maintenance schedules.",
        "Validated predictions in simulation: Built Simulink/SimScape models to validate RUL predictions; findings presented in Master Thesis."
      ]
    }
  ],
  "education": [
    { "school": "ISAE-SUPAERO", "degree": "Masters in Aerospace Engineering", "field": "Aircraft Systems and Controls", "start_date": "Sep 2016", "end_date": "Oct 2018" },
    { "school": "Vellore Institute of Technology", "degree": "Bachelors of Technology", "field": "Mechanical Engineering", "start_date": "Jun 2012", "end_date": "May 2016" }
  ],
  "languages": [
    { "name": "English", "level": "Fluent" },
    { "name": "Hindi", "level": "Native" },
    { "name": "French", "level": "B1-B2" },
    { "name": "German", "level": "A1" }
  ],
  "projects": [
    { "name": "mlx-lm inference engine (open-source)", "description": "Maintain a fork of Apple's ML inference framework; achieved 6.7x prefill speedup through asymmetric KV cache quantisation and two-tier memory persistence." },
    { "name": "Co-founder, Shaurya Racing", "description": "Established team for Formula Student India 2015 & 2016 FSAE competition vehicle." }
  ],
  "publications": [
    { "title": "Flying Car: CycloTech Presents the 'BlackBird' Demonstrator", "url": "https://www.cyclotech.at/cyclotech_presents_blackbird_demonstrator/" },
    { "title": "First Air Car with CycloRotors", "url": "https://www.cyclotech.at/cyclotech-presents-first-air-car-with-cyclorotors/" },
    { "title": "Innovative Cargo eVTOL Concept with CycloRotors", "url": "http://www.cyclotech.at/download/2005/" }
  ]
}`;

console.log('8) Real captured extraction still parses (ground-truth regression)');
{
  const p = X.parseLLMProfileJSON(REAL_REPLY, { finishReason: 'stop' });
  assert.equal(p.repaired, false, 'the real reply needs no repair');
  assert.deepEqual(p.missing, [], 'the real reply returns every requested key');
  assert.equal(p.profile.name, 'Shivam Bhalla', 'GT name');
  assert.equal(p.profile.email, 'shivam.bhalla07@gmail.com', 'GT email');
  assert.equal(p.profile.phone, '+33-753788537', 'GT phone starts +33');
  assert.equal(p.profile.linkedin, 'https://www.linkedin.com/in/shivambhalla07/', 'GT linkedin');
  assert.equal(p.profile.github, 'https://github.com/shivam2014', 'GT github');
  assert.equal(X.composeAddress(p.profile), 'Gdansk, Poland', 'GT location');
  assert.equal(p.profile.work_authorization, '', 'not in the PDF → empty, not invented');
  assert.equal(p.profile.website, '', 'not in the PDF → empty, not invented');
  assert.equal(p.profile.experience.length, 3, 'three jobs in the PDF');
  assert.equal(p.profile.experience[0].company, 'CycloTech GmbH', 'first employer');
  assert.equal(p.profile.experience[2].company, 'Aeroconseil, Akkodis', 'third employer');
  assert.ok(p.profile.experience[0].description[3].includes('Japan\u2019s largest delivery company'), 'curly apostrophe survived the whole pipeline');
  assert.ok(p.profile.projects[0].description.includes("Apple's"), 'ASCII apostrophe survived the whole pipeline');
  assert.ok(p.profile.publications[0].title.includes("'BlackBird'"), 'quoted title survived');
  assert.equal(p.profile.education.length, 2, 'two degrees in the PDF');
  assert.equal(p.profile.education[0].school, 'ISAE-SUPAERO', 'first school');
  assert.equal(p.profile.education[1].degree, 'Bachelors of Technology', 'second degree');
  assert.deepEqual(p.profile.languages.map(l => l.name), ['English', 'Hindi', 'French', 'German'], 'four languages in the PDF');
  assert.deepEqual(p.profile.languages.map(l => l.level), ['Fluent', 'Native', 'B1-B2', 'A1'], 'language levels');
  assert.equal(p.profile.skills.length, 22, 'skills list length');
  assert.ok(p.profile.skills.includes('MATLAB') && p.profile.skills.includes('Docker'), 'skills content');
}

console.log('\n🎉 Extraction parse tests passed (8 groups)\n');
