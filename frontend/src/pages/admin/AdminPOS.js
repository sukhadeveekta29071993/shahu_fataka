import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, Plus, Minus, X, ArrowRight, User, LogIn, LogOut, KeyRound, Scan } from "lucide-react";
import api, { apiError } from "@/lib/api";
import ProductIcon, { iconBg } from "@/components/ProductIcon";
import { money, priceShort, computeTotals } from "@/lib/totals";
import { useAuth } from "@/context/AuthContext";

const PAYMENT_MODES = ["cash", "upi", "card"];

// ── PIN pad component ─────────────────────────────────────────────────────────
function PinPad({ value, onChange }) {
  const digits = "1 2 3 4 5 6 7 8 9 . 0 ⌫".split(" ");
  const handle = (d) => {
    if (d === "⌫") { onChange(value.slice(0, -1)); return; }
    if (d === ".") return; // unused placeholder
    if (value.length < 4) onChange(value + d);
  };
  return (
    <div className="flex flex-col items-center gap-4">
      {/* Dots display */}
      <div className="flex gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={"w-4 h-4 rounded-full border-2 transition-colors " +
            (value.length > i ? "bg-brick border-brick" : "border-line")} />
        ))}
      </div>
      {/* Numpad */}
      <div className="grid grid-cols-3 gap-2 w-52">
        {digits.map((d) => (
          <button
            key={d}
            onClick={() => handle(d)}
            className={"h-12 rounded-xl font-bold text-lg transition-colors " +
              (d === "⌫" ? "bg-chip text-mocha hover:bg-[#E5D5C5]" :
               d === "." ? "invisible" :
               "bg-white border border-line hover:border-brick hover:text-brick")}
            data-testid={`pin-key-${d === "⌫" ? "back" : d}`}
          >
            {d}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Main POS component ────────────────────────────────────────────────────────
export default function AdminPOS() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isSalesperson = user?.role === "salesperson";

  // ── Cart & order state ──
  const [cart, setCart] = useState([]);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerType, setCustomerType] = useState("retail");
  const [paymentMode, setPaymentMode] = useState("cash");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [posCategory, setPosCategory] = useState("All");

  const [discountType, setDiscountType] = useState("none"); // "none" | "percent" | "flat"
  const [discountValue, setDiscountValue] = useState("");

  // ── Scanner state ──
  const scannerRef = useRef(null);
  const [scannerBuffer, setScannerBuffer] = useState("");
  const [scannerFeedback, setScannerFeedback] = useState(null); // null | 'ok' | 'error'
  const [scannerMsg, setScannerMsg] = useState("");

  // ── Shift state ──
  const [activeShift, setActiveShift] = useState(null); // {id, name} | null
  const [shiftStep, setShiftStep] = useState(null);     // null | "pick" | "pin"
  const [shiftPicked, setShiftPicked] = useState(null); // selected sp during flow
  const [pinEntry, setPinEntry] = useState("");
  const [pinBusy, setPinBusy] = useState(false);
  const [pinError, setPinError] = useState("");

  // ── Queries ──
  const { data: settings } = useQuery({
    queryKey: ["admin-settings"],
    queryFn: () => api.get("/admin/settings").then((r) => r.data),
    staleTime: 0,          // always re-fetch when POS mounts or regains focus
    refetchOnMount: true,
  });
  const scannerMode = settings?.scanner_mode ?? false;
  const gstEnabled  = settings?.gst_enabled  ?? false;

  // Apply default_category from settings once on first mount
  const defaultCatApplied = useRef(false);
  useEffect(() => {
    if (!defaultCatApplied.current && settings?.default_category) {
      defaultCatApplied.current = true;
      setPosCategory(settings.default_category);
    }
  }, [settings?.default_category]);

  // ── Auto-start shift for dedicated salesperson accounts ──
  useEffect(() => {
    if (isSalesperson && user?.salesperson_id && user?.name && !activeShift) {
      setActiveShift({ id: user.salesperson_id, name: user.name });
      api.post("/admin/salespersons/shift-start-no-pin", { salesperson_id: user.salesperson_id })
        .catch((e) => console.error("Auto shift-start log failed:", e));
    }
  }, [isSalesperson, user, activeShift]);

  const { data: products = [], isLoading } = useQuery({
    queryKey: ["products"],
    queryFn: () => api.get("/products").then((r) => r.data),
  });

  const { data: salespersons = [] } = useQuery({
    queryKey: ["salespersons"],
    queryFn: () => api.get("/admin/salespersons").then((r) => r.data),
    enabled: !isSalesperson,
  });

  const { data: posCategories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: () => api.get("/categories").then((r) => r.data),
  });

  const visible = useMemo(
    () => products.filter(
      (p) =>
        (posCategory === "All" || p.category === posCategory) &&
        p.name.toLowerCase().includes(q.trim().toLowerCase())
    ),
    [products, q, posCategory]
  );

  // ── Cart helpers ──
  const priceFor = (p) => customerType === "wholesale" ? p.wholesale_price : p.retail_price;
  const qtyOf = (id) => cart.find((i) => i.product_id === id)?.qty ?? 0;

  const addToCart = (p) => setCart((prev) => {
    const ex = prev.find((i) => i.product_id === p.id);
    if (ex) return prev.map((i) => i.product_id === p.id ? { ...i, qty: i.qty + 1 } : i);
    // Store retail/wholesale prices so items scanned before the product
    // cache refreshes still display correctly in the order panel.
    return [...prev, {
      product_id: p.id,
      name: p.name,
      stock: p.stock,
      qty: 1,
      retail_price: p.retail_price ?? 0,
      wholesale_price: p.wholesale_price ?? 0,
    }];
  });

  // ── Scanner focus management — only refocus if no other input is active ──
  useEffect(() => {
    if (scannerMode && scannerRef.current) {
      const active = document.activeElement;
      const otherInputFocused = active && active !== scannerRef.current &&
        (active.tagName === "INPUT" || active.tagName === "TEXTAREA");
      if (!otherInputFocused) scannerRef.current.focus();
    }
  }, [scannerMode, cart]);

  // ── Barcode scan handler ──
  const handleScan = useCallback(async (code) => {
    const trimmed = code.trim();
    if (!trimmed) return;
    setScannerBuffer("");
    // Also clear the DOM input directly for cases where the scanner fires
    // before React state has been applied (fast USB/BT scanner burst)
    if (scannerRef.current) scannerRef.current.value = "";
    try {
      const { data } = await api.get(`/products/barcode/${encodeURIComponent(trimmed)}`);
      addToCart(data);
      // If this product is not yet in the local cache (newly added), refresh it
      queryClient.invalidateQueries({ queryKey: ["products"] });
      setScannerFeedback("ok");
      setScannerMsg(`+ ${data.name}`);
    } catch {
      setScannerFeedback("error");
      setScannerMsg(`Not found: ${trimmed}`);
    }
    setTimeout(() => { setScannerFeedback(null); setScannerMsg(""); }, 2500);
    setTimeout(() => { if (scannerRef.current) scannerRef.current.focus(); }, 50);
  }, [queryClient]); // eslint-disable-line

  const setCartQty = (pid, qty) => {
    if (qty <= 0) setCart((prev) => prev.filter((i) => i.product_id !== pid));
    else setCart((prev) => prev.map((i) => i.product_id === pid ? { ...i, qty } : i));
  };

  const lines = cart.map((i) => {
    const p = products.find((x) => x.id === i.product_id);
    if (p) return { ...i, price: priceFor(p) };
    // Product not yet in the cache (e.g. newly added product scanned before
    // the React-Query cache refreshed) — use prices stored in the cart item.
    if (i.retail_price != null) {
      const price = customerType === "wholesale" ? i.wholesale_price : i.retail_price;
      return { ...i, price };
    }
    return null;
  }).filter(Boolean);

  // Compute effective discount amount for live preview
  const subtotalRaw = lines.reduce((s, l) => s + l.price * l.qty, 0);
  const discountAmt = (() => {
    const v = parseFloat(discountValue) || 0;
    if (discountType === "percent") return Math.min(subtotalRaw * v / 100, subtotalRaw);
    if (discountType === "flat") return Math.min(v, subtotalRaw);
    return 0;
  })();

  const totals = computeTotals(lines, discountAmt, gstEnabled);

  // ── Shift helpers ──
  const startShiftFlow = () => { setShiftStep("pick"); setPinEntry(""); setPinError(""); setShiftPicked(null); };
  const endShift = async () => {
    if (activeShift) {
      try {
        await api.post("/admin/salespersons/shift-end", { salesperson_id: activeShift.id, salesperson_name: activeShift.name });
      } catch (e) { console.error("Shift end log failed:", e); }
    }
    setActiveShift(null);
  };
  const cancelShift = () => { setShiftStep(null); setPinEntry(""); setPinError(""); setShiftPicked(null); };

  const pickSalesperson = async (sp) => {
    if (!sp.has_pin) {
      try {
        await api.post("/admin/salespersons/shift-start-no-pin", { salesperson_id: sp.id });
      } catch (e) { console.error("Shift log failed:", e); }
      setActiveShift({ id: sp.id, name: sp.name });
      setShiftStep(null);
      return;
    }
    setShiftPicked(sp);
    setPinEntry("");
    setPinError("");
    setShiftStep("pin");
  };

  const verifyPin = async () => {
    if (pinEntry.length !== 4) { setPinError("Enter all 4 digits"); return; }
    setPinBusy(true); setPinError("");
    try {
      await api.post("/admin/salespersons/verify-pin", { salesperson_id: shiftPicked.id, pin: pinEntry });
      setActiveShift({ id: shiftPicked.id, name: shiftPicked.name });
      setShiftStep(null);
    } catch (e) {
      setPinError(e?.response?.data?.detail || "Wrong PIN — try again");
      setPinEntry("");
    } finally { setPinBusy(false); }
  };

  // ── Place order ──
  const placeOrder = async () => {
    if (lines.length === 0) return;
    setBusy(true); setError("");
    try {
      const { data } = await api.post("/admin/pos", {
        customer_name: customerName.trim() || "Walk-in Customer",
        customer_phone: customerPhone.trim(),
        customer_type: customerType,
        items: lines.map((i) => ({ product_id: i.product_id, qty: i.qty })),
        payment_mode: paymentMode,
        salesperson_id: activeShift?.id || "",
        discount_type: discountType,
        discount_value: parseFloat(discountValue) || 0,
      });
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["admin-stats"] });
      queryClient.invalidateQueries({ queryKey: ["admin-orders"] });
      navigate(`/order/${data.id}`);
    } catch (e) {
      setError(apiError(e));
    } finally { setBusy(false); }
  };

  // ── Shift modal overlay ──────────────────────────────────────────────────────
  const ShiftModal = () => (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" data-testid="shift-modal">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
        {shiftStep === "pick" ? (
          <>
            <div className="flex items-center justify-between px-5 py-4 border-b border-line">
              <span className="font-bold text-base">Who is starting shift?</span>
              <button onClick={cancelShift} className="w-8 h-8 rounded-lg border border-line flex items-center justify-center text-mocha">
                <X size={15} />
              </button>
            </div>
            <div className="p-4 flex flex-col gap-2 max-h-80 overflow-y-auto">
              {salespersons.length === 0 ? (
                <p className="text-sm text-mocha text-center py-4">No salespersons added yet. Add them from Dashboard.</p>
              ) : (
                salespersons.map((sp) => (
                  <button
                    key={sp.id}
                    onClick={() => pickSalesperson(sp)}
                    className="flex items-center gap-3 p-3 rounded-xl border border-line hover:border-brick transition-colors text-left"
                    data-testid={`shift-pick-${sp.id}`}
                  >
                    <div className="w-9 h-9 rounded-xl bg-chip flex items-center justify-center flex-none">
                      <User size={16} className="text-mocha" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-sm">{sp.name}</div>
                      <div className={"text-[11px] font-medium " + (sp.has_pin ? "text-[#1F5F36]" : "text-mocha")}>
                        {sp.has_pin ? "PIN set — will ask PIN" : "No PIN — tap to start directly"}
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
            <div className="px-4 pb-4">
              <button onClick={cancelShift} className="w-full h-10 rounded-xl border border-line text-mocha text-sm font-medium">
                Skip — No salesperson
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between px-5 py-4 border-b border-line">
              <div>
                <div className="font-bold text-base">Enter PIN</div>
                <div className="text-sm text-mocha">{shiftPicked?.name}</div>
              </div>
              <button onClick={() => setShiftStep("pick")} className="w-8 h-8 rounded-lg border border-line flex items-center justify-center text-mocha">
                <X size={15} />
              </button>
            </div>
            <div className="p-5 flex flex-col items-center gap-4">
              <PinPad value={pinEntry} onChange={setPinEntry} />
              {pinError && <div className="text-sm text-maroon font-medium" data-testid="pin-error">{pinError}</div>}
              <button
                onClick={verifyPin}
                disabled={pinEntry.length !== 4 || pinBusy}
                className="w-full h-11 rounded-xl bg-brick text-white font-bold text-sm disabled:opacity-50 flex items-center justify-center gap-2"
                data-testid="pin-verify-btn"
              >
                <KeyRound size={15} /> {pinBusy ? "Verifying…" : "Start Shift"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-6xl mx-auto px-5 py-6" data-testid="admin-pos">
      {shiftStep && <ShiftModal />}

      {/* ── Floating total bar — mobile only, shows when items in cart ── */}
      {lines.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 lg:hidden z-40 bg-white border-t-2 border-brick px-4 py-3 flex items-center gap-3 shadow-lg" data-testid="pos-floating-total">
          <div className="flex-1 min-w-0">
            <div className="text-[11px] text-mocha">{totals.units} unit{totals.units !== 1 ? "s" : ""} · {totals.items} item{totals.items !== 1 ? "s" : ""}</div>
            <div className="font-bold text-xl text-maroon leading-tight">{money(totals.grand)}</div>
          </div>
          <button
            onClick={placeOrder}
            disabled={busy}
            className="h-11 px-5 rounded-xl bg-brick text-white font-bold text-sm disabled:opacity-50 flex items-center gap-1.5"
            data-testid="pos-floating-place-order"
          >
            Place Order
          </button>
        </div>
      )}

      <div className="flex flex-col lg:grid lg:grid-cols-[1fr_300px] gap-4">

        {/* Left: Products grid */}
        <div className="min-w-0">

          {/* ── Sticky search + categories ── */}
          <div className="sticky top-16 z-20 bg-cream pt-1 pb-2 -mx-5 px-5">

            {/* ── Scanner mode bar (when scanner_mode ON) ── */}
            {scannerMode && (
              <div
                className={`flex items-center gap-2.5 h-12 rounded-xl px-4 mb-2 border-2 transition-all ${
                  scannerFeedback === "ok"
                    ? "border-[#1F5F36] bg-[#DDF1E3]"
                    : scannerFeedback === "error"
                    ? "border-maroon bg-[#FDE3DE]"
                    : "border-brick bg-white"
                }`}
                data-testid="scanner-bar"
              >
                <Scan size={18} className={scannerFeedback === "error" ? "text-maroon flex-none" : "text-brick flex-none"} />
                <input
                  ref={scannerRef}
                  type="text"
                  value={scannerBuffer}
                  onChange={(e) => setScannerBuffer(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      // Read the DOM value directly — React state (scannerBuffer) may be
                      // stale when a USB/BT scanner fires all characters in one fast burst
                      // before React has had a chance to re-render between onChange events.
                      const code = e.currentTarget.value || scannerBuffer;
                      handleScan(code);
                    }
                  }}
                  onBlur={(e) => {
                    // Only re-focus scanner if focus isn't moving to another input/textarea
                    const rt = e.relatedTarget;
                    const goingToInput = rt && rt !== scannerRef.current &&
                      (rt.tagName === "INPUT" || rt.tagName === "TEXTAREA");
                    if (!goingToInput) {
                      setTimeout(() => { if (scannerRef.current) scannerRef.current.focus(); }, 100);
                    }
                  }}
                  placeholder="Scan barcode here (or type + Enter)…"
                  className="flex-1 bg-transparent outline-none text-sm text-ink placeholder:text-mocha min-w-0"
                  autoComplete="off"
                  data-testid="scanner-input"
                />
                {scannerFeedback && (
                  <span className={`text-xs font-bold flex-none truncate max-w-[120px] ${scannerFeedback === "ok" ? "text-[#1F5F36]" : "text-maroon"}`}>
                    {scannerMsg}
                  </span>
                )}
                <span className="text-[10px] font-bold text-white bg-brick rounded-lg px-2 py-1 flex-none">SCANNER ON</span>
              </div>
            )}

            <div className="h-12 bg-white border border-line rounded-xl flex items-center gap-2.5 px-4 mb-2">
              <Search size={18} className="text-mocha flex-none" />
              <input
                type="text" value={q}
                onChange={(e) => { setQ(e.target.value); if (e.target.value) setPosCategory("All"); }}
                placeholder="Search products…"
                className="flex-1 bg-transparent outline-none text-sm text-ink placeholder:text-mocha min-w-0"
                data-testid="pos-search"
              />
            </div>

            {posCategories.length > 0 && (
              <div className="flex gap-1.5 overflow-x-auto pb-0.5" style={{ scrollbarWidth: "none", WebkitOverflowScrolling: "touch" }} data-testid="pos-category-chips">
                {[{ id: "all", name: "All" }, ...posCategories].map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setPosCategory(c.name)}
                    data-testid={`pos-chip-${c.name.toLowerCase().replace(/[^a-z]+/g, "-")}`}
                    className={"flex-none h-8 px-3 rounded-xl border font-bold text-xs transition-colors " +
                      (posCategory === c.name
                        ? "bg-brick border-brick text-white"
                        : "bg-white border-line text-ink hover:border-brick/50")}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            )}
          </div>{/* end sticky */}

          {isLoading ? (
            <div className="flex flex-col sm:grid sm:grid-cols-2 lg:grid-cols-3 gap-2 sm:gap-4 mt-3 pb-24 lg:pb-0">
              {[...Array(6)].map((_, i) => <div key={i} className="bg-white border border-line rounded-2xl h-14 sm:h-44 animate-pulse" />)}
            </div>
          ) : (
            <div className="flex flex-col sm:grid sm:grid-cols-2 lg:grid-cols-3 gap-2 sm:gap-4 mt-3 pb-24 lg:pb-0">
              {visible.map((p) => {
                const qty = qtyOf(p.id);
                const price = priceFor(p);
                const out = p.stock === 0;
                const slug = p.id;
                return (
                  <div key={p.id}
                    className="bg-white border border-line rounded-2xl
                      flex items-center gap-3 px-3 py-2.5
                      sm:flex-col sm:items-stretch sm:gap-2 sm:p-4"
                    data-testid={`pos-product-${p.id}`}
                  >
                    {/* Icon */}
                    <div
                      className="w-11 h-11 flex-none rounded-xl flex items-center justify-center
                        sm:h-[72px] sm:w-full"
                      style={{ background: iconBg(p.icon) }}
                    >
                      <ProductIcon icon={p.icon} size={36} />
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-sm leading-snug">{p.name}</div>
                      <div className="text-xs text-mocha">{p.pack_type} · {p.pack_size}</div>
                      {p.brand && <div className="text-[10px] sm:text-xs font-bold text-brick uppercase tracking-wide">{p.brand}</div>}
                      {/* Price inline on mobile */}
                      <div className="font-bold text-sm text-ink mt-0.5 sm:hidden">{priceShort(price)}</div>
                      {p.stock <= 10 && p.stock > 0 && (
                        <span className="sm:hidden text-[10px] font-bold text-maroon">{p.stock} left</span>
                      )}
                    </div>

                    {/* Desktop price row */}
                    <div className="hidden sm:flex items-center justify-between min-h-[22px]">
                      <div className="font-bold text-base">{priceShort(price)}</div>
                      {p.stock <= 10 && p.stock > 0 && (
                        <span className="text-[11px] font-bold text-maroon bg-[#FFE3A3] rounded-lg px-1.5 py-0.5">{p.stock}</span>
                      )}
                    </div>

                    {/* Add / Stepper */}
                    <div className="flex-none">
                      {out ? (
                        <button disabled className="h-9 sm:h-10 w-16 sm:w-full rounded-xl bg-chip text-mocha font-bold text-xs sm:text-sm">Out</button>
                      ) : qty > 0 ? (
                        <div className="h-9 sm:h-10 border-[1.5px] border-brick rounded-xl overflow-hidden flex items-stretch w-[88px] sm:w-full" data-testid={`pos-stepper-${slug}`}>
                          <button onClick={() => setCartQty(p.id, qty - 1)} className="w-8 sm:w-10 text-brick font-bold flex items-center justify-center"><Minus size={15} /></button>
                          <div className="flex-1 flex items-center justify-center font-bold text-sm">{qty}</div>
                          <button onClick={() => qty < p.stock ? addToCart(p) : null} className="w-8 sm:w-10 bg-brick text-white font-bold flex items-center justify-center"><Plus size={15} /></button>
                        </div>
                      ) : (
                        <button onClick={() => addToCart(p)} className="h-9 sm:h-10 px-4 sm:px-0 sm:w-full rounded-xl bg-brick text-white font-bold text-xs sm:text-sm" data-testid={`pos-add-${slug}`}>Add</button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right: Order panel */}
        <div className="lg:sticky lg:top-[8.5rem] lg:h-fit">
          <div className="bg-white border border-line rounded-2xl flex flex-col lg:max-h-[calc(100vh-11rem)]" data-testid="pos-order-panel">

            {/* ── Scrollable top: shift + customer + discount + items ── */}
            <div className="flex-1 overflow-y-auto p-4 pb-2 flex flex-col gap-3 min-h-0">
              <div className="font-bold text-base">New Order</div>

            {/* Shift bar */}
            {isSalesperson ? (
              /* Dedicated salesperson account — always on shift, no controls */
              <div className="flex items-center gap-2 bg-[#DDF1E3] rounded-xl px-3 py-2" data-testid="shift-active-bar">
                <User size={14} className="text-[#1F5F36] flex-none" />
                <span className="text-sm font-bold text-[#1F5F36]">{user?.name}</span>
                <span className="ml-auto text-[11px] text-[#1F5F36] font-medium">On shift</span>
              </div>
            ) : activeShift ? (
              <div className="flex items-center justify-between gap-2 bg-[#DDF1E3] rounded-xl px-3 py-2" data-testid="shift-active-bar">
                <div className="flex items-center gap-2">
                  <User size={14} className="text-[#1F5F36] flex-none" />
                  <span className="text-sm font-bold text-[#1F5F36]">{activeShift.name}</span>
                </div>
                <button
                  onClick={endShift}
                  className="flex items-center gap-1 text-[11px] font-bold text-mocha hover:text-maroon transition-colors"
                  data-testid="shift-end-btn"
                >
                  <LogOut size={12} /> End shift
                </button>
              </div>
            ) : (
              <button
                onClick={startShiftFlow}
                className="flex items-center justify-center gap-2 h-10 rounded-xl border border-dashed border-[#C8A882] text-mocha text-sm font-medium hover:border-brick hover:text-brick transition-colors"
                data-testid="shift-start-btn"
              >
                <LogIn size={15} /> Start Shift
              </button>
            )}

            {/* Customer info */}
            <div className="flex bg-chip rounded-[10px] p-0.5 gap-0.5" data-testid="pos-type-selector">
              {["retail", "wholesale"].map((t) => (
                <button key={t} onClick={() => setCustomerType(t)}
                  className={"flex-1 h-9 rounded-[8px] font-bold text-[13px] capitalize transition-colors " +
                    (customerType === t ? "bg-brick text-white" : "text-[#5A3A30] hover:text-ink")}
                  data-testid={`pos-type-${t}`}>{t}
                </button>
              ))}
            </div>

            {/* Discount */}
            <div className="border-t border-line pt-3" data-testid="pos-discount-section">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-bold text-ink">Discount</span>
                <div className="flex bg-chip rounded-lg p-0.5 gap-0.5">
                  {[["none", "None"], ["percent", "%"], ["flat", "₹"]].map(([val, label]) => (
                    <button
                      key={val}
                      onClick={() => { setDiscountType(val); setDiscountValue(""); }}
                      className={"px-3 h-7 rounded-[6px] text-xs font-bold transition-colors " +
                        (discountType === val ? "bg-brick text-white" : "text-[#5A3A30] hover:text-ink")}
                      data-testid={`pos-discount-type-${val}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {discountType !== "none" && (
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-mocha">
                    {discountType === "percent" ? "%" : "₹"}
                  </span>
                  <input
                    type="number"
                    min="0"
                    max={discountType === "percent" ? "100" : undefined}
                    value={discountValue}
                    onChange={(e) => setDiscountValue(e.target.value)}
                    placeholder={discountType === "percent" ? "e.g. 10" : "e.g. 50"}
                    className="w-full h-11 border border-line rounded-xl pl-8 pr-3 text-sm outline-none focus:border-brick bg-cream"
                    data-testid="pos-discount-input"
                  />
                  {discountAmt > 0 && (
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#1F5F36] font-bold">
                      -{money(discountAmt)}
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Items list */}
            <div className="border-t border-line pt-2">
              {lines.length === 0 ? (
                <div className="text-sm text-mocha text-center py-3">No items added</div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {lines.map((i) => (
                    <div key={i.product_id} className="flex items-center gap-2 text-sm" data-testid={`pos-cart-item-${i.product_id}`}>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate text-[13px]">{i.name}</div>
                        <div className="text-xs text-mocha">{money(i.price)} × {i.qty}</div>
                      </div>
                      <div className="font-bold text-[13px] flex-none">{money(i.price * i.qty)}</div>
                      <button onClick={() => setCartQty(i.product_id, 0)} className="text-mocha hover:text-maroon flex-none" data-testid={`pos-remove-${i.product_id}`}>
                        <X size={15} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            </div>{/* end scrollable */}

            {/* ── Sticky bottom: totals + customer + payment + button ── */}
            <div className="border-t border-line bg-white rounded-b-2xl p-4 pt-3 flex flex-col gap-3">

            {/* Totals */}
            {lines.length > 0 && (
              <div className="flex flex-col gap-1 text-[13px]" data-testid="pos-totals">
                <div className="flex justify-between text-mocha"><span>Subtotal</span><span>{money(totals.subtotal)}</span></div>
                {totals.discount > 0 && (
                  <div className="flex justify-between text-[#1F5F36] font-medium" data-testid="pos-discount-line">
                    <span>Discount {discountType === "percent" ? `(${discountValue}%)` : ""}</span>
                    <span>-{money(totals.discount)}</span>
                  </div>
                )}
                {gstEnabled && totals.cgst > 0 && (
                  <>
                    <div className="flex justify-between text-mocha" data-testid="pos-cgst-line">
                      <span>CGST (9%)</span><span>{money(totals.cgst)}</span>
                    </div>
                    <div className="flex justify-between text-mocha" data-testid="pos-sgst-line">
                      <span>SGST (9%)</span><span>{money(totals.sgst)}</span>
                    </div>
                  </>
                )}
                <div className="flex justify-between font-bold text-base border-t border-line pt-1.5 mt-0.5">
                  <span>Total</span>
                  <span className="text-maroon" data-testid="pos-grand-total">{money(totals.grand)}</span>
                </div>
              </div>
            )}

            {/* Customer name + phone */}
            <div className="flex flex-col gap-2">
              <input type="text" value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Customer name (Walk-in if blank)"
                className="h-10 border border-line rounded-xl px-3 text-sm outline-none focus:border-brick bg-cream"
                data-testid="pos-customer-name"
              />
              <input type="tel" value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                placeholder="Phone (optional)"
                className="h-10 border border-line rounded-xl px-3 text-sm outline-none focus:border-brick bg-cream"
                data-testid="pos-customer-phone"
              />
            </div>

            {/* Payment mode */}
            <div className="flex bg-chip rounded-[10px] p-0.5 gap-0.5" data-testid="pos-payment-selector">
              {PAYMENT_MODES.map((m) => (
                <button key={m} onClick={() => setPaymentMode(m)}
                  className={"flex-1 h-9 rounded-[8px] font-bold text-[13px] uppercase transition-colors " +
                    (paymentMode === m ? "bg-brick text-white" : "text-[#5A3A30] hover:text-ink")}
                  data-testid={`pos-pay-${m}`}>{m}
                </button>
              ))}
            </div>

            {error && <div className="bg-[#FDE3DE] text-maroon rounded-xl px-3 py-2 text-sm" data-testid="pos-error">{error}</div>}

            <button
              onClick={placeOrder}
              disabled={busy || lines.length === 0}
              className="h-12 rounded-xl bg-brick text-white font-bold text-sm disabled:opacity-50 flex items-center justify-center gap-2"
              data-testid="pos-place-order"
            >
              {busy ? "Placing…" : lines.length === 0 ? "Add items to continue" : `Place Order · ${money(totals.grand)}`}
              {!busy && lines.length > 0 && <ArrowRight size={17} />}
            </button>
            </div>{/* end sticky bottom */}

          </div>
        </div>
      </div>
    </div>
  );
}
