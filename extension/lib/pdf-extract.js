// PDF Text Extraction — used by options page
// Also extracts hyperlinks (URLs) from PDF annotations

let pdfjsLib = null;
const WORKER_URL = chrome.runtime.getURL('lib/pdfjs/pdf.worker.min.mjs');
const PDFJS_URL = chrome.runtime.getURL('lib/pdfjs/pdf.min.mjs');

export async function extractTextFromPDF(arrayBuffer) {
  if (!pdfjsLib) {
    pdfjsLib = await import(PDFJS_URL);
    pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER_URL;
  }

  const data = new Uint8Array(arrayBuffer);
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  let fullText = '';
  let allLinks = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    
    // Extract text
    const tc = await page.getTextContent();
    fullText += tc.items.map(item => item.str).join(' ') + '\n\n';
    
    // Extract links (annotations)
    try {
      const annotations = await page.getAnnotations();
      for (const ann of annotations) {
        if (ann.subtype === 'Link' && ann.url) {
          // Find the text that this link corresponds to
          const linkText = ann.title || '';
          allLinks.push({ url: ann.url, text: linkText });
        }
      }
    } catch(e) {
      // Some PDFs don't support annotation extraction
    }
  }

  fullText = fullText.trim();
  
  // Append links to the text so the LLM can use them
  if (allLinks.length > 0) {
    fullText += '\n\n=== LINKS ===\n';
    const seen = new Set();
    for (const link of allLinks) {
      if (!seen.has(link.url)) {
        seen.add(link.url);
        fullText += link.url + '\n';
      }
    }
  }

  return fullText;
}

// Also expose globally for non-module scripts
if (typeof window !== 'undefined') {
  window.extractTextFromPDF = extractTextFromPDF;
}
