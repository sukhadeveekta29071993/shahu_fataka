import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Minus, Plus, ArrowRight, User } from "lucide-react";
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useCart } from "@/context/CartContext";
import ProductIcon, { iconBg } from "@/components/ProductIcon";
import { money, computeTotals } from "@/lib/totals";

export default function Cart() {
  const { user } = useAuth();
  const { items, setQty } = useCart();
  const navigate = useNavigate();

  const [custName, setCustName]   = useState(() => user?.name  || "");
  const [custPhone, setCustPhone] = useState(() => user?.phone || "");
  const [custEmail, setCustEmail] = useState(() => user?.email || "");

  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: () => api.get("/products").then((r) => r.data),
  });

  const wholesale = user?.customer_type === "wholesale" && user?.approved;
  const lines = items
    .map((i) => {
      const p = products.find((x) => x.id === i.product_id);
      return p ? { ...i, p, price: wholesale ? p.wholesale_price : p.retail_price } : null;
    })
    .filter(Boolean);
  const totals = computeTotals(lines);

  if (items.length === 0) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-20 text-center" data-testid="cart-empty">
        <div className="font-display font-bold text-2xl mb-2">Your cart is empty</div>
        <p className="text-mocha text-sm mb-6">Add some fireworks from the shop.</p>
        <Link to="/" data-testid="cart-empty-shop-btn" className="inline-flex h-12 items-center rounded-xl bg-brick text-white font-bold text-sm px-6">
          Continue shopping
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-5 py-6" data-testid="cart-page">
      <div className="flex items-center gap-3 mb-5">
        <h1 className="font-display font-bold text-2xl">Cart</h1>
      </div>

      <div className="bg-white border border-line rounded-2xl px-4 py-4 flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-full bg-[#FFE3B8] flex items-center justify-center flex-none text-maroon">
            <User size={22} />
          </div>
          <div className="min-w-0">
            <div className="font-bold text-sm truncate" data-testid="cart-customer-name">{user ? user.name : "Guest customer"}</div>
            <div className="text-xs text-mocha" data-testid="cart-pricing-note">
              {wholesale ? "Wholesale pricing" : "Retail pricing"} · Intra-state
            </div>
          </div>
        </div>
        {!user && (
          <Link to="/login" data-testid="cart-login-link" className="h-11 px-3.5 flex items-center border-[1.5px] border-brick text-brick rounded-xl font-bold text-[13px] flex-none">
            Login
          </Link>
        )}
      </div>

      <div className="bg-white border border-line rounded-2xl px-4 mb-4">
        {lines.map((l, idx) => (
          <div key={l.product_id} className={"flex items-center gap-3 py-4 " + (idx < lines.length - 1 ? "border-b border-[#F1E2CC]" : "")}>
            <div className="w-[52px] h-[52px] rounded-xl flex items-center justify-center flex-none" style={{ background: iconBg(l.p.icon) }}>
              <ProductIcon icon={l.p.icon} size={32} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-bold text-sm">{l.p.name}</div>
              <div className="text-xs text-mocha" data-testid={`cart-line-price-${l.p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>
                {money(l.price)} × {l.qty} = {money(l.price * l.qty)}
              </div>
            </div>
            <div className="h-11 w-[124px] border-[1.5px] border-brick rounded-xl overflow-hidden flex items-stretch flex-none" data-testid={`cart-stepper-${l.p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>
              <button aria-label={`Decrease ${l.p.name}`} data-testid={`cart-dec-${l.p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`} onClick={() => setQty(l.product_id, l.qty - 1)} className="w-10 text-brick text-xl font-bold flex items-center justify-center">
                <Minus size={16} />
              </button>
              <div className="flex-1 flex items-center justify-center font-bold text-[15px]" data-testid={`cart-qty-${l.p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>{l.qty}</div>
              <button aria-label={`Increase ${l.p.name}`} data-testid={`cart-inc-${l.p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`} onClick={() => (l.qty < l.p.stock ? setQty(l.product_id, l.qty + 1) : null)} className="w-10 bg-brick text-white font-bold flex items-center justify-center">
                <Plus size={16} />
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="bg-white border border-line rounded-2xl p-5 flex flex-col gap-2.5 text-sm mb-6" data-testid="cart-totals">
        <div className="flex justify-between pb-2.5 border-b border-dashed border-[#E3CCAE]"><span className="text-mocha">Subtotal</span><span className="font-medium">{money(totals.subtotal)}</span></div>
        <div className="flex justify-between items-baseline">
          <span className="font-bold text-[15px]">Grand total</span>
          <span className="font-display font-bold text-[26px] text-maroon" data-testid="cart-grand-total">{money(totals.grand)}</span>
        </div>
        {totals.roundOff !== 0 && (
          <div className="flex justify-between text-xs text-mocha"><span>incl. round off</span><span>{money(totals.roundOff)}</span></div>
        )}
      </div>

      {/* ── Customer Details ── */}
      <div className="bg-white border border-line rounded-2xl p-5 flex flex-col gap-3 text-sm mb-4" data-testid="cart-customer-details">
        <div className="font-bold text-[13px] text-ink">Customer Details</div>
        <div className="flex flex-col gap-2">
          <input
            type="text"
            value={custName}
            onChange={(e) => setCustName(e.target.value)}
            placeholder="Full name"
            data-testid="cart-cust-name"
            className="h-11 border border-line rounded-xl px-3.5 text-sm outline-none focus:border-brick bg-cream"
          />
          <input
            type="tel"
            value={custPhone}
            onChange={(e) => setCustPhone(e.target.value)}
            placeholder="Mobile number"
            data-testid="cart-cust-phone"
            className="h-11 border border-line rounded-xl px-3.5 text-sm outline-none focus:border-brick bg-cream"
          />
          <input
            type="email"
            value={custEmail}
            onChange={(e) => setCustEmail(e.target.value)}
            placeholder="Email ID"
            data-testid="cart-cust-email"
            className="h-11 border border-line rounded-xl px-3.5 text-sm outline-none focus:border-brick bg-cream"
          />
        </div>
      </div>

      <button
        onClick={() => navigate("/checkout", { state: { custName, custPhone, custEmail } })}
        data-testid="cart-proceed-btn"
        className="h-14 rounded-2xl bg-brick text-white font-bold text-base flex items-center justify-center gap-2.5 w-full"
      >
        Proceed to pay · {money(totals.grand)} <ArrowRight size={20} />
      </button>
    </div>
  );
}
