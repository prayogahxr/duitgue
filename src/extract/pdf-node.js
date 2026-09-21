// Ekstraksi item teks + koordinat dari PDF (versi Node, untuk testing).
// Di browser, ganti import ini dengan pdfjs-dist/build/pdf.mjs + worker.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

export async function extractItems(data, password) {
  const doc = await pdfjs.getDocument({ data, password, useSystemFonts: true }).promise;
  const items = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    for (const it of tc.items) {
      if (!it.str) continue;
      const [, , , , x, y] = it.transform;
      items.push({ page: p, x, y, str: it.str });
    }
  }
  return items;
}
