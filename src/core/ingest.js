/**
 * Menyatukan beberapa file jadi satu timeline.
 *
 * Alurnya sama persis dengan yang dipakai skrip di scripts/ — kenali sumber,
 * parse, validasi, beri ID, kategorikan, tandai kanal, pasangkan transfer.
 * Dipisahkan dari DOM supaya bisa diuji langsung dari fixture tanpa browser.
 *
 * Aturan yang tidak bisa ditawar: **file yang gagal validasi tidak
 * menyumbang satu baris pun** ke timeline. Hasilnya tetap dilaporkan supaya
 * user tahu file mana yang ditolak dan kenapa, tapi angkanya tidak ikut
 * dihitung. Menampilkan analitik di atas data yang belum terbukti benar
 * adalah cara tercepat kehilangan kepercayaan pada seluruh aplikasi.
 */
import { kenaliSumber } from '../parsers/index.js';
import { assignIds } from './dedupe.js';
import { categorizeAll, categorizeLabelsOnly } from './categorize.js';
import { tagBcaTransfers, tagGopayTransfers, matchTransfers, realSpending, realIncome } from './transfers.js';

/**
 * @param {Array<{nama: string, items: Array}>} berkas
 * @returns {{
 *   berkas: Array<any>,
 *   transactions: Array<any>,
 *   pairs: Array<any>,
 *   unmatched: Array<any>,
 *   ringkasan: {
 *     fileLolos: number, fileDitolak: number, jumlahTransaksi: number,
 *     pasangan: number, biayaAdmin: number, uangMasuk: number,
 *     pengeluaranMentah: number, pengeluaranNyata: number
 *   }
 * }}
 */
/**
 * Bukti bentuk berkas untuk berkas yang sumbernya tidak dikenali.
 *
 * Tidak memuat satu pun potongan teks statement. Yang dilaporkan cuma angka
 * dan jawaban ya/tidak, supaya aman ditunjukkan ke orang lain saat minta
 * bantuan.
 */
export function diagnosaSumber(items) {
  const halaman = items.length ? Math.max(...items.map((i) => i.page)) : 0;
  const teks1 = items
    .filter((i) => i.page === 1)
    .map((i) => i.str)
    .join('\n');
  return {
    halaman,
    jumlahItem: items.length,
    itemHalaman1: items.filter((i) => i.page === 1).length,
    // PDF hasil pindaian atau cetak-ke-gambar tidak punya lapisan teks sama
    // sekali. Ini sebab paling sering di balik "tidak dikenali".
    tanpaLapisanTeks: items.length === 0,
    penandaBca: /REKENING TAHAPAN|NO\. REKENING/.test(teks1),
    penandaGopay: /Total Coins didapatkan|Total Coins dipakai/.test(teks1),
  };
}

export async function ingest(berkas) {
  const hasil = [];

  for (const b of berkas) {
    const parser = kenaliSumber(b.items);
    if (!parser) {
      // "Tidak dikenali" tanpa keterangan adalah jalan buntu: user tidak bisa
      // tahu apakah berkasnya salah, PDF-nya hasil scan, atau parsernya yang
      // tidak cocok. Yang dibawa di sini BENTUK berkasnya, bukan isinya —
      // jumlah halaman, jumlah potongan teks, dan penanda mana yang ketemu.
      // Sengaja tanpa cuplikan teks: baris pertama statement memuat nama dan
      // nomor rekening, dan itu tidak boleh muncul di layar hasil yang
      // gampang di-screenshot.
      hasil.push({
        nama: b.nama,
        sumber: null,
        ok: false,
        alasan: 'sumber-tak-dikenali',
        diagnosa: diagnosaSumber(b.items),
        checks: [],
        transactions: [],
      });
      continue;
    }

    let parsed;
    try {
      parsed = parser.parse(b.items);
    } catch (e) {
      hasil.push({
        nama: b.nama,
        sumber: parser.label,
        ok: false,
        alasan: 'gagal-parse',
        pesan: e?.message ?? String(e),
        checks: [],
        transactions: [],
      });
      continue;
    }

    const v = parser.validate(parsed);
    hasil.push({
      nama: b.nama,
      sumber: parser.label,
      sumberId: parser.id,
      periode: parsed.period,
      akun: parsed.account,
      // Dipakai deteksi celah antar bulan. GoPay tidak mencetak saldo sama
      // sekali, jadi keduanya null di sana — itu benar, bukan kekurangan.
      pembukaan: parsed.openingBalance ?? null,
      penutupan: parsed.closingBalance ?? null,
      ok: v.ok,
      alasan: v.ok ? null : 'validasi-gagal',
      checks: v.checks,
      // Transaksi dari file yang gagal tetap disimpan di hasil per-file supaya
      // pesan errornya bisa menyebut jumlahnya, tapi tidak pernah digabungkan.
      transactions: await assignIds(parsed.transactions, parser.id),
    });
  }

  const lolos = hasil.filter((h) => h.ok);

  // Akun milik user diambil dari statement yang diunggah, bukan ditanyakan.
  // Ini yang membedakan "top up ke nomor sendiri" dari "kirim ke orang lain".
  const akunGopay = lolos.find((h) => h.sumberId === 'gopay')?.akun ?? null;
  const own = { gopay: akunGopay?.accountNumber ?? null };
  const ownName = akunGopay?.name ?? null;

  let semua = [];
  for (const h of lolos) {
    if (h.sumberId === 'bca') {
      semua = semua.concat(tagBcaTransfers(categorizeAll(h.transactions), own));
    } else {
      semua = semua.concat(tagGopayTransfers(categorizeLabelsOnly(h.transactions), ownName));
    }
  }
  semua.sort((a, b) => a.valueDate - b.valueDate);

  const m = matchTransfers(semua);
  const mentah = semua.filter((t) => t.amountCents < 0).reduce((a, t) => a - t.amountCents, 0);

  return {
    berkas: hasil,
    transactions: semua,
    pairs: m.pairs,
    unmatched: m.unmatched,
    ringkasan: {
      fileLolos: lolos.length,
      fileDitolak: hasil.length - lolos.length,
      jumlahTransaksi: semua.length,
      pasangan: m.pairs.length,
      biayaAdmin: m.feesTotalCents,
      uangMasuk: realIncome(semua),
      pengeluaranMentah: mentah,
      pengeluaranNyata: realSpending(semua),
    },
  };
}

/** Rp dalam sen -> "Rp1.234.567,89". Hanya untuk tampilan. */
export function rupiah(cents) {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const rp = Math.floor(abs / 100).toLocaleString('id-ID');
  return (neg ? '-' : '') + 'Rp' + rp + ',' + String(abs % 100).padStart(2, '0');
}
