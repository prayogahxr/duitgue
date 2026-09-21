/**
 * Deteksi celah antar bulan.
 *
 * Dua hal berbeda yang sama-sama berarti "ada yang belum diunggah":
 *
 * 1. **Bulan yang lompat.** Ada Januari dan Maret, tidak ada Februari.
 * 2. **Saldo tidak nyambung.** Saldo akhir Januari tidak sama dengan saldo
 *    awal Februari, padahal keduanya ada. Ini lebih halus dan lebih penting:
 *    bulannya lengkap, tapi angkanya membuktikan ada mutasi yang tidak
 *    terlihat — statement yang salah, atau rekening yang sama dipakai di
 *    tempat lain.
 *
 * Keduanya dilaporkan apa adanya. Yang tidak boleh terjadi adalah diam:
 * analitik di atas data berlubang menghasilkan angka yang terlihat masuk
 * akal dan salah, dan tidak ada yang akan tahu.
 *
 * Sumber tanpa saldo berjalan (GoPay) hanya bisa diperiksa untuk bulan yang
 * lompat — tidak ada saldo yang bisa dirantai. Itu keterbatasan sumbernya,
 * bukan sesuatu yang perlu ditebak-tebak.
 */

/** "2026-06" dari {month, year}. Dipakai sebagai kunci urut. */
export function kunciPeriode(month, year) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

const keIndeksBulan = (month, year) => year * 12 + (month - 1);

const namaBulan = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

/** "Februari 2026" dari indeks bulan absolut. */
function labelDariIndeks(idx) {
  return `${namaBulan[idx % 12]} ${Math.floor(idx / 12)}`;
}

/**
 * @param {Array<{accountId, label?, month, year, openingBalance, closingBalance}>} statements
 * @returns {Array<{accountId, jenis, pesan, dari?, sampai?, selisih?}>}
 */
export function cariCelah(statements) {
  const temuan = [];
  const perAkun = new Map();
  for (const s of statements) {
    if (s.month == null || s.year == null) continue;
    if (!perAkun.has(s.accountId)) perAkun.set(s.accountId, []);
    perAkun.get(s.accountId).push(s);
  }

  for (const [accountId, daftar] of perAkun) {
    // Satu bulan bisa terunggah lebih dari sekali; yang dipakai satu saja.
    const unik = new Map();
    for (const s of daftar) unik.set(kunciPeriode(s.month, s.year), s);
    const urut = [...unik.values()].sort(
      (a, b) => keIndeksBulan(a.month, a.year) - keIndeksBulan(b.month, b.year),
    );

    for (let i = 1; i < urut.length; i++) {
      const sblm = urut[i - 1];
      const kini = urut[i];
      const jarak = keIndeksBulan(kini.month, kini.year) - keIndeksBulan(sblm.month, sblm.year);

      if (jarak > 1) {
        const hilang = [];
        for (let k = 1; k < jarak; k++) {
          hilang.push(labelDariIndeks(keIndeksBulan(sblm.month, sblm.year) + k));
        }
        temuan.push({
          accountId,
          jenis: 'bulan-hilang',
          dari: kunciPeriode(sblm.month, sblm.year),
          sampai: kunciPeriode(kini.month, kini.year),
          pesan: `${accountId}: belum ada mutasi ${hilang.join(', ')}. Unggah bulan itu supaya angkanya utuh.`,
        });
        // Saldo jelas tidak akan nyambung kalau bulannya memang bolong —
        // melaporkan keduanya cuma jadi dua pesan untuk satu sebab.
        continue;
      }

      if (sblm.closingBalance == null || kini.openingBalance == null) continue;
      if (sblm.closingBalance !== kini.openingBalance) {
        temuan.push({
          accountId,
          jenis: 'saldo-tidak-nyambung',
          dari: kunciPeriode(sblm.month, sblm.year),
          sampai: kunciPeriode(kini.month, kini.year),
          selisih: kini.openingBalance - sblm.closingBalance,
          pesan:
            `${accountId}: saldo akhir ${kunciPeriode(sblm.month, sblm.year)} tidak sama dengan ` +
            `saldo awal ${kunciPeriode(kini.month, kini.year)}. Ada mutasi yang belum terlihat.`,
        });
      }
    }
  }

  return temuan;
}
