/**
 * Unit tests for the pure logic in Code.gs.
 * Run with:  node tests/logic.test.js
 * No dependencies: Code.gs is loaded into a sandbox without any Google services.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const sandbox = { console };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8'), sandbox);
const G = sandbox;
// CONFIG is a top-level const, so it is not exposed on the sandbox object.
const CONFIG = vm.runInContext('CONFIG', sandbox);

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
  } catch (err) {
    console.error('✗ ' + name);
    throw err;
  }
}
const ymd = (d) => G.dateKey(d);

test('toTitleCase', () => {
  assert.strictEqual(G.toTitleCase('  mario   ROSSI '), 'Mario Rossi');
  assert.strictEqual(G.toTitleCase("luca d'angelo"), "Luca D'Angelo");
  assert.strictEqual(G.toTitleCase('anna-maria conti'), 'Anna-Maria Conti');
  assert.strictEqual(G.toTitleCase('bianchi srl'), 'Bianchi SRL');
  assert.strictEqual(G.toTitleCase('caffè roma snc'), 'Caffè Roma SNC');
});

test('email', () => {
  assert.strictEqual(G.normalizeEmail(' Mario.Rossi@Example.COM '), 'mario.rossi@example.com');
  assert.strictEqual(G.isValidEmail('mario.rossi@example.com'), true);
  assert.strictEqual(G.isValidEmail('luca.dangelo@example'), false);
  assert.strictEqual(G.isValidEmail(''), false);
});

test('normalizePhone', () => {
  assert.strictEqual(G.normalizePhone('333 123 4567', '+39'), '+393331234567');
  assert.strictEqual(G.normalizePhone('0039 339 2223344', '+39'), '+393392223344');
  assert.strictEqual(G.normalizePhone('+39 347 9876543', '+39'), '+393479876543');
  assert.strictEqual(G.normalizePhone('328-444-5566', '+39'), '+393284445566');
  assert.strictEqual(G.normalizePhone('12', '+39'), null);
  assert.strictEqual(G.normalizePhone('', '+39'), '');
  assert.strictEqual(G.normalizePhone(3331234567, '+39'), '+393331234567');
});

test('parseDate', () => {
  assert.strictEqual(ymd(G.parseDate('2026-07-02')), '2026-07-02');
  assert.strictEqual(ymd(G.parseDate('03/07/2026')), '2026-07-03');
  assert.strictEqual(ymd(G.parseDate('05-07-2026')), '2026-07-05');
  assert.strictEqual(ymd(G.parseDate('22.07.2026')), '2026-07-22');
  assert.strictEqual(ymd(G.parseDate('5/3/26')), '2026-03-05');
  assert.strictEqual(G.parseDate('31/09/2026'), null);
  assert.strictEqual(G.parseDate('2026-02-30'), null);
  assert.strictEqual(G.parseDate('yesterday'), null);
  const d = new Date(2026, 0, 15);
  assert.strictEqual(G.parseDate(d), d);
});

test('parseNumber', () => {
  assert.strictEqual(G.parseNumber('18,90'), 18.9);
  assert.strictEqual(G.parseNumber('€ 89,00'), 89);
  assert.strictEqual(G.parseNumber('1.089,00'), 1089);
  assert.strictEqual(G.parseNumber('1,250.50'), 1250.5);
  assert.strictEqual(G.parseNumber('1.200'), 1200);
  assert.strictEqual(G.parseNumber('12.5'), 12.5);
  assert.strictEqual(G.parseNumber(7), 7);
  assert.ok(Number.isNaN(G.parseNumber('abc')));
  assert.ok(Number.isNaN(G.parseNumber('')));
});

test('normalizeStatus', () => {
  assert.strictEqual(G.normalizeStatus('Pagato'), 'Paid');
  assert.strictEqual(G.normalizeStatus('sì'), 'Paid');
  assert.strictEqual(G.normalizeStatus('da pagare'), 'Unpaid');
  assert.strictEqual(G.normalizeStatus(''), 'Unpaid');
  assert.strictEqual(G.normalizeStatus('boh'), null);
});

test('cleanRecord keeps invalid values and reports them', () => {
  const res = G.cleanRecord({
    orderId: ' a-1003', date: '31/09/2026', customer: 'luca', email: 'x@y',
    phone: '12', product: 'Mug', qty: '0', unitPrice: 'abc', status: 'boh', dueDate: 'soon',
  }, { defaultCountryCode: '+39' });
  assert.strictEqual(res.record.orderId, 'A-1003');
  assert.strictEqual(res.record.date, '31/09/2026');     // untouched
  assert.strictEqual(res.record.unitPrice, 'abc');       // untouched
  assert.strictEqual(res.record.total, '');
  assert.deepStrictEqual(Array.from(res.issues), [
    'Invalid date', 'Invalid email', 'Invalid phone', 'Invalid qty',
    'Invalid unit price', 'Unknown status', 'Invalid due date',
  ]);
});

test('findDuplicates', () => {
  const d = new Date(2026, 8, 5);
  const recs = [
    { orderId: 'A', email: 'a@b.it', product: 'Mug', date: d },
    { orderId: 'A', email: 'z@b.it', product: 'Box', date: d },  // exact (same ID)
    { orderId: 'B', email: 'a@b.it', product: 'mug', date: d },  // possible
    { _blank: true },
    { orderId: 'C', email: 'a@b.it', product: 'Mug', date: new Date(2026, 8, 6) },
  ];
  const dup = G.findDuplicates(recs);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(dup)), {
    1: { of: 0, type: 'exact' },
    2: { of: 0, type: 'possible' },
  });
});

test('selectReminders respects due date, status, interval and duplicates', () => {
  const today = new Date(2026, 9, 7);
  const base = { status: 'Unpaid', email: 'a@b.it', total: 10 };
  const recs = [
    Object.assign({}, base, { dueDate: new Date(2026, 9, 1) }),                                   // yes
    Object.assign({}, base, { dueDate: new Date(2026, 9, 7) }),                                   // due today: no
    Object.assign({}, base, { dueDate: new Date(2026, 9, 1), status: 'Paid' }),                   // paid: no
    Object.assign({}, base, { dueDate: new Date(2026, 9, 1), lastReminder: new Date(2026, 9, 3) }), // 4 days ago: no
    Object.assign({}, base, { dueDate: new Date(2026, 8, 1), lastReminder: new Date(2026, 8, 30) }), // 7 days ago: yes
    Object.assign({}, base, { dueDate: new Date(2026, 9, 1), email: 'bad' }),                     // bad email: no
    Object.assign({}, base, { dueDate: new Date(2026, 9, 1) }),                                   // duplicate: no
  ];
  assert.deepStrictEqual(Array.from(G.selectReminders(recs, today, 7, { 6: { of: 0, type: 'possible' } })), [0, 4]);
});

test('buildReminderEmail', () => {
  const mail = G.buildReminderEmail({
    customer: 'Mario Rossi', orderId: 'A-1', total: 1234.5, email: 'm@r.it', dueDate: new Date(2026, 6, 16),
  }, CONFIG);
  assert.strictEqual(mail.to, 'm@r.it');
  assert.strictEqual(mail.subject, 'Payment reminder – order A-1');
  assert.ok(mail.body.includes('€ 1.234,50'));
  assert.ok(mail.body.includes('16/07/2026'));
  assert.ok(!/\{\w+\}/.test(mail.body), 'no unfilled placeholders');
});

/* ---------- end-to-end on the sample CSV ---------- */

test('DEMO_ROWS in Code.gs match sample-orders.csv', () => {
  const csvRows = parseCsv(fs.readFileSync(path.join(__dirname, '..', 'sample-orders.csv'), 'utf8'));
  assert.strictEqual(JSON.stringify(vm.runInContext('DEMO_ROWS', sandbox)), JSON.stringify(csvRows));
});

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (ch !== '\r') field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

test('end-to-end on sample-orders.csv', () => {
  const rows = parseCsv(fs.readFileSync(path.join(__dirname, '..', 'sample-orders.csv'), 'utf8'));
  const header = rows[0];
  const keys = Object.keys(vm.runInContext('FIELDS', sandbox));
  const fields = vm.runInContext('FIELDS', sandbox);
  const required = vm.runInContext('REQUIRED_FIELDS', sandbox);
  const raw = rows.slice(1).map((r) => {
    const rec = {};
    keys.forEach((k) => { const c = header.indexOf(fields[k]); rec[k] = c > -1 ? r[c] : ''; });
    rec._blank = required.every((k) => G.isBlank(rec[k]));
    return rec;
  });

  const result = G.processRecords(raw, CONFIG);
  const recs = result.records;
  const flagged = Array.from(recs).map((r, i) => (r.issues ? `row ${i + 2}: ${r.issues}` : null)).filter(Boolean);

  // Spot checks on cleaning
  assert.strictEqual(recs[0].customer, 'Mario Rossi');
  assert.strictEqual(recs[0].email, 'mario.rossi@example.com');
  assert.strictEqual(recs[0].total, 37.8);
  assert.strictEqual(recs[1].customer, 'Giulia Bianchi');
  assert.strictEqual(recs[2].orderId, 'A-1003');
  assert.strictEqual(recs[3].customer, 'Bianchi SRL');

  // Expected problems in the demo data
  const expected = [
    'row 4: Invalid email',
    'row 8: Duplicate of row 7',
    'row 10: Invalid phone',
    'row 15: Unknown status',
    'row 16: Invalid qty',
    'row 20: Possible duplicate of row 19',
    'row 24: Invalid date',
  ];
  assert.deepStrictEqual(flagged, expected);

  // Report numbers (exact duplicates excluded, as in runBuildReport)
  const usable = recs.filter((r, i) => !r._blank && !(result.duplicates[i] && result.duplicates[i].type === 'exact'));
  const today = new Date(2026, 9, 7);
  const summary = G.buildSummary(usable, today);

  // Reminders
  const idx = Array.from(G.selectReminders(recs, today, 7, result.duplicates));
  const reminderRows = idx.map((i) => i + 2);

  console.log('\nDemo run (today = 07/10/2026)');
  console.log('Rows flagged:\n  ' + flagged.join('\n  '));
  console.log('Totals:', JSON.stringify(summary.totals));
  console.log('Months:', summary.months.map((m) => `${m.month}: ${m.orders} orders, ${m.sales.toFixed(2)}`).join(' | '));
  console.log('Top product:', summary.products[0].product, summary.products[0].sales.toFixed(2));
  console.log('Reminders due for rows:', reminderRows.join(', '));
  console.log('Example email:\n---\n' + (() => { const m = G.buildReminderEmail(recs[idx[0]], CONFIG); return 'To: ' + m.to + '\nSubject: ' + m.subject + '\n\n' + m.body; })() + '\n---');

  // A-1004, A-1007, A-1010, A-1014, A-1016 are unpaid and overdue.
  // A-1003 has an invalid email, A-1017 is a possible duplicate, A-1022/A-1019 not yet due.
  assert.deepStrictEqual(reminderRows, [5, 9, 13, 17, 19]);
});

console.log(`\n✓ ${passed} tests passed`);
