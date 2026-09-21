/**
 * Validasi hasil parsing terhadap angka yang tercetak di statement.
 *
 * Ini bukan tes opsional. Parser PDF gampang melewatkan baris atau salah baca
 * angka tanpa error apa pun. Pemeriksaan di bawah yang membuktikan hasil
 * parsing bisa dipercaya sebelum dipakai untuk analitik apa pun.
 */

export function validate(result) {
  const checks = [];
  const t = result.transactions;

  const credits = t.filter((x) => x.amountCents > 0);
  const debits = t.filter((x) => x.amountCents < 0);
  const sumCredit = credits.reduce((a, x) => a + x.amountCents, 0);
  const sumDebit = debits.reduce((a, x) => a - x.amountCents, 0);

  // 1. Saldo awal + kredit - debit harus persis sama dengan saldo akhir.
  const computed = result.openingBalance + sumCredit - sumDebit;
  checks.push({
    name: 'Rekonsiliasi saldo',
    ok: computed === result.closingBalance,
    expected: result.closingBalance,
    actual: computed,
  });

  // 2. Total dan jumlah transaksi harus cocok dengan blok ringkasan statement.
  if (result.stated?.creditTotal != null) {
    checks.push({
      name: 'Total mutasi kredit',
      ok: sumCredit === result.stated.creditTotal,
      expected: result.stated.creditTotal,
      actual: sumCredit,
    });
  }
  if (result.stated?.debitTotal != null) {
    checks.push({
      name: 'Total mutasi debit',
      ok: sumDebit === result.stated.debitTotal,
      expected: result.stated.debitTotal,
      actual: sumDebit,
    });
  }

  // 3. Jumlah transaksi per arah, bukan cuma nominalnya. Dua baris yang
  //    tertukar arah bisa membuat kedua total tetap cocok sementara
  //    jumlahnya meleset, jadi ini menangkap yang lolos dari pemeriksaan total.
  if (result.stated?.creditCount != null) {
    checks.push({
      name: 'Jumlah transaksi kredit',
      ok: credits.length === result.stated.creditCount,
      expected: result.stated.creditCount,
      actual: credits.length,
    });
  }
  if (result.stated?.debitCount != null) {
    checks.push({
      name: 'Jumlah transaksi debit',
      ok: debits.length === result.stated.debitCount,
      expected: result.stated.debitCount,
      actual: debits.length,
    });
  }

  // 4. Saldo berjalan per baris. BCA hanya mencetak saldo di transaksi terakhir
  //    tiap kelompok, jadi kita akumulasi dan cek tiap kali saldo muncul.
  //    Ini menangkap kesalahan yang lolos dari pemeriksaan total —
  //    misalnya dua transaksi yang nominalnya tertukar.
  let running = result.openingBalance;
  let mismatch = null;
  let checkpoints = 0;
  for (const tx of t) {
    running += tx.amountCents;
    if (tx.balanceAfterCents !== null) {
      checkpoints++;
      if (running !== tx.balanceAfterCents && !mismatch) {
        mismatch = { tx, expected: tx.balanceAfterCents, actual: running };
      }
    }
  }
  checks.push({
    name: `Saldo berjalan (${checkpoints} titik periksa)`,
    ok: !mismatch,
    detail: mismatch,
  });

  return {
    ok: checks.every((c) => c.ok),
    checks,
    stats: {
      total: t.length,
      creditCount: credits.length,
      debitCount: debits.length,
      sumCredit,
      sumDebit,
      statedCreditCount: result.stated?.creditCount ?? null,
      statedDebitCount: result.stated?.debitCount ?? null,
    },
  };
}

/**
 * Validasi sumber tanpa saldo berjalan (GoPay).
 *
 * Tidak ada saldo yang bisa direkonsiliasi, jadi jangkarnya dua total di
 * header halaman 1. Porsi GoPay Coins harus dikeluarkan lebih dulu — lihat
 * "Dua jenis pemakaian coins" di docs/ARCHITECTURE.md untuk alasan kenapa
 * yang dikurangi hanya coins di transaksi campuran.
 */
export function validateEwallet(result) {
  const t = result.transactions;
  const sumIn = t.filter((x) => x.amountCents > 0).reduce((a, x) => a + x.amountCents, 0);
  const sumOut = t.filter((x) => x.amountCents < 0).reduce((a, x) => a - x.amountCents, 0);
  const coinsCents = (result.meta?.coinsInMixed ?? 0) * 100;

  const checks = [];
  if (result.stated?.creditTotal != null) {
    checks.push({
      name: 'Total pemasukan',
      ok: sumIn === result.stated.creditTotal,
      expected: result.stated.creditTotal,
      actual: sumIn,
    });
  }
  if (result.stated?.debitTotal != null) {
    checks.push({
      name: 'Total pengeluaran',
      ok: sumOut - coinsCents === result.stated.debitTotal,
      expected: result.stated.debitTotal,
      actual: sumOut - coinsCents,
    });
  }

  return {
    ok: checks.length > 0 && checks.every((c) => c.ok),
    checks,
    stats: { total: t.length, sumIn, sumOut, coinsCents },
  };
}
