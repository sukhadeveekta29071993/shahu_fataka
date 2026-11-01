// ─── Render receipt rows to a 1-bit raster and wrap it in ESC/POS GS v 0 bands ──

const BASE_W = 576; // layout is designed for 80mm (576 dots), scaled for 58mm (384)
const FONT = 'Arial, Helvetica, sans-serif';
const ESC = 0x1b;
const GS = 0x1d;

function wrap(ctx, text, maxW) {
  const lines = [];
  let cur = '';
  for (const word of String(text ?? '').split(' ')) {
    const next = cur ? cur + ' ' + word : word;
    if (ctx.measureText(next).width <= maxW) { cur = next; continue; }
    if (cur) lines.push(cur);
    cur = '';
    let piece = '';
    for (const ch of word) {
      if (ctx.measureText(piece + ch).width > maxW && piece) { lines.push(piece); piece = ''; }
      piece += ch;
    }
    cur = piece;
  }
  if (cur || !lines.length) lines.push(cur);
  return lines;
}

// rows: {type:'text', text, size, bold, align} | {type:'pair', left, right, size, bold}
//       {type:'rule', style:'dash'|'solid'|'double'} | {type:'gap', h}
function layout(ctx, rows, width, k, draw) {
  const M = Math.round(10 * k);
  const inner = width - 2 * M;
  const setFont = (r) => { ctx.font = `${r.bold ? 'bold ' : ''}${Math.round((r.size || 22) * k)}px ${FONT}`; };
  const lh = (r) => Math.round((r.size || 22) * k * 1.3);
  const base = (r) => Math.round((r.size || 22) * k);
  let y = 0;
  for (const r of rows) {
    if (r.type === 'text') {
      setFont(r);
      for (const line of wrap(ctx, r.text, inner)) {
        if (draw) {
          ctx.textAlign = r.align || 'left';
          const x = r.align === 'center' ? width / 2 : r.align === 'right' ? width - M : M;
          ctx.fillText(line, x, y + base(r));
        }
        y += lh(r);
      }
    } else if (r.type === 'pair') {
      setFont(r);
      const right = String(r.right ?? '');
      const rw = ctx.measureText(right).width;
      wrap(ctx, r.left, Math.max(inner - rw - 12 * k, inner / 3)).forEach((line, i) => {
        if (draw) {
          ctx.textAlign = 'left';
          ctx.fillText(line, M, y + base(r));
          if (i === 0) { ctx.textAlign = 'right'; ctx.fillText(right, width - M, y + base(r)); }
        }
        y += lh(r);
      });
    } else if (r.type === 'rule') {
      y += Math.round(6 * k);
      const t = Math.max(2, Math.round(2 * k));
      if (draw) {
        if (r.style === 'dash') {
          for (let x = M; x < width - M; x += 12 * k) ctx.fillRect(x, y, 7 * k, t);
        } else {
          ctx.fillRect(M, y, inner, t);
          if (r.style === 'double') ctx.fillRect(M, y + t + 3 * k, inner, t);
        }
      }
      y += Math.round((r.style === 'double' ? 14 : 8) * k);
    } else if (r.type === 'gap') {
      y += Math.round((r.h || 10) * k);
    }
  }
  return y;
}

export function renderRows(rows, widthDots = BASE_W) {
  const k = widthDots / BASE_W;
  const canvas = document.createElement('canvas');
  canvas.width = widthDots;
  canvas.height = 10;
  const height = Math.ceil(layout(canvas.getContext('2d'), rows, widthDots, k, false)) + 8;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, widthDots, height);
  ctx.fillStyle = '#000';
  ctx.textBaseline = 'alphabetic';
  layout(ctx, rows, widthDots, k, true);
  return canvas;
}

// 1 bit per pixel, MSB = leftmost, 1 = black
export function canvasToBits(canvas, threshold = 160) {
  const { width, height } = canvas;
  const data = canvas.getContext('2d').getImageData(0, 0, width, height).data;
  const widthBytes = Math.ceil(width / 8);
  const bits = new Uint8Array(widthBytes * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      if (lum < threshold && data[i + 3] > 0) bits[y * widthBytes + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return { widthBytes, height, bits };
}

// GS v 0 per run of inked rows (max `band` rows); blank rows become a dot feed (ESC J n)
export function bitsToRasterCommands({ widthBytes, height, bits }, band = 24) {
  const out = [];
  const blank = (y) => {
    for (let i = y * widthBytes, e = i + widthBytes; i < e; i++) if (bits[i]) return false;
    return true;
  };
  let y = 0;
  while (y < height) {
    let n = 0;
    if (blank(y)) {
      while (y + n < height && n < 255 && blank(y + n)) n++;
      out.push(ESC, 0x4a, n);
    } else {
      while (y + n < height && n < band && !blank(y + n)) n++;
      out.push(GS, 0x76, 0x30, 0x00, widthBytes & 0xff, widthBytes >> 8, n & 0xff, n >> 8);
      const slice = bits.subarray(y * widthBytes, (y + n) * widthBytes);
      for (let i = 0; i < slice.length; i++) out.push(slice[i]);
    }
    y += n;
  }
  return out;
}

export const rowsToRaster = (rows, widthDots) =>
  bitsToRasterCommands(canvasToBits(renderRows(rows, widthDots)));
