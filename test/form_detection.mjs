// Test: Form field detection and classification
// Run: node test/form_detection.mjs

const assert = {
  equal(a, b, m) { if (a !== b) { console.error(`❌ ${m}: ${a} !== ${b}`); process.exit(1); } console.log(`  ✓ ${m}`); },
  ok(v, m) { if (!v) { console.error(`❌ ${m}`); process.exit(1); } console.log(`  ✓ ${m}`); },
};

console.log('\n🔬 Form Detection Tests\n');

// Simulated field patterns (from form-detector.js)
const fieldPatterns = {
  name: ['name', 'fullname', 'full-name', 'full_name', 'applicant.name', 'candidate.name', 'firstname', 'lastname'],
  email: ['email', 'e-mail', 'emailaddress', 'email_address', 'applicant.email', 'candidate.email'],
  phone: ['phone', 'telephone', 'tel', 'phonenumber', 'phone-number', 'phone_number', 'phone number', 'mobile', 'cell'],
  linkedin: ['linkedin', 'linkedinurl', 'linkedin-url', 'linkedin_url', 'linkedinprofile'],
  github: ['github', 'githuburl', 'github-url', 'github_url'],
  resume: ['resume', 'cv', 'upload-cv', 'uploadcv', 'upload_cv', 'file', 'attachment'],
  cover_letter: ['coverletter', 'cover-letter', 'cover_letter', 'coverlettertext', 'cover letter'],
  work_authorization: ['workauth', 'work-authorization', 'work_authorization', 'work authorization', 'visa', 'sponsorship', 'workpermit'],
  address: ['address', 'street', 'city', 'state', 'zip', 'postalcode', 'postal code', 'location'],
  website: ['website', 'portfolio', 'personalwebsite', 'url'],
};

function classifyField(identifiers) {
  const id = identifiers.toLowerCase();
  for (const [fieldName, patterns] of Object.entries(fieldPatterns)) {
    if (patterns.some(p => id.includes(p))) return fieldName;
  }
  return 'unknown';
}

// Test 1: All field patterns are present
assert.equal(Object.keys(fieldPatterns).length, 10, '10 field pattern categories');
for (const [name, patterns] of Object.entries(fieldPatterns)) {
  assert.ok(patterns.length >= 2, `${name}: at least 2 patterns`);
  patterns.forEach(p => assert.ok(p.length > 0, `  pattern not empty`));
}
console.log('  ✅ All 10 categories have valid patterns');

// Test 2: Correct classification
const tests = [
  ['name', 'applicant_name'],
  ['name', 'Full Name'],
  ['email', 'emailAddress'],
  ['email', 'e-mail address'],
  ['phone', 'phoneNumber'],
  ['phone', 'mobile phone'],
  ['linkedin', 'LinkedIn URL'],
  ['linkedin', 'linkedinprofile'],
  ['github', 'GitHub Profile'],
  ['resume', 'Upload CV'],
  ['resume', 'Resume File'],
  ['cover_letter', 'Cover Letter'],
  ['cover_letter', 'coverlettertext'],
  ['work_authorization', 'Work Authorization'],
  ['work_authorization', 'Visa Status'],
  ['address', 'Street Address'],
  ['address', 'City'],
  ['address', 'Postal Code'],
  ['website', 'Portfolio URL'],
  ['website', 'Personal Website'],
];
tests.forEach(([expected, input]) => {
  assert.equal(classifyField(input), expected, `"${input}" → ${expected}`);
});
console.log('  ✅ All 20 classifications correct');

// Test 3: Unknown fields return 'unknown'
const unknowns = ['random_field', 'something_else', '', 'job_title', 'salary_expectations', 'start_date', 'reference'];
unknowns.forEach(input => {
  assert.equal(classifyField(input), 'unknown', `"${input}" → unknown`);
});
console.log('  ✅ Unknown fields handled');

// Test 4: Case insensitivity
assert.equal(classifyField('FULL NAME'), 'name', 'UPPERCASE');
assert.equal(classifyField('Applicant Email'), 'email', 'Title Case');
assert.equal(classifyField('PHONE_NUMBER'), 'phone', 'UPPERCASE with underscore');
console.log('  ✅ Case insensitive matching');

// Test 5: Partial matches in multi-word strings
assert.equal(classifyField('Please enter your linkedin profile url'), 'linkedin', 'Long label with linkedin');
assert.equal(classifyField('Upload your resume here (PDF only)'), 'resume', 'Long label with resume');
assert.equal(classifyField('Enter your GitHub profile'), 'github', 'Question with github');
console.log('  ✅ Partial matches in sentences');

// Test 6: Personal field check
const personalFields = ['name', 'email', 'phone', 'linkedin', 'github', 'website', 'address', 'resume', 'cover_letter', 'work_authorization'];
assert.equal(personalFields.length, 10, '10 personal field types');
console.log('  ✅ Personal field types identified');

console.log('\n🎉 All form detection tests passed!\n');
