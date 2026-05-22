// Tests: Resume extraction pipeline — date normalization, JSON parsing, data construction
// Run: node test/extraction.mjs

const assert = {
  equal(a, b, m) { if (a !== b) { console.error(`  ❌ ${m}: "${a}" !== "${b}"`); process.exit(1); } console.log(`  ✓ ${m}`); },
  ok(v, m) { if (!v) { console.error(`  ❌ ${m}: falsy`); process.exit(1); } console.log(`  ✓ ${m}`); },
};

console.log('\n🔬 Extraction Pipeline Tests\n');

// ====== 1. Date normalization ======
console.log('--- Date Normalization ---');

function normalizeDate(str) {
  if (!str || typeof str !== 'string') return str || '';
  const months = {jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12'};
  const m = str.match(/^([a-z]{3})\s*(\d{4})$/i);
  if (m && months[m[1].toLowerCase()]) return months[m[1].toLowerCase()] + '/' + m[2];
  return str;
}

assert.equal(normalizeDate('Oct 2020'), '10/2020', 'Oct 2020 → 10/2020');
assert.equal(normalizeDate('Jul 2024'), '07/2024', 'Jul 2024 → 07/2024');
assert.equal(normalizeDate('Sep 2016'), '09/2016', 'Sep 2016 → 09/2016');
assert.equal(normalizeDate('jan 2020'), '01/2020', 'jan 2020 → 01/2020');
assert.equal(normalizeDate('10/2020'), '10/2020', '10/2020 stays as-is (already normalized)');
assert.equal(normalizeDate(''), '', 'Empty string stays empty');
assert.equal(normalizeDate('invalid'), 'invalid', 'Invalid date stays as-is');
assert.equal(normalizeDate('May 2020'), '05/2020', 'May 2020 → 05/2020');
assert.equal(normalizeDate('Dec 2025'), '12/2025', 'Dec 2025 → 12/2025');

// ====== 2. JSON extraction from reasoning content ======
console.log('\n--- JSON Extraction from Response ---');

function extractJSON(raw) {
  if (!raw) return null;
  const end = raw.lastIndexOf('}');
  if (end === -1) return null;
  let depth = 0, start = -1;
  for (let i = end; i >= 0; i--) {
    if (raw[i] === '}') depth++;
    else if (raw[i] === '{') depth--;
    if (depth === 0) { start = i; break; }
  }
  if (start === -1) return null;
  try { return JSON.parse(raw.slice(start, end + 1)); } catch { return null; }
}

// Test: JSON at end of thinking text
const response1 = `We need to extract data from this resume.
Let's parse through the resume text:
- name: "Shivam Bhalla"
- email: "shivam.bhalla07@gmail.com"

Here is the JSON:
{"name": "Shivam Bhalla", "email": "shivam.bhalla07@gmail.com", "phone": "+33-753788537"}`;

const r1 = extractJSON(response1);
assert.ok(r1 !== null, 'JSON extracted from end of thinking text');
assert.equal(r1.name, 'Shivam Bhalla', 'Name correctly parsed');
assert.equal(r1.email, 'shivam.bhalla07@gmail.com', 'Email correctly parsed');
assert.equal(r1.phone, '+33-753788537', 'Phone correctly parsed');

// Test: JSON with markdown fences
const response2 = '```json\n{"name": "Test", "skills": ["A", "B"]}\n```';
const r2 = extractJSON(response2);
assert.ok(r2 !== null, 'JSON extracted from markdown fence');
assert.equal(r2.name, 'Test', 'Name from fence');
assert.equal(r2.skills.length, 2, '2 skills from fence');

// Test: No JSON
assert.equal(extractJSON('Just some text without JSON'), null, 'No JSON returns null');

// Test: Empty
assert.equal(extractJSON(''), null, 'Empty string returns null');

// Test: Complex JSON with nested objects
const response3 = `Here's the extracted data:
{"name": "Shivam Bhalla", "skills": ["Python","MATLAB"], "experience": [{"title": "Engineer", "company": "Corp", "start_date": "Oct 2020", "end_date": "Jul 2024"}], "education": [{"degree": "Masters", "school": "ISAE-SUPAERO", "field": "Aerospace", "start_date": "Sep 2016", "end_date": "Oct 2018"}]}`;
const r3 = extractJSON(response3);
assert.ok(r3 !== null, 'Complex JSON extracted');
assert.equal(r3.experience.length, 1, '1 experience entry');
assert.equal(r3.experience[0].start_date, 'Oct 2020', 'Start date preserved');
assert.equal(r3.education[0].degree, 'Masters', 'Education degree preserved');

// ====== 3. Full resume data construction ======
console.log('\n--- Resume Data Construction ---');

function buildFullData(profile) {
  const fullData = { extractedFields: {}, rawSections: {} };
  for (const k in profile) {
    if (typeof profile[k] === 'object' && profile[k] !== null) {
      fullData.rawSections[k] = profile[k];
    } else {
      fullData.extractedFields[k] = profile[k];
    }
  }
  // Normalize dates
  const months = {jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12'};
  ['experience','education'].forEach(section => {
    if (fullData.rawSections[section]) {
      fullData.rawSections[section].forEach(item => {
        ['start_date','end_date'].forEach(field => {
          if (item[field] && typeof item[field] === 'string') {
            const m = item[field].match(/^([a-z]{3})\s*(\d{4})$/i);
            if (m && months[m[1].toLowerCase()]) item[field] = months[m[1].toLowerCase()] + '/' + m[2];
          }
        });
      });
    }
  });
  return fullData;
}

const profile = {
  name: 'Shivam Bhalla',
  email: 'shivam.bhalla07@gmail.com',
  phone: '+33-753788537',
  skills: ['Python', 'MATLAB', 'Flight Performance'],
  experience: [{ title: 'Engineer', company: 'Corp', start_date: 'Oct 2020', end_date: 'Jul 2024' }],
  education: [{ degree: 'Masters', school: 'ISAE-SUPAERO', start_date: 'Sep 2016', end_date: 'Oct 2018' }],
  languages: [{ name: 'English', level: 'Fluent' }],
};

const fd = buildFullData(profile);

assert.ok(fd.extractedFields.name === 'Shivam Bhalla', 'Name in extractedFields');
assert.ok(Array.isArray(fd.rawSections.skills), 'Skills in rawSections');
assert.equal(fd.rawSections.skills.length, 3, '3 skills preserved');
assert.equal(fd.rawSections.experience[0].start_date, '10/2020', 'Date normalized to 10/2020');
assert.equal(fd.rawSections.experience[0].end_date, '07/2024', 'Date normalized to 07/2024');
assert.equal(fd.rawSections.education[0].start_date, '09/2016', 'Education date normalized');
assert.equal(fd.rawSections.languages[0].level, 'Fluent', 'Language level preserved');

// Test with already-normalized dates
const profile2 = {
  name: 'Test',
  experience: [{ title: 'Test', company: 'T', start_date: '01/2020', end_date: '06/2023' }],
};
const fd2 = buildFullData(profile2);
assert.equal(fd2.rawSections.experience[0].start_date, '01/2020', 'Already normalized date stays');

// ====== 4. Merging with existing data ======
console.log('\n--- Data Merging ---');

function mergeData(newData, existingData) {
  const result = JSON.parse(JSON.stringify(newData));
  if (!existingData) return result;
  if (existingData.rawSections && result.rawSections) {
    for (const key in existingData.rawSections) {
      if (!result.rawSections[key] || (Array.isArray(result.rawSections[key]) && result.rawSections[key].length === 0)) {
        result.rawSections[key] = existingData.rawSections[key];
      }
    }
  }
  if (existingData.extractedFields && result.extractedFields) {
    for (const key in existingData.extractedFields) {
      if (!result.extractedFields[key]) result.extractedFields[key] = existingData.extractedFields[key];
    }
  }
  return result;
}

const existing = {
  extractedFields: { name: 'Old Name' },
  rawSections: { skills: ['ManualSkill'], projects: [{ name: 'Manual Project' }] }
};

const newData = {
  extractedFields: { name: 'New Name', email: 'new@email.com' },
  rawSections: { skills: ['ExtractedSkill'], experience: [{ title: 'New Job' }] }
};

const merged = mergeData(newData, existing);
assert.equal(merged.extractedFields.name, 'New Name', 'New data overwrites old');
assert.equal(merged.rawSections.skills[0], 'ExtractedSkill', 'Extracted skills replace manual');
assert.equal(merged.rawSections.projects[0].name, 'Manual Project', 'Manual project preserved (not in new data)');

// Merge with empty new data
const merged2 = mergeData({ extractedFields: {}, rawSections: { skills: [] } }, existing);
assert.equal(merged2.rawSections.skills[0], 'ManualSkill', 'Empty skills array preserves manual');
assert.equal(merged2.rawSections.projects[0].name, 'Manual Project', 'Projects preserved');

console.log(`\n🎉 All extraction pipeline tests passed!`);
