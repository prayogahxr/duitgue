/**
 * Pemeriksaan perangkat.
 *
 * Ada sebab-sebab kegagalan yang tidak bisa dilihat dari berkasnya: mesin
 * PDF yang gagal dijalankan, penyimpanan yang ditolak browser, atau fungsi
 * kripto yang cuma ada di koneksi aman. Semuanya berakhir sebagai "berkas
 * gagal dibaca", dan dari layar tidak ada bedanya dengan berkas yang memang
 * salah.
 *
 * Berkas ini menjawabnya dengan menguji perangkatnya sendiri — bukan
 * berkas user. PDF yang dipakai buatan sendiri, ditulis di sini, empat baris
 * teks. Kalau PDF ini pun gagal dibaca, masalahnya bukan di statement siapa
 * pun.
 *
 * Yang dilaporkan tidak memuat satu pun isi statement, jadi aman
 * di-screenshot dan dikirim ke orang lain saat minta bantuan.
 */
import { extractItems } from '../extract/pdf-browser.js'

/** PDF terkecil yang masih sah dan punya teks. Sengaja ditulis di sini. */
function pdfContoh(): Uint8Array {
  const isi = 'BT /F1 12 Tf 40 700 Td (UJI BACA PDF) Tj ET'
  const teks =
    '%PDF-1.4\n' +
    '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]' +
    '/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>endobj\n' +
    '4 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n' +
    `5 0 obj<</Length ${isi.length}>>stream\n${isi}\nendstream\nendobj\n` +
    'trailer<</Root 1 0 R/Size 6>>\n%%EOF'
  return new TextEncoder().encode(teks)
}

const ada = (b: boolean) => (b ? 'ada' : 'TIDAK ADA')

function dukungan() {
  let idb = false
  try {
    idb = !!indexedDB
  } catch {
    // Safari mode private melempar saat indexedDB disentuh.
  }
  return [
    ['Web Worker', ada(typeof Worker !== 'undefined')],
    ['Kripto (SHA-256)', ada(!!globalThis.crypto?.subtle)],
    ['Penyimpanan lokal', ada(idb)],
    ['Koneksi aman', ada(globalThis.isSecureContext)],
  ] as Array<[string, string]>
}

export function pasangPeriksa(el: HTMLElement) {
  el.innerHTML = `
    <details class="periksa">
      <summary>Ada masalah baca berkas? Uji perangkat</summary>
      <p class="sekunder">Ini menguji perangkatmu pakai PDF buatan sendiri, bukan statement-mu.
      Hasilnya tidak memuat isi berkas apa pun.</p>
      <p><button id="uji-pdf" type="button">Uji baca PDF</button></p>
      <div id="hasil-uji"></div>
    </details>`

  const tombol = el.querySelector<HTMLButtonElement>('#uji-pdf')!
  const hasil = el.querySelector<HTMLDivElement>('#hasil-uji')!

  tombol.addEventListener('click', async () => {
    tombol.disabled = true
    hasil.innerHTML = '<p>Sedang menguji…</p>'

    let baris = ''
    const mulai = performance.now()
    try {
      const items = await extractItems(pdfContoh())
      const lama = Math.round(performance.now() - mulai)
      baris =
        items.length > 0
          ? `<p><strong>Mesin PDF jalan.</strong> ${items.length} potongan teks dalam ${lama} ms.
             Kalau statement-mu tetap ditolak, masalahnya ada di berkasnya, bukan di perangkat ini.</p>`
          : `<p><strong>Mesin PDF jalan tapi tidak menghasilkan teks.</strong> Ini kelainan —
             tolong laporkan.</p>`
    } catch (e: any) {
      // Nama dan pesan errornya dibawa apa adanya. Inilah satu-satunya
      // keterangan yang berguna untuk perangkat yang tidak bisa dibuka
      // pengembangnya.
      baris = `<p><strong>Mesin PDF gagal jalan di perangkat ini.</strong></p>
        <p class="angka">${String(e?.name ?? 'Error')}: ${String(e?.message ?? e).slice(0, 200)}</p>`
    }

    const tabel = dukungan()
      .map(([n, v]) => `<tr><td>${n}</td><td>${v}</td></tr>`)
      .join('')

    hasil.innerHTML = `${baris}
      <div class="bungkus"><table><tbody>${tabel}
        <tr><td>Browser</td><td class="sekunder">${navigator.userAgent.slice(0, 120)}</td></tr>
      </tbody></table></div>`
    tombol.disabled = false
  })
}
