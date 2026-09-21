/**
 * Analitik (Tahap 8).
 *
 * Yang dijaga di sini terutama dua hal:
 *
 * 1. Analitik tidak boleh punya definisi uangnya sendiri. Totalnya harus
 *    sama persis dengan `realSpending`/`realIncome` di core.
 * 2. Yang belum terlihat tidak boleh lenyap. Rincian kategori ditambah pos
 *    "belum terlihat" harus persis sama dengan total pengeluaran nyata —
 *    kalau tidak, ada uang yang hilang dari laporan tanpa jejak.
 */
import { describe, it, expect } from 'vitest';
import { analitik, MINIMAL_BULAN, labelPeriode } from '../src/analytics/summary.js';
import { realSpending, realIncome } from '../src/core/transfers.js';

const hari = (iso) => new Date(iso + 'T00:00:00.000Z');

/** Transaksi ringkas untuk menguji aturan, bukan meniru statement. */
const trx = (tgl, jumlah, extra = {}) => ({
  valueDate: hari(tgl),
  amountCents: jumlah,
  categoryLabel: 'Makan & minum',
  ...extra,
});

const unggahan = (bulan, saldo = null, accountId = 'bca') =>
  bulan.map((m) => ({ accountId, month: m, year: 2026, closingBalance: saldo }));

describe('Pembagian per bulan', () => {
  // Parser membangun tanggal lewat Date.UTC dari tanggal cetak. Kalau bulan
  // dibaca dengan getter waktu lokal, transaksi GoPay pukul 21:15 pada 31/08
  // pindah ke September dan jadi "bulan" palsu berisi dua transaksi.
  it('transaksi malam di akhir bulan tidak bocor ke bulan berikutnya', () => {
    const a = analitik(
      [{ valueDate: new Date('2026-08-31T21:15:00.000Z'), amountCents: -1000 }],
      unggahan([8]),
    );
    expect(a.bulanan).toHaveLength(1);
    expect(a.bulanan[0].periode).toBe('2026-08');
  });

  it('bulan yang tidak tercakup statement ditandai tidak lengkap', () => {
    const a = analitik(
      [trx('2026-06-10', -1000), trx('2026-07-02', -2000)],
      unggahan([6]), // hanya Juni yang diunggah
    );
    expect(a.bulanan.find((b) => b.periode === '2026-06').lengkap).toBe(true);
    expect(a.bulanan.find((b) => b.periode === '2026-07').lengkap).toBe(false);
    expect(a.jumlahBulanPenuh).toBe(1);
  });
});

describe('Cukup tidaknya data', () => {
  it(`tren tidak dijawab di bawah ${MINIMAL_BULAN} bulan`, () => {
    const a = analitik(
      [trx('2026-06-10', -100000, { amountCents: -100000 }), trx('2026-07-10', -200000)],
      unggahan([6, 7], 500000),
    );
    expect(a.cukupData).toBe(false);
    expect(a.creep).toBeNull();
    expect(a.runwayBulan).toBeNull();
  });

  it('bulan sepotong tidak ikut dihitung sebagai modal tren', () => {
    const t = [trx('2026-06-10', -100000), trx('2026-07-10', -100000), trx('2026-08-10', -100000)];
    // Tiga bulan transaksi, tapi hanya dua yang punya statement.
    expect(analitik(t, unggahan([6, 7], 100000)).cukupData).toBe(false);
    expect(analitik(t, unggahan([6, 7, 8], 100000)).cukupData).toBe(true);
  });
});

describe('Savings rate', () => {
  it('persentase pemasukan yang tidak habis', () => {
    const a = analitik([trx('2026-06-05', 1000000), trx('2026-06-10', -250000)], unggahan([6]));
    expect(a.total.savingsRate).toBeCloseTo(75, 6);
  });

  it('tanpa pemasukan, rasionya tidak dipaksakan jadi angka', () => {
    const a = analitik([trx('2026-06-10', -250000)], unggahan([6]));
    expect(a.total.savingsRate).toBeNull();
  });

  it('bisa negatif kalau pengeluaran melebihi pemasukan', () => {
    const a = analitik([trx('2026-06-05', 100000), trx('2026-06-10', -150000)], unggahan([6]));
    expect(a.total.savingsRate).toBeCloseTo(-50, 6);
  });
});

describe('Tidak mendefinisikan ulang uang', () => {
  const t = [
    trx('2026-06-05', 2000000),
    trx('2026-06-06', -300000),
    // Pemindahan berpasangan: sisi keluar tidak dihitung, biayanya dihitung.
    trx('2026-06-07', -500000, { transferPairId: 'p1', transferFeeCents: 100000, isTransfer: true }),
    trx('2026-06-08', 500000, { transferPairId: 'p1', isTransfer: true }),
    // Pemindahan tanpa pasangan: uangnya memang keluar.
    trx('2026-06-09', -200000, { isTransfer: true, transferChannel: 'shopeepay' }),
  ];
  const a = analitik(t, unggahan([6]));

  it('total sama persis dengan realSpending dan realIncome di core', () => {
    expect(a.total.pengeluaran).toBe(realSpending(t));
    expect(a.total.uangMasuk).toBe(realIncome(t));
  });

  it('sisi masuk dari pemindahan berpasangan bukan pemasukan', () => {
    expect(a.total.uangMasuk).toBe(2000000);
  });

  it('biaya pemindahan tetap dihitung sebagai pengeluaran', () => {
    expect(a.perKategori.find((k) => k.label === 'Biaya pemindahan').jumlah).toBe(100000);
  });
});

describe('Yang belum terlihat punya posnya sendiri', () => {
  const t = [
    trx('2026-06-06', -300000),
    trx('2026-06-09', -200000, { isTransfer: true, transferChannel: 'shopeepay' }),
    trx('2026-06-10', -50000, { isTransfer: true, transferChannel: 'ovo' }),
  ];
  const a = analitik(t, unggahan([6]));

  it('dipisah dari rincian kategori, bukan dilebur', () => {
    expect(a.perKategori.map((k) => k.label)).toEqual(['Makan & minum']);
    expect(a.belumTerlihat.total).toBe(250000);
  });

  it('dirinci per kanal tujuan', () => {
    expect(a.belumTerlihat.perKanal).toEqual([
      { kanal: 'shopeepay', jumlah: 200000 },
      { kanal: 'ovo', jumlah: 50000 },
    ]);
  });

  // Kalau penjumlahan ini tidak utuh, ada uang yang hilang dari laporan.
  it('kategori + belum terlihat === pengeluaran nyata', () => {
    const totKat = a.perKategori.reduce((x, k) => x + k.jumlah, 0);
    expect(totKat + a.belumTerlihat.total).toBe(a.total.pengeluaran);
    expect(a.total.pengeluaran).toBe(realSpending(t));
  });

  it('tidak dihilangkan juga dari total pengeluaran', () => {
    expect(a.total.pengeluaran).toBe(550000);
  });
});

describe('Kirim ke nomor orang lain', () => {
  it('tidak diberi label pindah kantong di rincian pengeluaran', () => {
    const t = [
      trx('2026-06-11', -21000, {
        categoryLabel: 'Top up GoPay',
        sentToOther: true,
        isTransfer: false,
      }),
    ];
    const a = analitik(t, unggahan([6]));
    expect(a.perKategori.map((k) => k.label)).toEqual(['Dikirim ke nomor orang lain']);
  });
});

describe('Kekayaan bersih dan runway', () => {
  it('hanya menghitung akun yang mencetak saldo, dan menyebut yang tidak', () => {
    const t = [trx('2026-06-10', -100000), trx('2026-07-10', -100000), trx('2026-08-10', -100000)];
    const uploads = [
      ...unggahan([6, 7, 8], 900000, 'bca'),
      ...unggahan([6, 7, 8], null, 'gopay'),
    ];
    const a = analitik(t, uploads);
    expect(a.akunTanpaSaldo).toEqual(['gopay']);
    expect(a.netWorth).toHaveLength(3);
    expect(a.netWorth[0].perAkun.map((x) => x.accountId)).toEqual(['bca']);
  });

  it('runway = saldo terlihat dibagi rata-rata pengeluaran bulanan', () => {
    const t = [trx('2026-06-10', -100000), trx('2026-07-10', -100000), trx('2026-08-10', -100000)];
    const a = analitik(t, unggahan([6, 7, 8], 300000));
    expect(a.saldoTerlihat).toBe(300000);
    expect(a.runwayBulan).toBeCloseTo(3, 6);
  });
});

describe('Lifestyle creep', () => {
  it('membandingkan pertumbuhan pengeluaran dengan pertumbuhan pemasukan', () => {
    const t = [
      trx('2026-06-01', 1000000), trx('2026-06-10', -500000),
      trx('2026-07-01', 1000000), trx('2026-07-10', -600000),
      trx('2026-08-01', 1100000), trx('2026-08-10', -750000),
    ];
    const a = analitik(t, unggahan([6, 7, 8], 100000));
    expect(a.creep.pengeluaran).toBeCloseTo(50, 6); // 500rb -> 750rb
    expect(a.creep.pemasukan).toBeCloseTo(10, 6); // 1jt -> 1,1jt
    expect(a.creep.selisih).toBeCloseTo(40, 6); // poin persen
    expect(a.creep.titikData).toBe(3);
  });

  it('menyebut rentang bulannya supaya angkanya bisa ditelusuri', () => {
    const t = [
      trx('2026-06-01', 1000000), trx('2026-06-10', -500000),
      trx('2026-07-01', 1000000), trx('2026-07-10', -600000),
      trx('2026-08-01', 1000000), trx('2026-08-10', -700000),
    ];
    const a = analitik(t, unggahan([6, 7, 8], 100000));
    expect(a.creep.dari).toBe('Juni 2026');
    expect(a.creep.sampai).toBe('Agustus 2026');
  });
});

describe('labelPeriode', () => {
  it('menulis bulan dalam bahasa Indonesia', () => {
    expect(labelPeriode('2026-06')).toBe('Juni 2026');
    expect(labelPeriode('2026-12')).toBe('Desember 2026');
  });
});
