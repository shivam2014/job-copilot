// PDF Text Extraction — wraps pdf.js for use in the options page
// Exposes: extractTextFromPDF(arrayBuffer) → Promise<string>

async function extractTextFromPDF(arrayBuffer) {
  // Set worker path
  const workerSrc = chrome.runtime.getURL('lib/pdfjs/pdf.worker.min.mjs');
  
  // We need to dynamically import pdf.js
  // Since it's an ES module, we use import()
  const moduleUrl = chrome.runtime.getURL('lib/pdfjs/pdf.min.mjs');
  
  const pdfjsLib = await import(moduleUrl);
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;
  
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let fullText = '';
  
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map(item => item.str).join(' ');
    fullText += pageText + '\n\n';
  }
  
  return fullText.trim();
}
