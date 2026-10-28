// Self-check for logic.js. Run: node test.js
const fs = require('fs'), vm = require('vm'), assert = require('assert/strict');
const L = vm.runInThisContext(fs.readFileSync(__dirname + '/logic.js', 'utf8') +
  ';({ DEFAULT_STATE, parseAmount, parseNum, eur, balances, monthStats, weekCash, weekStart, toCSV, fromCSV })');

assert.equal(L.parseAmount('19,10'), 19.1);
assert.equal(L.parseAmount('16'), 16);
assert.ok(isNaN(L.parseAmount('0')) && isNaN(L.parseAmount('abc')));
assert.equal(L.parseNum('0'), 0);
assert.equal(L.weekStart('2026-10-28'), '2026-10-26'); // Wed -> Mon
assert.equal(L.weekStart('2026-11-01'), '2026-10-26'); // Sun -> Mon

const st = L.DEFAULT_STATE();
st.accounts[0].start = 800;
st.accounts[2].start = 50000;
st.expenses = [
  { id: 'a', amt: 19.1, acc: 'cash', cat: 'c1', date: '2026-10-26', note: 'Basko', impulse: false },
  { id: 'b', amt: 16, acc: 'cash', cat: 'c6', date: '2026-10-28', note: 'marca da bollo, "16€"', impulse: false },
  { id: 'c', amt: 450, acc: 'card', cat: 'c0', date: '2026-10-01', note: '', impulse: false },
  { id: 'd', amt: 2000, acc: 'inr', cat: 'c7', date: '2026-10-20', note: '', impulse: true, rate: 100 },
  { id: 'e', amt: 5, acc: 'cash', cat: 'c2', date: '2026-10-25', note: '', impulse: true }, // previous week
  { id: 'f', amt: 9, acc: 'cash', cat: 'c3', date: '2026-11-02', note: '', impulse: false }, // next month
];

assert.equal(L.eur(st, st.expenses[3]), 20);
const [cash, card, inr] = L.balances(st);
assert.equal(cash.bal, 800 - 19.1 - 16 - 5 - 9);
assert.equal(card.bal, -450);
assert.equal(inr.bal, 48000);

const m = L.monthStats(st, '2026-10');
assert.equal(m.total, 19.1 + 16 + 450 + 20 + 5);
assert.equal(m.budgetSpent, 60.1); // rent excluded
assert.equal(m.left, 639.9);
assert.equal(m.impulse, 25);

assert.deepEqual(L.weekCash(st, '2026-10-28'), { spent: 35.1, left: 14.9 });

// CSV round-trip keeps everything, including commas/quotes in notes
const back = L.fromCSV(L.toCSV(st));
assert.equal(back.skipped, 0);
assert.deepEqual(back.st.accounts, st.accounts);
assert.deepEqual(back.st.categories, st.categories);
assert.deepEqual([...back.st.expenses].sort((a, b) => a.id.localeCompare(b.id)), st.expenses);

// Excel (Italian locale) re-save: semicolons, BOM, CRLF
const excel = '﻿' + L.toCSV(st).replace(/,/g, ';').replace(/\n/g, '\r\n');
assert.equal(L.fromCSV(excel.replace('"marca da bollo; ""16€"""', 'stamp')).st.expenses.length, 6);

// Bad rows are skipped, not imported
const bad = L.fromCSV('type,date,account,category,amount\nexpense,28/10/2026,Cash,Groceries,5\nexpense,2026-10-28,Cash,Groceries,5');
assert.equal(bad.skipped, 1);
assert.equal(bad.st.expenses.length, 1);
assert.throws(() => L.fromCSV('hello,world'));

console.log('all checks passed');
