export const money = (n) =>
  "₹" + Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const priceShort = (n) => "₹" + Number(n).toLocaleString("en-IN");

export function computeTotals(lines, discountAmt = 0, gstEnabled = false) {
  const subtotal = lines.reduce((s, l) => s + l.price * l.qty, 0);
  const discount = Math.min(Math.max(discountAmt, 0), subtotal);
  const afterDiscount = subtotal - discount;
  const cgst = gstEnabled ? Math.round(afterDiscount * 0.09 * 100) / 100 : 0;
  const sgst = gstEnabled ? Math.round(afterDiscount * 0.09 * 100) / 100 : 0;
  const grand = Math.round(afterDiscount + cgst + sgst);
  return {
    subtotal: Math.round(subtotal * 100) / 100,
    discount: Math.round(discount * 100) / 100,
    taxable: Math.round(afterDiscount * 100) / 100,
    cgst,
    sgst,
    roundOff: Math.round((grand - (afterDiscount + cgst + sgst)) * 100) / 100,
    grand,
    items: lines.length,
    units: lines.reduce((s, l) => s + l.qty, 0),
  };
}

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

export function rupeesInWords(num) {
  const two = (n) => (n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? " " + ONES[n % 10] : ""));
  const three = (n) => (n >= 100 ? ONES[Math.floor(n / 100)] + " Hundred" + (n % 100 ? " " + two(n % 100) : "") : two(n));
  let n = Math.round(Number(num));
  if (!n) return "Zero";
  const crore = Math.floor(n / 10000000); n %= 10000000;
  const lakh = Math.floor(n / 100000); n %= 100000;
  const thousand = Math.floor(n / 1000); n %= 1000;
  const out = [];
  if (crore) out.push(three(crore) + " Crore");
  if (lakh) out.push(three(lakh) + " Lakh");
  if (thousand) out.push(three(thousand) + " Thousand");
  if (n) out.push(three(n));
  return out.join(" ");
}
