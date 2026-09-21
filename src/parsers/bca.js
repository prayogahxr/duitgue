/**
 * Parser e-statement BCA (REKENING TAHAPAN, PDF dari myBCA).
 *
 * Kontrak keluaran (sama untuk semua parser):
 *   {
 *     account:        { bank, accountNumber, holder, currency },
 *     period:         { month, year },
 *     openingBalance: <int sen>,
 *     closingBalance: <int sen>,
 *     stated:         { creditTotal, debitTotal, creditCount, debitCount } | null,
 *     transactions:   Transaction[]
 *   }
 *
 * Semua nominal disimpan sebagai INTEGER SEN (bukan float rupiah).
 * 3.290.639,04 -> 329063904. Ini wajib: float bikin validasi saldo meleset.
 */

// Batas kolom dalam koordinat x PDF (halaman A4, 595pt).
const COL = {
  date: [0, 80],      // TANGGAL
  type: [80, 190],    // KETERANGAN kolom kiri (jenis transaksi + "TANGGAL :dd/mm")
  detail: [190, 300], // KETERANGAN kolom kanan (baris keterangan)
  cbg: [300, 375],    // CBG
  mutasi: [375, 460], // MUTASI (nominal + penanda DB)
  saldo: [460, 999],  // SALDO
};

// Zona tabel secara vertikal. Di atasnya header, di bawahnya footer halaman.
const TABLE_TOP = 590;
const TABLE_BOTTOM = 45;

const MONTHS = {
  JANUARI: 1, FEBRUARI: 2, MARET: 3, APRIL: 4, MEI: 5, JUNI: 6,
  JULI: 7, AGUSTUS: 8, SEPTEMBER: 9, OKTOBER: 10, NOVEMBER: 11, DESEMBER: 12,
};

// Label blok ringkasan di halaman terakhir. Tanda ":" jatuh di kolom yang sama,
// jadi ikut ditoleransi di sini.
const SUMMARY_LABELS = /^(SALDO AWAL|MUTASI CR|MUTASI DB|SALDO AKHIR)\s*:?\s*$/;

/** "3,290,639.04" -> 329063904 (integer sen). */
export function parseAmount(str) {
  const clean = String(str).replace(/,/g, '').trim();
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  const [rp, sen = ''] = clean.split('.');
  return parseInt(rp, 10) * 100 + parseInt(sen.padEnd(2, '0') || '0', 10);
}

/** 329063904 -> "Rp3.290.639,04" */
export function formatAmount(cents) {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const rp = Math.floor(abs / 100).toLocaleString('id-ID');
  const sen = String(abs % 100).padStart(2, '0');
  return `${neg ? '-' : ''}Rp${rp},${sen}`;
}

function colOf(x) {
  for (const [name, [lo, hi]] of Object.entries(COL)) {
    if (x >= lo && x < hi) return name;
  }
  return null;
}

/**
 * Kelompokkan item teks jadi baris visual berdasarkan koordinat y.
 * Toleransi 2pt karena item di baris yang sama bisa beda sepersekian poin.
 */
function groupIntoLines(items) {
  const buckets = [];
  for (const it of items) {
    const bucket = buckets.find((b) => Math.abs(b.y - it.y) < 2);
    if (bucket) bucket.cells.push(it);
    else buckets.push({ y: it.y, cells: [it] });
  }
  buckets.sort((a, b) => b.y - a.y); // atas ke bawah
  for (const b of buckets) b.cells.sort((a, c) => a.x - c.x);
  return buckets;
}

/** Ubah satu baris visual jadi objek per kolom. */
function lineToCols(line) {
  const out = { date: [], type: [], detail: [], cbg: [], mutasi: [], saldo: [] };
  for (const c of line.cells) {
    const col = colOf(c.x);
    if (col) out[col].push(c.str.trim());
  }
  return out;
}

/** Ekstrak metadata dari header halaman (di atas zona tabel). */
function readHeader(items) {
  const text = items.map((i) => i.str).join('\n');
  const acc = text.match(/NO\. REKENING[\s\S]{0,40}?(\d{8,})/);
  const per = text.match(/\b(JANUARI|FEBRUARI|MARET|APRIL|MEI|JUNI|JULI|AGUSTUS|SEPTEMBER|OKTOBER|NOVEMBER|DESEMBER)\s+(\d{4})\b/);
  return {
    accountNumber: acc ? acc[1] : null,
    month: per ? MONTHS[per[1]] : null,
    year: per ? parseInt(per[2], 10) : null,
  };
}

/**
 * Bangun Date dari "dd/mm" + periode statement.
 * Menangani rollover: statement Desember yang memuat tanggal Januari, dan sebaliknya.
 */
function buildDate(ddmm, periodMonth, periodYear) {
  const m = ddmm.match(/^(\d{2})\/(\d{2})$/);
  if (!m) return null;
  const day = parseInt(m[1], 10);
  const mon = parseInt(m[2], 10);
  let year = periodYear;
  if (periodMonth === 12 && mon === 1) year += 1;
  else if (periodMonth === 1 && mon === 12) year -= 1;
  return new Date(Date.UTC(year, mon - 1, day));
}

/**
 * Parse teks PDF yang sudah diekstrak.
 * @param {Array<{page:number,x:number,y:number,str:string}>} items
 */
export function parseItems(items) {
  const header = readHeader(items.filter((i) => i.y > TABLE_TOP));
  if (!header.month) throw new Error('Periode statement tidak ditemukan di header PDF.');

  const rows = [];
  let summary = {};
  let summaryCount = {};
  let inSummary = false;

  const byPage = new Map();
  for (const it of items) {
    if (!it.str.trim()) continue;
    if (it.y > TABLE_TOP || it.y < TABLE_BOTTOM) continue;
    if (!byPage.has(it.page)) byPage.set(it.page, []);
    byPage.get(it.page).push(it);
  }

  for (const page of [...byPage.keys()].sort((a, b) => a - b)) {
    for (const line of groupIntoLines(byPage.get(page))) {
      const c = lineToCols(line);

      // Blok ringkasan di halaman terakhir. Labelnya jatuh di kolom "detail",
      // jadi harus dideteksi eksplisit supaya tidak dianggap lanjutan transaksi.
      const label = c.detail.join(' ').trim();
      if (SUMMARY_LABELS.test(label)) {
        inSummary = true;
        const key = label.replace(/\s*:\s*$/, "");
        const nums = [...c.cbg, ...c.mutasi].map(parseAmount).filter((n) => n !== null);
        if (nums.length) summary[key] = nums[0];
        // Baris MUTASI CR/DB juga mencetak JUMLAH transaksi di ujung kanan,
        // sebagai bilangan bulat polos — tanpa pemisah ribuan dan tanpa desimal,
        // jadi tidak bisa tertukar dengan nominal. Nominalnya sendiri jatuh di
        // kolom cbg, satu kolom di kirinya.
        const cnt = c.mutasi.map((t) => t.trim()).find((t) => /^\d{1,4}$/.test(t));
        if (cnt !== undefined) summaryCount[key] = parseInt(cnt, 10);
        continue;
      }
      if (inSummary) continue;

      const dateCell = c.date.find((s) => /^\d{2}\/\d{2}$/.test(s));

      if (dateCell) {
        rows.push({ postedDate: dateCell, cols: [c] }); // baris pertama transaksi
      } else if (rows.length) {
        rows[rows.length - 1].cols.push(c); // baris lanjutan
      }
    }
  }

  // Ubah baris mentah jadi transaksi.
  let openingBalance = null;
  const transactions = [];

  for (const row of rows) {
    const typeLines = row.cols.flatMap((c) => c.type);
    const detailLines = row.cols.flatMap((c) => c.detail);
    const cbg = row.cols.flatMap((c) => c.cbg).join('') || null;
    const mutasi = row.cols.flatMap((c) => c.mutasi);
    const saldo = row.cols.flatMap((c) => c.saldo);

    const type = (typeLines[0] || '').trim();

    // Baris SALDO AWAL: bukan transaksi, ini saldo pembukaan.
    if (/^SALDO AWAL/i.test(type)) {
      openingBalance = parseAmount(saldo[0] ?? '');
      continue;
    }

    // "TANGGAL :dd/mm" di baris kedua kolom type = tanggal transaksi sebenarnya
    // (berbeda dari tanggal posting di kolom TANGGAL).
    const valueMatch = typeLines.slice(1).join(' ').match(/TANGGAL\s*:\s*(\d{2}\/\d{2})/);

    const isDebit = mutasi.some((s) => s === 'DB');
    const amountStr = mutasi.find((s) => parseAmount(s) !== null);
    const amountCents = parseAmount(amountStr ?? '');
    if (amountCents === null) continue; // baris tanpa nominal: abaikan

    const balanceStr = saldo.find((s) => parseAmount(s) !== null);

    transactions.push({
      postedDate: buildDate(row.postedDate, header.month, header.year),
      valueDate: valueMatch
        ? buildDate(valueMatch[1], header.month, header.year)
        : buildDate(row.postedDate, header.month, header.year),
      type,
      description: detailLines.filter((s) => s !== '-').join(' | '),
      descriptionLines: detailLines,
      cbg,
      amountCents: isDebit ? -amountCents : amountCents,
      balanceAfterCents: balanceStr ? parseAmount(balanceStr) : null,
    });
  }

  const stated = {
    creditTotal: summary['MUTASI CR'] ?? null,
    debitTotal: summary['MUTASI DB'] ?? null,
    openingBalance: summary['SALDO AWAL'] ?? null,
    closingBalance: summary['SALDO AKHIR'] ?? null,
    creditCount: summaryCount['MUTASI CR'] ?? null,
    debitCount: summaryCount['MUTASI DB'] ?? null,
  };

  return {
    account: {
      bank: 'BCA',
      accountNumber: header.accountNumber,
      currency: 'IDR',
    },
    period: { month: header.month, year: header.year },
    openingBalance: openingBalance ?? stated.openingBalance,
    closingBalance:
      stated.closingBalance ??
      [...transactions].reverse().find((t) => t.balanceAfterCents !== null)?.balanceAfterCents ??
      null,
    stated,
    transactions,
  };
}
