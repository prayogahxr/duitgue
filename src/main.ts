/**
 * Layar unggah (Tahap 3).
 *
 * Tugasnya cuma menyambungkan berkas ke pipeline dan menampilkan hasilnya
 * apa adanya. Seluruh keputusan soal benar/salah ada di src/core/ingest.js —
 * di sini tidak ada satu pun aturan bisnis.
 */
import './style.css'
import { extractItems, classifyError } from './extract/pdf-browser.js'
import { ingest, rupiah } from './core/ingest.js'
import { simpanHasil, muatSemua, hapusSemua, simpanKoreksi, hapusKoreksi } from './storage/db.js'
import { cariCelah } from './core/gaps.js'
import { KATEGORI } from './core/categorize.js'
import { renderAnalitik } from './ui/analitik.js'
import { renderKoreksi } from './ui/koreksi.js'
import { renderProyeksi } from './ui/proyeksi.js'
import { amatiGerak } from './ui/gerak.js'
import { pasangNav, segarkanNav } from './ui/nav.js'

const form = document.querySelector<HTMLFormElement>('#form')!
const inputBerkas = document.querySelector<HTMLInputElement>('#berkas')!
const inputSandi = document.querySelector<HTMLInputElement>('#sandi')!
const blokSandi = document.querySelector<HTMLParagraphElement>('#sandi-blok')!
const zonaJatuh = document.querySelector<HTMLDivElement>('#jatuh')!
const elNamaBerkas = document.querySelector<HTMLSpanElement>('#nama-berkas')!
const elStatus = document.querySelector<HTMLDivElement>('#status')!
const elHasil = document.querySelector<HTMLDivElement>('#hasil')!
const elTersimpan = document.querySelector<HTMLDivElement>('#isi-tersimpan')!
const btnHapus = document.querySelector<HTMLButtonElement>('#hapus')!
const blokHapus = document.querySelector<HTMLParagraphElement>('.aksi-hapus')!
const spanKonfirmasi = document.querySelector<HTMLSpanElement>('#konfirmasi-hapus')!
const btnHapusYakin = document.querySelector<HTMLButtonElement>('#hapus-yakin')!
const btnHapusBatal = document.querySelector<HTMLButtonElement>('#hapus-batal')!
const elAnalitik = document.querySelector<HTMLElement>('#analitik')!
const elKoreksi = document.querySelector<HTMLElement>('#koreksi')!
const elProyeksi = document.querySelector<HTMLElement>('#proyeksi')!
const elSambutan = document.querySelector<HTMLElement>('#sambutan')!
const elLatar = document.querySelector<HTMLElement>('#latar-catur')!

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

// Getter UTC, bukan lokal: parser menyimpan tanggal cetak lewat Date.UTC,
// jadi komponen UTC yang benar. Dengan getter lokal, transaksi GoPay malam
// hari tampil sehari lebih maju daripada yang tertulis di statement.
const tanggal = (d: Date | null) =>
  d
    ? `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`
    : ''

/** Kalimat untuk tiap pemeriksaan yang gagal, lengkap dengan selisihnya. */
function jelaskanGagal(checks: any[]): string {
  return checks
    .filter((c) => !c.ok)
    .map((c) => {
      if (c.expected != null && c.actual != null) {
        const selisih = c.actual - c.expected
        // Jumlah transaksi dihitung per baris, bukan rupiah — jangan
        // diformat sebagai uang, nanti "3 transaksi" jadi "Rp0,03".
        const uang = !/^Jumlah transaksi/.test(c.name)
        const f = (n: number) => (uang ? rupiah(n) : String(n))
        return `${c.name}: seharusnya ${f(c.expected)}, terbaca ${f(c.actual)} (selisih ${f(selisih)})`
      }
      if (c.detail?.tx) {
        return `${c.name}: mulai meleset di ${tanggal(c.detail.tx.valueDate)} ${c.detail.tx.description ?? ''} — seharusnya ${rupiah(c.detail.expected)}, terbaca ${rupiah(c.detail.actual)}`
      }
      return c.name
    })
    .join('; ')
}

/**
 * Laporan unggahan barusan: satu baris per berkas, lolos atau ditolak.
 *
 * Tidak lagi menggambar timeline seluruh transaksi. 588 baris bukan sesuatu
 * yang dibaca orang, dan angka gabungannya sudah dijawab di panel analitik —
 * yang selalu digambar dari isi penyimpanan, bukan dari unggahan terakhir.
 * Koreksi kategori pindah ke daftar per merchant di `ui/koreksi.ts`, bentuk
 * yang memang cocok karena koreksinya disimpan per merchant.
 */
function render(hasil: any) {
  const b = hasil.berkas
    .map((f: any) => {
      const kelas = f.ok ? 'lulus' : 'gagal'
      let ket: string
      if (f.ok) {
        ket = `${f.checks.length} pemeriksaan lolos`
      } else if (f.alasan === 'sumber-tak-dikenali') {
        ket = 'Bukan mutasi BCA atau GoPay. Nggak dimasukin.'
      } else if (f.alasan === 'gagal-parse') {
        ket = `Nggak kebaca: ${esc(f.pesan)}. Nggak dimasukin.`
      } else {
        ket = `${jelaskanGagal(f.checks)}. Nggak dimasukin.`
      }
      const periode = f.periode?.month ? `${f.periode.month}/${f.periode.year}` : ''
      return `<tr class="${kelas}">
        <td>${esc(f.nama)}</td>
        <td>${esc(f.sumber ?? 'tidak dikenali')}</td>
        <td>${esc(periode)}</td>
        <td>${f.ok ? 'Lulus' : 'Ditolak'}</td>
        <td class="angka">${f.ok ? f.transactions.length : 0}</td>
        <td>${ket}</td>
      </tr>`
    })
    .join('')

  const r = hasil.ringkasan

  // Saat halaman baru dimuat belum ada unggahan — yang ada cuma isi
  // penyimpanan. Blok laporan unggahan disembunyikan, bukan diisi angka nol
  // yang membuat seolah barusan ada unggahan kosong.
  if (!r) {
    elHasil.innerHTML = ''
    return
  }

  // Dilipat, dan terbuka sendiri karena unggahannya memang baru saja terjadi.
  // Laporan per berkas penting saat ada yang ditolak, tapi tidak perlu ikut
  // memanjangkan halaman setiap kali dibuka lagi nanti.
  elHasil.innerHTML = `
    <details open>
    <summary>Hasil barusan</summary>
    <div class="bungkus"><table>
      <thead><tr><th>Berkas</th><th>Sumber</th><th>Periode</th><th>Validasi</th><th>Transaksi</th><th>Keterangan</th></tr></thead>
      <tbody>${b}</tbody>
    </table></div>

    <ul>
      <li>${r.jumlahTransaksi} transaksi</li>
      <li>${r.pasangan} pindah kantong kepasangan, biaya ${rupiah(r.biayaAdmin)}</li>
      <li>Masuk ${rupiah(r.uangMasuk)}, keluar ${rupiah(r.pengeluaranNyata)}</li>
    </ul>
    </details>`
}

/** Nama berkas yang terpilih, karena input aslinya tidak terlihat lagi. */
function tulisNamaBerkas() {
  const f = Array.from(inputBerkas.files ?? [])
  elNamaBerkas.textContent = !f.length
    ? 'atau tarik ke sini'
    : f.length === 1
      ? f[0].name
      : `${f.length} berkas`
}
inputBerkas.addEventListener('change', tulisNamaBerkas)

// Seret-lepas. Tanpa preventDefault di dragover, browser membuka PDF-nya di
// tab dan halaman ini hilang beserta datanya yang belum dibaca.
for (const ev of ['dragenter', 'dragover'] as const) {
  zonaJatuh.addEventListener(ev, (e) => {
    e.preventDefault()
    zonaJatuh.classList.add('siap')
  })
}
for (const ev of ['dragleave', 'drop'] as const) {
  zonaJatuh.addEventListener(ev, () => zonaJatuh.classList.remove('siap'))
}
zonaJatuh.addEventListener('drop', (e) => {
  e.preventDefault()
  const pdf = Array.from(e.dataTransfer?.files ?? []).filter(
    (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name),
  )
  if (!pdf.length) {
    elStatus.textContent = 'Itu bukan PDF.'
    return
  }
  // Satu-satunya cara mengisi input file dari kode.
  const dt = new DataTransfer()
  for (const f of pdf) dt.items.add(f)
  inputBerkas.files = dt.files
  tulisNamaBerkas()
})

// Satu penangan untuk seluruh tabel, dipasang sekali. Tabelnya digambar ulang
// tiap koreksi, jadi memasang penangan per <select> akan menumpuk.
document.addEventListener('change', async (e) => {
  const el = e.target as HTMLSelectElement
  if (!el || !el.classList || !el.classList.contains('kategori')) return

  const kunci = el.dataset.kunci!
  if (el.value === '__auto__') {
    await hapusKoreksi(kunci)
    elStatus.textContent = `Koreksi ${kunci} dicabut, balik ke aturan otomatis.`
  } else {
    const k = KATEGORI.find((x: any) => x.id === el.value)!
    await simpanKoreksi(kunci, k.id, k.label)
    elStatus.textContent = `${kunci} masuk "${k.label}". Semua transaksinya ikut kebenerin.`
  }

  await gambarTersimpan()

  // Tabelnya digambar ulang, jadi barisnya elemen baru — dicari lagi lewat
  // kuncinya, bukan disimpan referensinya.
  const baris = document
    .querySelector(`.kategori[data-kunci="${CSS.escape(kunci)}"]`)
    ?.closest('tr')
  baris?.classList.add('dikedipkan')
})

/**
 * Gambar ulang panel "data tersimpan" langsung dari IndexedDB.
 *
 * Selalu dibaca dari penyimpanan, tidak pernah dari hasil unggahan terakhir.
 * Kalau dua-duanya jadi sumber kebenaran, angka di layar bisa berbeda dari
 * angka yang benar-benar tersimpan dan tidak ada yang sadar.
 */
async function gambarTersimpan() {
  const { transactions, uploads } = await muatSemua()

  // Analitik selalu digambar dari isi penyimpanan yang sama dengan panel ini,
  // jadi angkanya tidak bisa berbeda dari yang benar-benar tersimpan.
  const ringkasan = renderAnalitik(elAnalitik, transactions, uploads)
  renderProyeksi(elProyeksi, ringkasan)
  renderKoreksi(elKoreksi, transactions)

  // Blok yang baru digambar ikut diamati, kalau tidak yang muncul setelah
  // unggahan akan berdiri diam sementara sisanya bergeser.
  amatiGerak(elAnalitik)
  amatiGerak(elProyeksi)
  amatiGerak(elKoreksi)

  // Tautan seksi ikut menyesuaikan: yang seksinya masih kosong tetap
  // disembunyikan.
  segarkanNav()

  // Blok sambutan cuma berguna selama layar masih kosong. Begitu ada angka,
  // kalimat perkenalan malah mendorong angkanya turun dari layar pertama.
  elSambutan.hidden = transactions.length > 0
  // Latar bergerak baru dipasang setelah ada isinya.
  elLatar.hidden = transactions.length === 0

  // Tidak ada gunanya menawarkan "hapus semua" saat belum ada apa-apa.
  blokHapus.hidden = !uploads.length

  if (!uploads.length) {
    elTersimpan.innerHTML =
      '<p class="sekunder">Masih kosong. Masukin statement dulu, nanti angkanya muncul sendiri.</p>'
    return { transactions, uploads }
  }

  const celah = cariCelah(uploads)
  const perBulan = uploads
    .map(
      (u: any) => `<tr>
        <td>${esc(u.accountId)}</td>
        <td>${esc(u.month)}/${esc(u.year)}</td>
        <td class="angka">${u.jumlahTransaksi}</td>
        <td class="angka">${u.openingBalance == null ? 'tidak dicetak' : rupiah(u.openingBalance)}</td>
        <td class="angka">${u.closingBalance == null ? 'tidak dicetak' : rupiah(u.closingBalance)}</td>
        <td>${esc(u.nama)}</td>
      </tr>`,
    )
    .join('')

  const blokCelah = celah.length
    ? `<h3>Ada yang bolong</h3><ul>${celah
        .map(
          (c: any) =>
            `<li>${esc(c.pesan)}${c.selisih != null ? ` Selisihnya ${esc(rupiah(c.selisih))}.` : ''}</li>`,
        )
        .join('')}</ul>`
    : '<p class="sekunder">Bulan-bulannya nyambung, nggak ada yang bolong.</p>'

  elTersimpan.innerHTML = `
    <p>${transactions.length} transaksi dari ${uploads.length} statement.</p>
    <div class="bungkus"><table>
      <thead><tr><th>Sumber</th><th>Periode</th><th>Transaksi</th><th>Saldo awal</th><th>Saldo akhir</th><th>Berkas</th></tr></thead>
      <tbody>${perBulan}</tbody>
    </table></div>
    ${blokCelah}`

  return { transactions, uploads }
}

btnHapus.addEventListener('click', () => {
  spanKonfirmasi.hidden = false
  btnHapus.disabled = true
})
btnHapusBatal.addEventListener('click', () => {
  spanKonfirmasi.hidden = true
  btnHapus.disabled = false
})
btnHapusYakin.addEventListener('click', async () => {
  await hapusSemua()
  spanKonfirmasi.hidden = true
  btnHapus.disabled = false
  elHasil.innerHTML = ''
  elStatus.textContent = 'Udah bersih.'
  await gambarTersimpan()
})

form.addEventListener('submit', async (e) => {
  e.preventDefault()
  const files = Array.from(inputBerkas.files ?? [])
  if (!files.length) {
    elStatus.textContent = 'Belum ada berkas yang dipilih.'
    return
  }

  const sandi = inputSandi.value || undefined
  elStatus.textContent = `Lagi baca ${files.length} berkas…`
  elHasil.innerHTML = ''

  const terbaca: Array<{ nama: string; items: any[] }> = []
  const gagalBaca: Array<{ nama: string; sebab: string }> = []
  let adaYangMintaSandi = false

  for (const f of files) {
    // Byte-nya dibaca ulang tiap berkas dan tidak pernah dipakai bersama:
    // extractItems menyalin sendiri, tapi menahan satu buffer besar untuk
    // semua berkas tidak ada gunanya.
    try {
      const items = await extractItems(new Uint8Array(await f.arrayBuffer()), sandi)
      terbaca.push({ nama: f.name, items })
    } catch (err) {
      const jenis = classifyError(err)
      if (jenis === 'butuh-sandi' || jenis === 'sandi-salah') adaYangMintaSandi = true
      gagalBaca.push({
        nama: f.name,
        sebab:
          jenis === 'butuh-sandi'
            ? 'berkas ini terkunci dan butuh sandi'
            : jenis === 'sandi-salah'
              ? 'sandi yang dimasukkan tidak cocok'
              : jenis === 'bukan-pdf'
                ? 'berkas ini bukan PDF yang bisa dibaca'
                : 'berkas gagal dibuka',
      })
    }
  }

  // Field sandi baru muncul kalau memang ada yang memintanya — layar unggah
  // tidak perlu menampilkan kolom yang mayoritas berkas tidak butuh.
  blokSandi.hidden = !adaYangMintaSandi
  if (adaYangMintaSandi) inputSandi.focus()

  const hasil = await ingest(terbaca)
  for (const g of gagalBaca) {
    hasil.berkas.unshift({ nama: g.nama, sumber: null, ok: false, alasan: 'gagal-parse', pesan: g.sebab, checks: [], transactions: [] })
  }
  hasil.ringkasan.fileDitolak = hasil.berkas.filter((f: any) => !f.ok).length

  const simpan = await simpanHasil(hasil)
  const tersimpan = await gambarTersimpan()

  elStatus.textContent =
    `${hasil.ringkasan.fileLolos} masuk, ${hasil.ringkasan.fileDitolak} ditolak. ` +
    `${simpan.ditambah} transaksi baru, ${simpan.dilewati} udah ada. ` +
    `Total ${tersimpan!.transactions.length}.` +
    (adaYangMintaSandi ? ' Ada yang dikunci — isi sandinya, baca ulang.' : '')
  render(hasil)
})

// Data yang sudah tersimpan ditampilkan sebelum user menyentuh apa pun —
// itu yang membuat "datanya bertahan" terlihat, bukan cuma diklaim.
gambarTersimpan().then((t) => {
  if (t && t.transactions.length) {
    elStatus.textContent = `${t.transactions.length} transaksi udah kesimpan.`
  }
})

amatiGerak()

pasangNav()
