/**
 * Kategorisasi berbasis aturan.
 *
 * Aturan dicoba berurutan, yang pertama cocok menang. Sengaja rule-based dulu,
 * bukan model: 80% transaksi punya penanda merchant yang jelas, dan aturan
 * bisa kamu koreksi sendiri saat lihat hasilnya salah. Model baru masuk akal
 * setelah kamu punya data berlabel dari pemakaian nyata.
 *
 * `transfer: true` menandai pemindahan antar-kantong milik sendiri.
 * Ini BUKAN pengeluaran dan harus dikeluarkan dari total belanja,
 * kalau tidak angkanya terhitung dua kali begitu mutasi e-wallet ikut masuk.
 */

const RULES = [
  // --- Pindah ke / dari kantong sendiri ---
  { id: 'topup_gopay',     label: 'Top up GoPay',      transfer: true,  match: /GOPAY TOPUP|70001\// },
  { id: 'topup_shopeepay', label: 'Top up ShopeePay',  transfer: true,  match: /SHOPEEPAY|12208\// },
  { id: 'topup_ovo',       label: 'Top up OVO',        transfer: true,  match: /\bOVO\b|39368\// },
  { id: 'gopay_cashout',   label: 'Tarik dari GoPay',  transfer: true,  match: /GoPay Bank Transfe|DOMPET ANAK BANGSA/i },
  { id: 'cash',            label: 'Tarik tunai',       transfer: true,  match: /TARIKAN ATM/ },

  // --- Tagihan ---
  { id: 'listrik',  label: 'Listrik',        match: /NEW PLN MOBI|20500\// },
  { id: 'pulsa',    label: 'Pulsa & data',   match: /Telkomsel|MyTelkomse|Asia Cell|XL |Indosat/i },

  // --- Belanja ---
  { id: 'ecommerce', label: 'E-commerce',    match: /TOKOPEDIA|80777\/|Tokoped|TAKAPEDIA|Shopee Ind|Lazada/i },
  { id: 'travel',    label: 'Travel',        match: /TRAVELOKA|22222\/|Tiket\.com/i },
  { id: 'groceries', label: 'Minimarket',    match: /ALFAMART|INDOMARET|IDM INDOMA|MIDI REGUL|ALFAMIDI/i },
  { id: 'retail',    label: 'Ritel & toko',  match: /MR DIY|TOKO TAS|ELIZABETH|MOMOYO/i },

  // --- Makan & minum: cocokkan setelah kategori spesifik di atas ---
  { id: 'fnb', label: 'Makan & minum',
    match: /WARKOP|jamur|Bakso|Hotang|STEAK|FORE |Brother sn|TEMAN NONG|chibuki|NETROPOLIS|AMERTA|Kopi|Mie |Ayam/i },

  // --- Biaya bank ---
  { id: 'fees', label: 'Biaya bank', match: /^BIAYA ADM\b|BIF BIAYA TXN/ },

  // --- Kartu debit ---
  { id: 'card', label: 'Kartu debit', match: /^KARTU DEBIT|DB INTERCHANGE|DB DEBIT DOMESTIK/ },

  // --- Transfer ke/dari orang ---
  { id: 'transfer_in',  label: 'Transfer masuk',  direction: 1,
    match: /BIF TRANSFER DR|SWITCHING CR|TRSF E-BANKING CR/ },
  { id: 'transfer_out', label: 'Transfer keluar', direction: -1,
    match: /BIF TRANSFER KE|FTSCY|FTQRS/ },
];

/**
 * Daftar kategori yang bisa dipilih user saat mengoreksi.
 *
 * Diturunkan dari RULES supaya tidak ada dua sumber kebenaran: menambah
 * aturan otomatis menambah pilihannya, dan label di dropdown selalu sama
 * dengan label yang dipakai aturan.
 */
export const KATEGORI = [
  ...RULES.map((r) => ({ id: r.id, label: r.label, transfer: !!r.transfer })),
  { id: 'other', label: 'Belum terkategori', transfer: false },
];

export function categorize(tx) {
  const hay = `${tx.type} ${tx.description}`;
  for (const r of RULES) {
    if (r.direction === 1 && tx.amountCents < 0) continue;
    if (r.direction === -1 && tx.amountCents > 0) continue;
    if (r.match.test(hay)) {
      return { category: r.id, categoryLabel: r.label, isTransfer: !!r.transfer };
    }
  }
  return { category: 'other', categoryLabel: 'Belum terkategori', isTransfer: false };
}

export function categorizeAll(transactions) {
  return transactions.map((t) => ({ ...t, ...categorize(t) }));
}

/**
 * Kategori saja, tanpa menyentuh `isTransfer`.
 *
 * Dipakai untuk sumber e-wallet. Penandaan pemindahan di sana datang dari
 * `tagGopayTransfers`, yang tahu nomor dan nama akun milik user — aturan
 * kata kunci di sini tidak tahu itu dan bisa salah menandai. Kategorinya
 * tetap berguna supaya barisnya bisa dikoreksi user seperti yang lain.
 */
export function categorizeLabelsOnly(transactions) {
  return transactions.map((t) => {
    const c = categorize(t);
    return { ...t, category: c.category, categoryLabel: c.categoryLabel };
  });
}
