import fs from 'fs';
import { extractItems } from '../src/extract/pdf-node.js';
import { parseItems } from '../src/parsers/gopay.js';
import { formatAmount } from '../src/parsers/bca.js';
import { validateEwallet } from '../src/core/validate.js';

const data = new Uint8Array(fs.readFileSync(process.argv[2]));
const r = parseItems(await extractItems(data));
const t = r.transactions;
const sumIn  = t.filter(x=>x.amountCents>0).reduce((a,x)=>a+x.amountCents,0);
const sumOut = t.filter(x=>x.amountCents<0).reduce((a,x)=>a-x.amountCents,0);
// Hanya poin yang tertanam di nominal rupiah transaksi campuran yang boleh
// dikurangi. Poin dari transaksi yang dibayar 100% coins tidak pernah masuk
// sumOut, jadi menguranginya berarti menghitung dua kali.
const coinsCents = (r.meta.coinsInMixed ?? 0) * 100;

console.log('Akun     :', r.account.bank, r.account.accountNumber);
console.log('Transaksi:', t.length, `| baris coins diabaikan: ${r.meta.coinRows}`);
console.log('Coins    : didapat', r.meta.coinsEarned, '| dipakai', r.meta.coinsUsed,
            `(${r.meta.coinsSpentWholly} di transaksi murni coins, ${r.meta.coinsInMixed} di transaksi campuran)`);
console.log('Bayar campuran saldo+coins:', t.filter(x=>x.mixedPayment).length, 'transaksi');
console.log('');
console.log('=== VALIDASI ===');
const v = validateEwallet(r);
for (const c of v.checks) {
  console.log(`[${c.ok ? 'LULUS' : 'GAGAL'}] ${c.name.padEnd(17)}: ${formatAmount(c.actual)} vs ${formatAmount(c.expected)}`
    + (c.ok ? '' : `  SELISIH ${formatAmount(c.actual - c.expected)}`));
}
console.log('       (nilai transaksi', formatAmount(v.stats.sumOut), 'dikurangi porsi coins campuran', formatAmount(v.stats.coinsCents) + ')');
