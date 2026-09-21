/**
 * Tampilan analitik (Tahap 8).
 *
 * Tidak menghitung apa pun. Seluruh angka datang dari
 * `src/analytics/summary.js`; berkas ini hanya memutuskan urutannya di layar
 * dan kalimat yang menemaninya.
 *
 * Urutannya disengaja: satu angka besar lebih dulu, lalu hal yang paling
 * gampang membuat angka itu salah dibaca — uang yang pindah ke kantong yang
 * statement-nya belum diunggah. Sisanya menyusul dengan tenang.
 */
import { analitik, MINIMAL_BULAN } from '../analytics/summary.js'
import { rupiah } from '../core/ingest.js'

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

/** Bertanda: untuk angka yang berdiri sendiri dan arahnya penting. */
const persen = (n: number, digit = 1) =>
  (n > 0 ? '+' : '') + n.toFixed(digit).replace('.', ',') + '%'

/** Tanpa tanda: untuk angka yang arahnya sudah disebut kata "naik"/"turun". */
const persenPolos = (n: number, digit = 1) =>
  Math.abs(n).toFixed(digit).replace('.', ',') + '%'

/** Selisih dua persentase adalah POIN persen, bukan persen. */
const poin = (n: number, digit = 1) =>
  Math.abs(n).toFixed(digit).replace('.', ',') + ' poin persen'

const angka = (n: number) => (n < 0 ? ' class="angka negatif"' : ' class="angka"')

/** Mengembalikan ringkasannya supaya proyeksi memakai hitungan yang sama
 *  persis, bukan memanggil `analitik()` untuk kedua kalinya. */
export function renderAnalitik(el: HTMLElement, transaksi: any[], uploads: any[]) {
  if (!transaksi.length) {
    el.innerHTML = ''
    return null
  }

  const a: any = analitik(transaksi, uploads)
  const b: any = a.bulanTerakhir ?? a.bulanan[a.bulanan.length - 1]

  // --- Angka utama. Telanjang, tanpa kartu dan tanpa bingkai. -------------
  const sr: number | null = b ? b.savingsRate : null
  const utama =
    sr == null
      ? `<span class="nilai">—</span>
         <p class="keterangan">Nggak ada pemasukan di ${esc(b ? b.label : 'bulan ini')}.</p>`
      : `<span class="nilai${sr < 0 ? ' negatif' : ''}">${esc(persen(sr))}</span>
         <p class="keterangan">${esc(b.label)} nggak abis.
         Masuk ${esc(rupiah(b.uangMasuk))}, keluar ${esc(rupiah(b.pengeluaran))},
         ${sr < 0 ? 'kurang' : 'sisa'} ${esc(rupiah(Math.abs(b.sisa)))}.</p>`

  // --- Yang belum terlihat: status kelas satu, bukan nol. ----------------
  const bt = a.belumTerlihat
  const blokBelum = bt.total
    ? `<div class="belum">
         <h3>Rinciannya belum kelihatan</h3>
         <p>${esc(rupiah(bt.total))} pindah ke kantong yang statement-nya belum masuk.
         Tetap kehitung keluar, tapi dipake buat apa belum ketahuan. Masukin statement
         kantong itu, rinciannya langsung nongol.</p>
         <div class="bungkus"><table>
           <thead><tr><th>Pindah ke</th><th class="angka">Jumlah</th></tr></thead>
           <tbody>${bt.perKanal
             .map(
               (k: any) =>
                 `<tr><td class="tanda-belum">${esc(k.kanal)}</td><td class="angka">${esc(rupiah(k.jumlah))}</td></tr>`,
             )
             .join('')}</tbody>
         </table></div>
       </div>`
    : ''

  const blokCukup = a.cukupData
    ? ''
    : `<div class="catatan"><p>Baru ${a.jumlahBulanPenuh} bulan penuh. Tahan berapa lama sama
       tren butuh ${MINIMAL_BULAN} bulan, jadi belum ditampilin. Angka per bulan tetap bener.</p></div>`

  // --- Deret angka pendukung. ---------------------------------------------
  // Dulu tiap metrik punya judul dan paragrafnya sendiri, dan halaman jadi
  // panjang untuk isi yang sebenarnya cuma empat angka. Sekarang keempatnya
  // sebaris; kalimat penjelasnya tetap ada, cuma turun jadi baris kecil di
  // bawah angkanya. Tidak ada informasi yang hilang, cuma jaraknya.
  const stat = (label: string, nilai: string, ket: string, kelas = '') =>
    `<div class="stat${kelas ? ' ' + kelas : ''}">
       <span class="label">${label}</span>
       <span class="besar">${nilai}</span>
       <small>${ket}</small>
     </div>`

  const kartuRunway = a.runwayBulan
    ? stat(
        'Tahan berapa lama tanpa pemasukan',
        `${esc(a.runwayBulan.toFixed(1).replace('.', ','))} bulan`,
        `${esc(rupiah(a.saldoTerlihat))} dibagi rata-rata keluar
         ${esc(rupiah(Math.round(a.saldoTerlihat / a.runwayBulan)))} sebulan.` +
          (a.akunTanpaSaldo.length
            ? ` Saldo ${esc(a.akunTanpaSaldo.join(', '))} nggak dicetak, jadi nggak ikut.`
            : ''),
      )
    : ''

  const c = a.creep
  const kartuCreep = c
    ? stat(
        c.selisih > 0 ? 'Pengeluaran naik lebih kencang' : 'Pemasukan naik lebih kencang',
        esc(poin(c.selisih)),
        `${esc(c.dari)} ke ${esc(c.sampai)}: keluar
         ${c.pengeluaran >= 0 ? 'naik' : 'turun'} ${esc(persenPolos(c.pengeluaran))},
         masuk ${c.pemasukan >= 0 ? 'naik' : 'turun'} ${esc(persenPolos(c.pemasukan))}.
         Dari ${c.titikData} bulan, jadi ini arah kasarnya doang.`,
        c.selisih > 0 ? 'tandai' : '',
      )
    : ''

  const kartuBulan = b
    ? stat(
        `Keluar ${esc(b.label)}`,
        esc(rupiah(b.pengeluaran)),
        `Dari ${esc(rupiah(b.uangMasuk))} yang masuk. Totalnya
         ${esc(rupiah(a.total.pengeluaran))} dari ${a.bulanan.length} bulan.`,
      )
    : ''

  const kartuSaldo = a.saldoTerlihat
    ? stat(
        'Saldo yang kelihatan',
        esc(rupiah(a.saldoTerlihat)),
        `Saldo akhir dari statement paling baru tiap akun.`,
      )
    : ''

  const deretStat = [kartuBulan, kartuSaldo, kartuRunway, kartuCreep].filter(Boolean).join('')
  const blokStat = deretStat ? `<div class="statistik">${deretStat}</div>` : ''

  const barisBulan = a.bulanan
    .map(
      (m: any) => `<tr>
        <td>${esc(m.label)}${m.lengkap ? '' : ' <small class="tanda-belum">sepotong</small>'}</td>
        <td class="angka">${esc(rupiah(m.uangMasuk))}</td>
        <td class="angka">${esc(rupiah(m.pengeluaran))}</td>
        <td${angka(m.sisa)}>${esc(rupiah(m.sisa))}</td>
        <td${angka(m.savingsRate == null ? 0 : m.savingsRate)}>${m.savingsRate == null ? '—' : esc(persen(m.savingsRate))}</td>
        <td class="angka">${m.belumTerlihat ? esc(rupiah(m.belumTerlihat)) : '—'}</td>
      </tr>`,
    )
    .join('')

  const kepalaNet = a.netWorth.length
    ? a.netWorth[a.netWorth.length - 1].perAkun
        .map((x: any) => `<th class="angka">${esc(x.accountId)}</th>`)
        .join('')
    : ''
  const barisNet = a.netWorth
    .map(
      (n: any) => `<tr>
        <td>${esc(n.label)}</td>
        ${n.perAkun.map((x: any) => `<td class="angka">${esc(rupiah(x.saldo))}</td>`).join('')}
        <td class="angka">${esc(rupiah(n.total))}</td>
      </tr>`,
    )
    .join('')

  const maks = a.perKategori.length ? a.perKategori[0].jumlah : 1
  const barisKategori = a.perKategori
    .map(
      (k: any) => `<tr>
        <td>${esc(k.label)}</td>
        <td class="angka">${esc(rupiah(k.jumlah))}</td>
        <td class="angka">${k.n}</td>
        <td style="width:32%"><span class="batang" style="width:${((k.jumlah / maks) * 100).toFixed(1)}%"></span></td>
      </tr>`,
    )
    .join('')

  // Urutannya: satu angka besar, deret angka pendukung, hal yang bisa membuat
  // angka itu salah dibaca, lalu rincian kategori. Dua tabel terakhir — per
  // bulan dan saldo akhir — dilipat: isinya benar dan tetap ada, tapi bukan
  // yang dibaca tiap kali halaman dibuka, dan membiarkannya terbentang membuat
  // sisanya harus digulir untuk dilihat.
  el.innerHTML = `
    <div class="utama">${utama}</div>
    ${blokStat}
    ${blokBelum}
    ${blokCukup}

    <h3>Keluar buat apa aja</h3>
    <div class="bungkus"><table>
      <thead><tr><th>Kategori</th><th class="angka">Jumlah</th><th class="angka">Transaksi</th><th></th></tr></thead>
      <tbody>${barisKategori}</tbody>
    </table></div>
    <p class="sekunder">Pindah kantong yang kepasangan udah dikeluarin. Kategori +
    ${esc(rupiah(a.belumTerlihat.total))} yang belum kelihatan = ${esc(rupiah(a.total.pengeluaran))}.</p>

    <details>
    <summary>Rincian per bulan</summary>
    <div class="bungkus"><table>
      <thead><tr>
        <th>Bulan</th><th class="angka">Masuk</th><th class="angka">Keluar</th>
        <th class="angka">Sisa</th><th class="angka">Nggak abis</th><th class="angka">Belum kelihatan</th>
      </tr></thead>
      <tbody>${barisBulan}</tbody>
      <tfoot><tr>
        <td>Semuanya</td>
        <td class="angka">${esc(rupiah(a.total.uangMasuk))}</td>
        <td class="angka">${esc(rupiah(a.total.pengeluaran))}</td>
        <td${angka(a.total.sisa)}>${esc(rupiah(a.total.sisa))}</td>
        <td${angka(a.total.savingsRate == null ? 0 : a.total.savingsRate)}>${
          a.total.savingsRate == null ? '—' : esc(persen(a.total.savingsRate))
        }</td>
        <td class="angka">${esc(rupiah(a.belumTerlihat.total))}</td>
      </tr></tfoot>
    </table></div>
    </details>

    ${
      a.netWorth.length
        ? `<details>
             <summary>Saldo tiap akhir bulan</summary>
             <div class="bungkus"><table>
               <thead><tr><th>Bulan</th>${kepalaNet}<th class="angka">Total kelihatan</th></tr></thead>
               <tbody>${barisNet}</tbody>
             </table></div>
           </details>`
        : ''
    }`

  return a
}
