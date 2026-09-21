/**
 * Kunci merchant: penanda stabil untuk "tempat yang sama".
 *
 * Ini yang membuat koreksi kategori bisa diingat. User mengoreksi satu
 * transaksi, yang disimpan bukan "transaksi ini kategorinya X" melainkan
 * "merchant ini kategorinya X" — jadi transaksi lain dari tempat yang sama
 * ikut benar, termasuk yang baru diunggah bulan depan.
 *
 * Syaratnya cuma satu tapi tidak sepele: kuncinya harus sama untuk transaksi
 * yang berbeda di tempat yang sama. Berarti semua yang berubah tiap transaksi
 * harus dibuang — tanggal, nominal, nomor referensi, ID transaksi. Kalau
 * nominal ikut masuk kunci, tiap pembelian jadi "merchant" sendiri dan
 * koreksinya tidak pernah berlaku untuk apa pun selain baris yang diklik.
 *
 * Deskripsi asli tidak disentuh sama sekali. Kunci ini diturunkan darinya,
 * bukan menggantikannya.
 */

/** Bagian yang berubah tiap transaksi — dibuang dari kunci. */
const BUANG = [
  /^TGL:\s*\d{2}\/\d{2}$/i,          // penanda tanggal transaksi BCA
  /^QR\s*\d+$/i,                      // nomor terminal QR
  /^\d{3,4}\/[A-Z]+\/[A-Z0-9]+$/i,    // nomor referensi "0206/FTSCY/WS95051"
  /^[\d.,]+$/,                        // nominal polos
  /^\d{9,}$/,                         // nomor telepon / rekening
  /^[A-Z]{2}\d{8,}[A-Z0-9]*$/,        // ID transaksi "ID2615325850283L0A"
  /^[A-Za-z0-9]{16,}$/,               // ID transaksi GoPay
];

/**
 * BCA menempelkan nominal ke depan nama merchant QR: "00000.00XXI NSR".
 * Angkanya bukan bagian dari nama, dan di transaksi lain nilainya berbeda,
 * jadi harus dilepas atau tiap pembelian jadi merchant yang berlainan.
 */
const lepasAwalanNominal = (s) => s.replace(/^\d+[.,]\d{2}\s*/, '');

/**
 * @param {{description?: string, descriptionLines?: string[], type?: string}} tx
 * @returns {string|null} kunci ternormalisasi, atau null kalau tidak ada yang tersisa
 */
export function merchantKey(tx) {
  const baris =
    tx.descriptionLines && tx.descriptionLines.length
      ? tx.descriptionLines
      : String(tx.description ?? tx.type ?? '').split('|');

  const sisa = baris
    .map((s) => lepasAwalanNominal(String(s).trim()))
    .filter((s) => s && !BUANG.some((re) => re.test(s)));

  const kunci = sisa.join(' ').replace(/\s+/g, ' ').trim().toUpperCase();
  if (kunci) return kunci;

  // Sebagian transaksi tidak punya lawan transaksi sama sekali — biaya admin,
  // bunga, koreksi bank. Seluruh barisnya terbuang oleh saringan di atas dan
  // menyisakan kunci kosong. Jenis transaksinya sendiri sudah cukup stabil
  // untuk dipakai, dan tanpa ini baris-baris itu tidak bisa dikoreksi.
  const jenis = String(tx.type ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
  return jenis || null;
}

/**
 * Terapkan koreksi user di atas hasil aturan.
 *
 * Koreksi selalu menang: user melihat transaksinya sendiri dan tahu itu apa,
 * aturan cuma menebak dari kata kunci.
 *
 * Yang diubah HANYA `category` dan `categoryLabel`. `isTransfer` tidak ikut,
 * karena itu bukan selera melainkan hasil pencocokan antar akun — mengubahnya
 * dari sini akan membuat "pengeluaran nyata" bisa digeser dengan mengganti
 * label, dan angkanya berhenti bisa dipercaya.
 *
 * @param {Array} transactions
 * @param {Map<string,{category:string,categoryLabel:string}>|Array} koreksi
 */
export function terapkanKoreksi(transactions, koreksi) {
  const peta =
    koreksi instanceof Map
      ? koreksi
      : new Map((koreksi ?? []).map((k) => [k.merchantKey, k]));
  if (!peta.size) return transactions;

  return transactions.map((t) => {
    const k = merchantKey(t);
    const c = k && peta.get(k);
    if (!c) return t;
    return { ...t, category: c.category, categoryLabel: c.categoryLabel, dikoreksi: true };
  });
}
