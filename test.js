// Self-check for logic.js. Run: node test.js
const fs = require('fs'), vm = require('vm'), assert = require('assert/strict');
const L = vm.runInThisContext(fs.readFileSync(__dirname + '/logic.js', 'utf8') +
  ';({ merge, DEFAULT_STATE, parseAmount, parseNum, eur, balances, monthStats, weekCash, weekStart, toCSV, fromCSV })');

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
  { id: 'g', amt: 7, acc: 'cash', cat: 'c1', date: '2026-10-02', note: '', impulse: false, pre: true }, // paid before setup
];

assert.equal(L.eur(st, st.expenses[3]), 20);
const [cash, card, inr] = L.balances(st);
assert.equal(cash.bal, 800 - 19.1 - 16 - 5 - 9); // 'g' is pre: not subtracted
assert.equal(card.bal, -450);
assert.equal(inr.bal, 48000);

const m = L.monthStats(st, '2026-10');
assert.equal(m.total, 19.1 + 16 + 450 + 20 + 5 + 7);
assert.equal(m.budgetSpent, 67.1); // rent excluded, pre included
assert.equal(m.left, 632.9);
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
assert.equal(L.fromCSV(excel.replace('"marca da bollo; ""16€"""', 'stamp')).st.expenses.length, 7);

// Bad rows are skipped, not imported
const bad = L.fromCSV('type,date,account,category,amount\nexpense,28/10/2026,Cash,Groceries,5\nexpense,2026-10-28,Cash,Groceries,5');
assert.equal(bad.skipped, 1);
assert.equal(bad.st.expenses.length, 1);
assert.throws(() => L.fromCSV('hello,world'));

// Sync merge: phone and laptop each changed things since the last sync
const base = L.DEFAULT_STATE();
const ex = (id, amt, mt) => ({ id, amt, acc: 'cash', cat: 'c1', date: '2026-10-28', note: '', impulse: false, mt });
const phone = { ...base, expenses: [ex('a', 5, 10), ex('b', 7, 10), ex('p', 1, 30)], deleted: {}, metaMt: 50,
  accounts: base.accounts.map(a => a.id === 'cash' ? { ...a, start: 751 } : a), settings: { ...base.settings, onboarded: true } };
const laptop = { ...base, expenses: [ex('a', 6, 20), ex('l', 2, 25)], deleted: { b: 15 }, metaMt: 40, settings: { ...base.settings, budget: 650 } };
const mergedPL = L.merge(phone, laptop), mergedLP = L.merge(laptop, phone);
const amounts = m => Object.fromEntries(m.expenses.map(e => [e.id, e.amt]));
assert.deepEqual(amounts(mergedPL), { a: 6, l: 2, p: 1 }); // newer edit of 'a' wins, 'b' deleted, both new ones kept
assert.deepEqual(amounts(mergedLP), amounts(mergedPL)); // same result whichever side syncs
assert.equal(mergedPL.accounts[0].start, 751); // phone's setup is newer than laptop's
assert.equal(mergedLP.settings.budget, 700);
assert.equal(mergedLP.settings.onboarded, true);
// edited after being deleted elsewhere -> comes back; deleted after last edit -> stays gone
assert.equal(L.merge({ ...phone, expenses: [ex('b', 9, 20)] }, laptop).expenses.some(e => e.id === 'b'), true);
// sync data survives the file format
const viaFile = L.fromCSV(L.toCSV(mergedPL)).st;
assert.deepEqual(amounts(L.merge(L.DEFAULT_STATE(), viaFile)), amounts(mergedPL));
assert.deepEqual(viaFile.deleted, { b: 15 });
assert.equal(viaFile.metaMt, 50);
assert.equal(L.merge(L.DEFAULT_STATE(), viaFile).accounts[0].start, 751); // new device gets your setup

console.log('all checks passed');
