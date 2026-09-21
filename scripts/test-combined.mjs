import fs from 'fs';
import crypto from 'crypto';
import { extractItems } from '../src/extract/pdf-node.js';
import * as bca from '../src/parsers/bca.js';
import * as gopay from '../src/parsers/gopay.js';
import { tagBcaTransfers, tagGopayTransfers, matchTransfers, realSpending } from '../src/core/transfers.js';
import { categorizeAll } from '../src/core/categorize.js';
const { formatAmount } = bca;
const f = (c,w=14)=>formatAmount(c).padStart(w);

import { assignIds } from '../src/core/dedupe.js';

const load = async (p, parser, accountId) => {
  const r = parser.parseItems(await extractItems(new Uint8Array(fs.readFileSync(p))));
  return await assignIds(r.transactions, accountId);
};

const OWN = { gopay: process.env.GOPAY_PHONE || '085283216092' };
const B = tagBcaTransfers(categorizeAll(await load(process.argv[2], bca, 'bca')), OWN);
const G = tagGopayTransfers(await load(process.argv[3], gopay, 'gopay'), process.env.OWN_NAME || 'Muhammad Prayoga');

const all = [...B, ...G].sort((a,b)=>a.valueDate-b.valueDate);
const m = matchTransfers(all);

console.log('=== PENCOCOKAN TRANSFER ===');
console.log('Pasangan ketemu :', m.pairs.length);
console.log('Biaya admin total:', formatAmount(m.feesTotalCents));
console.log('');
m.pairs.sort((a,b)=>a.out.valueDate-b.out.valueDate).forEach(p=>console.log(
  ' ', p.out.valueDate.toISOString().slice(0,10),
  f(Math.abs(p.out.amountCents)), '->', f(p.inc.amountCents),
  `biaya ${formatAmount(p.feeCents).padStart(10)}`,
  ` ${p.out.accountId}→${p.inc.accountId}`));
console.log('');
console.log('=== TIDAK KETEMU PASANGANNYA ===');
// Tarikan ATM ditandai pemindahan oleh categorize.js — uang pindah ke kantong
// tunai — tapi tidak punya transferChannel, karena tidak ada akun pasangan yang
// bisa dicocokkan. Tanpa fallback, kuncinya jadi string "undefined".
const channelLabel = (t) =>
  t.transferChannel ?? (t.categoryLabel ? t.categoryLabel.toLowerCase() : 'tanpa kanal');

const byCh = {};
m.unmatched.forEach(t=>{ (byCh[channelLabel(t)] ??= []).push(t); });
for (const [ch, list] of Object.entries(byCh)) {
  const sum = list.reduce((a,t)=>a+Math.abs(t.amountCents),0);
  console.log(`  ${ch}: ${list.length} transaksi, ${formatAmount(sum)}`);
  list.forEach(t=>console.log('     ', t.valueDate.toISOString().slice(0,10), f(t.amountCents), t.accountId.padEnd(6), t.type.slice(0,30)));
}
console.log('');
console.log('=== DIKIRIM KE NOMOR ORANG LAIN (bukan transfer sendiri) ===');
B.filter(t=>t.sentToOther).forEach(t=>console.log(' ', t.valueDate.toISOString().slice(0,10), f(t.amountCents), 'ke', t.transferTarget));
console.log('');
console.log('=== TOTAL ===');
const naive = all.filter(t=>t.amountCents<0).reduce((a,t)=>a-t.amountCents,0);
console.log('Jumlah mentah dua sumber :', f(naive));
console.log('Pengeluaran nyata        :', f(realSpending(all)));
console.log('Selisih (double counting):', f(naive - realSpending(all)));
