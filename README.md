# Order Automation for Google Sheets

Turn a messy order list into clean data, a sales report and automatic payment reminders, with one menu inside Google Sheets. No add-ons, no paid tools: just Google Apps Script.

## The problem it solves

Small businesses often track orders in a spreadsheet that several people edit by hand. After a few months it contains inconsistent names, mixed date formats, numbers like `€ 1.089,00`, duplicated rows and unpaid invoices that nobody follows up. This script fixes that in seconds and keeps it fixed with a daily schedule.

## What it does

**1. Clean & check data**
- Normalizes names (`  mario   ROSSI ` → `Mario Rossi`, `bianchi srl` → `Bianchi SRL`), emails, phone numbers (`0039 339 2223344` → `+393392223344`) and order IDs
- Understands dates in `yyyy-mm-dd`, `dd/mm/yyyy`, `dd-mm-yy` and `dd.mm.yyyy`
- Understands European and English number formats (`18,90`, `€ 1.089,00`, `1,250.50`)
- Maps status words in English and Italian (`paid`, `pagato`, `sì`, `da pagare`, `pending`…) to `Paid` / `Unpaid`
- Calculates `Total = Qty × Unit Price`
- Flags exact duplicates (same Order ID) and possible duplicates (same customer, product and date)
- Writes every problem in an `Issues` column and colors the row. **Invalid values are never overwritten**, so no information is lost

**2. Build report**
A `Report` sheet with key figures (sales, unpaid, overdue), sales by month with a chart, sales by product and top customers. Exact duplicates are excluded so they don't inflate the numbers.

**3. Payment reminders**
Finds unpaid orders past their due date and emails the customer, at most once every 7 days per order. Rows with an invalid email or flagged as duplicates are skipped.
- **Preview** mode lists who would receive an email in the `Log` sheet and sends nothing
- **Send** mode asks for confirmation, respects Gmail's daily quota and records the date in `Last Reminder`

**4. Daily schedule**
One click installs a daily run (cleaning + report). Automatic sending of reminders is off by default and can be turned on in `CONFIG`.

## Try it in 5 minutes

1. Create a new Google Sheet and rename the first tab to `Orders`.
2. (Optional) skip importing anything: the menu has a **Load demo data** item that fills the sheet with deliberately messy orders.
3. *Extensions → Apps Script*, delete the default code, paste `Code.gs`, save.
4. Reload the spreadsheet: a new **⚙️ Automations** menu appears.
5. Click *Load demo data*, then *Clean & check data*, then *Build report*, then *Preview payment reminders*. Google will ask for authorization the first time.

## Configuration

Everything a client may want to change is in the `CONFIG` object at the top of `Code.gs`: sheet names, business name, reply-to address, default phone prefix, currency and date formats, reminder interval, email text, daily schedule.

Column names are matched by header, so columns can be in any order and extra columns are left untouched. The script only writes to its own columns; formulas elsewhere are preserved. Note: cleaning resets the background color of data rows.

## How it is built

- `Code.gs` is split into **pure logic** (no Google services) and a thin **Sheets/Gmail layer**
- The pure logic is covered by unit tests that run in Node without any dependency:

```bash
node tests/logic.test.js
```

The tests include an end-to-end run on `sample-orders.csv` that checks which rows get flagged, the report totals and exactly which orders receive a reminder.

## Easy extensions

- Reminder emails in the customer's language
- Invoice PDFs generated from a Google Docs template
- Sync with a Google Form, Shopify or WooCommerce export
- Weekly report emailed to the owner
- Slack or Telegram notification for overdue payments

## Transparency

This project was built with an AI-assisted workflow. Besides the unit tests, it was tested end-to-end in a live Google Sheet (October 2026): demo data, cleaning, re-running on already-clean data, report, chart and reminder preview.

## License

MIT
