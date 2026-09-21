# Dashboard Finansial

Dashboard keuangan pribadi yang berjalan dari **statement yang diunggah**,
bukan dari pencatatan transaksi harian.

Unggah mutasi BCA dan GoPay sekali, dan aplikasi menghitung sendiri ke mana
uangnya pergi — termasuk memisahkan pemindahan antar-kantong dari belanja
yang sebenarnya.

**Semua diproses di browser.** Tidak ada server, tidak ada unggahan ke mana
pun. Data transaksi tidak pernah keluar dari perangkat.

## Status

Lapisan data sudah selesai dan tervalidasi terhadap statement asli
(Juni, Juli, Agustus 2026). Lapisan antarmuka belum dibangun.

| Modul | Status |
|---|---|
| Parser BCA | Selesai — 3 bulan, 6 pemeriksaan lolos |
| Parser GoPay | Selesai — 3 bulan, kedua total cocok |
| Validasi saldo | Selesai |
| Deduplikasi | Selesai |
| Pencocokan transfer | Selesai — 18 pasangan, 0 salah pasang |
| Kategorisasi | Selesai — rule-based, bisa dikoreksi user |
| Test otomatis | Selesai — Vitest, 3 bulan, fixture anonim |
| Ekstraksi browser | Selesai — identik dengan versi Node |
| Antarmuka | Selesai sampai Tahap 9 — unggah, analitik, koreksi kategori, proyeksi |
| Penyimpanan lokal | Selesai — IndexedDB, dedup, deteksi celah |
| Analitik | Selesai — savings rate, runway, tren, per kategori |

## Menjalankan

```bash
npm install
```

Uji parser terhadap statement:

```bash
node scripts/test-bca.mjs   path/ke/statement-bca.pdf
node scripts/test-gopay.mjs path/ke/statement-gopay.pdf
node scripts/test-combined.mjs path/ke/bca.pdf path/ke/gopay.pdf
```

`test-combined.mjs` menerima dua variabel lingkungan agar pencocokan
transfer tahu mana akun milik sendiri:

```bash
GOPAY_PHONE=08xxxxxxxxxx OWN_NAME="Nama Depan" \
  node scripts/test-combined.mjs bca.pdf gopay.pdf
```

Ringkasan per kategori:

```bash
node scripts/analyze.mjs path/ke/statement-bca.pdf
```

Test otomatis berjalan di atas fixture anonim, tanpa perlu statement asli:

```bash
npm test
```

Menambah bulan baru ke test:

```bash
node scripts/make-fixtures.mjs bca path/ke/statement.pdf test/fixtures-anon/bca-2026-09.json
```

## Struktur

```
src/
  extract/pdf-node.js    ekstraksi teks + koordinat (Node, untuk skrip)
  extract/pdf-browser.js ekstraksi versi browser, pdf.js + web worker
  parsers/bca.js         parser mutasi BCA
  parsers/gopay.js       parser e-statement GoPay
  core/validate.js       rekonsiliasi terhadap angka tercetak
  core/dedupe.js         ID deterministik dari isi transaksi
  core/transfers.js      pencocokan pemindahan antar-akun
  core/categorize.js     kategorisasi berbasis aturan
  core/ingest.js         gabungkan banyak berkas jadi satu timeline
  core/gaps.js           deteksi bulan bolong dan saldo tidak nyambung
  core/merchant.js       kunci merchant + penerapan koreksi kategori
  analytics/summary.js   savings rate, runway, net worth, tren, kategori
  ui/analitik.ts         tampilan analitik
  ui/koreksi.ts          daftar merchant + koreksi kategori
  style.css              penataan, gaya neobrutalism
  storage/db.js          IndexedDB: accounts, transactions, uploads
  parsers/index.js       registry parser + pengenalan sumber
  main.ts                layar unggah
scripts/                 skrip uji manual
```

Catatan proses — keputusan desain, temuan dari data asli, dan tahap demi
tahap pengerjaan — sengaja tidak ikut ke repositori ini. Isinya catatan
kerja, bukan bagian dari aplikasi.

## Publikasi

Hasil build seluruhnya berkas statis — HTML, JS, CSS, huruf, gambar. Tidak
ada backend, tidak ada database, tidak ada environment variable. Apa pun
yang bisa menyajikan folder bisa memuatnya.

```bash
npm run build     # menghasilkan dist/
npm run preview   # mencoba hasil build itu di localhost:4173
```

Lalu unggah isi `dist/` ke host static mana pun. Yang disarankan Cloudflare
Pages atau Netlify, karena keduanya membaca `public/_headers` dan tidak
menyuntikkan skrip apa pun ke halaman.

**Cloudflare Pages, lewat Git:** sambungkan repo, setel build command
`npm run build` dan output directory `dist`. Tiap push jadi versi baru.

**GitHub Pages:** `.github/workflows/pages.yml` sudah ada. Nyalakan di
Settings → Pages → Source: **GitHub Actions**, lalu push ke `main`. Alurnya
menjalankan `npm test` lebih dulu; kalau validasi parser rusak, versi rusak
itu tidak jadi terbit.

Hasil build memakai jalur relatif (`base: './'`), jadi sama benarnya
disajikan dari akar domain maupun dari subfolder seperti
`https://<user>.github.io/<repo>/`.

Satu hal yang hilang di GitHub Pages: dia tidak bisa memasang header
sendiri, jadi `public/_headers` diabaikan di sana. CSP-nya tetap berlaku
karena ikut di dalam `<meta>` — termasuk `connect-src 'none'`. Yang tidak
ikut cuma `frame-ancestors`, `Referrer-Policy`, dan `Permissions-Policy`,
yang memang cuma bisa datang sebagai header. Kalau itu penting, pakai
Cloudflare Pages atau Netlify.

**Tanpa Git**, seret folder `dist/` ke halaman deploy Cloudflare Pages atau
[app.netlify.com/drop](https://app.netlify.com/drop).

### Yang harus diperiksa sebelum publik

1. **`git status` tidak menampilkan satu pun `.pdf`.** Statement asli memuat
   nomor rekening, nomor telepon, dan seluruh riwayat transaksi.
2. **Host tidak menyuntikkan skrip.** Analitik bawaan host, widget chat, dan
   sejenisnya berjalan di halaman yang sama dengan mutasi bank orang.
   Kalaupun tidak membaca apa-apa, janji di layar berhenti benar.
3. **Jangan menambahkan telemetri.** Tidak ada pengecualian "cuma jumlah
   pengunjung" — halaman ini menyatakan datanya tidak keluar dari perangkat.
4. **Sajikan dari akar domain**, bukan subfolder. Rujukan gambar memakai
   jalur absolut (`/gambar/...`).

### Yang menegakkan janjinya

Hasil build membawa Content-Security-Policy di dalam `<meta>`, dan
`public/_headers` memasang kebijakan yang sama sebagai header sungguhan.
Barisnya:

```
connect-src 'none'
```

Dengan itu `fetch`, XHR, WebSocket, dan `sendBeacon` ke mana pun — termasuk
ke asal sendiri — ditolak browser. Sampai sekarang yang menjaga "tidak ada
apa pun yang keluar dari perangkat" cuma disiplin: jangan menulis `fetch()`.
Ini mengubahnya jadi sesuatu yang ditegakkan browser, bukan diingat manusia.
Kalau suatu hari ada yang menambahkan pengiriman data — sengaja, salah
tempel, atau lewat dependensi — halaman berhenti bekerja dan muncul
pelanggaran di console. Gagal keras, bukan diam-diam mengirim mutasi orang.

Sudah diuji terhadap hasil build: `fetch` ke asal sendiri diblokir, `fetch`
ke domain luar diblokir, `sendBeacon` diblokir (walau mengembalikan `true`,
permintaannya tidak pernah dikirim), sementara pdf.js tetap bisa membaca
PDF — worker-nya berjalan dari asal yang sama.

## Catatan penting

**Statement asli tidak pernah di-commit.** `*.pdf` ada di `.gitignore`
sejak awal. File-file itu memuat nomor rekening, nomor telepon, dan
seluruh riwayat transaksi.

**Validasi tidak boleh dilemahkan.** Parser PDF bisa melewatkan baris tanpa
melempar error. Rekonsiliasi terhadap angka yang tercetak di statement
adalah satu-satunya bukti hasil parsing benar. File yang gagal validasi
ditolak, bukan ditampilkan apa adanya.

Alasan di balik tiap aturan ada di komentar berkasnya masing-masing —
`src/core/validate.js`, `src/core/transfers.js`, dan `src/analytics/summary.js`
menjelaskan sendiri kenapa aturannya seperti itu.
