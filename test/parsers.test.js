/**
 * Validasi parser terhadap fixture tiga bulan.
 *
 * Fixture-nya BUKAN statement asli: berkas di test/fixtures-anon/ adalah hasil
 * ekstraksi koordinat yang sudah dianonimkan, dengan nominal yang diganti angka
 * baru dan dibuat konsisten satu sama lain. Dibuat ulang lewat
 * `node scripts/make-fixtures.mjs`. Statement asli tidak pernah masuk repo.
 *
 * Yang dibuktikan di sini adalah parsernya membaca tata letak dengan benar dan
 * rekonsiliasinya utuh — bukan bahwa angka tertentu muncul.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import * as bca from '../src/parsers/bca.js';
import * as gopay from '../src/parsers/gopay.js';
import { validate, validateEwallet } from '../src/core/validate.js';

const BULAN = ['2026-06', '2026-07', '2026-08'];

const muat = (nama) =>
  JSON.parse(fs.readFileSync(new URL(`./fixtures-anon/${nama}.json`, import.meta.url), 'utf8'));

const cari = (v, nama) => v.checks.find((c) => c.name.startsWith(nama));

describe.each(BULAN)('Parser BCA %s', (bulan) => {
  const hasil = bca.parseItems(muat(`bca-${bulan}`));
  const v = validate(hasil);

  it('menghasilkan transaksi', () => {
    expect(hasil.transactions.length).toBeGreaterThan(0);
  });

  // Pemeriksaan di validate.js dilewati diam-diam kalau angka pembandingnya
  // null. Tanpa penjaga ini, parser yang gagal membaca blok ringkasan akan
  // terlihat "lulus" justru karena tidak ada yang diperiksa.
  it('menjalankan keenam pemeriksaan, tidak ada yang dilewati', () => {
    expect(v.checks.map((c) => c.name.replace(/ \(.*\)$/, ''))).toEqual([
      'Rekonsiliasi saldo',
      'Total mutasi kredit',
      'Total mutasi debit',
      'Jumlah transaksi kredit',
      'Jumlah transaksi debit',
      'Saldo berjalan',
    ]);
  });

  it.each([
    'Rekonsiliasi saldo',
    'Total mutasi kredit',
    'Total mutasi debit',
    'Jumlah transaksi kredit',
    'Jumlah transaksi debit',
    'Saldo berjalan',
  ])('%s lolos', (nama) => {
    const c = cari(v, nama);
    expect(c, `pemeriksaan "${nama}" tidak ada`).toBeDefined();
    expect(c.ok, `${nama}: dapat ${c.actual}, harusnya ${c.expected}`).toBe(true);
  });

  it('saldo berjalan benar-benar punya titik periksa', () => {
    const titik = hasil.transactions.filter((t) => t.balanceAfterCents !== null).length;
    expect(titik).toBeGreaterThan(10);
  });

  it('nominal selalu integer sen, tidak pernah pecahan', () => {
    for (const t of hasil.transactions) {
      expect(Number.isInteger(t.amountCents)).toBe(true);
    }
  });
});

describe.each(BULAN)('Parser GoPay %s', (bulan) => {
  const hasil = gopay.parseItems(muat(`gopay-${bulan}`));
  const v = validateEwallet(hasil);

  it('menghasilkan transaksi', () => {
    expect(hasil.transactions.length).toBeGreaterThan(0);
  });

  it('menjalankan kedua pemeriksaan, tidak ada yang dilewati', () => {
    expect(v.checks.map((c) => c.name)).toEqual(['Total pemasukan', 'Total pengeluaran']);
  });

  it.each(['Total pemasukan', 'Total pengeluaran'])('%s lolos', (nama) => {
    const c = cari(v, nama);
    expect(c, `pemeriksaan "${nama}" tidak ada`).toBeDefined();
    expect(c.ok, `${nama}: dapat ${c.actual}, harusnya ${c.expected}`).toBe(true);
  });

  it('tidak mencetak saldo berjalan', () => {
    expect(hasil.transactions.every((t) => t.balanceAfterCents === null)).toBe(true);
  });
});

// Kesalahan yang bikin Agustus gagal: seluruh "Total Coins dipakai" dikurangi
// dari pengeluaran, padahal poin dari transaksi yang dibayar 100% coins tidak
// pernah ikut masuk hitungan rupiah. Juni dan Juli lolos hanya karena kebetulan
// tidak punya transaksi jenis itu, jadi pembedaannya diuji eksplisit.
describe('Pembagian GoPay Coins', () => {
  it.each(BULAN)('%s: coins campuran = dipakai - murni coins', (bulan) => {
    const m = gopay.parseItems(muat(`gopay-${bulan}`)).meta;
    expect(m.coinsInMixed).toBe(m.coinsUsed - m.coinsSpentWholly);
  });

  it('Agustus memang punya transaksi yang dibayar penuh dengan coins', () => {
    const m = gopay.parseItems(muat('gopay-2026-08')).meta;
    expect(m.coinsSpentWholly).toBeGreaterThan(0);
    expect(m.coinsInMixed).toBeLessThan(m.coinsUsed);
  });

  it('Juni dan Juli tidak punya, jadi pintasan lama kebetulan benar di situ', () => {
    for (const bulan of ['2026-06', '2026-07']) {
      const m = gopay.parseItems(muat(`gopay-${bulan}`)).meta;
      expect(m.coinsSpentWholly).toBe(0);
      expect(m.coinsInMixed).toBe(m.coinsUsed);
    }
  });
});
