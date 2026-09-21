/**
 * Ekstraksi teks + koordinat dari PDF, versi browser.
 *
 * Keluarannya WAJIB identik dengan src/extract/pdf-node.js untuk file yang
 * sama — array `{page, x, y, str}` dengan urutan yang sama persis. Seluruh
 * parser berdiri di atas koordinat ini, jadi selisih sekecil apa pun antara
 * dua versi berarti hasil parsing di browser tidak bisa dipercaya.
 *
 * Bedanya dengan versi Node cuma satu: pdf.js di browser butuh web worker,
 * dan workernya di-bundel Vite lewat `?worker` supaya tidak ada permintaan
 * ke CDN. Tidak ada satu pun byte PDF yang meninggalkan perangkat.
 */
import * as pdfjs from 'pdfjs-dist/build/pdf.mjs';
import PdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?worker';

// workerPort, bukan workerSrc: workerSrc menuntut URL yang bisa diambil saat
// runtime, sementara ini instance worker yang sudah dibundel ikut aplikasi.
pdfjs.GlobalWorkerOptions.workerPort = new PdfWorker();

/**
 * @param {Uint8Array|ArrayBuffer} data  isi berkas PDF
 * @param {string} [password]            untuk statement terproteksi
 * @returns {Promise<Array<{page:number,x:number,y:number,str:string}>>}
 */
export async function extractItems(data, password) {
  // pdf.js MEMINDAHKAN buffer ke worker, bukan menyalinnya — setelah satu
  // panggilan, buffer milik pemanggil jadi detached dan byteLength-nya nol.
  // Itu mematikan alur yang paling penting untuk PDF terproteksi: percobaan
  // pertama gagal minta sandi, user mengetik sandinya, percobaan kedua tidak
  // punya data lagi. Jadi salinannya dibuat di sini, sekali per panggilan.
  const src = data instanceof Uint8Array ? data : new Uint8Array(data);
  const bytes = src.slice();
  const doc = await pdfjs.getDocument({ data: bytes, password, useSystemFonts: true }).promise;
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

/** Baca File dari <input type="file"> lalu ekstrak. */
export async function extractFromFile(file, password) {
  return extractItems(new Uint8Array(await file.arrayBuffer()), password);
}

/**
 * Bedakan PDF terproteksi dari PDF rusak.
 *
 * pdf.js melempar PasswordException untuk keduanya-beda-alasan: sandi belum
 * diberikan, atau sandi salah. UI perlu membedakannya supaya pesannya jujur —
 * "file ini minta sandi" dan "sandinya salah" adalah dua hal berbeda buat user.
 */
export function classifyError(err) {
  const name = err?.name ?? '';
  const code = err?.code;
  if (name === 'PasswordException') {
    return code === 1 ? 'butuh-sandi' : 'sandi-salah';
  }
  if (name === 'InvalidPDFException') return 'bukan-pdf';
  return 'gagal';
}
