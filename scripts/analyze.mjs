import fs from 'fs';
import { extractItems } from '../src/extract/pdf-node.js';
import { parseItems, formatAmount } from '../src/parsers/bca.js';
import { categorizeAll } from '../src/core/categorize.js';

const data = new Uint8Array(fs.readFileSync(process.argv[2]));
const r = parseItems(await extractItems(data));
const tx = categorizeAll(r.transactions);

const fmt = (c) => formatAmount(c).padStart(16);

const groups = {};
for (const t of tx) {
  const k = t.categoryLabel;
  groups[k] ??= { in: 0, out: 0, n: 0, transfer: t.isTransfer };
  if (t.amountCents > 0) groups[k].in += t.amountCents;
  else groups[k].out -= t.amountCents;
  groups[k].n++;
}

const realOut = tx.filter(t => t.amountCents < 0 && !t.isTransfer).reduce((a,t)=>a-t.amountCents,0);
const realIn  = tx.filter(t => t.amountCents > 0 && !t.isTransfer).reduce((a,t)=>a+t.amountCents,0);
const moved   = tx.filter(t => t.isTransfer && t.amountCents < 0).reduce((a,t)=>a-t.amountCents,0);

console.log('=== RINGKASAN JUNI 2026 ===');
console.log('Uang masuk (bukan pindah kantong) :', fmt(realIn));
console.log('Pengeluaran nyata dari rekening   :', fmt(realOut));
console.log('Pindah ke e-wallet/tunai          :', fmt(moved), ' <- rinciannya belum terlihat');
console.log('');
console.log('=== PER KATEGORI (keluar) ===');
Object.entries(groups)
  .filter(([,v]) => v.out > 0)
  .sort((a,b) => b[1].out - a[1].out)
  .forEach(([k,v]) => console.log(`${(k+(v.transfer?' *':'')).padEnd(24)} ${fmt(v.out)}  ${String(v.n).padStart(3)}x`));
console.log('* = pindah kantong, bukan pengeluaran');
console.log('');
console.log('=== BELUM TERKATEGORI ===');
tx.filter(t=>t.category==='other').forEach(t =>
  console.log(`${t.postedDate.toISOString().slice(5,10)} ${fmt(t.amountCents)}  ${t.type} | ${t.description.slice(0,45)}`));
