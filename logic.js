// Pure data functions, no DOM. Used by index.html and test.js.

const DEFAULT_STATE = () => ({
  accounts: [
    { id: 'cash', name: 'Cash', cur: 'EUR', start: 0 },
    { id: 'card', name: 'Card', cur: 'EUR', start: 0 },
    { id: 'inr', name: 'Indian bank', cur: 'INR', start: 0 },
  ],
  categories: ['Rent & deposit', 'Groceries', 'Drinks & snacks', 'Eating out', 'Transport',
    'Phone & data', 'Paperwork & fees', 'Study', 'Health', 'Other']
    .map((name, i) => ({ id: 'c' + i, name, noBudget: i === 0 })),
  // amt is in the account's currency; rate (INR per 1 EUR) only on INR entries
  expenses: [], // each may carry mt = last edit time (ms), used by sync
  deleted: {}, // id -> time deleted, so a sync doesn't bring deleted entries back
  metaMt: 0, // last edit of accounts/categories/budget, newest device wins
  settings: { budget: 700, weekly: 50, rate: null, onboarded: false },
});

const round2 = n => Math.round(n * 100) / 100;
// accepts "19,10" (Italian iPhone keyboard) and "19.10"
const parseNum = s => { const n = parseFloat(String(s).replace(/\s/g, '').replace(',', '.')); return isFinite(n) ? round2(n) : NaN; };
const parseAmount = s => { const n = parseNum(s); return n > 0 ? n : NaN; };
const sum = (list, f) => round2(list.reduce((s, x) => s + f(x), 0));

const accOf = (st, id) => st.accounts.find(a => a.id === id);
const eur = (st, e) => accOf(st, e.acc)?.cur === 'INR' ? e.amt / e.rate : e.amt;

// local-time YYYY-MM-DD (toISOString would shift the day near midnight)
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (s, n) => { const d = new Date(s + 'T12:00'); d.setDate(d.getDate() + n); return ymd(d); };
const weekStart = s => addDays(s, -((new Date(s + 'T12:00').getDay() + 6) % 7)); // Monday

// balance in the account's own currency; "pre" entries were paid before the start balance was counted
const balances = st => st.accounts.map(a => ({ ...a, bal: round2(a.start - sum(st.expenses.filter(e => e.acc === a.id && !e.pre), e => e.amt)) }));

const outsideBudget = st => new Set(st.categories.filter(c => c.noBudget).map(c => c.id));

function monthStats(st, ym) { // ym = 'YYYY-MM'
  const out = outsideBudget(st);
  const list = st.expenses.filter(e => e.date.startsWith(ym));
  const byCat = {};
  for (const e of list) byCat[e.cat] = round2((byCat[e.cat] || 0) + eur(st, e));
  const budgetSpent = sum(list.filter(e => !out.has(e.cat)), e => eur(st, e));
  return {
    list, byCat, budgetSpent,
    total: sum(list, e => eur(st, e)),
    left: round2(st.settings.budget - budgetSpent),
    impulse: sum(list.filter(e => e.impulse), e => eur(st, e)),
  };
}

// weekly allowance counts Cash-account spending Mon–Sun, excluding outside-budget categories
function weekCash(st, day) {
  const from = weekStart(day), to = addDays(from, 6), out = outsideBudget(st);
  const spent = sum(st.expenses.filter(e => e.acc === 'cash' && e.date >= from && e.date <= to && !out.has(e.cat)), e => e.amt);
  return { spent, left: round2(st.settings.weekly - spent) };
}

const sortExpenses = list => [...list].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));

// ---- CSV backup: one file holds accounts, categories, settings and expenses (by "type") ----
const CSV_COLS = ['type', 'date', 'account', 'category', 'amount', 'currency', 'eur', 'rate', 'impulse', 'before_start', 'note', 'id', 'modified'];

function toCSV(st) {
  const q = v => /[",;\n\r]/.test(v = String(v ?? '')) ? `"${v.replace(/"/g, '""')}"` : v;
  const rows = [
    ...st.accounts.map(a => ({ type: 'account', account: a.name, amount: a.start, currency: a.cur, id: a.id })),
    ...st.categories.map(c => ({ type: 'category', category: c.name, note: c.noBudget ? 'outside budget' : '', id: c.id })),
    ...['budget', 'weekly', 'rate'].map(k => ({ type: 'setting', note: k, amount: st.settings[k] })),
    { type: 'setting', note: 'meta_modified', amount: st.metaMt || 0 },
    ...Object.entries(st.deleted || {}).map(([id, t]) => ({ type: 'deleted', id, modified: t })),
    ...sortExpenses(st.expenses).reverse().map(e => {
      const a = accOf(st, e.acc);
      return { type: 'expense', date: e.date, account: a?.name, category: st.categories.find(c => c.id === e.cat)?.name,
        amount: e.amt, currency: a?.cur, eur: round2(eur(st, e)), rate: e.rate, impulse: e.impulse ? 'yes' : '', before_start: e.pre ? 'yes' : '', note: e.note, id: e.id, modified: e.mt };
    }),
  ];
  return [CSV_COLS.join(','), ...rows.map(r => CSV_COLS.map(c => q(r[c])).join(','))].join('\n') + '\n';
}

function parseCSV(text, sep) {
  const rows = []; let row = [], f = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c !== '"') f += c;
      else if (text[i + 1] === '"') { f += '"'; i++; }
      else quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === sep) { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(f); rows.push(row); row = []; f = '';
    } else f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows;
}

// Returns { st, skipped }. Throws if the file isn't a backup.
function fromCSV(text) {
  text = text.replace(/^﻿/, '');
  const first = text.split(/\r?\n/)[0];
  const sep = first.includes(';') && !first.includes(',') ? ';' : ','; // Excel in Italian saves with ;
  const [head, ...rows] = parseCSV(text, sep);
  if (head?.[0]?.trim() !== 'type') throw new Error('This is not a Spend backup file.');
  const recs = rows.filter(r => r.some(x => x.trim()))
    .map(r => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
  const of = t => recs.filter(r => r.type === t);
  const cur = s => s === 'INR' ? 'INR' : 'EUR';

  const st = DEFAULT_STATE();
  if (of('account').length) st.accounts = of('account').map((r, i) => ({ id: r.id || 'a' + i, name: r.account, cur: cur(r.currency), start: parseNum(r.amount) || 0 }));
  if (of('category').length) st.categories = of('category').map((r, i) => ({ id: r.id || 'k' + i, name: r.category, noBudget: r.note === 'outside budget' }));
  for (const r of of('setting')) {
    const n = parseNum(r.amount);
    if (['budget', 'weekly', 'rate'].includes(r.note) && !isNaN(n)) st.settings[r.note] = n;
    if (r.note === 'meta_modified' && n > 0) { st.metaMt = n; st.settings.onboarded = true; }
  }
  for (const r of of('deleted')) if (r.id && +r.modified) st.deleted[r.id] = +r.modified;
  const findOrAdd = (list, name, make) => list.find(x => x.name === name) ?? (list.push(make()), list.at(-1));
  const ids = new Set();
  let skipped = 0;
  of('expense').forEach((r, i) => {
    const amt = parseAmount(r.amount), rate = parseAmount(r.rate);
    if (!amt || !/^\d{4}-\d{2}-\d{2}$/.test(r.date) || !r.account || !r.category) return skipped++;
    const a = findOrAdd(st.accounts, r.account, () => ({ id: 'a' + st.accounts.length, name: r.account, cur: cur(r.currency), start: 0 }));
    if (a.cur === 'INR' && !rate) return skipped++;
    const c = findOrAdd(st.categories, r.category, () => ({ id: 'k' + st.categories.length, name: r.category, noBudget: false }));
    const id = r.id && !ids.has(r.id) ? r.id : 'i' + i;
    ids.add(id);
    st.expenses.push({ id, amt, acc: a.id, cat: c.id, date: r.date, note: r.note, impulse: r.impulse === 'yes', ...(r.before_start === 'yes' && { pre: true }), ...(a.cur === 'INR' && { rate }), ...(+r.modified && { mt: +r.modified }) });
  });
  return { st, skipped };
}

// Combine two copies of the data (this device + a file or Google Drive) without losing edits:
// newest version of each expense wins, deletions win over older edits, newest accounts/budget win.
function merge(a, b) {
  const deleted = { ...a.deleted };
  for (const [id, t] of Object.entries(b.deleted || {})) deleted[id] = Math.max(deleted[id] || 0, t);
  const byId = new Map();
  for (const e of [...a.expenses, ...b.expenses]) if (!byId.has(e.id) || (e.mt || 0) > (byId.get(e.id).mt || 0)) byId.set(e.id, e);
  const meta = (b.metaMt || 0) > (a.metaMt || 0) ? b : a;
  const synced = ['budget', 'weekly', 'rate', 'onboarded'].reduce((o, k) => (o[k] = meta.settings[k] ?? a.settings[k], o), {});
  return {
    ...a, accounts: meta.accounts, categories: meta.categories, metaMt: meta.metaMt || 0,
    settings: { ...a.settings, ...synced, onboarded: !!(a.settings.onboarded || b.settings.onboarded) },
    expenses: [...byId.values()].filter(e => !(deleted[e.id] >= (e.mt || 0))),
    deleted,
  };
}
