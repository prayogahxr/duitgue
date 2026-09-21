/**
 * Pipeline unggah (Tahap 3) diuji langsung dari fixture, tanpa browser.
 *
 * Yang dibuktikan di sini: sumber dikenali dari isi berkas, berkas yang gagal
 * validasi tidak menyumbang satu baris pun ke timeline, dan jumlah transaksi
 * gabungan sama dengan penjumlahan per berkas yang sudah lolos di
 * parsers.test.js.
 *
 * Catatan soal batas fixture: nominalnya diacak per berkas, jadi hubungan
 * antar-berkas ikut hilang — top up di BCA tidak lagi sepadan dengan top up
 * di GoPay. Pencocokan transfer karena itu TIDAK bisa diuji di sini dan
 * memang menghasilkan nol pasangan. Logikanya sendiri diuji terhadap
 * statement asli lewat scripts/test-combined.mjs.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import { ingest, rupiah } from '../src/core/ingest.js';
import { kenaliSumber } from '../src/parsers/index.js';
import { tagGopayTransfers } from '../src/core/transfers.js';

const muat = (nama) =>
  JSON.parse(fs.readFileSync(new URL(`./fixtures-anon/${nama}.json`, import.meta.url), 'utf8'));

const SEMUA = [
  'bca-2026-06', 'bca-2026-07', 'bca-2026-08',
  'gopay-2026-06', 'gopay-2026-07', 'gopay-2026-08',
];

const berkasDari = (nama) => nama.map((n) => ({ nama: `${n}.json`, items: muat(n) }));

describe('Pengenalan sumber', () => {
  it.each(SEMUA)('%s dikenali tanpa bertanya ke user', (n) => {
    const p = kenaliSumber(muat(n));
    expect(p).not.toBeNull();
    expect(p.id).toBe(n.startsWith('bca') ? 'bca' : 'gopay');
  });

  it('berkas yang bukan mutasi ditolak, bukan ditebak', () => {
    expect(kenaliSumber([{ page: 1, x: 0, y: 0, str: 'Nota Pembelian' }])).toBeNull();
  });
});

describe('Unggah enam berkas sekaligus', () => {
  let hasil;
  beforeAll(async () => { hasil = await ingest(berkasDari(SEMUA)); });

  it('keenam berkas lolos validasi', () => {
    const ditolak = hasil.berkas.filter((b) => !b.ok).map((b) => `${b.nama}: ${b.alasan}`);
    expect(ditolak).toEqual([]);
  });

  it('BCA dan GoPay tercampur dan keduanya terbaca', () => {
    expect(hasil.berkas.filter((b) => b.sumberId === 'bca')).toHaveLength(3);
    expect(hasil.berkas.filter((b) => b.sumberId === 'gopay')).toHaveLength(3);
  });

  // 106 + 120 + 120 + 50 + 79 + 113 — angka yang sama dengan parsers.test.js.
  it('jumlah transaksi gabungan sama dengan jumlah per berkas', () => {
    const perBerkas = hasil.berkas.reduce((a, b) => a + b.transactions.length, 0);
    expect(hasil.transactions.length).toBe(perBerkas);
    expect(hasil.transactions.length).toBe(588);
  });

  it('timeline urut menurut tanggal transaksi', () => {
    for (let i = 1; i < hasil.transactions.length; i++) {
      expect(hasil.transactions[i].valueDate >= hasil.transactions[i - 1].valueDate).toBe(true);
    }
  });

  it('tiap transaksi punya id dan asal akun', () => {
    for (const t of hasil.transactions) {
      expect(t.id).toBeTruthy();
      expect(['bca', 'gopay']).toContain(t.accountId);
    }
  });

  it('akun GoPay milik user diambil dari berkasnya, bukan ditanyakan', () => {
    const akun = hasil.berkas.find((b) => b.sumberId === 'gopay').akun;
    expect(akun.accountNumber).toMatch(/^\+62/);
    expect(akun.name).toBeTruthy();
  });
});

describe('Berkas yang gagal validasi tidak masuk timeline', () => {
  // Rusak satu angka saldo di fixture BCA Juli: rekonsiliasinya harus gagal,
  // dan tidak satu pun dari 120 transaksinya boleh muncul di timeline.
  const rusak = muat('bca-2026-07').map((i) =>
    i.x >= 460 && /^[\d,]+\.\d{2}$/.test(i.str) ? { ...i, str: '1.00' } : i,
  );
  let hasil;
  beforeAll(async () => {
    hasil = await ingest([
      { nama: 'bca-2026-06.json', items: muat('bca-2026-06') },
      { nama: 'bca-rusak.json', items: rusak },
    ]);
  });

  it('berkas rusak ditandai gagal', () => {
    const b = hasil.berkas.find((x) => x.nama === 'bca-rusak.json');
    expect(b.ok).toBe(false);
    expect(b.alasan).toBe('validasi-gagal');
  });

  it('pemeriksaan yang gagal bisa disebutkan satu per satu', () => {
    const b = hasil.berkas.find((x) => x.nama === 'bca-rusak.json');
    const gagal = b.checks.filter((c) => !c.ok);
    expect(gagal.length).toBeGreaterThan(0);
    expect(gagal.map((c) => c.name).join(' ')).toMatch(/Saldo berjalan/);
  });

  it('timeline hanya berisi transaksi dari berkas yang lolos', () => {
    expect(hasil.transactions).toHaveLength(106);
    expect(hasil.ringkasan.fileLolos).toBe(1);
    expect(hasil.ringkasan.fileDitolak).toBe(1);
  });
});

describe('rupiah()', () => {
  it('memformat sen jadi rupiah tanpa kehilangan presisi', () => {
    expect(rupiah(329063904)).toBe('Rp3.290.639,04');
    expect(rupiah(-100000)).toBe('-Rp1.000,00');
    expect(rupiah(0)).toBe('Rp0,00');
  });
});

/**
 * Nama pemilik akun di header GoPay adalah nama panggilan ("Prayoga"),
 * sementara baris transaksinya memuat nama lengkap yang dipotong
 * ("Muhammad Prayoga Ramadha"). Cocok-awalan persis gagal untuk keduanya,
 * dan akibatnya tiga penarikan saldo ke rekening sendiri per bulan tidak
 * terpasangkan — uangnya terhitung sebagai pengeluaran padahal cuma pindah
 * kantong. Fixture tidak bisa menguji ini karena namanya sudah dianonimkan.
 */
describe('Mengenali tarik saldo ke rekening sendiri', () => {
  const tag = (type) => {
    const t = [{ type, amountCents: -100000 }];
    tagGopayTransfers(t, 'Prayoga');
    return !!t[0].isTransfer;
  };

  it('nama panggilan yang muncul di tengah nama lengkap tetap dikenali', () => {
    expect(tag('Ditransfer ke Muhammad Prayoga Ramadha')).toBe(true);
  });

  it('nama persis juga dikenali', () => {
    expect(tag('Ditransfer ke Prayoga')).toBe(true);
  });

  it('orang lain tidak ikut terhitung sebagai pemindahan sendiri', () => {
    expect(tag('Ditransfer ke Benny Setiawan')).toBe(false);
  });

  it('nama yang mirip tapi bukan kata yang sama tidak cocok', () => {
    expect(tag('Ditransfer ke Prayogi Santoso')).toBe(false);
    expect(tag('Ditransfer ke Prayogan')).toBe(false);
  });

  it('tujuan yang disamarkan GoPay tidak ditebak', () => {
    expect(tag('Ditransfer ke R*****')).toBe(false);
  });
});

describe('diagnosa berkas yang sumbernya tidak dikenali', () => {
  it('menandai PDF tanpa lapisan teks', async () => {
    const h = await ingest([{ nama: 'scan.pdf', items: [] }]);
    const f = h.berkas[0];
    expect(f.alasan).toBe('sumber-tak-dikenali');
    expect(f.diagnosa.tanpaLapisanTeks).toBe(true);
    expect(f.diagnosa.jumlahItem).toBe(0);
  });

  it('membedakan PDF berteks yang penandanya tidak cocok', async () => {
    const items = [
      { page: 1, x: 10, y: 700, str: 'LAPORAN REKENING KORAN' },
      { page: 1, x: 10, y: 680, str: 'Bank lain, format lain' },
      { page: 2, x: 10, y: 700, str: 'halaman dua' },
    ];
    const f = (await ingest([{ nama: 'lain.pdf', items }])).berkas[0];
    expect(f.diagnosa.tanpaLapisanTeks).toBe(false);
    expect(f.diagnosa.jumlahItem).toBe(3);
    expect(f.diagnosa.halaman).toBe(2);
    expect(f.diagnosa.penandaBca).toBe(false);
    expect(f.diagnosa.penandaGopay).toBe(false);
  });

  it('diagnosanya tidak memuat satu pun potongan teks statement', async () => {
    const items = [{ page: 1, x: 10, y: 700, str: 'PRAYOGA RAMADHANI 1234567890' }];
    const f = (await ingest([{ nama: 'x.pdf', items }])).berkas[0];
    const isi = JSON.stringify(f.diagnosa);
    expect(isi).not.toMatch(/PRAYOGA/);
    expect(isi).not.toMatch(/1234567890/);
  });
});
