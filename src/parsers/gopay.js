/**
 * Parser e-statement GoPay (PDF dari aplikasi Gojek).
 *
 * Mengikuti kontrak yang sama dengan parser BCA — lihat src/parsers/bca.js.
 *
 * Perbedaan penting dari BCA:
 *  - TIDAK ada saldo berjalan. Validasi bertumpu pada "Total pemasukan" dan
 *    "Total pengeluaran" di header, bukan rekonsiliasi saldo.
 *  - Nominal format Indonesia: "-Rp349.000" (titik ribuan, tanpa sen).
 *  - Arah ditentukan tanda minus, bukan penanda DB seperti BCA.
 *  - Ada baris GoPay Coins yang nilainya bukan rupiah — harus dikeluarkan
 *    dari perhitungan uang.
 *  - Ada timestamp jam:menit, tidak cuma tanggal.
 */

const COL = {
  date: [0, 90],      // Tanggal (baris 1) / jam (baris 2)
  name: [90, 260],    // Nama transaksi, bisa membungkus ke baris kedua
  txnId: [260, 375],  // ID transaksi, membungkus ke baris kedua
  method: [375, 500], // Metode pembayaran
  amount: [500, 999], // Jumlah, rata kanan
};

const MONTHS_ID = {
  januari: 1, februari: 2, maret: 3, april: 4, mei: 5, juni: 6,
  juli: 7, agustus: 8, september: 9, oktober: 10, november: 11, desember: 12,
};

/** "-Rp349.000" atau "Rp1.710.500" -> integer sen. null kalau bukan nominal rupiah. */
export function parseIdr(str) {
  const m = String(str).trim().match(/^(-)?Rp\s?([\d.]+)$/);
  if (!m) return null;
  const rupiah = parseInt(m[2].replace(/\./g, ''), 10);
  if (Number.isNaN(rupiah)) return null;
  return (m[1] ? -rupiah : rupiah) * 100;
}

function colOf(x) {
  for (const [name, [lo, hi]] of Object.entries(COL)) {
    if (x >= lo && x < hi) return name;
  }
  return null;
}

function groupIntoLines(items, tol = 2.5) {
  const buckets = [];
  for (const it of items) {
    const b = buckets.find((b) => Math.abs(b.y - it.y) <= tol);
    if (b) {
      b.cells.push(it);
      b.y = (b.y + it.y) / 2;
    } else {
      buckets.push({ y: it.y, cells: [it] });
    }
  }
  buckets.sort((a, b) => b.y - a.y);
  for (const b of buckets) b.cells.sort((a, c) => a.x - c.x);
  return buckets;
}

function lineToCols(line) {
  const out = { date: [], name: [], txnId: [], method: [], amount: [] };
  for (const c of line.cells) {
    const col = colOf(c.x);
    if (col) out[col].push(c.str.trim());
  }
  return out;
}

/** Baca periode dan total dari header halaman pertama. */
function readHeader(items) {
  const page1 = items.filter((i) => i.page === 1);
  const text = page1.map((i) => i.str).join(' ');

  const per = text.match(
    /Periode transaksi\s*:?\s*(\d{1,2})\s+(\w+)\s+(\d{4})\s*[-–]\s*(\d{1,2})\s+(\w+)\s+(\d{4})/i
  );

  let period = null;
  if (per) {
    period = {
      from: new Date(Date.UTC(+per[3], MONTHS_ID[per[2].toLowerCase()] - 1, +per[1])),
      to: new Date(Date.UTC(+per[6], MONTHS_ID[per[5].toLowerCase()] - 1, +per[4])),
      month: MONTHS_ID[per[2].toLowerCase()],
      year: +per[3],
    };
  }

  // Total pemasukan / pengeluaran: label dan nilainya ada di baris berbeda,
  // dipasangkan lewat kedekatan koordinat x.
  const findTotal = (label) => {
    const lab = page1.find((i) => i.str.trim() === label);
    if (!lab) return null;
    const cand = page1
      .filter((i) => i.y < lab.y && lab.y - i.y < 30 && Math.abs(i.x - lab.x) < 30)
      .map((i) => parseIdr(i.str))
      .filter((v) => v !== null);
    return cand.length ? cand[0] : null;
  };

  // Coins dilaporkan sebagai angka polos, bukan nominal rupiah.
  const findCoins = (label) => {
    const lab = page1.find((i) => i.str.trim() === label);
    if (!lab) return null;
    const cand = page1
      .filter((i) => i.y < lab.y && lab.y - i.y < 30 && Math.abs(i.x - lab.x) < 40)
      .map((i) => (/^\d+$/.test(i.str.trim()) ? parseInt(i.str, 10) : null))
      .filter((v) => v !== null);
    return cand.length ? cand[0] : null;
  };

  return {
    period,
    statedIn: findTotal('Total pemasukan'),
    statedOut: findTotal('Total pengeluaran'),
    coinsEarned: findCoins('Total Coins didapatkan'),
    coinsUsed: findCoins('Total Coins dipakai'),
    phone: (text.match(/\+62\d{8,}/) || [null])[0],
    // Nama pemilik akun dicetak tepat di atas nomor telepon, di kolom yang
    // sama. Dibutuhkan pencocokan transfer untuk mengenali "Ditransfer ke
    // <nama>" — tarik saldo ke rekening sendiri, bukan kirim ke orang lain.
    name: (() => {
      const tel = page1.find((i) => /^\+62\d{8,}/.test(i.str.trim()));
      if (!tel) return null;
      const atas = page1
        .filter((i) => Math.abs(i.x - tel.x) < 5 && i.y > tel.y && i.y - tel.y < 30 && i.str.trim())
        .sort((a, b) => a.y - b.y)[0];
      return atas ? atas.str.trim() : null;
    })(),
  };
}

function buildDateTime(dateStr, timeStr) {
  const d = dateStr.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!d) return null;
  const t = (timeStr || '').match(/^(\d{2}):(\d{2})$/);
  return new Date(Date.UTC(+d[3], +d[2] - 1, +d[1], t ? +t[1] : 0, t ? +t[2] : 0));
}

export function parseItems(items) {
  const header = readHeader(items);
  if (!header.period) throw new Error('Periode statement GoPay tidak ditemukan.');

  const rows = [];
  const byPage = new Map();
  for (const it of items) {
    if (!it.str.trim()) continue;
    if (!byPage.has(it.page)) byPage.set(it.page, []);
    byPage.get(it.page).push(it);
  }

  for (const page of [...byPage.keys()].sort((a, b) => a - b)) {
    let inTable = false;
    for (const line of groupIntoLines(byPage.get(page))) {
      const c = lineToCols(line);

      // Baris judul tabel menandai awal daftar transaksi di tiap halaman.
      if (c.date[0] === 'Tanggal' && c.name[0] === 'Transaksi') {
        inTable = true;
        continue;
      }
      if (!inTable) continue;

      const dateCell = c.date.find((s) => /^\d{2}\/\d{2}\/\d{4}$/.test(s));
      if (dateCell) rows.push({ date: dateCell, cols: [c] });
      else if (rows.length) rows[rows.length - 1].cols.push(c);
    }
  }

  const transactions = [];
  let coinRows = 0;
  let coinsSpentWholly = 0;  // poin dari transaksi yang dibayar 100% coins
  let coinsReceived = 0;     // poin dari baris cashback

  for (const row of rows) {
    const time = row.cols.flatMap((c) => c.date).find((s) => /^\d{2}:\d{2}$/.test(s));
    // Nama bisa membungkus; gabungkan baris-barisnya.
    const name = row.cols.flatMap((c) => c.name).join(' ').replace(/\s+/g, ' ').trim();
    const txnId = row.cols.flatMap((c) => c.txnId).join('');
    const method = [...new Set(row.cols.flatMap((c) => c.method))].join(' + ');
    const amountRaw = row.cols.flatMap((c) => c.amount).find((s) => s);

    const amountCents = parseIdr(amountRaw ?? '');

    // Baris GoPay Coins: nilainya poin, bukan rupiah. Dikeluarkan dari
    // perhitungan uang supaya total tetap cocok dengan header.
    if (amountCents === null) {
      coinRows++;
      // Nilainya poin polos. Tandanya penting: baris NEGATIF berarti transaksi
      // itu dibayar sepenuhnya dengan coins, jadi porsi rupiahnya nol dan baris
      // ini tidak pernah ikut "Total pengeluaran". Baris POSITIF adalah
      // cashback. Keduanya dicatat supaya validasi bisa memisahkan poin yang
      // tertanam di nominal rupiah dari poin yang berdiri sendiri.
      const pts = (amountRaw ?? '').trim();
      if (/^-?\d+$/.test(pts)) {
        const n = parseInt(pts, 10);
        if (n < 0) coinsSpentWholly += -n;
        else coinsReceived += n;
      }
      continue;
    }

    transactions.push({
      postedDate: buildDateTime(row.date, time),
      valueDate: buildDateTime(row.date, time),
      type: name,
      description: name,
      descriptionLines: [name],
      externalId: txnId || null,
      method,
      // Transaksi yang dibayar sebagian dengan GoPay Coins. Nominal yang
      // ditampilkan adalah nilai total, sementara "Total pengeluaran" di
      // header hanya menghitung porsi saldo rupiah. Selisihnya = coins dipakai.
      mixedPayment: /Coins/.test(method) && /Saldo/.test(method),
      amountCents,
      balanceAfterCents: null, // GoPay tidak mencetak saldo berjalan
    });
  }

  return {
    account: {
      bank: 'GOPAY',
      type: 'ewallet',
      accountNumber: header.phone,
      name: header.name,
      currency: 'IDR',
    },
    period: { month: header.period.month, year: header.period.year },
    openingBalance: null,
    closingBalance: null,
    stated: {
      creditTotal: header.statedIn,
      debitTotal: header.statedOut != null ? Math.abs(header.statedOut) : null,
    },
    meta: {
      coinRows,
      coinsEarned: header.coinsEarned,
      coinsUsed: header.coinsUsed,
      coinsSpentWholly,
      coinsReceived,
      // Poin yang tertanam di dalam nominal rupiah transaksi campuran.
      // HANYA angka ini yang boleh dikurangi dari total pengeluaran —
      // lihat catatan "Dua jenis pemakaian coins" di docs/ARCHITECTURE.md.
      coinsInMixed:
        header.coinsUsed == null ? null : header.coinsUsed - coinsSpentWholly,
    },
    transactions,
  };
}
