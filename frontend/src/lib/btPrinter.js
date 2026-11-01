import { rowsToRaster } from './btRaster';
// ─── Web Bluetooth ESC/POS printer for BTP-802 (and compatible) ───────────────

// Known BLE service/characteristic pairs for common thermal receipt printers
const KNOWN_PAIRS = [
  // BTP-802 / PT-series / many generic printers
  { svc: '000018f0-0000-1000-8000-00805f9b34fb', chr: '00002af1-0000-1000-8000-00805f9b34fb' },
  // Xprinter XP series / HPRT
  { svc: 'e7810a71-73ae-499d-8c15-faa9aef0c3f2', chr: 'bef8d6c9-9c21-4c9e-b632-bd58c1009f9f' },
  // Generic 0xFF00 (most common Chinese printers)
  { svc: '0000ff00-0000-1000-8000-00805f9b34fb', chr: '0000ff02-0000-1000-8000-00805f9b34fb' },
  // Peripage / Paperang style
  { svc: '49535343-fe7d-4ae5-8fa9-9fafd205e455', chr: '49535343-8841-43f4-a8d4-ecbe34729bb3' },
  // SPP-over-BLE variant
  { svc: '00001101-0000-1000-8000-00805f9b34fb', chr: '00001101-0000-1000-8000-00805f9b34fb' },
];

let _device = null;
let _char = null;

export const isBTSupported = () =>
  typeof navigator !== 'undefined' && 'bluetooth' in navigator;

export const isConnected = () =>
  !!(_device?.gatt?.connected && _char);

export const getSavedPrinterName = () =>
  localStorage.getItem('bt_printer_name') || null;

export function disconnect() {
  try { if (_device?.gatt?.connected) _device.gatt.disconnect(); } catch (_) {}
  _device = null;
  _char = null;
  localStorage.removeItem('bt_printer_name');
}

export const BT_TIMEOUT_MS = 10000;

export function withTimeout(promise, label, ms = BT_TIMEOUT_MS) {
  let t;
  const timer = new Promise((_, rej) => {
    t = setTimeout(() => rej(new Error(`${label} timed out after ${ms / 1000}s`)), ms);
  });
  return Promise.race([promise, timer]).finally(() => clearTimeout(t));
}

const EXTRA_SVCS = [
  '0000ffe0-0000-1000-8000-00805f9b34fb',
  '0000fee7-0000-1000-8000-00805f9b34fb',
  '0000ae30-0000-1000-8000-00805f9b34fb',
];
const ALL_SVCS = [...new Set([...KNOWN_PAIRS.map((p) => p.svc), ...EXTRA_SVCS])];
const short = (uuid) => (/^0000[0-9a-f]{4}-0000-1000-8000-00805f9b34fb$/.test(uuid) ? uuid.slice(4, 8) : uuid);
const propList = (c) => ['write', 'writeWithoutResponse', 'notify', 'indicate'].filter((p) => c.properties?.[p]);

let _info = null;
export const getPrinterInfo = () => _info;

async function bindCharacteristic(device) {
  const server = device.gatt.connected ? device.gatt : await withTimeout(device.gatt.connect(), 'Connecting to printer');
  const found = [];
  for (const svc of ALL_SVCS) {
    let service;
    try { service = await withTimeout(server.getPrimaryService(svc), 'Finding print service'); } catch (_) { continue; }
    try {
      const chars = await withTimeout(service.getCharacteristics(), 'Reading printer characteristics');
      chars.forEach((c) => found.push({ svc, c }));
    } catch (_) { /* ignore */ }
  }
  // Write to a writable characteristic only (never the notify one); prefer known printer UUIDs
  const writable = found.filter(({ c }) => c.properties?.write || c.properties?.writeWithoutResponse);
  const pick = writable.find(({ c }) => KNOWN_PAIRS.some((p) => p.chr === c.uuid)) || writable[0];
  if (!pick) {
    device.gatt.disconnect();
    throw new Error(
      'Could not find a writable print characteristic on this printer' +
      (found.length ? ` (found: ${found.map(({ c }) => short(c.uuid)).join(', ')})` : '') + '.'
    );
  }
  _device = device;
  _char = pick.c;
  _info = {
    service: pick.svc,
    characteristic: pick.c.uuid,
    props: propList(pick.c),
    summary: `${short(pick.svc)}/${short(pick.c.uuid)} (${propList(pick.c).join(', ')})`,
    all: found.map(({ svc, c }) => `${short(svc)}/${short(c.uuid)} [${propList(c).join(',')}]`),
  };
  console.info('[BT] printer characteristics:', _info.all, '-> writing to', _info.summary);
  localStorage.setItem('bt_printer_name', device.name || 'Printer001');
  return device.name || 'Printer001';
}

// Connect to printer and auto-discover writable characteristic
export async function connectPrinter() {
  if (!isBTSupported()) throw new Error('Bluetooth is not available in this browser. Use Chrome on Android or desktop.');
  const device = await navigator.bluetooth.requestDevice({
    filters: [{ name: 'Printer001' }],
    optionalServices: ALL_SVCS,
  });
  // Keep the device so a dropped GATT link can be re-opened without the chooser
  device.addEventListener('gattserverdisconnected', () => { _char = null; });
  return bindCharacteristic(device);
}

// Re-open a dropped GATT link on the already-paired device (no chooser needed)
export async function ensureConnected() {
  if (isConnected()) return true;
  if (!_device) return false;
  try {
    await bindCharacteristic(_device);
    return isConnected();
  } catch (_) {
    return false;
  }
}

// ─── ESC/POS byte builder ──────────────────────────────────────────────────────

const ESC = 0x1b;
const GS  = 0x1d;
const FS  = 0x1c;
const LF  = 0x0a;
const COLS = 48; // 80mm paper @ standard font = 48 chars

const cmd = {
  init:       () => [ESC, 0x40],
  plainText:  () => [FS, 0x2e, ESC, 0x74, 0x00], // cancel Chinese mode, code page 437
  align:      (a) => [ESC, 0x61, a],          // 0=left 1=center 2=right
  bold:       (on) => [ESC, 0x45, on ? 1 : 0],
  dblWidth:   (on) => [ESC, 0x0e, on ? 1 : 0],
  textSize:   (w, h) => [GS, 0x21, ((w - 1) << 4) | (h - 1)],
  feed:       (n) => [ESC, 0x64, n],
  cut:        () => [GS, 0x56, 0x42, 0x00],
};

const CHAR_MAP = {
  '\u20b9': 'Rs.', '\u2013': '-', '\u2014': '-', '\u2212': '-', '\u2022': '*', '\u00b7': '.',
  '\u2018': "'", '\u2019': "'", '\u201c': '"', '\u201d': '"', '\u2026': '...', '\u00d7': 'x',
  '\u00a0': ' ', '\u2500': '-', '\u2550': '=',
};

function encodeText(text) {
  const out = [];
  for (const ch of String(text ?? '')) {
    const mapped = CHAR_MAP[ch] ?? ch.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
    for (const m of mapped) {
      const c = m.codePointAt(0);
      if (c >= 32 && c < 127) out.push(c);
      else if (c === 10) out.push(LF);
      // other control / non-ASCII characters are dropped
    }
  }
  return out;
}

const ln = (t) => [...encodeText(t), LF];
const emptyLn = () => [LF];
const dashes = (n = COLS) => ln('-'.repeat(n));
const equals = (n = COLS) => ln('='.repeat(n));

function pad(left, right, width = COLS) {
  const maxLeft = width - right.length - 1;
  const l = left.length > maxLeft ? left.slice(0, maxLeft) : left;
  const gap = width - l.length - right.length;
  return l + (gap > 0 ? ' '.repeat(gap) : ' ') + right;
}

function wrapText(text, width = COLS) {
  const words = String(text ?? '').split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    if ((cur + (cur ? ' ' : '') + w).length > width) {
      if (cur) lines.push(cur);
      cur = w.slice(0, width);
    } else {
      cur = cur ? cur + ' ' + w : w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

const str = (v) => (v === null || v === undefined ? '' : String(v));
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const rs = (v) => 'Rs ' + num(v).toFixed(2);

const DEFAULT_SHOP = {
  shopName: 'Balaji Fataka',
  shopAddr: 'Off Navidyam NorthStar ManglDham Soc\nNanda Koradi, Nagpur - 441111',
  shopPhone: '9637662411',
  gstNo: '27BGPPA1777A1ZL',
  fireLicNo: '108975582503',
  upiId: 'paytm.d95113099@pty',
};

export function buildReceiptBytes(order, shop = {}) {
  const bytes = [];
  const push = (...chunks) =>
    chunks.forEach((c) => (Array.isArray(c) ? bytes.push(...c) : bytes.push(c)));
  const pick = (k) => str(shop[k]).trim() || DEFAULT_SHOP[k];

  const created = new Date(order.created_at);
  const dateStr = isNaN(created) ? '' : created.toLocaleString('en-IN', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

  // Init
  push(cmd.init(), cmd.plainText());

  // ── Shop header ────────────────────────────────────────────────────────────
  push(cmd.align(1), cmd.bold(true), cmd.textSize(2, 2));
  wrapText(pick('shopName'), COLS / 2).forEach((l) => push(ln(l)));
  push(cmd.textSize(1, 1), cmd.bold(false));
  pick('shopAddr').split('\n').map((l) => l.trim()).filter(Boolean)
    .forEach((l) => wrapText(l).forEach((w) => push(ln(w))));
  push(ln('Ph: ' + pick('shopPhone')));
  if (shop.gstEnabled || num(order.cgst) > 0) push(ln('GSTIN: ' + pick('gstNo')));
  push(ln('Explosives Lic: ' + pick('fireLicNo')));
  push(emptyLn());
  push(cmd.bold(true));
  push(ln('========== INVOICE =========='));
  push(cmd.bold(false));
  push(emptyLn());

  // ── Order info ─────────────────────────────────────────────────────────────
  push(cmd.align(0));
  push(ln('Inv : ' + str(order.invoice_no)));
  push(ln('Date: ' + dateStr));
  const custType = order.customer_type === 'wholesale' ? 'Wholesale' : 'Retail';
  push(ln('Cust: ' + (str(order.customer_name) || 'Walk-in Customer') + ' (' + custType + ')'));
  if (order.customer_phone) push(ln('Ph  : ' + str(order.customer_phone)));
  if (order.salesperson_name) push(ln('By  : ' + str(order.salesperson_name)));

  push(dashes());

  // ── Items header ───────────────────────────────────────────────────────────
  push(cmd.bold(true));
  push(ln(pad('ITEM', 'AMOUNT')));
  push(cmd.bold(false));
  push(dashes());

  // ── Items ──────────────────────────────────────────────────────────────────
  (order.items || []).forEach((it) => {
    const amt = rs(num(it.price) * num(it.qty));
    const nameLines = wrapText(str(it.name) || 'Item', COLS - amt.length - 1);
    push(ln(pad(nameLines[0] || '', amt)));
    nameLines.slice(1).forEach((l) => push(ln('  ' + l)));
    push(ln('  ' + num(it.qty) + ' x ' + rs(it.price) + (it.hsn ? '  HSN: ' + str(it.hsn) : '')));
  });

  push(dashes());

  // ── Totals ─────────────────────────────────────────────────────────────────
  push(ln(pad('Subtotal', rs(order.subtotal))));
  if (num(order.discount) > 0)
    push(ln(pad('Discount', '-' + rs(order.discount))));
  if (num(order.cgst) > 0) {
    push(ln(pad('CGST (9%)', rs(order.cgst))));
    push(ln(pad('SGST (9%)', rs(order.sgst))));
  }
  if (num(order.round_off) !== 0)
    push(ln(pad('Round off', num(order.round_off).toFixed(2))));

  push(equals());
  push(cmd.bold(true), cmd.textSize(1, 2));
  push(ln(pad('TOTAL', rs(order.total))));
  push(cmd.textSize(1, 1), cmd.bold(false));
  push(equals());

  // ── Payment ────────────────────────────────────────────────────────────────
  const modeLabel =
    order.payment_mode === 'upi' ? 'UPI' :
    order.payment_mode === 'cash' ? 'Cash' : 'Card';
  push(ln(pad('Paid by ' + modeLabel, rs(order.total))));
  if (order.utr) push(ln('UTR: ' + str(order.utr)));
  const status = order.status === 'paid' ? 'PAID' : 'PENDING';
  push(ln(pad('Status', status)));

  // UPI payment details — always printed
  push(dashes());
  push(cmd.align(1));
  push(cmd.bold(true));
  push(ln('PAY VIA UPI'));
  push(cmd.bold(false));
  push(ln(pick('upiId')));
  push(ln('Amount: ' + rs(order.total)));
  push(ln('Ref: ' + str(order.invoice_no)));
  push(cmd.align(0));

  push(dashes());

  // ── Footer ─────────────────────────────────────────────────────────────────
  push(cmd.align(1));
  push(emptyLn());
  push(ln('Thank you! Visit again.'));
  push(ln('Goods once sold will not be taken back.'));
  push(ln('Keep fireworks away from children.'));
  push(emptyLn());

  // Feed & cut
  push(cmd.feed(5));
  push(cmd.cut());

  return new Uint8Array(bytes);
}

// ─── Image (raster) receipt ───────────────────────────────────────────────────

const inr = (v) => '\u20b9' + num(v).toFixed(2);

export function receiptRows(order, shop = {}) {
  const pick = (k) => str(shop[k]).trim() || DEFAULT_SHOP[k];
  const created = new Date(order.created_at);
  const dateStr = isNaN(created) ? '' : created.toLocaleString('en-IN', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  const T = (text, o = {}) => ({ type: 'text', text, ...o });
  const P = (left, right, o = {}) => ({ type: 'pair', left, right, ...o });
  const R = (style = 'dash') => ({ type: 'rule', style });
  const C = (text, o = {}) => T(text, { align: 'center', ...o });
  const gst = shop.gstEnabled || num(order.cgst) > 0;
  const rows = [C(pick('shopName'), { size: 40, bold: true })];
  pick('shopAddr').split('\n').map((l) => l.trim()).filter(Boolean).forEach((l) => rows.push(C(l)));
  rows.push(C('Ph: ' + pick('shopPhone')));
  if (gst) rows.push(C('GSTIN: ' + pick('gstNo')));
  rows.push(C('Explosives Lic: ' + pick('fireLicNo')), { type: 'gap', h: 6 }, C(gst ? 'TAX INVOICE' : 'INVOICE', { size: 26, bold: true }), R());
  const custType = order.customer_type === 'wholesale' ? 'Wholesale' : 'Retail';
  rows.push(T('Inv: ' + str(order.invoice_no)), T('Date: ' + dateStr),
    T('Cust: ' + (str(order.customer_name) || 'Walk-in Customer') + ' (' + custType + ')'));
  if (order.customer_phone) rows.push(T('Ph: ' + str(order.customer_phone)));
  if (order.salesperson_name) rows.push(T('By: ' + str(order.salesperson_name)));
  rows.push(R(), P('ITEM', 'AMOUNT', { bold: true }), R());
  (order.items || []).forEach((it) => {
    rows.push(P(str(it.name) || 'Item', inr(num(it.price) * num(it.qty)), { bold: true }));
    rows.push(T('   ' + num(it.qty) + ' x ' + inr(it.price) + (it.hsn ? '   HSN: ' + str(it.hsn) : ''), { size: 20 }));
  });
  rows.push(R(), P('Subtotal', inr(order.subtotal)));
  if (num(order.discount) > 0) rows.push(P('Discount', '-' + inr(order.discount)));
  if (num(order.cgst) > 0) rows.push(P('CGST (9%)', inr(order.cgst)), P('SGST (9%)', inr(order.sgst)));
  if (num(order.round_off) !== 0) rows.push(P('Round off', num(order.round_off).toFixed(2)));
  rows.push(R('double'), P('TOTAL', inr(order.total), { size: 32, bold: true }), R('double'));
  const modeLabel = order.payment_mode === 'upi' ? 'UPI' : order.payment_mode === 'cash' ? 'Cash' : 'Card';
  rows.push(P('Paid by ' + modeLabel, inr(order.total)));
  if (order.utr) rows.push(T('UTR: ' + str(order.utr)));
  rows.push(P('Status', order.status === 'paid' ? 'PAID' : 'PENDING', { bold: true }), R(),
    C('PAY VIA UPI', { bold: true }), C(pick('upiId')), C('Amount: ' + inr(order.total)), C('Ref: ' + str(order.invoice_no)), R(),
    { type: 'gap', h: 6 }, C('Thank you! Visit again.', { bold: true }),
    C('Goods once sold will not be taken back.'), C('Keep fireworks away from children.'), { type: 'gap', h: 10 });
  return rows;
}

export function buildReceiptImageBytes(order, shop = {}, widthDots = 576) {
  return new Uint8Array([...cmd.init(), ...rowsToRaster(receiptRows(order, shop), widthDots), ...cmd.feed(5), ...cmd.cut()]);
}

// Diagnostic job: A plain text, B text with Chinese mode off, C raster image, D TSPL label
export function buildTestBytes(widthDots = 576) {
  const img = rowsToRaster([
    { type: 'text', text: 'C: image \u20b9123.00', size: 32, bold: true, align: 'center' },
    { type: 'rule', style: 'solid' },
    { type: 'text', text: `Image mode OK - paper ${widthDots} dots`, align: 'center' },
  ], widthDots);
  const tspl = 'SIZE 50 mm,25 mm\r\nGAP 2 mm,0 mm\r\nCLS\r\nTEXT 20,20,"3",0,1,1,"D: label TSPL"\r\nPRINT 1,1\r\n';
  return new Uint8Array([
    ...cmd.init(), ...ln('A: text'), ...ln('Plain ESC/POS text 123'), ...cmd.feed(2),
    ...cmd.init(), ...cmd.plainText(), ...ln('B: text with Chinese mode off'), ...ln('ESC/POS text 456'), ...cmd.feed(2),
    ...cmd.init(), ...img, ...cmd.feed(3),
    ...Array.from(tspl, (ch) => ch.charCodeAt(0)), ...cmd.feed(4), ...cmd.cut(),
  ]);
}

// ─── Print preferences ────────────────────────────────────────────────────────

export const getPrintMode = () => localStorage.getItem('bt_print_mode') || 'image';
export const setPrintMode = (m) => localStorage.setItem('bt_print_mode', m);
export const getPaperDots = () => Number(localStorage.getItem('bt_paper_dots')) || 576;
export const setPaperDots = (d) => localStorage.setItem('bt_paper_dots', String(d));

// ─── Send bytes to printer over BLE ───────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function sendBytes(bytes, { chunk = 20, onProgress } = {}) {
  if (!(await ensureConnected())) throw new Error('Printer not connected');
  const props = _char.properties || {};
  // Acknowledged writes when supported (flow control); otherwise unacknowledged with a delay
  const withResp = !!props.write;
  if (!withResp && !props.writeWithoutResponse) throw new Error('Printer characteristic is not writable');
  const write = (b) => (withResp ? _char.writeValueWithResponse(b) : _char.writeValueWithoutResponse(b));
  const delay = withResp ? 10 : 25;
  let size = chunk;
  let i = 0;
  while (i < bytes.length) {
    if (!_device?.gatt?.connected) throw new Error('Printer disconnected while printing');
    const part = bytes.slice(i, i + size);
    try {
      await withTimeout(write(part), 'Sending data to printer');
    } catch (e) {
      // Large packets need a bigger BLE MTU; fall back to 20-byte packets
      if (size > 20 && !/timed out/.test(e?.message || '')) {
        console.warn('[BT] ' + size + '-byte write failed, falling back to 20 bytes:', e?.message);
        size = 20;
        continue;
      }
      throw e;
    }
    i += part.length;
    onProgress?.(i / bytes.length);
    await sleep(delay);
  }
  return bytes.length;
}

export async function printOrder(order, shop = {}, onProgress) {
  if (!(await ensureConnected())) throw new Error('Printer not connected');
  const image = getPrintMode() === 'image';
  const bytes = image ? buildReceiptImageBytes(order, shop, getPaperDots()) : buildReceiptBytes(order, shop);
  return sendBytes(bytes, { chunk: image ? 180 : 20, onProgress });
}

export async function testPrint(onProgress) {
  return sendBytes(buildTestBytes(getPaperDots()), { chunk: 180, onProgress });
}
