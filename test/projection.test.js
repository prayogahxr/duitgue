/**
 * Test proyeksi (Tahap 9).
 *
 * Bahan bakunya bukan fixture PDF: `proyeksi()` hanya membaca `bulanan` dan
 * `saldoTerlihat` dari hasil `analitik()`, jadi yang dipakai di sini
 * ringkasan buatan tangan. Itu justru yang dibutuhkan — supaya bisa menguji
 * bulan minus, bulan tanpa pemasukan, dan saldo yang tidak dicetak, yang
 * tidak semuanya ada di tiga bulan statement asli.
 *
 * Yang dijaga test ini, berurutan: penolakan saat data kurang, hasil yang
 * sama persis untuk masukan yang sama, urutan persentil, bulan buruk yang
 * ikut terambil, arah slider, dan uang yang tetap bilangan bulat sen.
 */
import { describe, it, expect } from 'vitest';
import { proyeksi, HORIZON_MIN, HORIZON_MAX, ITERASI, GESER_MAKS } from '../src/analytics/projection.js';

const bulan = (label, masuk, keluar, lengkap = true) => ({
  label,
  uangMasuk: masuk,
  pengeluaran: keluar,
  sisa: masuk - keluar,
  lengkap,
});

/** Tiga bulan: dua menabung, satu minus. */
const ringkasan = (extra = {}) => ({
  bulanan: [
    bulan('Juni 2026', 10_000_00, 6_000_00),
    bulan('Juli 2026', 10_000_00, 12_000_00),
    bulan('Agustus 2026', 10_000_00, 7_000_00),
  ],
  saldoTerlihat: 5_000_00,
  akunTanpaSaldo: [],
  ...extra,
});

describe('penolakan saat datanya belum cukup', () => {
  it('menolak di bawah tiga bulan penuh', () => {
    const r = proyeksi({ bulanan: [bulan('Juni 2026', 10_000_00, 6_000_00)], saldoTerlihat: 0 });
    expect(r.cukup).toBe(false);
    expect(r.dasarBulan).toBe(1);
    expect(r.alasan).toMatch(/1 bulan penuh/);
  });

  it('bulan sepotong tidak ikut dihitung sebagai bulan penuh', () => {
    const r = proyeksi({
      bulanan: [
        bulan('Juni 2026', 10_000_00, 6_000_00),
        bulan('Juli 2026', 10_000_00, 6_000_00),
        bulan('Agustus 2026', 200_00, 100_00, false),
      ],
      saldoTerlihat: 0,
    });
    expect(r.cukup).toBe(false);
    expect(r.dasarBulan).toBe(2);
  });

  it('tiga bulan penuh sudah cukup', () => {
    expect(proyeksi(ringkasan()).cukup).toBe(true);
  });
});

describe('hasilnya tetap, bukan berubah tiap dipanggil', () => {
  it('dua panggilan dengan masukan sama menghasilkan angka identik', () => {
    const a = proyeksi(ringkasan(), { bulan: 6, geserPoin: 0 });
    const b = proyeksi(ringkasan(), { bulan: 6, geserPoin: 0 });
    expect(b.jalur).toEqual(a.jalur);
  });

  it('setelan yang berbeda menghasilkan jalur yang berbeda', () => {
    const a = proyeksi(ringkasan(), { bulan: 6, geserPoin: 0 });
    const b = proyeksi(ringkasan(), { bulan: 6, geserPoin: 10 });
    expect(b.jalur).not.toEqual(a.jalur);
  });
});

describe('bentuk hasilnya', () => {
  it('horizon dijepit ke 3-12', () => {
    expect(proyeksi(ringkasan(), { bulan: 1 }).horizon).toBe(HORIZON_MIN);
    expect(proyeksi(ringkasan(), { bulan: 240 }).horizon).toBe(HORIZON_MAX);
    expect(proyeksi(ringkasan(), { bulan: 7 }).horizon).toBe(7);
  });

  it('satu baris per bulan, bernomor urut', () => {
    const r = proyeksi(ringkasan(), { bulan: 9 });
    expect(r.jalur).toHaveLength(9);
    expect(r.jalur.map((j) => j.bulanKe)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(r.akhir).toBe(r.jalur[8]);
  });

  it('persentilnya berurutan di tiap bulan', () => {
    const r = proyeksi(ringkasan(), { bulan: 12 });
    for (const j of r.jalur) {
      expect(j.p10).toBeLessThanOrEqual(j.p50);
      expect(j.p50).toBeLessThanOrEqual(j.p90);
    }
  });

  it('rentangnya melebar seiring bulan — ketidakpastian menumpuk', () => {
    const r = proyeksi(ringkasan(), { bulan: 12 });
    const lebar = r.jalur.map((j) => j.p90 - j.p10);
    expect(lebar[11]).toBeGreaterThan(lebar[0]);
  });

  it('seluruh nilainya bilangan bulat sen, tidak pernah pecahan', () => {
    const r = proyeksi(ringkasan(), { bulan: 12, geserPoin: 33 });
    for (const j of r.jalur) {
      expect(Number.isInteger(j.p10)).toBe(true);
      expect(Number.isInteger(j.p50)).toBe(true);
      expect(Number.isInteger(j.p90)).toBe(true);
    }
  });
});

describe('bulan buruk ikut terambil', () => {
  // Inti metodenya. Kalau bulan minus diam-diam dibuang, atau kalau yang
  // dipakai cuma rata-rata, p10 bulan pertama tidak akan pernah turun di
  // bawah saldo awal — padahal Juli memang minus Rp2.000.
  it('jalur terburuk bulan pertama turun di bawah saldo awal', () => {
    const r = proyeksi(ringkasan(), { bulan: 6 });
    expect(r.jalur[0].p10).toBeLessThan(5_000_00);
  });

  it('jalur terbaik bulan pertama naik di atas saldo awal', () => {
    const r = proyeksi(ringkasan(), { bulan: 6 });
    expect(r.jalur[0].p90).toBeGreaterThan(5_000_00);
  });

  it('bulan yang seluruhnya sama menghasilkan rentang yang rapat', () => {
    const r = proyeksi(
      {
        bulanan: [
          bulan('Juni 2026', 10_000_00, 6_000_00),
          bulan('Juli 2026', 10_000_00, 6_000_00),
          bulan('Agustus 2026', 10_000_00, 6_000_00),
        ],
        saldoTerlihat: 0,
      },
      { bulan: 3 },
    );
    expect(r.jalur[2].p10).toBe(r.jalur[2].p90);
    expect(r.jalur[2].p50).toBe(12_000_00);
  });
});

describe('slider "bagaimana jika"', () => {
  it('menggeser slider menaikkan proyeksinya', () => {
    const tanpa = proyeksi(ringkasan(), { bulan: 6, geserPoin: 0 });
    const dengan = proyeksi(ringkasan(), { bulan: 6, geserPoin: 10 });
    expect(dengan.akhir.p50).toBeGreaterThan(tanpa.akhir.p50);
  });

  it('naik 10 poin persen dari pemasukan Rp10.000 menambah Rp1.000 per bulan', () => {
    // Tiga bulan identik, jadi tidak ada keacakan yang mengaburkan: tiap bulan
    // pasti bertambah persis sebesar potongannya.
    const rata = {
      bulanan: [
        bulan('Juni 2026', 10_000_00, 6_000_00),
        bulan('Juli 2026', 10_000_00, 6_000_00),
        bulan('Agustus 2026', 10_000_00, 6_000_00),
      ],
      saldoTerlihat: 0,
    };
    const a = proyeksi(rata, { bulan: 3, geserPoin: 0 }).akhir.p50;
    const b = proyeksi(rata, { bulan: 3, geserPoin: 10 }).akhir.p50;
    expect(b - a).toBe(3 * 1_000_00);
  });

  it('geseran dijepit ke 0-50 poin', () => {
    expect(proyeksi(ringkasan(), { geserPoin: -5 }).geserPoin).toBe(0);
    expect(proyeksi(ringkasan(), { geserPoin: 900 }).geserPoin).toBe(GESER_MAKS);
  });

  it('pengeluaran tidak bisa turun di bawah nol', () => {
    // Pengeluaran Rp1.000 dari pemasukan Rp10.000; geser 50 poin berarti
    // potong Rp5.000. Yang benar adalah pengeluaran jadi nol, bukan minus
    // Rp4.000 yang berubah jadi uang dari langit.
    const tipis = {
      bulanan: [
        bulan('Juni 2026', 10_000_00, 1_000_00),
        bulan('Juli 2026', 10_000_00, 1_000_00),
        bulan('Agustus 2026', 10_000_00, 1_000_00),
      ],
      saldoTerlihat: 0,
    };
    const r = proyeksi(tipis, { bulan: 3, geserPoin: 50 });
    expect(r.akhir.p50).toBe(3 * 10_000_00);
  });
});

describe('target', () => {
  it('tidak ada blok target kalau tidak ada targetnya', () => {
    expect(proyeksi(ringkasan(), { bulan: 6 }).target).toBe(null);
  });

  it('target yang sudah terlampaui saldo awal tercapai di bulan pertama', () => {
    const r = proyeksi(ringkasan(), { bulan: 6, targetSen: 1_00 });
    expect(r.target.tengah).toBe(1);
    expect(r.target.porsiTercapai).toBe(1);
  });

  it('target yang mustahil dalam horizon dijawab null, bukan angka', () => {
    const r = proyeksi(ringkasan(), { bulan: 6, targetSen: 900_000_00 });
    expect(r.target.tengah).toBe(null);
    expect(r.target.porsiTercapai).toBe(0);
  });

  it('target di bawah saldo sekarang ditandai sudah tercapai', () => {
    const r = proyeksi(ringkasan(), { bulan: 6, targetSen: 1_000_00 });
    expect(r.target.sudahTercapai).toBe(true);
  });

  it('target di atas saldo sekarang tidak ditandai sudah tercapai', () => {
    const r = proyeksi(ringkasan(), { bulan: 6, targetSen: 9_000_00 });
    expect(r.target.sudahTercapai).toBe(false);
  });

  it('target yang sudah terlampaui tapi jalurnya menurun tetap melaporkan seberapa sering bertahan', () => {
    // Tiga bulan yang seluruhnya minus Rp2.000, saldo awal Rp5.000. Target
    // Rp4.000 sudah terlampaui hari ini, tapi tidak ada satu jalur pun yang
    // masih di atasnya setelah tiga bulan. Dua angka itu harus bisa dibedakan.
    const menurun = {
      bulanan: [
        bulan('Juni 2026', 10_000_00, 12_000_00),
        bulan('Juli 2026', 10_000_00, 12_000_00),
        bulan('Agustus 2026', 10_000_00, 12_000_00),
      ],
      saldoTerlihat: 5_000_00,
    };
    const r = proyeksi(menurun, { bulan: 3, targetSen: 4_000_00 });
    expect(r.target.sudahTercapai).toBe(true);
    expect(r.target.porsiBertahan).toBe(0);
  });

  it('jalur cepat sampai tidak lebih lambat daripada jalur lambat', () => {
    const r = proyeksi(ringkasan(), { bulan: 12, targetSen: 12_000_00 });
    expect(r.target.cepat).toBeLessThanOrEqual(r.target.tengah);
    expect(r.target.tengah).not.toBe(null);
  });

  it('menabung lebih banyak membuat target tercapai lebih sering', () => {
    const a = proyeksi(ringkasan(), { bulan: 6, targetSen: 20_000_00, geserPoin: 0 });
    const b = proyeksi(ringkasan(), { bulan: 6, targetSen: 20_000_00, geserPoin: 20 });
    expect(b.target.porsiTercapai).toBeGreaterThan(a.target.porsiTercapai);
  });
});

describe('saldo yang tidak dicetak', () => {
  it('tanpa saldo terlihat, proyeksinya berpindah menghitung tambahan dari nol', () => {
    const r = proyeksi(ringkasan({ saldoTerlihat: null }), { bulan: 6 });
    expect(r.dariNol).toBe(true);
    expect(r.mulaiDari).toBe(null);
  });

  it('dengan saldo terlihat, titik mulainya saldo itu', () => {
    const r = proyeksi(ringkasan(), { bulan: 6 });
    expect(r.dariNol).toBe(false);
    expect(r.mulaiDari).toBe(5_000_00);
  });

  it('akun yang saldonya tidak dicetak diteruskan supaya bisa dinyatakan', () => {
    const r = proyeksi(ringkasan({ akunTanpaSaldo: ['gopay'] }), { bulan: 6 });
    expect(r.akunTanpaSaldo).toEqual(['gopay']);
  });
});

describe('asal angkanya bisa ditelusuri', () => {
  it('hasilnya membawa rentang bulan dan jumlah jalur yang dipakai', () => {
    const r = proyeksi(ringkasan(), { bulan: 6 });
    expect(r.dasarBulan).toBe(3);
    expect(r.dariBulan).toBe('Juni 2026');
    expect(r.sampaiBulan).toBe('Agustus 2026');
    expect(r.iterasi).toBe(ITERASI);
  });
});
