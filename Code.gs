/**
 * Order Automation for Google Sheets
 * ----------------------------------
 * Cleans and validates an order list, flags duplicates, builds a sales
 * report with a chart, and sends payment reminders for overdue invoices.
 *
 * Structure:
 *   1. CONFIG            – everything a client may want to change
 *   2. Pure logic        – no Google services, unit-tested in Node (see /tests)
 *   3. Sheets / Gmail    – reads and writes the spreadsheet, menu, triggers
 */

/* =====================================================================
 * 1. CONFIG
 * ===================================================================== */

const CONFIG = {
  ORDERS_SHEET: 'Orders',
  REPORT_SHEET: 'Report',
  LOG_SHEET: 'Log',

  BUSINESS_NAME: 'Your Business',
  REPLY_TO: '',                    // e.g. 'billing@yourbusiness.com' (optional)
  DEFAULT_COUNTRY_CODE: '+39',     // added to phone numbers without a prefix
  CURRENCY_SYMBOL: '€',
  MONEY_FORMAT: '"€"#,##0.00',
  DATE_FORMAT: 'dd/mm/yyyy',

  REMINDER_INTERVAL_DAYS: 7,       // min days between two reminders to the same order
  MAX_EMAILS_PER_RUN: 50,
  AUTO_SEND_REMINDERS: false,      // if true, the daily schedule also sends emails
  DAILY_HOUR: 8,

  REMINDER_SUBJECT: 'Payment reminder – order {orderId}',
  REMINDER_BODY:
    'Hello {customer},\n\n' +
    'this is a friendly reminder that order {orderId} ({total}) was due on {dueDate} ' +
    'and is still marked as unpaid on our side.\n\n' +
    'If you have already paid, please ignore this message.\n\n' +
    'Kind regards,\n{business}',

  COLORS: {
    ISSUE: '#f8d7da',      // light red – row has validation problems
    DUPLICATE: '#fff3cd',  // light yellow – row is a (possible) duplicate
  },
};

/** Column headers expected in the Orders sheet, keyed by internal field name. */
const FIELDS = {
  orderId: 'Order ID',
  date: 'Date',
  customer: 'Customer',
  email: 'Email',
  phone: 'Phone',
  product: 'Product',
  qty: 'Qty',
  unitPrice: 'Unit Price',
  status: 'Status',
  dueDate: 'Due Date',
  // Managed columns: created automatically if missing.
  total: 'Total',
  lastReminder: 'Last Reminder',
  issues: 'Issues',
};

const REQUIRED_FIELDS = [
  'orderId', 'date', 'customer', 'email', 'phone',
  'product', 'qty', 'unitPrice', 'status', 'dueDate',
];
const MANAGED_FIELDS = ['total', 'lastReminder', 'issues'];

/** Demo rows (same as sample-orders.csv): messy on purpose. Emails use reserved example domains. */
const DEMO_ROWS = [
  ["Order ID", "Date", "Customer", "Email", "Phone", "Product", "Qty", "Unit Price", "Status", "Due Date"],
  ["A-1001", "2026-07-02", "mario rossi", "Mario.Rossi@Example.com", "333 123 4567", "Espresso Beans 1kg", "2", "18,90", "pagato", "2026-07-16"],
  ["A-1002", "03/07/2026", "  GIULIA   BIANCHI ", "giulia.bianchi@example.com", "+39 347 9876543", "Ceramic Mug", "4", "9,50", "Paid", "17/07/2026"],
  ["a-1003", "05-07-2026", "luca d'angelo", "luca.dangelo@example", "3401112223", "Moka Pot 3 cups", "1", "24,00", "da pagare", "19/07/2026"],
  ["A-1004", "2026-07-08", "bianchi srl", "orders@bianchi.example.org", "06 5551234", "Gift Box", "10", "35,00", "unpaid", "2026-08-07"],
  ["A-1005", "12/07/2026", "sara verdi", "sara.verdi@example.com", "", "Espresso Beans 1kg", "3", "18,90", "yes", "26/07/2026"],
  ["A-1006", "15/07/2026", "Paolo Neri", "paolo.neri@example.com", "328-444-5566", "Grinder", "1", "€ 89,00", "Paid", "29/07/2026"],
  ["A-1006", "15/07/2026", "Paolo Neri", "paolo.neri@example.com", "328-444-5566", "Grinder", "1", "€ 89,00", "Paid", "29/07/2026"],
  ["A-1007", "2026-07-20", "anna-maria conti", "anna.conti@example.com", "0039 339 2223344", "Ceramic Mug", "6", "9,50", "pending", "2026-08-03"],
  ["A-1008", "22.07.2026", "Marco Gallo", "marco.gallo@example.com", "12", "Gift Box", "2", "35,00", "Paid", "05.08.2026"],
  ["", "", "", "", "", "", "", "", "", ""],
  ["A-1009", "2026-08-01", "elena ricci", "ELENA.RICCI@EXAMPLE.COM", "335 666 7788", "Espresso Beans 1kg", "5", "18,90", "si", "2026-08-15"],
  ["A-1010", "04/08/2026", "Caffè Roma snc", "info@cafferoma.example.net", "02 4445566", "Espresso Beans 1kg", "20", "16,50", "unpaid", "03/09/2026"],
  ["A-1011", "2026-08-06", "federico esposito", "federico.esposito@example.com", "349 777 8899", "Moka Pot 3 cups", "2", "24,00", "Paid", "2026-08-20"],
  ["A-1012", "10/08/2026", "Chiara Romano", "chiara.romano@example.com", "331 222 3344", "Grinder", "1", "89,00", "boh", "24/08/2026"],
  ["A-1013", "2026-08-18", "giorgio fontana", "giorgio.fontana@example.com", "333 999 0000", "Ceramic Mug", "0", "9,50", "Paid", "2026-09-01"],
  ["A-1014", "2026-08-25", "Bianchi srl", "orders@bianchi.example.org", "06 5551234", "Gift Box", "8", "35,00", "unpaid", "2026-09-24"],
  ["A-1015", "02/09/2026", "laura marino", "laura.marino@example.com", "320 123 9876", "Espresso Beans 1kg", "2", "18,90", "Paid", "16/09/2026"],
  ["A-1016", "2026-09-05", "Stefano Greco", "stefano.greco@example.com", "338 456 7890", "Gift Box", "1", "35,00", "unpaid", "2026-09-19"],
  ["A-1017", "2026-09-05", "Stefano Greco", "stefano.greco@example.com", "338 456 7890", "Gift Box", "1", "35,00", "unpaid", "2026-09-19"],
  ["A-1018", "09/09/2026", "valentina bruno", "valentina.bruno@example.com", "347 321 6540", "Moka Pot 3 cups", "3", "24,00", "Paid", "23/09/2026"],
  ["A-1019", "2026-09-14", "Caffè Roma snc", "info@cafferoma.example.net", "02 4445566", "Espresso Beans 1kg", "25", "16,50", "da pagare", "2026-10-14"],
  ["A-1020", "2026-09-18", "Alessio Moretti", "alessio.moretti@example.com", "333 101 2020", "Grinder", "1", "89,00", "Paid", "2026-10-02"],
  ["A-1021", "31/09/2026", "Martina Barbieri", "martina.barbieri@example.com", "339 303 4040", "Ceramic Mug", "2", "9,50", "Paid", "14/10/2026"],
  ["A-1022", "2026-09-25", "simone lombardi", "simone.lombardi@example.com", "340 505 6060", "Espresso Beans 1kg", "4", "18,90", "unpaid", "2026-10-09"],
  ["A-1023", "2026-10-01", "Francesca Costa", "francesca.costa@example.com", "345 707 8080", "Gift Box", "3", "35,00", "Paid", "2026-10-15"],
  ["A-1024", "2026-10-02", "Bianchi srl", "orders@bianchi.example.org", "06 5551234", "Gift Box", "12", "34,00", "unpaid", "2026-11-01"],
  ["A-1025", "2026-10-03", "roberto ferrara", "roberto.ferrara@example.com", "348 909 1010", "Moka Pot 3 cups", "1", "24,00", "unpaid", "2026-10-17"],
  ["A-1026", "2026-10-05", "Elena Ricci", "elena.ricci@example.com", "335 666 7788", "Commercial Grinder", "1", "1.089,00", "Paid", "2026-10-19"]
];

/* =====================================================================
 * 2. PURE LOGIC (no Google services – safe to unit test)
 * ===================================================================== */

function isBlank(value) {
  return value === null || value === undefined || String(value).trim() === '';
}

function isDate(value) {
  return Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime());
}

function normalizeWhitespace(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\s+/g, ' ').trim();
}

/** "  mario   ROSSI " -> "Mario Rossi", "d'angelo" -> "D'Angelo", "bianchi srl" -> "Bianchi SRL" */
function toTitleCase(value) {
  const lower = normalizeWhitespace(value).toLowerCase();
  const titled = lower.replace(/(^|[\s'\-])([a-zà-öø-ÿ])/g, function (m, sep, ch) {
    return sep + ch.toUpperCase();
  });
  return titled.replace(/\b(srl|spa|snc|sas|llc|ltd|gmbh)\b/gi, function (m) {
    return m.toUpperCase();
  });
}

function normalizeEmail(value) {
  return normalizeWhitespace(value).toLowerCase().replace(/\s/g, '');
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(String(value || ''));
}

/** Returns the phone in "+<digits>" form, '' if empty, or null if it looks invalid. */
function normalizePhone(value, defaultCountryCode) {
  let s = normalizeWhitespace(value);
  if (!s) return '';
  s = s.replace(/[^\d+]/g, '');
  if (s.indexOf('00') === 0) s = '+' + s.slice(2);
  if (s.charAt(0) !== '+') s = (defaultCountryCode || '') + s;
  if (s.lastIndexOf('+') > 0) return null;
  const digits = s.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) return null;
  return s;
}

/** Accepts Date objects, "yyyy-mm-dd", "dd/mm/yyyy", "dd-mm-yy", "dd.mm.yyyy". Returns Date or null. */
function parseDate(value) {
  if (isDate(value)) return value;
  const s = normalizeWhitespace(value);
  if (!s) return null;
  let y, mo, d, m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) {
    y = +m[1]; mo = +m[2]; d = +m[3];
  } else if ((m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2}|\d{4})$/))) {
    d = +m[1]; mo = +m[2]; y = +m[3];
    if (y < 100) y += 2000;
  } else {
    return null;
  }
  const date = new Date(y, mo - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
  return date;
}

/**
 * Parses numbers written in European or English style.
 * "€ 1.250,50" -> 1250.5, "12,5" -> 12.5, "1.200" -> 1200, "1,250.50" -> 1250.5
 * Returns NaN when the value is not a number.
 */
function parseNumber(value) {
  if (typeof value === 'number') return isFinite(value) ? value : NaN;
  let s = normalizeWhitespace(value).replace(/[€$£\s]/g, '');
  if (!s) return NaN;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lastComma > -1) {
    s = (s.match(/,/g) || []).length > 1 ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, '');
  }
  if (!/^-?\d+(\.\d+)?$/.test(s)) return NaN;
  return parseFloat(s);
}

const PAID_WORDS = ['paid', 'pagato', 'pagata', 'saldato', 'yes', 'y', 'si', 'sì', 'ok', 'true', '✓'];
const UNPAID_WORDS = ['unpaid', 'non pagato', 'da pagare', 'no', 'n', 'pending', 'in attesa', 'false'];

/** Returns 'Paid', 'Unpaid', or null when the status is not recognised. Empty means Unpaid. */
function normalizeStatus(value) {
  const s = normalizeWhitespace(value).toLowerCase();
  if (!s) return 'Unpaid';
  if (PAID_WORDS.indexOf(s) > -1) return 'Paid';
  if (UNPAID_WORDS.indexOf(s) > -1) return 'Unpaid';
  return null;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function daysBetween(from, to) {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / 86400000);
}

function pad2(n) {
  return (n < 10 ? '0' : '') + n;
}

function dateKey(value) {
  return isDate(value) ? value.getFullYear() + '-' + pad2(value.getMonth() + 1) + '-' + pad2(value.getDate()) : '';
}

function monthKey(value) {
  return isDate(value) ? value.getFullYear() + '-' + pad2(value.getMonth() + 1) : '';
}

function formatDateHuman(value) {
  return isDate(value) ? pad2(value.getDate()) + '/' + pad2(value.getMonth() + 1) + '/' + value.getFullYear() : '';
}

function formatMoney(n, symbol) {
  const fixed = round2(n).toFixed(2).split('.');
  const intPart = fixed[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (symbol || '') + ' ' + intPart + ',' + fixed[1];
}

function fillTemplate(template, vars) {
  return String(template).replace(/\{(\w+)\}/g, function (m, key) {
    return Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : m;
  });
}

/**
 * Cleans one order. Invalid values are left exactly as they were and reported in "issues",
 * so no information is ever lost.
 */
function cleanRecord(rec, options) {
  const opts = options || {};
  const out = Object.assign({}, rec);
  const issues = [];

  out.orderId = normalizeWhitespace(rec.orderId).toUpperCase();
  if (!out.orderId) issues.push('Missing Order ID');

  const date = parseDate(rec.date);
  if (date) out.date = date; else issues.push('Invalid date');

  out.customer = toTitleCase(rec.customer);
  if (!out.customer) issues.push('Missing customer');

  out.email = normalizeEmail(rec.email);
  if (!out.email) issues.push('Missing email');
  else if (!isValidEmail(out.email)) issues.push('Invalid email');

  const phone = normalizePhone(rec.phone, opts.defaultCountryCode);
  if (phone === null) issues.push('Invalid phone'); else out.phone = phone;

  out.product = normalizeWhitespace(rec.product);
  if (!out.product) issues.push('Missing product');

  const qty = parseNumber(rec.qty);
  const qtyOk = !isNaN(qty) && qty > 0;
  if (qtyOk) out.qty = qty; else issues.push('Invalid qty');

  const price = parseNumber(rec.unitPrice);
  const priceOk = !isNaN(price) && price >= 0;
  if (priceOk) out.unitPrice = price; else issues.push('Invalid unit price');

  out.total = qtyOk && priceOk ? round2(qty * price) : '';

  const status = normalizeStatus(rec.status);
  if (status) out.status = status; else issues.push('Unknown status');

  if (isBlank(rec.dueDate)) {
    out.dueDate = '';
  } else {
    const due = parseDate(rec.dueDate);
    if (due) out.dueDate = due; else issues.push('Invalid due date');
  }

  const reminded = parseDate(rec.lastReminder);
  if (reminded) out.lastReminder = reminded;

  return { record: out, issues: issues };
}

/**
 * Finds duplicates among cleaned records.
 * - "exact": same Order ID as an earlier row
 * - "possible": different Order ID but same email + product + date as an earlier row
 * Returns { index: { of: earlierIndex, type: 'exact' | 'possible' } }
 */
function findDuplicates(records) {
  const byId = {};
  const byKey = {};
  const result = {};
  records.forEach(function (r, i) {
    if (!r || r._blank) return;
    const id = r.orderId;
    const key = r.email && dateKey(r.date)
      ? [r.email, String(r.product).toLowerCase(), dateKey(r.date)].join('|')
      : '';
    if (id && byId[id] !== undefined) {
      result[i] = { of: byId[id], type: 'exact' };
      return;
    }
    if (key && byKey[key] !== undefined) {
      result[i] = { of: byKey[key], type: 'possible' };
      return;
    }
    if (id) byId[id] = i;
    if (key) byKey[key] = i;
  });
  return result;
}

/** Aggregates sales by month, product and customer. Ignores rows without a valid total. */
function buildSummary(records, today) {
  const months = {};
  const products = {};
  const customers = {};
  const totals = { sales: 0, orders: 0, unpaid: 0, overdue: 0, overdueCount: 0 };
  const todayStart = startOfDay(today).getTime();

  records.forEach(function (r) {
    if (!r || r._blank || typeof r.total !== 'number') return;
    totals.sales += r.total;
    totals.orders += 1;

    const m = monthKey(r.date);
    if (m) {
      months[m] = months[m] || { month: m, orders: 0, sales: 0 };
      months[m].orders += 1;
      months[m].sales += r.total;
    }

    products[r.product] = products[r.product] || { product: r.product, qty: 0, sales: 0 };
    products[r.product].qty += r.qty;
    products[r.product].sales += r.total;

    customers[r.customer] = customers[r.customer] || { customer: r.customer, orders: 0, sales: 0 };
    customers[r.customer].orders += 1;
    customers[r.customer].sales += r.total;

    if (r.status === 'Unpaid') {
      totals.unpaid += r.total;
      if (isDate(r.dueDate) && startOfDay(r.dueDate).getTime() < todayStart) {
        totals.overdue += r.total;
        totals.overdueCount += 1;
      }
    }
  });

  const values = function (obj) {
    return Object.keys(obj).map(function (k) { return obj[k]; });
  };
  const bySalesDesc = function (a, b) { return b.sales - a.sales; };

  totals.sales = round2(totals.sales);
  totals.unpaid = round2(totals.unpaid);
  totals.overdue = round2(totals.overdue);

  return {
    totals: totals,
    months: values(months).sort(function (a, b) { return a.month < b.month ? -1 : 1; }),
    products: values(products).sort(bySalesDesc),
    topCustomers: values(customers).sort(bySalesDesc).slice(0, 5),
  };
}

/**
 * Returns the indexes of orders that should get a payment reminder today:
 * unpaid, valid email, due date in the past, not reminded in the last "intervalDays",
 * and not flagged as a duplicate.
 */
function selectReminders(records, today, intervalDays, duplicates) {
  const dups = duplicates || {};
  const todayStart = startOfDay(today).getTime();
  const picked = [];
  records.forEach(function (r, i) {
    if (!r || r._blank || dups[i]) return;
    if (r.status !== 'Unpaid' || typeof r.total !== 'number') return;
    if (!isValidEmail(r.email) || !isDate(r.dueDate)) return;
    if (startOfDay(r.dueDate).getTime() >= todayStart) return;
    if (isDate(r.lastReminder) && daysBetween(r.lastReminder, today) < intervalDays) return;
    picked.push(i);
  });
  return picked;
}

function buildReminderEmail(r, config) {
  const vars = {
    customer: r.customer,
    orderId: r.orderId,
    total: formatMoney(r.total, config.CURRENCY_SYMBOL),
    dueDate: formatDateHuman(r.dueDate),
    business: config.BUSINESS_NAME,
  };
  return {
    to: r.email,
    subject: fillTemplate(config.REMINDER_SUBJECT, vars),
    body: fillTemplate(config.REMINDER_BODY, vars),
  };
}

/** Full in-memory pipeline used by every action: clean + duplicates + issue text. */
function processRecords(rawRecords, config) {
  const cleaned = rawRecords.map(function (raw) {
    if (raw._blank) return raw;
    const res = cleanRecord(raw, { defaultCountryCode: config.DEFAULT_COUNTRY_CODE });
    res.record._issues = res.issues;
    return res.record;
  });
  const duplicates = findDuplicates(cleaned);
  cleaned.forEach(function (r, i) {
    if (r._blank) return;
    const notes = r._issues.slice();
    const dup = duplicates[i];
    if (dup) {
      // +2: header row + 1-based sheet rows
      notes.push((dup.type === 'exact' ? 'Duplicate of row ' : 'Possible duplicate of row ') + (dup.of + 2));
    }
    r.issues = notes.join('; ');
  });
  return { records: cleaned, duplicates: duplicates };
}

/* =====================================================================
 * 3. GOOGLE SHEETS / GMAIL LAYER
 * ===================================================================== */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('⚙️ Automations')
    .addItem('Load demo data', 'loadDemoData')
    .addSeparator()
    .addItem('Clean & check data', 'runCleanData')
    .addItem('Build report', 'runBuildReport')
    .addSeparator()
    .addItem('Preview payment reminders (sends nothing)', 'runRemindersPreview')
    .addItem('Send payment reminders…', 'runRemindersSend')
    .addSeparator()
    .addItem('Run everything', 'runAll')
    .addItem('Schedule daily run', 'installDailyTrigger')
    .addItem('Remove daily schedule', 'removeDailyTrigger')
    .addToUi();
}

/* ---------- menu actions ---------- */

function runCleanData() {
  const ctx = readOrders_();
  const result = processRecords(ctx.records, CONFIG);
  writeFields_(ctx, result.records, ['orderId', 'date', 'customer', 'email', 'phone', 'product',
    'qty', 'unitPrice', 'total', 'status', 'dueDate', 'issues']);
  colorRows_(ctx, result);
  ctx.sheet.autoResizeColumns(1, ctx.sheet.getLastColumn());

  const rows = result.records.filter(function (r) { return !r._blank; });
  const withIssues = rows.filter(function (r) { return r.issues; }).length;
  const dupCount = Object.keys(result.duplicates).length;
  const msg = rows.length + ' rows checked · ' + withIssues + ' need attention · ' + dupCount + ' duplicates';
  log_('Clean & check data', msg);
  notify_(msg);
}

function runBuildReport() {
  const ctx = readOrders_();
  const result = processRecords(ctx.records, CONFIG);
  // Exact duplicates are excluded so they do not inflate the numbers.
  const usable = result.records.filter(function (r, i) {
    return !r._blank && !(result.duplicates[i] && result.duplicates[i].type === 'exact');
  });
  const summary = buildSummary(usable, new Date());
  writeReport_(summary);
  log_('Build report', summary.totals.orders + ' orders included');
  notify_('Report updated: ' + summary.totals.orders + ' orders.');
}

function runRemindersPreview() {
  const plan = planReminders_();
  writePreview_(plan.emails);
  log_('Preview reminders', plan.emails.length + ' reminder(s) would be sent');
  notify_(plan.emails.length + ' reminder(s) would be sent. See the "' + CONFIG.LOG_SHEET + '" sheet.');
}

function runRemindersSend() {
  const plan = planReminders_();
  const ui = SpreadsheetApp.getUi();
  if (!plan.emails.length) {
    ui.alert('No payment reminders are due today.');
    return;
  }
  const answer = ui.alert(
    'Send payment reminders',
    'Send ' + plan.emails.length + ' reminder email(s) now?',
    ui.ButtonSet.YES_NO
  );
  if (answer !== ui.Button.YES) return;
  const sent = sendReminders_(plan);
  notify_(sent + ' reminder(s) sent.');
}

function runAll() {
  runCleanData();
  runBuildReport();
  runRemindersPreview();
}

function loadDemoData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CONFIG.ORDERS_SHEET);
  if (sheet && sheet.getLastRow() > 1) {
    const ui = SpreadsheetApp.getUi();
    const answer = ui.alert('Load demo data',
      'The "' + CONFIG.ORDERS_SHEET + '" sheet already contains data. Replace it with demo data?',
      ui.ButtonSet.YES_NO);
    if (answer !== ui.Button.YES) return;
  }
  if (!sheet) {
    sheet = ss.getSheets().length === 1 && ss.getSheets()[0].getLastRow() === 0
      ? ss.getSheets()[0].setName(CONFIG.ORDERS_SHEET)
      : ss.insertSheet(CONFIG.ORDERS_SHEET);
  }
  sheet.clear();
  // Plain-text format first, so the messy values stay exactly as typed.
  sheet.getRange(1, 1, DEMO_ROWS.length, DEMO_ROWS[0].length).setNumberFormat('@').setValues(DEMO_ROWS);
  sheet.getRange(1, 1, 1, DEMO_ROWS[0].length).setFontWeight('bold');
  sheet.setFrozenRows(1);
  notify_('Demo data loaded (messy on purpose). Now run "Clean & check data".');
}

/* ---------- scheduling ---------- */

function installDailyTrigger() {
  removeTriggers_();
  ScriptApp.newTrigger('dailyJob').timeBased().everyDays(1).atHour(CONFIG.DAILY_HOUR).create();
  notify_('Daily run scheduled around ' + CONFIG.DAILY_HOUR + ':00.');
}

function removeDailyTrigger() {
  removeTriggers_();
  notify_('Daily schedule removed.');
}

function dailyJob() {
  runCleanData();
  runBuildReport();
  if (CONFIG.AUTO_SEND_REMINDERS) {
    const sent = sendReminders_(planReminders_());
    log_('Daily job', sent + ' reminder(s) sent automatically');
  }
}

function removeTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'dailyJob') ScriptApp.deleteTrigger(t);
  });
}

/* ---------- reading & writing ---------- */

function readOrders_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.ORDERS_SHEET);
  if (!sheet) throw new Error('Sheet "' + CONFIG.ORDERS_SHEET + '" not found.');

  ensureManagedColumns_(sheet);

  const values = sheet.getDataRange().getValues();
  const header = values[0].map(normalizeWhitespace);
  const col = {};
  Object.keys(FIELDS).forEach(function (k) { col[k] = header.indexOf(FIELDS[k]); });

  const missing = REQUIRED_FIELDS.filter(function (k) { return col[k] === -1; })
    .map(function (k) { return FIELDS[k]; });
  if (missing.length) throw new Error('Missing column(s) in "' + CONFIG.ORDERS_SHEET + '": ' + missing.join(', '));

  const records = values.slice(1).map(function (row) {
    const r = {};
    Object.keys(col).forEach(function (k) { r[k] = col[k] > -1 ? row[col[k]] : ''; });
    r._blank = REQUIRED_FIELDS.every(function (k) { return isBlank(r[k]); });
    return r;
  });

  return { sheet: sheet, col: col, records: records, lastColumn: header.length };
}

function ensureManagedColumns_(sheet) {
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const header = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(normalizeWhitespace);
  let next = lastCol + 1;
  MANAGED_FIELDS.forEach(function (k) {
    if (header.indexOf(FIELDS[k]) === -1) {
      sheet.getRange(1, next).setValue(FIELDS[k]).setFontWeight('bold');
      next += 1;
    }
  });
}

/** Writes only the given columns, so formulas in other columns are never touched. */
function writeFields_(ctx, records, fields) {
  const n = records.length;
  if (!n) return;
  fields.forEach(function (f) {
    const c = ctx.col[f];
    if (c === -1) return;
    const column = records.map(function (r) {
      const v = r[f];
      return [v === undefined || v === null ? '' : v];
    });
    const range = ctx.sheet.getRange(2, c + 1, n, 1);
    range.setNumberFormat(numberFormatFor_(f));
    range.setValues(column);
  });
}

function numberFormatFor_(field) {
  if (field === 'date' || field === 'dueDate' || field === 'lastReminder') return CONFIG.DATE_FORMAT;
  if (field === 'unitPrice' || field === 'total') return CONFIG.MONEY_FORMAT;
  if (field === 'qty') return '0.##';
  return '@'; // text: keeps "+39..." phones and IDs from being reinterpreted
}

function colorRows_(ctx, result) {
  const n = result.records.length;
  if (!n) return;
  const width = ctx.sheet.getLastColumn();
  const colors = result.records.map(function (r, i) {
    let color = null;
    if (!r._blank && r._issues && r._issues.length) color = CONFIG.COLORS.ISSUE;
    else if (result.duplicates[i]) color = CONFIG.COLORS.DUPLICATE;
    const row = [];
    for (let c = 0; c < width; c++) row.push(color);
    return row;
  });
  ctx.sheet.getRange(2, 1, n, width).setBackgrounds(colors);
}

function writeReport_(summary) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CONFIG.REPORT_SHEET);
  if (!sheet) sheet = ss.insertSheet(CONFIG.REPORT_SHEET);
  sheet.getCharts().forEach(function (ch) { sheet.removeChart(ch); });
  sheet.clear();

  sheet.getRange('A1').setValue('Sales report').setFontSize(16).setFontWeight('bold');
  sheet.getRange('A2').setValue('Generated on ' + formatDateHuman(new Date())).setFontColor('#666666');

  const t = summary.totals;
  const keyStart = 4;
  let row = writeTable_(sheet, keyStart, 'Key figures', ['Metric', 'Value'], [
    ['Total sales', t.sales],
    ['Orders', t.orders],
    ['Unpaid', t.unpaid],
    ['Overdue (' + t.overdueCount + ' orders)', t.overdue],
  ], { 2: CONFIG.MONEY_FORMAT });
  sheet.getRange(keyStart + 3, 2).setNumberFormat('0'); // "Orders" row is a count, not money

  const monthsStart = row;
  row = writeTable_(sheet, row, 'Sales by month', ['Month', 'Orders', 'Sales'],
    summary.months.map(function (m) { return [m.month, m.orders, m.sales]; }), { 1: '@', 3: CONFIG.MONEY_FORMAT });

  row = writeTable_(sheet, row, 'Sales by product', ['Product', 'Qty', 'Sales'],
    summary.products.map(function (p) { return [p.product, p.qty, p.sales]; }), { 3: CONFIG.MONEY_FORMAT });

  writeTable_(sheet, row, 'Top customers', ['Customer', 'Orders', 'Sales'],
    summary.topCustomers.map(function (c) { return [c.customer, c.orders, c.sales]; }), { 3: CONFIG.MONEY_FORMAT });

  if (summary.months.length) {
    const dataRange = sheet.getRange(monthsStart + 1, 1, summary.months.length + 1, 1);
    const salesRange = sheet.getRange(monthsStart + 1, 3, summary.months.length + 1, 1);
    const chart = sheet.newChart()
      .setChartType(Charts.ChartType.COLUMN)
      .addRange(dataRange)
      .addRange(salesRange)
      .setNumHeaders(1) // first row of each range is the header, not a data point
      .setOption('title', 'Sales by month')
      .setOption('legend', { position: 'none' })
      .setPosition(4, 5, 0, 0)
      .build();
    sheet.insertChart(chart);
  }
  sheet.autoResizeColumns(1, 3);
}

/** Writes a titled table and returns the next free row (leaving one blank row). */
function writeTable_(sheet, startRow, title, headers, rows, formats) {
  sheet.getRange(startRow, 1).setValue(title).setFontWeight('bold').setFontSize(12);
  sheet.getRange(startRow + 1, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold').setBackground('#eeeeee');
  if (rows.length) {
    // Formats first, so values like "2026-07" stay text instead of becoming dates.
    Object.keys(formats || {}).forEach(function (colNum) {
      sheet.getRange(startRow + 2, Number(colNum), rows.length, 1).setNumberFormat(formats[colNum]);
    });
    sheet.getRange(startRow + 2, 1, rows.length, headers.length).setValues(rows);
  } else {
    sheet.getRange(startRow + 2, 1).setValue('No data').setFontColor('#999999');
  }
  return startRow + 2 + Math.max(rows.length, 1) + 1;
}

/* ---------- reminders ---------- */

function planReminders_() {
  const ctx = readOrders_();
  const result = processRecords(ctx.records, CONFIG);
  const indexes = selectReminders(result.records, new Date(), CONFIG.REMINDER_INTERVAL_DAYS, result.duplicates);
  const quota = MailApp.getRemainingDailyQuota();
  const limited = indexes.slice(0, Math.min(CONFIG.MAX_EMAILS_PER_RUN, quota));
  return {
    ctx: ctx,
    records: result.records,
    indexes: limited,
    skippedForQuota: indexes.length - limited.length,
    emails: limited.map(function (i) {
      const email = buildReminderEmail(result.records[i], CONFIG);
      email.row = i + 2;
      return email;
    }),
  };
}

function sendReminders_(plan) {
  const now = new Date();
  let sent = 0;
  plan.emails.forEach(function (email, k) {
    const options = { name: CONFIG.BUSINESS_NAME };
    if (CONFIG.REPLY_TO) options.replyTo = CONFIG.REPLY_TO;
    try {
      MailApp.sendEmail(email.to, email.subject, email.body, options);
      plan.ctx.sheet.getRange(email.row, plan.ctx.col.lastReminder + 1).setValue(now)
        .setNumberFormat(CONFIG.DATE_FORMAT);
      log_('Reminder sent', 'Row ' + email.row + ' → ' + email.to);
      sent += 1;
    } catch (err) {
      log_('Reminder FAILED', 'Row ' + email.row + ' → ' + email.to + ': ' + err.message);
    }
  });
  if (plan.skippedForQuota) log_('Reminders postponed', plan.skippedForQuota + ' over the daily limit');
  return sent;
}

function writePreview_(emails) {
  emails.forEach(function (e) {
    log_('Reminder PREVIEW', 'Row ' + e.row + ' → ' + e.to + ' | ' + e.subject);
  });
}

/* ---------- utilities ---------- */

function log_(action, details) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CONFIG.LOG_SHEET);
  if (!sheet) {
    const active = ss.getActiveSheet();
    sheet = ss.insertSheet(CONFIG.LOG_SHEET);
    sheet.appendRow(['Timestamp', 'Action', 'Details']);
    sheet.getRange(1, 1, 1, 3).setFontWeight('bold');
    if (active) ss.setActiveSheet(active); // creating the log must not steal the user's view
  }
  sheet.appendRow([new Date(), action, details]);
}

function notify_(message) {
  try {
    SpreadsheetApp.getActiveSpreadsheet().toast(message, 'Automations', 6);
  } catch (e) {
    // No UI available (e.g. time-driven trigger): the Log sheet already has the details.
  }
}
