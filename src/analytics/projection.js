/**
 * Proyeksi (Tahap 9) — "kapan gue mampu beli X".
 *
 * Modul ini meneruskan tiga aturan dari `summary.js` dan menambah satu.
 *
 * 1. **Tidak ada definisi uang yang lahir di sini.** Bahan bakunya adalah
 *    `bulanan` dari `analitik()`, yang sudah memakai `realSpending` dan
 *    `realIncome`. Tidak ada satu pun transaksi dibaca ulang di berkas ini.
 *
 * 2. **Angka yang tidak bisa dipertanggungjawabkan tidak ditampilkan.**
 *    Di bawah `MINIMAL_BULAN` bulan penuh, proyeksinya menolak menjawab.
 *    Menarik garis dua belas bulan ke depan dari dua bulan data bukan
 *    proyeksi, itu tebakan yang dikasih sumbu.
 *
 * 3. **Yang tidak diketahui tidak boleh jadi nol.** Kalau tidak ada satu
 *    pun statement yang mencetak saldo, proyeksinya tidak berpura-pura
 *    mulai dari nol rupiah — ia berpindah menghitung TAMBAHAN tabungan,
 *    dan mengatakannya.
 *
 * 4. **Keluarkan rentang, bukan satu angka.** Masa depan tidak punya satu
 *    nilai. Yang dikeluarkan persentil 10/50/90 dari ribuan jalur, dan
 *    jalurnya disusun dari bulan-bulan yang benar-benar terjadi — bukan
 *    dari rata-rata mulus yang tidak pernah dialami siapa pun.
 *
 * Caranya bootstrap: tiap bulan proyeksi mengambil satu bulan historis
 * secara acak dengan pengembalian, lalu memakai selisih masuk-keluar bulan
 * itu apa adanya. Bulan yang minus ikut terambil. Itu inti metodenya —
 * bulan buruk yang pernah terjadi tetap bisa terjadi lagi.
 */
import { MINIMAL_BULAN } from './summary.js';

/** Batas horizon. Di ROADMAP: pendek, 3-12 bulan, bukan puluhan tahun. */
export const HORIZON_MIN = 3;
export const HORIZON_MAX = 12;

/** Berapa jalur yang ditarik. Cukup supaya persentilnya stabil. */
export const ITERASI = 2000;

/** Batas atas slider, dalam poin persen dari pemasukan. */
export const GESER_MAKS = 50;

/**
 * PRNG kecil dengan benih tetap.
 *
 * Sengaja BUKAN Math.random. Dua penggambaran dengan data dan setelan yang
 * sama harus menghasilkan angka yang sama persis: angka yang berubah sendiri
 * tiap kali komponennya digambar ulang membuat orang berhenti mempercayainya,
 * dan membuat test jadi mustahil ditulis.
 */
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Benih diturunkan dari datanya sendiri, supaya tetap terikat pada isinya. */
function benih(nilai, bulan, geser) {
  let h = 2166136261;
  for (const n of [...nilai, bulan, geser]) {
    h ^= n | 0;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Persentil dengan interpolasi linear, dibulatkan ke sen.
 * `urut` harus sudah terurut menaik.
 */
function persentil(urut, p) {
  if (!urut.length) return 0;
  const i = (p / 100) * (urut.length - 1);
  const bawah = Math.floor(i);
  const atas = Math.ceil(i);
  if (bawah === atas) return Math.round(urut[bawah]);
  return Math.round(urut[bawah] + (urut[atas] - urut[bawah]) * (i - bawah));
}

/**
 * @param {object} ringkasan  hasil `analitik()`
 * @param {object} opsi
 * @param {number} opsi.bulan          horizon, 3-12
 * @param {number} opsi.geserPoin      pengeluaran turun sekian poin persen
 *                                     dari pemasukan, 0-50
 * @param {number|null} opsi.targetSen target yang ingin dicapai
 */
export function proyeksi(ringkasan, { bulan = 6, geserPoin = 0, targetSen = null } = {}) {
  const dasar = (ringkasan.bulanan ?? []).filter((b) => b.lengkap);

  if (dasar.length < MINIMAL_BULAN) {
    return {
      cukup: false,
      dasarBulan: dasar.length,
      minimalBulan: MINIMAL_BULAN,
      alasan:
        `Baru ada ${dasar.length} bulan penuh. Proyeksi ini nyusun masa depan dari ` +
        `bulan-bulan yang udah kejadian, jadi di bawah ${MINIMAL_BULAN} bulan yang ` +
        `kesusun bukan proyeksi, cuma ngulang satu-dua bulan yang kebetulan kecatat.`,
    };
  }

  const horizon = Math.min(HORIZON_MAX, Math.max(HORIZON_MIN, Math.round(bulan)));
  const geser = Math.min(GESER_MAKS, Math.max(0, geserPoin));

  // Tiap bulan historis jadi satu kemungkinan. Geseran slider mengurangi
  // pengeluaran sebesar sekian poin persen DARI PEMASUKAN bulan itu, dan
  // pengeluaran tidak bisa turun di bawah nol — "hemat 50 poin" di bulan yang
  // pengeluarannya memang kecil tidak boleh berubah jadi uang dari langit.
  const kemungkinan = dasar.map((b) => {
    const potong = Math.round((geser / 100) * b.uangMasuk);
    const keluar = Math.max(0, b.pengeluaran - potong);
    return b.uangMasuk - keluar;
  });

  const acak = mulberry32(benih(kemungkinan, horizon, geser));

  // Jalur disimpan per bulan: kolom ke-i memuat ITERASI kemungkinan nilai
  // kumulatif setelah i+1 bulan.
  const kolom = Array.from({ length: horizon }, () => new Array(ITERASI));
  // Bulan keberapa target tercapai, per jalur. Infinity kalau tidak tercapai
  // dalam horizon — sengaja bukan null, supaya bisa diurutkan dan
  // dipersentilkan bersama yang lain.
  const tercapai = targetSen != null ? new Array(ITERASI) : null;

  const mulai = ringkasan.saldoTerlihat;
  const dariNol = mulai == null;
  const awal = mulai ?? 0;

  for (let it = 0; it < ITERASI; it++) {
    let kumulatif = awal;
    let kapan = Infinity;
    for (let m = 0; m < horizon; m++) {
      kumulatif += kemungkinan[Math.floor(acak() * kemungkinan.length)];
      kolom[m][it] = kumulatif;
      if (tercapai && kapan === Infinity && kumulatif >= targetSen) kapan = m + 1;
    }
    if (tercapai) tercapai[it] = kapan;
  }

  const jalur = kolom.map((nilai, i) => {
    const urut = nilai.slice().sort((a, b) => a - b);
    return {
      bulanKe: i + 1,
      p10: persentil(urut, 10),
      p50: persentil(urut, 50),
      p90: persentil(urut, 90),
    };
  });

  let target = null;
  if (targetSen != null) {
    const urut = tercapai.slice().sort((a, b) => a - b);
    const bulanKe = (p) => {
      const v = persentil(urut.map((x) => (x === Infinity ? horizon + 1 : x)), p);
      return v > horizon ? null : v;
    };
    // Bagian jalur yang sampai ke target dalam horizon. Ini angka yang
    // sebenarnya dijawab: bukan "kapan", tapi "seberapa sering sampai".
    const porsi = urut.filter((x) => x !== Infinity).length / ITERASI;
    // Bagian jalur yang MASIH di atas target di akhir horizon. Untuk target
    // yang sudah dilampaui saldo sekarang, inilah pertanyaannya — bukan
    // "kapan sampai", tapi "apakah bertahan".
    const akhirKolom = kolom[horizon - 1];
    const bertahan = akhirKolom.filter((x) => x >= targetSen).length / ITERASI;
    target = {
      sen: targetSen,
      // Saldo yang terlihat sekarang sudah di atas target. Tanpa penanda ini,
      // target yang sudah terlampaui tapi jalurnya menurun akan dilaporkan
      // "tidak tercapai" — benar menurut hitungan, menyesatkan sebagai kalimat.
      sudahTercapai: awal >= targetSen,
      porsiTercapai: porsi,
      porsiBertahan: bertahan,
      cepat: bulanKe(10),
      tengah: bulanKe(50),
      lambat: bulanKe(90),
    };
  }

  return {
    cukup: true,
    horizon,
    geserPoin: geser,
    dasarBulan: dasar.length,
    dariBulan: dasar[0].label,
    sampaiBulan: dasar[dasar.length - 1].label,
    mulaiDari: dariNol ? null : awal,
    dariNol,
    akunTanpaSaldo: ringkasan.akunTanpaSaldo ?? [],
    iterasi: ITERASI,
    jalur,
    akhir: jalur[jalur.length - 1],
    target,
  };
}
