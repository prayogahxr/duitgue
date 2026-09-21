/**
 * Penyimpanan lokal (IndexedDB).
 *
 * IndexedDB tidak ada di Node, jadi `fake-indexeddb/auto` memasang
 * implementasi in-memory sebelum modul penyimpanan diimpor. Yang diuji di
 * sini perilakunya, bukan peramban tertentu — verifikasi terhadap peramban
 * sungguhan tetap dilakukan manual dengan statement asli.
 *
 * Yang paling penting dibuktikan: menyimpan hasil yang sama dua kali tidak
 * menambah satu baris pun. Itu bertumpu pada ID transaksi yang deterministik,
 * bukan pada perbandingan isi saat menyimpan.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import { simpanHasil, muatSemua, hapusSemua, bukaDb } from '../src/storage/db.js';
import { ingest } from '../src/core/ingest.js';

const muat = (nama) =>
  JSON.parse(fs.readFileSync(new URL(`./fixtures-anon/${nama}.json`, import.meta.url), 'utf8'));

const berkasDari = (nama) => nama.map((n) => ({ nama: `${n}.json`, items: muat(n) }));

beforeEach(async () => {
  await hapusSemua();
});

describe('Simpan dan ambil', () => {
  it('menyimpan transaksi, akun, dan catatan unggahan', async () => {
    const hasil = await ingest(berkasDari(['bca-2026-06', 'gopay-2026-06']));
    const n = await simpanHasil(hasil);

    expect(n.ditambah).toBe(156); // 106 + 50
    expect(n.dilewati).toBe(0);
    expect(n.berkasBaru).toBe(2);

    const isi = await muatSemua();
    expect(isi.transactions).toHaveLength(156);
    expect(isi.accounts.map((a) => a.id).sort()).toEqual(['bca', 'gopay']);
    expect(isi.uploads).toHaveLength(2);
  });

  it('tanggal kembali sebagai Date, bukan teks', async () => {
    await simpanHasil(await ingest(berkasDari(['bca-2026-06'])));
    const isi = await muatSemua();
    expect(isi.transactions[0].valueDate).toBeInstanceOf(Date);
    expect(Number.isNaN(isi.transactions[0].valueDate.getTime())).toBe(false);
  });

  it('transaksi kembali urut menurut tanggal', async () => {
    await simpanHasil(await ingest(berkasDari(['bca-2026-06', 'bca-2026-07'])));
    const { transactions } = await muatSemua();
    for (let i = 1; i < transactions.length; i++) {
      expect(transactions[i].valueDate >= transactions[i - 1].valueDate).toBe(true);
    }
  });

  it('nominal tetap integer sen setelah bolak-balik ke penyimpanan', async () => {
    await simpanHasil(await ingest(berkasDari(['bca-2026-06'])));
    const { transactions } = await muatSemua();
    for (const t of transactions) expect(Number.isInteger(t.amountCents)).toBe(true);
  });

  it('catatan unggahan memuat saldo awal/akhir untuk deteksi celah', async () => {
    await simpanHasil(await ingest(berkasDari(['bca-2026-06'])));
    const { uploads } = await muatSemua();
    const u = uploads.find((x) => x.accountId === 'bca');
    expect(u.month).toBe(6);
    expect(u.year).toBe(2026);
    expect(Number.isInteger(u.openingBalance)).toBe(true);
    expect(Number.isInteger(u.closingBalance)).toBe(true);
  });

  it('sumber tanpa saldo berjalan menyimpan null, bukan nol', async () => {
    await simpanHasil(await ingest(berkasDari(['gopay-2026-06'])));
    const { uploads } = await muatSemua();
    expect(uploads.find((x) => x.accountId === 'gopay').openingBalance).toBeNull();
  });
});

describe('Deduplikasi', () => {
  it('menyimpan hasil yang sama dua kali tidak menambah baris', async () => {
    const hasil = await ingest(berkasDari(['bca-2026-06', 'gopay-2026-06']));

    const a = await simpanHasil(hasil);
    expect(a.ditambah).toBe(156);

    const b = await simpanHasil(await ingest(berkasDari(['bca-2026-06', 'gopay-2026-06'])));
    expect(b.ditambah).toBe(0);
    expect(b.dilewati).toBe(156);
    expect(b.berkasDiulang).toBe(2);

    expect((await muatSemua()).transactions).toHaveLength(156);
  });

  // Inti kriteria Tahap 4: unggahan yang tumpang tindih tidak menggandakan
  // bulan yang sudah ada.
  it('unggahan tumpang tindih menghasilkan gabungan tanpa duplikat', async () => {
    const a = await simpanHasil(await ingest(berkasDari(['bca-2026-06', 'bca-2026-07'])));
    expect(a.ditambah).toBe(226); // 106 + 120

    const b = await simpanHasil(await ingest(berkasDari(['bca-2026-07', 'bca-2026-08'])));
    expect(b.dilewati).toBe(120); // Juli sudah ada
    expect(b.ditambah).toBe(120); // Agustus baru

    const { transactions, uploads } = await muatSemua();
    expect(transactions).toHaveLength(346); // 106 + 120 + 120
    expect(uploads.map((u) => `${u.month}/${u.year}`)).toEqual(['6/2026', '7/2026', '8/2026']);
  });

  it('tiap transaksi tersimpan punya ID unik', async () => {
    await simpanHasil(await ingest(berkasDari(['bca-2026-06', 'bca-2026-07', 'gopay-2026-06'])));
    const { transactions } = await muatSemua();
    expect(new Set(transactions.map((t) => t.id)).size).toBe(transactions.length);
  });

  // Nama berkas tidak ikut jadi kunci catatan unggahan: statement yang sama
  // sering diunduh ulang dengan nama berbeda, dan itu tetap bulan yang sama.
  it('statement yang sama dengan nama berkas berbeda tidak jadi dua catatan', async () => {
    await simpanHasil(await ingest([{ nama: 'unduhan-pertama.pdf', items: muat('bca-2026-06') }]));
    await simpanHasil(await ingest([{ nama: 'unduhan-kedua.pdf', items: muat('bca-2026-06') }]));
    const { uploads, transactions } = await muatSemua();
    expect(uploads).toHaveLength(1);
    expect(uploads[0].nama).toBe('unduhan-kedua.pdf');
    expect(transactions).toHaveLength(106);
  });

  it('berkas yang gagal validasi tidak menyentuh penyimpanan sama sekali', async () => {
    const rusak = muat('bca-2026-07').map((i) =>
      i.x >= 460 && /^[\d,]+\.\d{2}$/.test(i.str) ? { ...i, str: '1.00' } : i,
    );
    const hasil = await ingest([
      { nama: 'bca-2026-06.json', items: muat('bca-2026-06') },
      { nama: 'rusak.json', items: rusak },
    ]);
    await simpanHasil(hasil);

    const { transactions, uploads } = await muatSemua();
    expect(transactions).toHaveLength(106);
    expect(uploads).toHaveLength(1);
    expect(uploads[0].month).toBe(6);
  });
});

describe('Hapus semua data', () => {
  it('mengosongkan keempat store', async () => {
    await simpanHasil(await ingest(berkasDari(['bca-2026-06', 'gopay-2026-06'])));
    expect((await muatSemua()).transactions.length).toBeGreaterThan(0);

    await hapusSemua();

    const isi = await muatSemua();
    expect(isi.transactions).toEqual([]);
    expect(isi.accounts).toEqual([]);
    expect(isi.uploads).toEqual([]);
  });

  it('database masih bisa dipakai setelah dihapus', async () => {
    await simpanHasil(await ingest(berkasDari(['bca-2026-06'])));
    await hapusSemua();
    const n = await simpanHasil(await ingest(berkasDari(['bca-2026-06'])));
    expect(n.ditambah).toBe(106);
    expect((await muatSemua()).transactions).toHaveLength(106);
  });
});

describe('Skema', () => {
  it('punya keempat store dengan indeks yang dipakai', async () => {
    const db = await bukaDb();
    expect([...db.objectStoreNames].sort()).toEqual([
      'accounts', 'corrections', 'transactions', 'uploads',
    ]);
    const tx = db.transaction(['transactions', 'uploads']);
    expect([...tx.objectStore('transactions').indexNames].sort()).toEqual(['accountId', 'valueDate']);
    expect([...tx.objectStore('uploads').indexNames]).toEqual(['accountId']);
  });
});
