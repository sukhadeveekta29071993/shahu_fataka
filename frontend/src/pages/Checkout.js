import { useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import api, { apiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useCart } from "@/context/CartContext";
import { money, computeTotals } from "@/lib/totals";

const MODES = [
  { key: "upi", label: "UPI" },
  { key: "cash", label: "Cash" },
  { key: "card", label: "Card" },
];

export default function Checkout() {
  const { user } = useAuth();
  const { items, clear } = useCart();
  const navigate = useNavigate();
  const location = useLocation();

  // Customer details passed from Cart page
  const custName  = location.state?.custName  || user?.name  || "";
  const custPhone = location.state?.custPhone || user?.phone || "";
  const custEmail = location.state?.custEmail || user?.email || "";

  const [mode, setMode] = useState("upi");
  const [utr, setUtr] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: () => api.get("/products").then((r) => r.data),
  });

  const { data: shopInfo } = useQuery({
    queryKey: ["shop-info"],
    queryFn: () => api.get("/settings/public").then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });
  const upiId   = shopInfo?.upi_id   || "paytm.d95113099@pty";
  const upiName = shopInfo?.upi_name || "Balaji Fataka";

  const wholesale = user?.customer_type === "wholesale" && user?.approved;
  const lines = items
    .map((i) => {
      const p = products.find((x) => x.id === i.product_id);
      return p ? { ...i, price: wholesale ? p.wholesale_price : p.retail_price } : null;
    })
    .filter(Boolean);
  const totals = computeTotals(lines);

  const place = async () => {
    setBusy(true);
    setError("");
    try {
      const { data } = await api.post("/orders", {
        items: items.map((i) => ({ product_id: i.product_id, qty: i.qty })),
        payment_mode: mode,
        utr,
        customer_name:  custName  || undefined,
        customer_phone: custPhone || undefined,
        customer_email: custEmail || undefined,
      });
      clear();
      navigate(`/order/${data.id}`);
    } catch (e) {
      setError(apiError(e));
    } finally {
      setBusy(false);
    }
  };

  if (items.length === 0) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-20 text-center" data-testid="checkout-empty">
        <div className="font-display font-bold text-2xl mb-2">Nothing to check out</div>
        <p className="text-mocha text-sm mb-6">Your cart is empty.</p>
        <Link to="/" data-testid="checkout-empty-shop-btn" className="inline-flex h-12 items-center rounded-xl bg-brick text-white font-bold text-sm px-6">
          Continue shopping
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto" data-testid="checkout-page">
      <div className="bg-maroon px-4 pt-4 pb-5 md:rounded-b-2xl">
        <div className="text-xs font-medium text-gold">Amount to collect</div>
        <div className="font-display font-bold text-4xl leading-[42px] text-white" data-testid="checkout-amount">{money(totals.grand)}</div>
        <div className="text-xs text-[#F3D9C4] mt-0.5">New order · {user.name} ({user.customer_type})</div>
      </div>

      <div className="px-4 py-4 flex flex-col gap-3">
        <div className="flex bg-chip rounded-[14px] p-1 gap-1" data-testid="payment-mode-tabs">
          {MODES.map((m) => (
            <button
              key={m.key}
              data-testid={`pay-mode-${m.key}`}
              onClick={() => setMode(m.key)}
              className={"flex-1 h-11 rounded-[10px] font-bold text-[13px] transition-colors " + (mode === m.key ? "bg-brick text-white" : "text-[#5A3A30]")}
            >
              {m.label}
            </button>
          ))}
        </div>

        {mode === "upi" ? (
          <>
            <div className="bg-white border border-line rounded-2xl p-4 flex flex-col items-center gap-2.5" data-testid="upi-panel">
              <div className="w-[176px] h-[176px] border border-line rounded-xl p-1.5 bg-white">
                <QRCodeSVG
                  data-testid="upi-qr"
                  value={`upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(upiName)}&am=${totals.grand}&cu=INR&tn=Fireworks+Order`}
                  size={164}
                  fgColor="#2B1712"
                />
              </div>
              <div className="font-bold text-sm">Scan with any UPI app</div>
              <div className="text-xs text-mocha">Pay to {upiId} · {money(totals.grand)}</div>
              <div className="bg-[#FFF0C9] text-[#5C3F00] rounded-full px-3.5 py-2 text-[13px] font-bold" data-testid="upi-waiting-badge">Waiting for payment</div>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="utr" className="text-xs font-bold text-[#5A3A30]">UTR / transaction ID (optional)</label>
              <input
                id="utr"
                data-testid="utr-input"
                type="text"
                value={utr}
                onChange={(e) => setUtr(e.target.value)}
                placeholder="e.g. 402183746512"
                className="h-12 border-[1.5px] border-line rounded-xl bg-white px-3.5 text-base outline-none focus:border-brick"
              />
            </div>
          </>
        ) : (
          <div className="bg-white border border-line rounded-2xl p-4 text-sm text-mocha" data-testid="cod-panel">
            Pay with {mode === "cash" ? "cash" : "card"} when your order is delivered. The invoice will be marked <b className="text-ink">Pending</b> until payment is collected.
          </div>
        )}

        {error && <div className="bg-[#FDE3DE] text-maroon rounded-xl px-3.5 py-2.5 text-sm font-medium" data-testid="checkout-error">{error}</div>}

        <button
          onClick={place}
          disabled={busy}
          data-testid="place-order-btn"
          className="h-14 rounded-2xl bg-brick text-white font-bold text-base flex items-center justify-center disabled:opacity-60"
        >
          {busy ? "Placing order…" : mode === "upi" ? `Payment received · Place order` : `Place order · Pay on delivery`}
        </button>

        <Link to="/cart" data-testid="checkout-back-to-cart" className="h-12 rounded-2xl border-[1.5px] border-brick text-brick font-bold text-sm flex items-center justify-center">
          Back to cart
        </Link>
      </div>
    </div>
  );
}
