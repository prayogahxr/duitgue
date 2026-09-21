import fs from 'fs';
import { extractItems } from '../src/extract/pdf-node.js';
import { parseItems, formatAmount } from '../src/parsers/bca.js';
import { validate } from '../src/core/validate.js';

const data = new Uint8Array(fs.readFileSync(process.argv[2]));
const items = await extractItems(data);
const r = parseItems(items);

console.log('Rekening :', r.account.accountNumber);
console.log('Periode  :', r.period.month + '/' + r.period.year);
console.log('Saldo awal :', formatAmount(r.openingBalance));
console.log('Saldo akhir:', formatAmount(r.closingBalance));
console.log('Transaksi  :', r.transactions.length);
console.log('');

const v = validate(r);
console.log('=== VALIDASI ===');
for (const c of v.checks) {
  const mark = c.ok ? 'LULUS' : 'GAGAL';
  let line = `[${mark}] ${c.name}`;
  if (!c.ok && c.expected !== undefined) {
    line += `  harusnya ${formatAmount(c.expected)}, dapat ${formatAmount(c.actual)}  (selisih ${formatAmount(c.actual - c.expected)})`;
  }
  console.log(line);
  if (!c.ok && c.detail) {
    const d = c.detail;
    console.log('       di:', d.tx.postedDate.toISOString().slice(0,10), d.tx.type, d.tx.description.slice(0,40));
    console.log('       harusnya', formatAmount(d.expected), 'dapat', formatAmount(d.actual));
  }
}
console.log('');
console.log('Kredit:', v.stats.creditCount, 'txn', formatAmount(v.stats.sumCredit));
console.log('Debit :', v.stats.debitCount, 'txn', formatAmount(v.stats.sumDebit));
console.log('Statement bilang:', v.stats.statedCreditCount ?? '?', 'txn CR,', v.stats.statedDebitCount ?? '?', 'txn DB');
