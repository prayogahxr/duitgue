/**
 * Analitik (Tahap 8).
 *
 * Aturan pertama modul ini: **tidak ada definisi uang yang lahir di sini.**
 * "Pengeluaran nyata" dan "pemasukan nyata" diambil dari
 * `src/core/transfers.js`. Kalau lapisan analitik boleh mendefinisikan
 * ulang, cepat atau lambat angka di layar depan berbeda dari angka di
 * timeline dan tidak ada yang tahu mana yang benar.
 *
 * Aturan kedua: **angka yang tidak bisa dipertanggungjawabkan tidak
 * ditampilkan.** Tiap metrik membawa jumlah bulan yang mendasarinya, dan
 * yang butuh tren menolak menjawab kalau datanya di bawah tiga bulan.
 * Lebih baik berkata "belum cukup" daripada memberi angka meyakinkan dari
 * dua titik.
 *
 * Aturan ketiga: **yang belum terlihat tidak boleh jadi nol.** Uang yang
 * pindah ke kantong yang statement-nya belum diunggah punya barisnya
 * sendiri, bukan dilebur ke pengeluaran biasa dan bukan dihilangkan.
 */
import { realSpending, realIncome } from '../core/transfers.js';
import { kunciPeriode } from '../core/gaps.js';

/** Bulan minimum supaya tren punya arti. Di bawah ini, tren tidak dijawab. */
export const MINIMAL_BULAN = 3;

const namaBulan = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

export const labelPeriode = (kunci) => {
  const [th, bl] = kunci.split('-');
  return `${namaBulan[parseInt(bl, 10) - 1]} ${th}`;
};

/**
 * Pecah transaksi per bulan menurut `valueDate` — tanggal transaksi
 * sebenarnya, bukan tanggal masuk sistem bank. Memakai `postedDate` akan
 * menggeser transaksi akhir bulan ke bulan berikutnya.
 */
function perBulan(transactions) {
  const peta = new Map();
  for (const t of transactions) {
    if (!t.valueDate) continue;
    // WAJIB getter UTC. Parser membangun tanggal dengan Date.UTC dari tanggal
    // yang TERCETAK di statement, jadi komponen UTC-lah yang memuat tanggal
    // asli. Membacanya dengan getMonth() lokal menggeser transaksi malam ke
    // hari — dan kadang bulan — berikutnya: transaksi GoPay 31/08 pukul 21:15
    // WIB sempat muncul sebagai bulan September tersendiri.
    const k = kunciPeriode(t.valueDate.getUTCMonth() + 1, t.valueDate.getUTCFullYear());
    if (!peta.has(k)) peta.set(k, []);
    peta.get(k).push(t);
  }
  return [...peta.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

/** Uang yang pindah ke kantong yang statement-nya belum diunggah. */
function belumTerlihat(transactions) {
  const perKanal = new Map();
  let total = 0;
  for (const t of transactions) {
    if (t.amountCents >= 0 || !t.isTransfer || t.transferPairId) continue;
    const kanal = t.transferChannel ?? (t.categoryLabel ? t.categoryLabel.toLowerCase() : 'tujuan lain');
    perKanal.set(kanal, (perKanal.get(kanal) ?? 0) + -t.amountCents);
    total += -t.amountCents;
  }
  return {
    total,
    perKanal: [...perKanal.entries()]
      .map(([kanal, jumlah]) => ({ kanal, jumlah }))
      .sort((a, b) => b.jumlah - a.jumlah),
  };
}

/**
 * Persentase pemasukan yang tidak habis.
 * Tanpa pemasukan, rasionya tidak terdefinisi — bukan nol, bukan minus tak
 * hingga. Dikembalikan null supaya lapisan tampilan bisa mengatakannya.
 */
function savingsRate(masuk, keluar) {
  if (masuk <= 0) return null;
  return ((masuk - keluar) / masuk) * 100;
}

/** Perubahan dari bulan pertama ke bulan terakhir, dalam persen. */
function perubahan(awal, akhir) {
  if (awal <= 0) return null;
  return ((akhir - awal) / awal) * 100;
}

/**
 * @param {Array} transactions  seluruh transaksi tersimpan
 * @param {Array} uploads       catatan statement, untuk saldo akhir per bulan
 */
export function analitik(transactions, uploads = []) {
  // Bulan yang benar-benar tercakup statement. Statement bisa memuat baris
  // yang tanggal transaksinya jatuh di bulan sebelum atau sesudahnya, dan
  // tanpa penanda ini potongan itu jadi "bulan" tersendiri berisi dua
  // transaksi — cukup untuk membuat tren pengeluaran terlihat anjlok 99%.
  const tercakup = new Set(
    uploads.filter((u) => u.month != null).map((u) => kunciPeriode(u.month, u.year)),
  );

  const bulanan = perBulan(transactions).map(([periode, trx]) => {
    const masuk = realIncome(trx);
    const keluar = realSpending(trx);
    return {
      periode,
      label: labelPeriode(periode),
      jumlahTransaksi: trx.length,
      uangMasuk: masuk,
      pengeluaran: keluar,
      sisa: masuk - keluar,
      savingsRate: savingsRate(masuk, keluar),
      belumTerlihat: belumTerlihat(trx).total,
      lengkap: tercakup.size === 0 || tercakup.has(periode),
    };
  });

  // Hanya bulan penuh yang boleh jadi dasar tren dan rata-rata.
  const bulanPenuh = bulanan.filter((b) => b.lengkap);
  const cukup = bulanPenuh.length >= MINIMAL_BULAN;

  // ---- Saldo per akhir bulan, dari statement, bukan ditebak ----------------
  //
  // Hanya sumber yang MENCETAK saldo yang bisa dihitung. GoPay tidak mencetak
  // saldo sama sekali, jadi kekayaan bersih di sini adalah kekayaan yang
  // terlihat, bukan seluruhnya. Itu dinyatakan, bukan disamarkan dengan
  // menganggap saldo GoPay nol.
  const akunBersaldo = new Set(
    uploads.filter((u) => u.closingBalance != null).map((u) => u.accountId),
  );
  const akunTanpaSaldo = [...new Set(uploads.map((u) => u.accountId))].filter(
    (a) => !akunBersaldo.has(a),
  );

  const petaSaldo = new Map();
  for (const u of uploads) {
    if (u.closingBalance == null || u.month == null) continue;
    const k = kunciPeriode(u.month, u.year);
    if (!petaSaldo.has(k)) petaSaldo.set(k, new Map());
    petaSaldo.get(k).set(u.accountId, u.closingBalance);
  }
  const netWorth = [...petaSaldo.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([periode, perAkun]) => ({
      periode,
      label: labelPeriode(periode),
      perAkun: [...perAkun.entries()].map(([accountId, saldo]) => ({ accountId, saldo })),
      total: [...perAkun.values()].reduce((a, b) => a + b, 0),
    }));

  // ---- Runway -------------------------------------------------------------
  //
  // Saldo terakhir yang terlihat dibagi rata-rata pengeluaran bulanan.
  // Rata-rata dihitung dari bulan penuh yang ada; dengan satu bulan angkanya
  // hampir tidak berarti, jadi ikut dibatasi MINIMAL_BULAN.
  const saldoTerakhir = netWorth.length ? netWorth[netWorth.length - 1].total : null;
  const rataPengeluaran = bulanPenuh.length
    ? bulanPenuh.reduce((a, b) => a + b.pengeluaran, 0) / bulanPenuh.length
    : 0;
  const runwayBulan =
    cukup && saldoTerakhir != null && rataPengeluaran > 0
      ? saldoTerakhir / rataPengeluaran
      : null;

  // ---- Lifestyle creep ----------------------------------------------------
  //
  // Pertumbuhan pengeluaran dibanding pertumbuhan pemasukan, dari bulan
  // pertama ke bulan terakhir. Selisihnya dalam POIN PERSEN: positif berarti
  // pengeluaran tumbuh lebih cepat daripada pemasukan.
  let creep = null;
  if (cukup) {
    const a = bulanPenuh[0];
    const z = bulanPenuh[bulanPenuh.length - 1];
    const dKeluar = perubahan(a.pengeluaran, z.pengeluaran);
    const dMasuk = perubahan(a.uangMasuk, z.uangMasuk);
    if (dKeluar != null && dMasuk != null) {
      creep = {
        pengeluaran: dKeluar,
        pemasukan: dMasuk,
        selisih: dKeluar - dMasuk,
        dari: a.label,
        sampai: z.label,
        titikData: bulanPenuh.length,
      };
    }
  }

  // ---- Rincian per kategori ----------------------------------------------
  //
  // Sisi keluar dari pemindahan yang BERPASANGAN sudah dikeluarkan oleh
  // realSpending; di sini rinciannya dipecah dengan aturan yang sama supaya
  // jumlah seluruh kategori sama persis dengan total pengeluaran nyata.
  // Pemindahan yang belum berpasangan SENGAJA tidak masuk daftar kategori.
  // Uang itu memang keluar dari rekening, tapi kita belum tahu dibelanjakan
  // untuk apa — menaruhnya sebagai "Top up ShopeePay" di antara kategori
  // belanja membuatnya terbaca seolah itu jenis pengeluaran, padahal itu
  // justru bagian yang belum terlihat. Dipisah ke posnya sendiri, dan
  // penjumlahannya tetap utuh:
  //
  //     total kategori + total belum terlihat === pengeluaran nyata
  const kategori = new Map();
  for (const t of transactions) {
    if (t.amountCents >= 0) continue;
    if (t.isTransfer && !t.transferPairId) continue;
    const nilai = t.transferPairId ? t.transferFeeCents || 0 : -t.amountCents;
    if (!nilai) continue;
    // Top up ke nomor orang lain dikategorikan "Top up GoPay" oleh aturan,
    // dan di daftar pengeluaran label itu menyesatkan: terbaca seperti pindah
    // kantong sendiri padahal uangnya benar-benar dikirim keluar. Diberi
    // namanya sendiri supaya tidak ada yang bertanya kenapa "pindah kantong"
    // ikut dihitung sebagai belanja.
    const label = t.transferPairId
      ? 'Biaya pemindahan'
      : t.sentToOther
        ? 'Dikirim ke nomor orang lain'
        : (t.categoryLabel ?? 'Belum terkategori');
    const k = kategori.get(label) ?? { label, jumlah: 0, n: 0 };
    k.jumlah += nilai;
    k.n++;
    kategori.set(label, k);
  }

  const totalMasuk = realIncome(transactions);
  const totalKeluar = realSpending(transactions);

  return {
    jumlahBulan: bulanan.length,
    jumlahBulanPenuh: bulanPenuh.length,
    cukupData: cukup,
    minimalBulan: MINIMAL_BULAN,
    bulanan,
    total: {
      uangMasuk: totalMasuk,
      pengeluaran: totalKeluar,
      sisa: totalMasuk - totalKeluar,
      savingsRate: savingsRate(totalMasuk, totalKeluar),
    },
    // Savings rate bulan terakhir: angka yang paling menjawab
    // "gue lagi baik-baik aja nggak?" tanpa dilunakkan rata-rata.
    bulanTerakhir: bulanPenuh.length ? bulanPenuh[bulanPenuh.length - 1] : null,
    runwayBulan,
    saldoTerlihat: saldoTerakhir,
    akunTanpaSaldo,
    netWorth,
    creep,
    perKategori: [...kategori.values()].sort((a, b) => b.jumlah - a.jumlah),
    belumTerlihat: belumTerlihat(transactions),
  };
}
