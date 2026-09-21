/**
 * Deteksi pemindahan uang antar akun milik sendiri.
 *
 * Versi pertama modul ini hanya mencocokkan nominal yang sama persis.
 * Diuji ke data asli (BCA + GoPay Juni 2026), hasilnya: 3 benar,
 * 5 salah pasang, 30 lebih tidak ketemu. Dua sebabnya:
 *
 *   1. BCA memungut biaya admin Rp1.000 tiap top up GoPay. Debit di BCA
 *      Rp81.000, yang sampai di GoPay Rp80.000. Nominalnya memang TIDAK
 *      pernah sama, jadi pencocokan persis pasti gagal.
 *
 *   2. Tanpa batasan selain nominal, pembelian QR Rp106.500 ikut
 *      dipasangkan dengan top up GoPay Rp106.500 yang kebetulan sama.
 *
 * Sekarang pencocokan butuh dua syarat sekaligus: nominal cocok setelah
 * memperhitungkan biaya, DAN kedua sisi berada di kanal yang sama.
 * Nominal saja tidak pernah cukup.
 */

const DEFAULT_OPTS = {
  windowHours: 48,
  feeCandidates: [0, 1000, 1500, 2500], // rupiah; 0 dicoba lebih dulu
};

function normPhone(p) {
  if (!p) return null;
  return String(p).replace(/\D/g, '').replace(/^62/, '0');
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Tandai transaksi BCA yang berpotensi jadi pemindahan.
 *   transferChannel — kanal tujuan ('gopay', 'shopeepay', 'ovo')
 *   transferTarget  — nomor tujuan, untuk membedakan top up ke diri
 *                     sendiri vs ke nomor orang lain
 */
export function tagBcaTransfers(transactions, ownAccounts = {}) {
  for (const t of transactions) {
    const hay = `${t.type} ${t.description}`;
    const phone = (t.descriptionLines || []).find((s) => /^0\d{9,}$/.test(s)) || null;

    if (/GOPAY TOPUP|70001\//.test(hay)) {
      t.transferChannel = 'gopay';
      t.transferTarget = phone;
      // Top up ke nomor orang lain BUKAN pemindahan antar kantong sendiri.
      // Itu uang yang benar-benar keluar dan tetap dihitung pengeluaran.
      t.isTransfer = !ownAccounts.gopay || normPhone(phone) === normPhone(ownAccounts.gopay);
      t.sentToOther = !t.isTransfer;
    } else if (/GoPay Bank Transfe|DOMPET ANAK BANGSA/i.test(hay)) {
      t.transferChannel = 'gopay';
      t.isTransfer = true;
    } else if (/SHOPEEPAY|12208\//.test(hay)) {
      t.transferChannel = 'shopeepay';
      t.transferTarget = phone;
      t.isTransfer = true;
    } else if (/\bOVO\b|39368\//.test(hay)) {
      t.transferChannel = 'ovo';
      t.isTransfer = true;
    }
  }
  return transactions;
}

/**
 * "Ditransfer ke <nama>" itu tarik saldo ke rekening sendiri atau kirim ke
 * orang lain, dan bedanya cuma dari namanya.
 *
 * Tidak bisa dicocokkan persis dari awal. Header statement memuat nama
 * panggilan ("Prayoga"), sementara baris transaksinya memuat nama lengkap
 * yang dipotong GoPay ("Muhammad Prayoga Ramadha"). Cocok-awalan gagal untuk
 * keduanya. Jadi yang diperiksa: nama dari header muncul sebagai kata utuh
 * di dalam nama tujuan.
 *
 * Batasnya jujur saja: ini heuristik. Orang lain yang namanya memuat nama
 * user akan ikut terhitung sebagai pemindahan sendiri. Pemeriksaan kata utuh
 * menahan kasus yang paling mungkin ("Prayogi", "Prayogan"), dan tujuan yang
 * disamarkan GoPay ("Ditransfer ke R*****") memang tidak akan pernah cocok —
 * itu benar, karena identitasnya tidak bisa dipastikan.
 */
function ditujukanKeDiriSendiri(teks, ownName) {
  const m = /^Ditransfer ke\s+(.*)$/i.exec(String(teks).trim());
  if (!m) return false;
  return new RegExp(`\\b${escapeRe(ownName)}\\b`, 'i').test(m[1]);
}

export function tagGopayTransfers(transactions, ownName = null) {
  for (const t of transactions) {
    if (/GoPay top up/i.test(t.type)) {
      t.transferChannel = 'gopay';
      t.isTransfer = true;
    } else if (ownName && ditujukanKeDiriSendiri(t.type, ownName)) {
      t.transferChannel = 'gopay'; // tarik saldo ke rekening sendiri
      t.isTransfer = true;
    }
  }
  return transactions;
}

export function matchTransfers(transactions, opts = {}) {
  const { windowHours, feeCandidates } = { ...DEFAULT_OPTS, ...opts };

  const outs = transactions.filter((t) => t.amountCents < 0 && t.isTransfer && t.transferChannel);
  const ins = transactions.filter((t) => t.amountCents > 0 && t.isTransfer && t.transferChannel);

  const candidates = [];
  for (const out of outs) {
    for (const inc of ins) {
      if (inc.accountId === out.accountId) continue;
      if (inc.transferChannel !== out.transferChannel) continue;

      const gapMs = Math.abs(inc.valueDate - out.valueDate);
      if (gapMs > windowHours * 3600 * 1000) continue;

      const gross = Math.abs(out.amountCents);
      const fee = feeCandidates.find((f) => gross - f * 100 === inc.amountCents);
      if (fee === undefined) continue;

      // Utamakan biaya nol, lalu selisih waktu terkecil.
      candidates.push({ out, inc, gapMs, feeCents: fee * 100, score: fee * 1e9 + gapMs });
    }
  }

  candidates.sort((a, b) => a.score - b.score);

  const used = new Set();
  const pairs = [];
  for (const c of candidates) {
    if (used.has(c.out.id) || used.has(c.inc.id)) continue;
    used.add(c.out.id);
    used.add(c.inc.id);
    const pairId = `${c.out.id}~${c.inc.id}`;
    c.out.transferPairId = pairId;
    c.inc.transferPairId = pairId;
    c.out.transferFeeCents = c.feeCents;
    pairs.push(c);
  }

  return {
    pairs,
    feesTotalCents: pairs.reduce((a, p) => a + p.feeCents, 0),
    // Ditandai pemindahan tapi pasangannya tidak ketemu. Ini BUKAN error:
    // akun pasangannya bisa saja memang belum diunggah. Tampilkan apa
    // adanya ke user, jangan disembunyikan atau ditebak.
    unmatched: transactions.filter((t) => t.isTransfer && !t.transferPairId),
  };
}

/**
 * Pengeluaran nyata: uang yang benar-benar keluar dari seluruh kantong.
 * Sisi keluar dari pemindahan berpasangan dikecualikan, KECUALI biayanya —
 * biaya admin adalah uang yang benar-benar hilang.
 */
/**
 * Pemasukan nyata: uang yang benar-benar masuk dari luar.
 *
 * Cerminan dari `realSpending` dan wajib tinggal berdampingan dengannya —
 * kalau definisinya berbeda, savings rate langsung salah. Sisi masuk dari
 * pemindahan yang berpasangan dikecualikan: itu uang sendiri yang pindah
 * kantong, bukan penghasilan.
 *
 * Pemindahan masuk yang BELUM berpasangan tetap dihitung, sama seperti sisi
 * keluarnya dihitung sebagai pengeluaran. Menebak bahwa itu uang sendiri
 * padahal pasangannya belum terlihat justru menyembunyikan aliran uang.
 */
export function realIncome(transactions) {
  let total = 0;
  for (const t of transactions) {
    if (t.amountCents <= 0) continue;
    if (t.transferPairId) continue;
    total += t.amountCents;
  }
  return total;
}

export function realSpending(transactions) {
  let total = 0;
  for (const t of transactions) {
    if (t.amountCents >= 0) continue;
    if (t.transferPairId) total += t.transferFeeCents || 0;
    else total -= t.amountCents;
  }
  return total;
}
