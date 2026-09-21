/**
 * Membuat fixture test dari statement asli.
 *
 * Statement asli TIDAK boleh di-commit. Skrip ini menghasilkan berkas JSON
 * berisi item hasil ekstraksi koordinat dengan:
 *
 *  - seluruh data pengenal diganti (nama, nomor rekening, nomor telepon,
 *    email, nama merchant, ID transaksi)
 *  - seluruh nominal diganti angka acak yang BARU, bukan hasil transformasi
 *    dari angka asli — jadi nominal aslinya tidak bisa dihitung balik
 *
 * Yang dipertahankan: tata letak koordinat, urutan baris, tanda DB, jumlah
 * transaksi, dan struktur kolom — semua yang sebenarnya diuji oleh parser.
 *
 * Nominal acak itu lalu dibuat konsisten satu sama lain: saldo berjalan,
 * blok ringkasan, dan total header dihitung ULANG dari nominal yang baru.
 * Kalau tidak konsisten, skrip ini gagal dan tidak menulis apa pun — supaya
 * fixture yang bohong tidak pernah lolos ke repo.
 *
 * Pemakaian:
 *   node scripts/make-fixtures.mjs bca   <statement.pdf> <keluaran.json> [saldoAwalSen]
 *   node scripts/make-fixtures.mjs gopay <statement.pdf> <keluaran.json>
 */
import fs from 'fs';
import { extractItems } from '../src/extract/pdf-node.js';
import * as bca from '../src/parsers/bca.js';
import * as gopay from '../src/parsers/gopay.js';
import { validate } from '../src/core/validate.js';

// PRNG berbenih supaya fixture yang sama bisa dibuat ulang persis.
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const fmtBca = (cents) => {
  const rp = Math.floor(Math.abs(cents) / 100);
  const sen = String(Math.abs(cents) % 100).padStart(2, '0');
  return rp.toLocaleString('en-US') + '.' + sen;
};

const fmtGopay = (cents) =>
  (cents < 0 ? '-' : '') + 'Rp' + Math.round(Math.abs(cents) / 100).toLocaleString('id-ID');

const isBcaMoney = (s) => /^[\d,]+\.\d{2}$/.test(s.trim());
const inCol = (x, a, b) => x >= a && x < b;

/** Kelompokkan item jadi baris (halaman sama, y berdekatan), urut dokumen. */
function groupRows(items) {
  const rows = [];
  for (const it of items) {
    let r = rows.find((r) => r.page === it.page && Math.abs(r.y - it.y) < 3);
    if (!r) {
      r = { page: it.page, y: it.y, cells: [] };
      rows.push(r);
    }
    r.cells.push(it);
  }
  rows.sort((a, b) => a.page - b.page || b.y - a.y);
  rows.forEach((r) => r.cells.sort((a, b) => a.x - b.x));
  return rows;
}

/** Ganti string pengenal yang bisa muncul di sumber mana pun. */
function scrubCommon(s) {
  return s
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, 'contoh@example.com')
    // Satu aturan untuk semua deretan angka panjang: nomor rekening, nomor
    // telepon, dan nomor yang menempel pada digit lain ("9085283216092").
    // Batas kata tidak bisa dipakai justru karena penempelan itu. Nominal
    // tidak pernah kena — semuanya bertanda pemisah ribuan.
    .replace(/\+?\d{9,}/g, (m) => (m.startsWith('+') ? '+6281234567890' : '081234567890'))
    .replace(/PRAYOGA|MUHAMMAD/gi, (m) => (m === m.toUpperCase() ? 'CONTOH' : 'Contoh'));
}

function makePseudo() {
  const seen = new Map();
  return (s) => {
    if (!seen.has(s)) seen.set(s, 'MERCHANT ' + String(seen.size + 1).padStart(2, '0'));
    return seen.get(s);
  };
}

const fakeId = (s) => s.replace(/[A-Za-z]/g, 'X').replace(/\d/g, '9');

const SUMMARY = /^(SALDO AWAL|MUTASI CR|MUTASI DB|SALDO AKHIR)\s*:?\s*$/;

// ------------------------------------------------------------------ BCA

function buildBca(items, rand, saldoAwal) {
  const out = items.map((i) => ({ ...i, str: scrubCommon(i.str) }));
  const pseudo = makePseudo();

  // Blok identitas di kiri atas: nama cabang, nama pemilik rekening, dan
  // alamat rumah lengkap sampai RT/RW dan kode pos. Seluruhnya di luar zona
  // tabel, jadi parser tidak pernah membacanya dan aman diganti utuh.
  // Periode statement dibaca dari nama bulan di sisi kanan header, bukan dari
  // sini, jadi penggantinya tidak boleh memuat nama bulan.
  const IDENTITAS = ['KCP CONTOH', 'NAMA CONTOH', 'KELURAHAN CONTOH', 'RT000 RW000 CONTOH', 'JL. CONTOH', 'KOTA CONTOH 00000', 'INDONESIA'];
  // Blok ini diulang di tiap halaman, jadi hitungannya direset per halaman
  // supaya susunan barisnya tetap sama seperti aslinya.
  const kePerHalaman = new Map();
  for (const it of out) {
    if (it.y > 680 && it.x < 210 && it.str.trim()) {
      const n = kePerHalaman.get(it.page) ?? 0;
      kePerHalaman.set(it.page, n + 1);
      it.str = IDENTITAS[Math.min(n, IDENTITAS.length - 1)];
    }
  }

  // Nama lawan transaksi ada di kolom detail. Label ringkasan dan penanda
  // "TANGGAL :dd/mm" jatuh di kolom yang sama, jadi keduanya dikecualikan.
  for (const it of out) {
    if (it.y > 590 || it.y < 45) continue;
    if (!inCol(it.x, 190, 300)) continue;
    const s = it.str.trim();
    if (!s || SUMMARY.test(s) || /^TANGGAL/i.test(s) || /^[\d\s:,./-]+$/.test(s)) continue;
    it.str = pseudo(s);
  }

  const rows = groupRows(out.filter((i) => i.str.trim() && i.y <= 590 && i.y >= 45));
  // Saldo awal bisa ditentukan pemanggil supaya fixture beruntun bisa
  // dirantai: saldo akhir bulan N jadi saldo awal bulan N+1, seperti statement
  // sungguhan. Tanpa itu tiap bulan mulai dari angka yang sama dan deteksi
  // celah antar bulan tidak bisa diuji — selalu terlihat bolong.
  const opening = saldoAwal ?? 20000000000; // Rp200.000.000, cukup supaya tidak minus
  let running = opening;
  let sumCr = 0;
  let sumDb = 0;
  const summaryRows = [];

  for (const row of rows) {
    const label = row.cells
      .filter((c) => inCol(c.x, 190, 300))
      .map((c) => c.str)
      .join(' ')
      .trim();
    if (SUMMARY.test(label)) {
      summaryRows.push({ row, key: label.replace(/\s*:\s*$/, '') });
      continue;
    }

    const mutasi = row.cells.filter((c) => inCol(c.x, 375, 460));
    const isDebit = mutasi.some((c) => c.str.trim() === 'DB');
    const amtCell = mutasi.find((c) => isBcaMoney(c.str));
    if (amtCell) {
      const cents = Math.floor(rand() * 49900000) + 100000; // Rp1.000 - Rp500.000
      amtCell.str = fmtBca(cents);
      if (isDebit) {
        running -= cents;
        sumDb += cents;
      } else {
        running += cents;
        sumCr += cents;
      }
    }
    for (const c of row.cells) {
      if (inCol(c.x, 460, 999) && isBcaMoney(c.str)) c.str = fmtBca(running);
    }
  }

  const val = {
    'SALDO AWAL': opening,
    'MUTASI CR': sumCr,
    'MUTASI DB': sumDb,
    'SALDO AKHIR': running,
  };
  for (const entry of summaryRows) {
    const cell = entry.row.cells.find((c) => inCol(c.x, 300, 375) && isBcaMoney(c.str));
    if (cell) cell.str = fmtBca(val[entry.key]);
  }
  return out;
}

// ---------------------------------------------------------------- GoPay

// Blok ringkasan GoPay hanya ada di halaman 1 bagian atas. Di halaman 2 dan
// seterusnya tabel transaksi naik sampai y~816, jadi ambang y saja tidak cukup
// untuk membedakan header dari transaksi — halamannya harus ikut diperiksa.
const isGopayHeader = (i) => i.page === 1 && i.y > 700;

const GOPAY_KEEP =
  /^(GoPay top up|GoPay Saldo|GoPay Coins|Tanggal|Transaksi|ID transaksi|Metode pembayaran|Jumlah|E-statement|Halaman.*|Periode transaksi|Total .*)$/i;

function buildGopay(items, rand) {
  const out = items.map((i) => ({ ...i, str: scrubCommon(i.str) }));
  const pseudo = makePseudo();

  for (const it of out) {
    const s = it.str.trim();
    if (!s) continue;
    if (inCol(it.x, 260, 375) && /^[A-Za-z0-9]{8,}$/.test(s)) {
      it.str = fakeId(s);
      continue;
    }
    if (inCol(it.x, 90, 260) && !isGopayHeader(it)) {
      if (GOPAY_KEEP.test(s) || /^\d/.test(s)) continue;
      // "Cashback <merchant>" dan "Ditransfer ke <nama>" punya makna struktural
      // di tahap pencocokan transfer — awalannya dipertahankan.
      const m = s.match(/^(Cashback|Ditransfer ke)\s+(.*)$/i);
      it.str = m ? m[1] + ' ' + pseudo(m[2]) : pseudo(s);
    }
  }

  for (const it of out) {
    if (!isGopayHeader(it) && it.x >= 500 && /Rp/.test(it.str)) {
      const neg = /-/.test(it.str);
      const cents = (Math.floor(rand() * 4990) + 10) * 10000; // Rp1.000 - Rp500.000, bulat
      it.str = fmtGopay(neg ? -cents : cents);
    }
  }
  return out;
}

// ----------------------------------------------------------------- main

const [kind, src, dest, saldoAwalArg] = process.argv.slice(2);
if (!kind || !src || !dest) {
  console.error('Pemakaian: node scripts/make-fixtures.mjs <bca|gopay> <statement.pdf> <keluaran.json>');
  process.exit(1);
}

const raw = await extractItems(new Uint8Array(fs.readFileSync(src)));
const rand = mulberry32(20260920);
let items;

if (kind === 'bca') {
  items = buildBca(raw, rand, saldoAwalArg ? parseInt(saldoAwalArg, 10) : undefined);
  const v = validate(bca.parseItems(items));
  if (!v.ok) {
    console.error('Fixture BCA tidak konsisten:');
    v.checks.filter((c) => !c.ok).forEach((c) => console.error(' -', c.name, c.expected, 'vs', c.actual));
    process.exit(1);
  }
  console.log('BCA  ' + v.checks.length + ' pemeriksaan lolos, ' + v.stats.total + ' transaksi');
  // Dicetak supaya bisa dirantai ke bulan berikutnya dari shell.
  console.log('SALDO_AKHIR=' + bca.parseItems(items).closingBalance);
} else if (kind === 'gopay') {
  items = buildGopay(raw, rand);
  // Total header dihitung ulang dari nominal baru. coinsInMixed dibaca dari
  // hasil parsing supaya relasi "pengeluaran = nilai transaksi - porsi coins
  // campuran" tetap berlaku di fixture.
  const pre = gopay.parseItems(items);
  const sumIn = pre.transactions.filter((x) => x.amountCents > 0).reduce((a, x) => a + x.amountCents, 0);
  const sumOut = pre.transactions.filter((x) => x.amountCents < 0).reduce((a, x) => a - x.amountCents, 0);
  const head = items
    .filter((i) => isGopayHeader(i) && i.x >= 400 && /Rp/.test(i.str))
    .sort((a, b) => a.x - b.x);
  if (head.length !== 2) throw new Error('Total header GoPay tidak ketemu (dapat ' + head.length + ')');
  head[0].str = fmtGopay(sumIn);
  head[1].str = fmtGopay(sumOut - (pre.meta.coinsInMixed ?? 0) * 100);

  const r = gopay.parseItems(items);
  const t = r.transactions;
  const inSum = t.filter((x) => x.amountCents > 0).reduce((a, x) => a + x.amountCents, 0);
  const outSum = t.filter((x) => x.amountCents < 0).reduce((a, x) => a - x.amountCents, 0);
  const ok1 = inSum === r.stated.creditTotal;
  const ok2 = outSum - (r.meta.coinsInMixed ?? 0) * 100 === r.stated.debitTotal;
  if (!ok1 || !ok2) {
    console.error('Fixture GoPay tidak konsisten', { ok1, ok2 });
    process.exit(1);
  }
  console.log('GoPay 2 pemeriksaan lolos, ' + t.length + ' transaksi');
} else {
  throw new Error('jenis harus bca atau gopay');
}

// Penjaga terakhir. Kebocoran pertama lolos lewat kolom detail BCA, yang
// sengaja dipertahankan apa adanya kalau isinya murni angka — sebuah nomor
// telepon ikut terselamatkan di situ. Jadi pemeriksaannya dilakukan di hasil
// akhir, bukan di aturan penggantinya.
const bocor = items.filter(
  (i) =>
    /\d{9,}/.test(i.str) &&
    !/0?81234567890/.test(i.str) && // placeholder nomor telepon/rekening
    !/^[X9]+$/.test(i.str.trim()), // ID transaksi yang sudah dipalsukan
);
if (bocor.length) {
  console.error('Masih ada deretan angka panjang yang belum diganti:');
  bocor.slice(0, 10).forEach((i) => console.error('  hal', i.page, 'x', Math.round(i.x), JSON.stringify(i.str)));
  process.exit(1);
}

fs.mkdirSync(dest.replace(/[^/\\]+$/, ''), { recursive: true });
fs.writeFileSync(
  dest,
  JSON.stringify(
    items.map((i) => ({
      page: i.page,
      x: Math.round(i.x * 100) / 100,
      y: Math.round(i.y * 100) / 100,
      str: i.str,
    })),
  ),
);
console.log('ditulis:', dest);
