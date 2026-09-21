/**
 * Daftar merchant + koreksi kategori.
 *
 * Menggantikan timeline gabungan yang dulu menampilkan seluruh transaksi.
 * 588 baris bukan sesuatu yang dibaca orang, dan koreksi kategori memang
 * disimpan PER MERCHANT (lihat src/core/merchant.js), bukan per transaksi —
 * jadi satu baris per merchant adalah bentuk yang sebenarnya cocok dengan
 * cara kerjanya. 588 transaksi menyusut jadi sekitar 150 merchant, dan yang
 * benar-benar butuh perhatian jauh lebih sedikit lagi.
 *
 * Bawaannya hanya menampilkan yang belum terkategori, karena itu satu-satunya
 * bagian yang menunggu keputusan user. Sisanya ada di balik satu centang.
 */
import { merchantKey } from '../core/merchant.js'
import { KATEGORI } from '../core/categorize.js'
import { rupiah } from '../core/ingest.js'

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

/** Bertahan antar penggambaran ulang, supaya centangnya tidak balik sendiri. */
let tampilkanSemua = false

type Baris = {
  kunci: string
  contoh: string
  n: number
  keluar: number
  masuk: number
  category: string
  categoryLabel: string
  dikoreksi: boolean
  sumber: Set<string>
}

function kelompokkan(transaksi: any[]): Baris[] {
  const peta = new Map<string, Baris>()
  for (const t of transaksi) {
    const kunci = merchantKey(t)
    if (!kunci) continue
    let b = peta.get(kunci)
    if (!b) {
      b = {
        kunci,
        contoh: t.description || t.type || kunci,
        n: 0,
        keluar: 0,
        masuk: 0,
        category: t.category ?? 'other',
        categoryLabel: t.categoryLabel ?? 'Belum terkategori',
        dikoreksi: !!t.dikoreksi,
        sumber: new Set<string>(),
      }
      peta.set(kunci, b)
    }
    b.n++
    b.sumber.add(t.accountId)
    if (t.amountCents < 0) b.keluar += -t.amountCents
    else b.masuk += t.amountCents
    // Kategori diambil dari transaksi mana pun di kelompok ini: koreksi
    // berlaku per merchant, jadi seluruh anggotanya pasti sama.
    if (t.dikoreksi) b.dikoreksi = true
  }
  return [...peta.values()].sort((a, b) => b.keluar - a.keluar || b.masuk - a.masuk)
}

function selectKategori(b: Baris): string {
  const opsi = KATEGORI.map(
    (k: any) =>
      `<option value="${esc(k.id)}"${k.id === b.category ? ' selected' : ''}>${esc(k.label)}</option>`,
  ).join('')
  return (
    `<select class="kategori" data-kunci="${esc(b.kunci)}" ` +
    `aria-label="Kategori untuk ${esc(b.kunci)}" ` +
    `title="Berlaku buat ${b.n} transaksi dari ${esc(b.kunci)}, termasuk yang nanti">` +
    opsi +
    `<option value="__auto__">— balik ke aturan otomatis —</option>` +
    `</select>`
  )
}

export function renderKoreksi(el: HTMLElement, transaksi: any[]) {
  if (!transaksi.length) {
    el.innerHTML = ''
    return
  }

  const semua = kelompokkan(transaksi)
  const belum = semua.filter((b) => b.category === 'other')
  const tampil = tampilkanSemua ? semua : belum

  const baris = tampil
    .map(
      (b) => `<tr>
        <td>
          ${esc(b.kunci)}
          ${b.dikoreksi ? '<small class="ditandai">dikoreksi</small>' : ''}
          <br /><small class="sekunder">${esc(b.contoh.slice(0, 64))}</small>
        </td>
        <td class="angka">${b.n}</td>
        <td class="angka">${b.keluar ? esc(rupiah(b.keluar)) : '—'}</td>
        <td>${selectKategori(b)}</td>
      </tr>`,
    )
    .join('')

  el.innerHTML = `
    <img class="hias hias-panah el-panah" src="./gambar/elemen-7.png" alt="" aria-hidden="true" />
    <h2>Kategori</h2>
    <p>
      ${belum.length
        ? `${belum.length} dari ${semua.length} merchant belum ada kategorinya.
           Benerin satu merchant, semua transaksinya ikut kebenerin — termasuk yang
           bakal diunggah bulan depan.`
        : `Semua ${semua.length} merchant udah ada kategorinya.`}
    </p>
    <p>
      <label class="centang">
        <input type="checkbox" id="tampil-semua"${tampilkanSemua ? ' checked' : ''} />
        Tampilin semuanya
      </label>
    </p>
    ${
      tampil.length
        ? `<div class="bungkus gulir"><table>
             <thead><tr>
               <th>Merchant</th><th class="angka">Transaksi</th>
               <th class="angka">Keluar</th><th>Kategori</th>
             </tr></thead>
             <tbody>${baris}</tbody>
           </table></div>`
        : `<p class="sekunder">Nggak ada yang perlu dibenerin.</p>`
    }`

  const centang = el.querySelector<HTMLInputElement>('#tampil-semua')
  if (centang) {
    centang.addEventListener('change', () => {
      tampilkanSemua = centang.checked
      renderKoreksi(el, transaksi)
    })
  }
}
