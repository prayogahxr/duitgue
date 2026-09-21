/**
 * Kunci merchant dan koreksi kategori (Tahap 7).
 *
 * Yang paling penting dibuktikan: kunci merchant TIDAK ikut berubah saat
 * nominal, tanggal, atau nomor referensi berubah. Kalau ikut berubah, satu
 * koreksi cuma berlaku untuk baris yang diklik dan janji "transaksi lain dari
 * merchant yang sama ikut terkoreksi" tidak pernah terpenuhi.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import { merchantKey, terapkanKoreksi } from '../src/core/merchant.js';
import { KATEGORI, categorize } from '../src/core/categorize.js';
import { ingest } from '../src/core/ingest.js';
import { simpanHasil, muatSemua, hapusSemua, simpanKoreksi, hapusKoreksi } from '../src/storage/db.js';

const muat = (nama) =>
  JSON.parse(fs.readFileSync(new URL(`./fixtures-anon/${nama}.json`, import.meta.url), 'utf8'));

describe('merchantKey', () => {
  // Bentuk asli dari statement BCA: BCA menempelkan nominal ke depan nama
  // merchant QR, dan nominalnya berbeda tiap transaksi.
  it('nominal yang menempel di depan nama merchant dilepas', () => {
    expect(
      merchantKey({ descriptionLines: ['TGL: 02/06', 'QR 014', '00000.00XXI NSR'] }),
    ).toBe('XXI NSR');
  });

  it('dua transaksi di merchant yang sama menghasilkan kunci yang sama', () => {
    const a = merchantKey({ descriptionLines: ['TGL: 21/06', 'QR 914', '00000.00Hanif jaya'] });
    const b = merchantKey({ descriptionLines: ['TGL: 28/06', 'QR 914', '00000.00Hanif jaya'] });
    expect(a).toBe(b);
    expect(a).toBe('HANIF JAYA');
  });

  it('tanggal, nomor QR, dan nominal tidak mengubah kunci', () => {
    const dasar = merchantKey({ descriptionLines: ['TGL: 01/01', 'QR 001', '10000.00XOFTWARE P'] });
    const lain = merchantKey({ descriptionLines: ['TGL: 29/12', 'QR 999', '99999.99XOFTWARE P'] });
    expect(dasar).toBe(lain);
  });

  it('nomor referensi dan ID transaksi dibuang', () => {
    expect(
      merchantKey({
        descriptionLines: ['0206/FTSCY/WS95051', '80500.00', 'GoPay Bank Transfe', 'ID2615325850283L0A', 'DOMPET ANAK BANGSA'],
      }),
    ).toBe('GOPAY BANK TRANSFE DOMPET ANAK BANGSA');
  });

  it('beda huruf besar-kecil dan spasi tetap satu merchant', () => {
    expect(merchantKey({ description: 'Mie  Gacoan' })).toBe(
      merchantKey({ description: 'MIE GACOAN' }),
    );
  });

  it('baris yang seluruhnya terbuang jatuh balik ke jenis transaksi', () => {
    expect(merchantKey({ type: 'BIAYA ADM', descriptionLines: ['0.00'] })).toBe('BIAYA ADM');
  });

  it('transaksi tanpa keterangan apa pun tidak memaksakan kunci', () => {
    expect(merchantKey({ type: '', description: '', descriptionLines: [] })).toBeNull();
  });
});

describe('terapkanKoreksi', () => {
  const trx = [
    { descriptionLines: ['TGL: 02/06', 'QR 011', '00000.00XOFTWARE P'], category: 'other', categoryLabel: 'Belum terkategori' },
    { descriptionLines: ['TGL: 20/07', 'QR 011', '55000.00XOFTWARE P'], category: 'other', categoryLabel: 'Belum terkategori' },
    { descriptionLines: ['TGL: 02/06', 'QR 014', '00000.00XXI NSR'], category: 'other', categoryLabel: 'Belum terkategori' },
  ];
  const koreksi = [{ merchantKey: 'XOFTWARE P', category: 'ecommerce', categoryLabel: 'E-commerce' }];

  it('satu koreksi memperbaiki semua transaksi dari merchant itu', () => {
    const hasil = terapkanKoreksi(trx, koreksi);
    expect(hasil[0].category).toBe('ecommerce');
    expect(hasil[1].category).toBe('ecommerce');
  });

  it('merchant lain tidak ikut berubah', () => {
    expect(terapkanKoreksi(trx, koreksi)[2].category).toBe('other');
  });

  it('deskripsi asli tidak pernah disentuh', () => {
    const hasil = terapkanKoreksi(trx, koreksi);
    expect(hasil[0].descriptionLines).toEqual(trx[0].descriptionLines);
    expect(hasil[1].descriptionLines).toEqual(trx[1].descriptionLines);
  });

  // isTransfer berasal dari pencocokan antar akun, bukan dari selera user.
  // Kalau bisa digeser lewat dropdown kategori, "pengeluaran nyata" berhenti
  // bisa dipercaya.
  it('isTransfer tidak ikut diubah oleh koreksi kategori', () => {
    const t = [{ descriptionLines: ['00000.00XOFTWARE P'], category: 'other', isTransfer: true }];
    expect(terapkanKoreksi(t, koreksi)[0].isTransfer).toBe(true);
  });

  it('tanpa koreksi, daftar transaksi dikembalikan apa adanya', () => {
    expect(terapkanKoreksi(trx, [])).toBe(trx);
  });
});

describe('KATEGORI', () => {
  it('memuat setiap kategori yang bisa dihasilkan aturan', () => {
    const ids = new Set(KATEGORI.map((k) => k.id));
    expect(ids.has('other')).toBe(true);
    for (const t of [
      { type: 'TARIKAN ATM', description: '' },
      { type: '', description: 'TOKOPEDIA' },
      { type: '', description: 'ALFAMART' },
    ]) {
      expect(ids.has(categorize(t).category)).toBe(true);
    }
  });
});

describe('Koreksi yang tersimpan, lewat penyimpanan', () => {
  beforeEach(async () => {
    await hapusSemua();
    await simpanHasil(await ingest([{ nama: 'bca-2026-06.json', items: muat('bca-2026-06') }]));
  });

  const belumTerkategori = (trx) => trx.filter((t) => t.category === 'other');

  // CATATAN SOAL ANGKA. Di statement ASLI Juni hanya 7 transaksi yang belum
  // terkategori. Di fixture jumlahnya jauh lebih banyak, dan itu memang
  // seharusnya: nama merchant sudah dianonimkan jadi "MERCHANT NN", sehingga
  // aturan berbasis kata kunci (ALFAMART, TOKOPEDIA, ...) tidak lagi punya
  // apa pun untuk dicocokkan. Jadi yang diuji di sini MEKANISME koreksinya,
  // bukan cakupan aturannya. Cakupan diverifikasi terhadap statement asli.
  it('ada transaksi yang belum terkategori untuk dikoreksi', async () => {
    const { transactions } = await muatSemua();
    expect(belumTerkategori(transactions).length).toBeGreaterThan(0);
  });

  it('mengoreksi satu merchant memperbaiki semua barisnya sekaligus', async () => {
    const { transactions } = await muatSemua();
    // Merchant yang muncul dua kali di Juni — dua baris harus ikut berubah.
    const hitung = new Map();
    for (const t of belumTerkategori(transactions)) {
      const k = merchantKey(t);
      hitung.set(k, (hitung.get(k) ?? 0) + 1);
    }
    const kembar = [...hitung.entries()].find(([, n]) => n === 2);
    expect(kembar, 'perlu satu merchant yang muncul dua kali').toBeDefined();

    await simpanKoreksi(kembar[0], 'fnb', 'Makan & minum');

    const sesudah = await muatSemua();
    const cocok = sesudah.transactions.filter((t) => merchantKey(t) === kembar[0]);
    expect(cocok).toHaveLength(2);
    for (const t of cocok) {
      expect(t.category).toBe('fnb');
      expect(t.categoryLabel).toBe('Makan & minum');
      expect(t.dikoreksi).toBe(true);
    }
    // Tepat dua baris pindah keluar dari "belum terkategori", bukan lebih.
    expect(belumTerkategori(sesudah.transactions).length).toBe(
      belumTerkategori(transactions).length - 2,
    );
  });

  it('koreksi ikut berlaku untuk bulan yang diunggah SESUDAHNYA', async () => {
    const juni = (await muatSemua()).transactions;

    // Harus merchant yang juga muncul di Juli, kalau tidak pemeriksaannya
    // lulus tanpa membuktikan apa pun: baris Juni sendiri sudah pasti cocok.
    const juliMentah = await ingest([{ nama: 'bca-2026-07.json', items: muat('bca-2026-07') }]);
    const kunciJuli = new Set(juliMentah.transactions.map(merchantKey));
    const kunci = belumTerkategori(juni).map(merchantKey).find((k) => kunciJuli.has(k));
    expect(kunci, 'perlu merchant yang muncul di Juni dan Juli').toBeDefined();

    await simpanKoreksi(kunci, 'retail', 'Ritel & toko');
    await simpanHasil(juliMentah);

    const sesudah = await muatSemua();
    const cocok = sesudah.transactions.filter((t) => merchantKey(t) === kunci);
    const dariJuli = cocok.filter((t) => t.valueDate.getUTCMonth() === 6); // Juli
    expect(dariJuli.length).toBeGreaterThan(0);
    for (const t of cocok) expect(t.category).toBe('retail');
  });

  it('mencabut koreksi mengembalikan hasil aturan', async () => {
    const { transactions } = await muatSemua();
    const t0 = belumTerkategori(transactions)[0];
    const kunci = merchantKey(t0);

    await simpanKoreksi(kunci, 'fnb', 'Makan & minum');
    expect((await muatSemua()).transactions.find((t) => t.id === t0.id).category).toBe('fnb');

    await hapusKoreksi(kunci);
    const kembali = (await muatSemua()).transactions.find((t) => t.id === t0.id);
    expect(kembali.category).toBe('other');
    expect(kembali.dikoreksi).toBeUndefined();
  });

  it('koreksi tidak menulis ulang baris transaksi — kategori tetap field turunan', async () => {
    const { transactions } = await muatSemua();
    const t0 = belumTerkategori(transactions)[0];
    await simpanKoreksi(merchantKey(t0), 'fnb', 'Makan & minum');

    // Dibaca mentah dari store, tanpa lewat penerapan koreksi.
    const { bukaDb } = await import('../src/storage/db.js');
    const db = await bukaDb();
    const mentah = await db.get('transactions', t0.id);
    expect(mentah.category).toBe('other');
    expect(mentah.description).toBe(t0.description);
  });
});
