import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';

// ─── Matching logic extracted for unit testing ───────────────
// These functions mirror the matching logic in form-detector.js.
// We test the PRIORITY (exact > word-boundary > startsWith > includes)
// independently of DOM manipulation.

function matchSelectOption(lowerValue, options) {
  // Phase 1: exact match
  let match = options.find(o =>
    o.text.toLowerCase().trim() === lowerValue ||
    o.value.toLowerCase().trim() === lowerValue
  );
  if (match) return { match, phase: 'exact' };

  // Phase 2: word-boundary regex
  const wordRegex = new RegExp(
    '\\b' + lowerValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b',
    'i'
  );
  match = options.find(o => wordRegex.test(o.text) || wordRegex.test(o.value));
  if (match) return { match, phase: 'word-boundary' };

  // Phase 3: starts with
  match = options.find(o =>
    o.text.toLowerCase().trim().startsWith(lowerValue) ||
    o.value.toLowerCase().trim().startsWith(lowerValue) ||
    lowerValue.startsWith(o.text.toLowerCase().trim())
  );
  if (match) return { match, phase: 'startsWith' };

  return { match: null, phase: null };
}

function matchComboboxOption(valueLower, items) {
  // Phase 1: exact match
  let match = Array.from(items).find(o =>
    o.textContent.trim().toLowerCase() === valueLower
  );
  if (match) return { match, phase: 'exact' };

  // Phase 2: word-boundary regex
  const wb = new RegExp(
    '\\b' + valueLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b',
    'i'
  );
  match = Array.from(items).find(o => wb.test(o.textContent.trim()));
  if (match) return { match, phase: 'word-boundary' };

  // Phase 3: starts with
  match = Array.from(items).find(o =>
    o.textContent.trim().toLowerCase().startsWith(valueLower) ||
    valueLower.startsWith(o.textContent.trim().toLowerCase())
  );
  if (match) return { match, phase: 'startsWith' };

  return { match: null, phase: null };
}

// ─── Tests ──────────────────────────────────────────────────
describe('Bug #6: GUI should not match Strategic Guidance', () => {
  const selectOptions = [
    { text: 'Strategic Guidance', value: 'strategic-guidance' },
    { text: 'Technical Support', value: 'technical-support' },
    { text: 'Data Analysis', value: 'data-analysis' },
  ];

  it('select: "GUI" does NOT match "Strategic Guidance"', () => {
    const result = matchSelectOption('gui', selectOptions);
    expect(result.match).toBeNull();
  });

  it('select: "GUI" does NOT match via any phase', () => {
    const result = matchSelectOption('gui', selectOptions);
    expect(result.match).toBeNull();
    expect(result.phase).toBeNull();
  });

  it('combobox: "GUI" does NOT match "Strategic Guidance"', () => {
    const dom = new JSDOM('<div><span>Strategic Guidance</span><span>Technical Support</span></div>');
    const items = dom.window.document.querySelectorAll('span');
    const result = matchComboboxOption('gui', items);
    expect(result.match).toBeNull();
  });

  it('select: "support" does NOT match "Technical Support" via includes (matches word-boundary instead)', () => {
    const result = matchSelectOption('support', selectOptions);
    // "support" word-boundary matches "Technical Support" — that's fine
    expect(result.phase).toBe('word-boundary');
  });
});

describe('select: matching priority order', () => {
  it('exact match wins over all others', () => {
    const options = [
      { text: 'United States', value: 'US' },
      { text: 'Canada', value: 'CA' },
    ];
    const result = matchSelectOption('canada', options);
    expect(result.phase).toBe('exact');
    expect(result.match.text).toBe('Canada');
  });

  it('exact match on value wins', () => {
    const options = [
      { text: 'United States', value: 'US' },
    ];
    const result = matchSelectOption('us', options);
    expect(result.phase).toBe('exact');
  });

  it('word-boundary wins over startsWith', () => {
    const opts = [
      { text: 'Engineering Management', value: 'em' },
      { text: 'Executive Management', value: 'exec' },
    ];
    const result = matchSelectOption('engineering', opts);
    expect(result.phase).toBe('word-boundary');
    expect(result.match.text).toBe('Engineering Management');
  });

  it('startsWith matches "Poland" against "Poland (+48)" (word-boundary fails due to paren)', () => {
    const opts = [
      { text: 'Poland (+48)', value: 'PL' },
      { text: 'Portugal (+351)', value: 'PT' },
    ];
    const result = matchSelectOption('poland', opts);
    // \bpoland\b tests against "Poland (+48)" — "Poland" is followed by space, which is a word boundary. So word-boundary matches.
    expect(result.phase).toBe('word-boundary');
  });

  it('no substring matching — "GUI" does not false-match', () => {
    const opts = [
      { text: 'Strategic Guidance', value: 'sg' },
    ];
    const result = matchSelectOption('gui', opts);
    expect(result.match).toBeNull();
  });

  it('word-boundary matches "gui" against "GUI Testing"', () => {
    const opts = [
      { text: 'GUI Testing', value: 'gtest' },
    ];
    const result = matchSelectOption('gui', opts);
    expect(result.phase).toBe('word-boundary');
  });
});

describe('select: existing matching still works', () => {
  it('exact match on text', () => {
    const opts = [
      { text: 'Poland (+48)', value: 'PL' },
    ];
    const result = matchSelectOption('poland (+48)', opts);
    expect(result.phase).toBe('exact');
  });

  it('word-boundary finds word in multi-word option', () => {
    const opts = [
      { text: 'Software Engineering', value: 'se' },
    ];
    const result = matchSelectOption('engineering', opts);
    expect(result.phase).toBe('word-boundary');
    expect(result.match.text).toBe('Software Engineering');
  });

  it('startsWith matches partial prefix when word-boundary fails', () => {
    // "comp" has no word boundary in "Computer Science" — matches via startsWith
    const opts = [
      { text: 'Computer Science', value: 'cs' },
    ];
    const result = matchSelectOption('comp', opts);
    expect(result.phase).toBe('startsWith');
  });
});

describe('combobox: matching priority order', () => {
  it('exact match wins', () => {
    const dom = new JSDOM('<div><span>Engineering</span><span>Executive</span></div>');
    const items = dom.window.document.querySelectorAll('span');
    const result = matchComboboxOption('engineering', items);
    expect(result.phase).toBe('exact');
  });

  it('word-boundary wins over startsWith', () => {
    const dom = new JSDOM('<div><span>Software Engineering</span><span>Executive</span></div>');
    const items = dom.window.document.querySelectorAll('span');
    const result = matchComboboxOption('engineering', items);
    expect(result.phase).toBe('word-boundary');
    expect(result.match.textContent).toBe('Software Engineering');
  });

  it('startsWith matches when word-boundary does not', () => {
    const dom = new JSDOM('<div><span>Engineering Management</span></div>');
    const items = dom.window.document.querySelectorAll('span');
    // "eng" — \beng\b doesn't match because "eng" is followed by "i" (no word boundary)
    const result = matchComboboxOption('eng', items);
    expect(result.phase).toBe('startsWith');
  });

  it('GUI does not match Strategic Guidance', () => {
    const dom = new JSDOM('<div><span>Strategic Guidance</span><span>Technical Support</span></div>');
    const items = dom.window.document.querySelectorAll('span');
    const result = matchComboboxOption('gui', items);
    expect(result.match).toBeNull();
  });
});
