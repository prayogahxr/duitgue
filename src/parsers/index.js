/**
 * Registry parser + pengenalan sumber.
 *
 * User tidak pernah ditanya "ini bank apa" — sumbernya dikenali dari isi
 * file. Statement yang sudah diunduh sudah memuat identitasnya sendiri;
 * menanyakannya lagi cuma memindahkan pekerjaan ke user dan membuka peluang
 * salah pilih yang hasilnya kacau tanpa pesan yang jelas.
 */
import * as bca from './bca.js';
import * as gopay from './gopay.js';
import { validate, validateEwallet } from '../core/validate.js';

export const PARSERS = [
  {
    id: 'bca',
    label: 'BCA',
    type: 'bank',
    parse: bca.parseItems,
    validate,
    // "REKENING TAHAPAN" dan "NO. REKENING" muncul di header tiap halaman.
    // Blok ringkasan dipakai sebagai penguat supaya file BCA jenis lain yang
    // formatnya beda tidak ikut terpilih diam-diam.
    cocok: (teks) => /REKENING TAHAPAN|NO\. REKENING/.test(teks) && /SALDO AWAL|MUTASI CR/.test(teks),
  },
  {
    id: 'gopay',
    label: 'GoPay',
    type: 'ewallet',
    parse: gopay.parseItems,
    validate: validateEwallet,
    cocok: (teks) => /Total Coins didapatkan|Total Coins dipakai/.test(teks) && /Metode pembayaran/.test(teks),
  },
];

/**
 * Kenali sumber dari item hasil ekstraksi.
 * @returns parser yang cocok, atau null kalau tidak ada yang yakin.
 */
export function kenaliSumber(items) {
  // Halaman pertama sudah memuat seluruh penanda yang dipakai, dan membatasi
  // ke situ membuat pengenalan tidak melambat untuk statement tebal.
  const teks = items
    .filter((i) => i.page === 1)
    .map((i) => i.str)
    .join('\n');
  const cocok = PARSERS.filter((p) => p.cocok(teks));
  // Dua parser mengaku cocok berarti penandanya tidak cukup tajam. Lebih baik
  // menolak dan bilang tidak dikenali daripada menebak dan salah parse.
  return cocok.length === 1 ? cocok[0] : null;
}
