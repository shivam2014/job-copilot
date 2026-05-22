// PDF Text Extraction — used by options page
// pdf.js imported dynamically from local path

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

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const tc = await page.getTextContent();
    fullText += tc.items.map(item => item.str).join(' ') + '\n\n';
  }

  return fullText.trim();
}

// Also expose globally for non-module scripts
if (typeof window !== 'undefined') {
  window.extractTextFromPDF = extractTextFromPDF;
}
