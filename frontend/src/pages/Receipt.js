import { useState, useCallback, useRef } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { Bluetooth, BluetoothConnected, BluetoothOff, Loader, Share2, MessageCircle, Printer } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { money, rupeesInWords } from "@/lib/totals";
import {
  isBTSupported,
  isConnected,
  ensureConnected,
  connectPrinter,
  disconnect,
  getSavedPrinterName,
  printOrder,
  testPrint,
  getPrinterInfo,
  getPrintMode,
  setPrintMode,
  getPaperDots,
  setPaperDots,
} from "@/lib/btPrinter";

// Throttled "Printing… N%" toast updater
const progressToast = (label) => {
  let last = -1;
  return (f) => {
    const pct = Math.floor(f * 20) * 5;
    if (pct !== last) { last = pct; toast.loading(`${label}… ${pct}%`, { id: "bt" }); }
  };
};

// Fit the 80mm page height to the receipt; style is removed after printing
function printReceipt() {
  const card = document.querySelector('[data-testid="receipt-card"]');
  const hMm = card ? Math.ceil((card.scrollHeight * 25.4) / 96 * 1.15) + 12 : 297;
  const style = document.createElement("style");
  style.setAttribute("data-receipt-page", "");
  style.textContent = `@media print { @page { size: 80mm ${hMm}mm; margin: 4mm 3mm; } }`;
  document.head.appendChild(style);
  const cleanup = () => { style.remove(); window.removeEventListener("afterprint", cleanup); };
  window.addEventListener("afterprint", cleanup);
  window.print();
  setTimeout(cleanup, 60000);
}

export default function Receipt() {
  const { id } = useParams();
  const { user } = useAuth();

  // ── BT printer state ──────────────────────────────────────────────────────
  const [btState, setBtState] = useState(() =>
    isConnected() ? "connected" : getSavedPrinterName() ? "saved" : "idle"
  );
  const [btLabel, setBtLabel] = useState(() => getSavedPrinterName() || "");
  const [btError, setBtError] = useState("");
  const [btInfo, setBtInfo] = useState(() => getPrinterInfo());
  const [printMode, setPrintModeState] = useState(getPrintMode);
  const [paperDots, setPaperDotsState] = useState(getPaperDots);

  const busyRef = useRef(false);

  const btFail = useCallback((msg, state = "idle") => {
    setBtState(state);
    setBtError(msg);
    toast.error(msg, { id: "bt" });
  }, []);

  const connectMsg = (e) =>
    e?.name === "NotFoundError" ? "No printer selected. Tap Connect Printer and choose Printer001."
    : e?.name === "SecurityError" ? "Bluetooth blocked: tap the button again (needs a direct tap, HTTPS only)."
    : e?.name === "NotAllowedError" ? "Bluetooth permission denied. Allow Bluetooth for this site in Chrome settings."
    : (e?.message || "Could not connect to printer.");

  const handleConnect = useCallback(async () => {
    if (!isBTSupported()) return btFail("Bluetooth is not available in this browser. Use Chrome on Android or desktop.");
    if (busyRef.current) return toast.info("Printer is busy, please wait…", { id: "bt" });
    busyRef.current = true;
    setBtError("");
    setBtState("connecting");
    toast.loading("Connecting to printer…", { id: "bt" });
    try {
      const name = await connectPrinter();
      setBtLabel(name);
      setBtInfo(getPrinterInfo());
      setBtState("connected");
      toast.success(`${name} connected`, { id: "bt" });
    } catch (e) {
      console.error("BT connect failed:", e);
      btFail(connectMsg(e));
    } finally {
      busyRef.current = false;
    }
  }, [btFail]);

  const handleDisconnect = useCallback(() => {
    disconnect();
    setBtLabel("");
    setBtState("idle");
    setBtError("");
  }, []);

  const handleBTPrint = async (order, shop) => {
    if (!isBTSupported()) return btFail("Bluetooth is not available in this browser. Use Chrome on Android or desktop.");
    if (busyRef.current) return toast.info("Already printing, please wait…", { id: "bt" });
    if (!order || !Array.isArray(order.items) || order.items.length === 0)
      return btFail("Bill data not loaded yet. Reload the page and try again.", "connected");
    busyRef.current = true;
    setBtError("");
    setBtState("printing");
    toast.loading("Printing…", { id: "bt" });
    try {
      if (!isConnected() && !(await ensureConnected())) {
        toast.loading("Printer not connected, choose Printer001…", { id: "bt" });
        try {
          setBtLabel(await connectPrinter());
          setBtInfo(getPrinterInfo());
        } catch (e) {
          console.error("BT reconnect failed:", e);
          btFail("Reconnect failed: " + connectMsg(e));
          return;
        }
        toast.loading("Printing…", { id: "bt" });
      }
      const n = await printOrder(order, shop, progressToast("Printing"));
      setBtState("done");
      toast.success(`Receipt sent to printer (${printMode === "image" ? "image" : "text"} mode, ${n} bytes)`, { id: "bt" });
      setTimeout(() => setBtState(isConnected() ? "connected" : "idle"), 3000);
    } catch (e) {
      console.error("BT print failed:", e);
      btFail("Print failed: " + (e?.message || "Unknown error"), isConnected() ? "connected" : "idle");
    } finally {
      busyRef.current = false;
    }
  };

  const handleTestPrint = async () => {
    if (busyRef.current) return toast.info("Printer is busy, please wait…", { id: "bt" });
    if (!isConnected() && !(await ensureConnected()))
      return btFail("Connect the printer first, then tap Test print.");
    busyRef.current = true;
    setBtError("");
    setBtState("printing");
    toast.loading("Sending test print…", { id: "bt" });
    try {
      const n = await testPrint(progressToast("Test print"));
      setBtState("connected");
      toast.success(`Test sent (${n} bytes). Which samples printed: A, B, C or D?`, { id: "bt", duration: 10000 });
    } catch (e) {
      console.error("BT test print failed:", e);
      btFail("Test print failed: " + (e?.message || "Unknown error"), isConnected() ? "connected" : "idle");
    } finally {
      busyRef.current = false;
    }
  };

  const changeMode = (m) => { setPrintMode(m); setPrintModeState(m); };
  const changePaper = (d) => { setPaperDots(d); setPaperDotsState(Number(d)); };
  const { data: order, isLoading, isError } = useQuery({
    queryKey: ["order", id],
    queryFn: () => api.get(`/orders/${id}`).then((r) => r.data),
    retry: 1,
  });

  const { data: shopInfo } = useQuery({
    queryKey: ["shop-info"],
    queryFn: () => api.get("/settings/public").then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });
  const upiId      = shopInfo?.upi_id        || "paytm.d95113099@pty";
  const upiName    = shopInfo?.upi_name      || "Balaji Fataka";
  const shopName   = shopInfo?.shop_name     || "Balaji Fataka";
  const shopAddr   = shopInfo?.address       || "";
  const shopPhone  = shopInfo?.phone         || "";
  const gstNo      = shopInfo?.gst_no        || "";
  const fireLicNo  = shopInfo?.fire_license_no || "";
  const gstEnabled = shopInfo?.gst_enabled   || false;

  // ── Share bill via WhatsApp / SMS — must be before any early return ──────────
  const [shareState, setShareState] = useState("idle"); // "idle" | "done"
  const handleShare = useCallback(async () => {
    if (!order) return;
    const dateLabel = new Date(order.created_at).toLocaleString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
    const itemLines = order.items
      .map((it) => `  • ${it.name} x${it.qty} = ₹${(it.price * it.qty).toFixed(2)}`)
      .join("\n");
    const gstLine = order.cgst > 0
      ? `\nCGST (9%): ₹${order.cgst.toFixed(2)}\nSGST (9%): ₹${order.sgst.toFixed(2)}`
      : "";
    const discountLine = order.discount > 0 ? `\nDiscount: -₹${order.discount.toFixed(2)}` : "";
    const text =
`*${shopName} — Invoice*
Inv No: *${order.invoice_no}*
Date: ${dateLabel}
Customer: ${order.customer_name}${order.customer_phone ? " | " + order.customer_phone : ""}

*Items:*
${itemLines}
${discountLine}${gstLine}
─────────────────
*Total: ₹${order.total.toFixed(2)}*
Payment: ${order.payment_mode?.toUpperCase()} | ${order.status === "paid" ? "✅ PAID" : "⏳ PENDING"}

View bill: ${window.location.href}`;

    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: `Invoice ${order.invoice_no}`, text, url: window.location.href });
        setShareState("done");
        setTimeout(() => setShareState("idle"), 3000);
      } catch { /* user cancelled */ }
    } else {
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
    }
  }, [order, shopName]);

  if (isLoading) {
    return <div className="max-w-6xl mx-auto px-4 py-20 text-center text-mocha text-sm">Loading receipt…</div>;
  }
  if (isError || !order) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-20 text-center" data-testid="receipt-not-found">
        <div className="font-display font-bold text-2xl mb-2">Receipt not found</div>
        <Link to="/orders" data-testid="receipt-back-to-orders" className="inline-flex h-12 items-center rounded-xl bg-brick text-white font-bold text-sm px-6 mt-3">
          My orders
        </Link>
      </div>
    );
  }

  const paid = order.status === "paid";
  const dateStr = new Date(order.created_at).toLocaleString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 print:px-0 print:py-0" data-testid="receipt-page">
      <div className="bg-white border border-line rounded-2xl shadow-sm p-5 mx-auto max-w-[360px] print:shadow-none print:border-0 print:rounded-none print:max-w-full print:p-2" style={{ fontFamily: '"DM Sans", monospace' }} data-testid="receipt-card">
        <div className="text-center flex flex-col gap-0.5 text-[13px] leading-5">
          <div className="font-bold tracking-wide text-[15px]">{shopName}</div>
          {shopAddr && shopAddr.split("\n").map((line, i) => <div key={i}>{line}</div>)}
          {shopPhone && <div>Ph: {shopPhone}</div>}
          {gstEnabled && gstNo && <div>GSTIN: {gstNo}</div>}
          {fireLicNo && <div>Explosives Lic: {fireLicNo}</div>}
        </div>

        <div className="text-center font-bold tracking-[0.2em] text-xs my-3 border-y border-dashed border-[#1F1512] py-1.5">INVOICE</div>

        <div className="flex flex-col gap-0.5 text-[13px]">
          <div>Inv No <b>{order.invoice_no}</b></div>
          <div className="flex justify-between"><span>Date</span><span>{dateStr}</span></div>
          <div className="flex justify-between"><span>Customer</span><span>{order.customer_name} ({order.customer_type === "wholesale" ? "Wholesale" : "Retail"})</span></div>
          {order.customer_phone && <div className="flex justify-between"><span>Phone</span><span>{order.customer_phone}</span></div>}
          {order.salesperson_name && <div className="flex justify-between"><span>Salesperson</span><span>{order.salesperson_name}</span></div>}
        </div>

        <div className="flex gap-2 py-1.5 mt-2 font-bold text-[11px] uppercase border-b border-[#1F1512]">
          <div className="flex-[2]">Item</div>
          <div className="flex-1 text-right">Amount</div>
        </div>
        {order.items.map((it, i) => (
          <div key={`${it.name}-${i}`} className="py-1.5 border-b border-dashed border-[#E5D8CE] text-[13px]">
            <div className="flex justify-between gap-2">
              <span className="flex-[2]">{it.name} ({it.pack_type} of {it.pack_size})</span>
              <span className="flex-1 text-right font-bold">{(it.price * it.qty).toFixed(2)}</span>
            </div>
            <div className="text-[11px] text-mocha">{it.qty} x {it.price.toFixed(2)} · HSN {it.hsn}</div>
          </div>
        ))}

        <div className="flex justify-between text-xs text-mocha py-1.5"><span>Items {order.items.length} / Qty {order.items.reduce((s, i) => s + i.qty, 0)}</span></div>

        <div className="flex flex-col gap-0.5 text-[13px]">
          <div className="flex justify-between"><span>Subtotal</span><span>{order.subtotal.toFixed(2)}</span></div>
          {order.discount > 0 && <div className="flex justify-between"><span>Discount</span><span>-{order.discount.toFixed(2)}</span></div>}
          {order.cgst > 0 && (
            <>
              <div className="flex justify-between" data-testid="receipt-cgst"><span>CGST (9%)</span><span>{order.cgst.toFixed(2)}</span></div>
              <div className="flex justify-between" data-testid="receipt-sgst"><span>SGST (9%)</span><span>{order.sgst.toFixed(2)}</span></div>
            </>
          )}
          {order.round_off !== 0 && <div className="flex justify-between"><span>Round off</span><span>{order.round_off.toFixed(2)}</span></div>}
        </div>

        <div className="flex justify-between items-baseline font-bold text-base border-t border-dashed border-[#1F1512] mt-2 pt-2">
          <span>TOTAL</span>
          <span data-testid="receipt-total">₹{order.total.toFixed(2)}</span>
        </div>
        <div className="text-[12px] italic mt-0.5">Rupees {rupeesInWords(order.total)} Only</div>

        <div className="border-t border-dashed border-[#1F1512] my-3" />

        <div className="flex flex-col gap-0.5 text-[13px]" data-testid="receipt-payment">
          <div className="flex justify-between"><span>Paid by {order.payment_mode === "upi" ? "UPI" : order.payment_mode === "cash" ? "Cash" : "Card"}</span><b>{order.total.toFixed(2)}</b></div>
          {order.utr && <div className="flex justify-between"><span>UTR</span><span>{order.utr}</span></div>}
          <div className="flex justify-between"><span>Status</span><b className={paid ? "text-[#1F5F36]" : "text-[#5C3F00]"} data-testid="receipt-status">{paid ? "PAID" : "PENDING"}</b></div>
        </div>

        {/* UPI QR — always shown on bill */}
        <div className="flex flex-col items-center gap-1.5 py-3 border-t border-dashed border-[#1F1512] mt-2">
          <QRCodeSVG
            value={`upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(upiName)}&am=${order.total.toFixed(2)}&cu=INR&tn=Invoice+${encodeURIComponent(order.invoice_no)}`}
            size={100}
            fgColor="#1F1512"
            data-testid="receipt-upi-qr"
          />
          <div className="text-[12px] font-bold">{upiId}</div>
          <div className="text-[11px] text-mocha">{upiName}</div>
          <div className="text-[11px] text-center text-[#5A3A30]">Scan to pay ₹{order.total.toFixed(2)} via any UPI app</div>
        </div>

        <div className="border-t border-dashed border-[#1F1512]" />

        <div className="flex flex-col items-center text-center gap-0.5 pt-2 text-[13px]">
          <div className="font-bold">Thank you! Visit again.</div>
          <div>Goods once sold will not be taken back.</div>
          <div>Keep fireworks away from children.</div>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 justify-center mt-5 print:hidden">

        {/* ── Bluetooth print section ── */}
        {isBTSupported() && (
          <div className="w-full flex flex-col items-center gap-2">
            {/* Status bar */}
            {(btState === "connected" || btState === "printing" || btState === "done" || btState === "saving") && (
              <div className="flex items-center gap-2 text-xs font-bold text-[#1F5F36] bg-[#DDF1E3] rounded-xl px-4 py-2" data-testid="bt-connected-bar">
                <BluetoothConnected size={14} />
                <span>{btLabel || "Printer001"} connected</span>
                <button
                  onClick={handleDisconnect}
                  className="ml-2 text-mocha hover:text-brick transition-colors"
                  data-testid="bt-disconnect-btn"
                  title="Disconnect"
                >
                  <BluetoothOff size={13} />
                </button>
              </div>
            )}
            {btInfo && (btState === "connected" || btState === "printing" || btState === "done") && (
              <div className="text-[10px] font-mono text-mocha text-center max-w-xs break-all" data-testid="bt-char-info" title={btInfo.all.join("\n")}>
                Writing to {btInfo.summary}
              </div>
            )}

            {/* Error message */}
            {btError && (
              <div className="text-xs text-brick bg-[#FFE3E3] rounded-xl px-4 py-2 max-w-xs text-center" data-testid="bt-error-msg">
                {btError}
              </div>
            )}

            {/* BT Print / Connect buttons */}
            {(btState === "connected" || btState === "done") ? (
              <button
                onClick={() => handleBTPrint(order, { shopName, shopAddr, shopPhone, gstNo, gstEnabled, fireLicNo, upiId })}
                disabled={btState === "done"}
                data-testid="bt-print-btn"
                className="h-12 px-6 rounded-xl bg-brick text-white font-bold text-sm flex items-center gap-2 active:scale-[0.98] transition-transform disabled:opacity-70"
              >
                {btState === "done" ? (
                  <><BluetoothConnected size={16} /> Printed!</>
                ) : (
                  <><Bluetooth size={16} /> Print via Bluetooth</>
                )}
              </button>
            ) : btState === "printing" ? (
              <button disabled className="h-12 px-6 rounded-xl bg-brick/70 text-white font-bold text-sm flex items-center gap-2" data-testid="bt-printing-btn">
                <Loader size={15} className="animate-spin" /> Printing…
              </button>
            ) : btState === "connecting" ? (
              <button disabled className="h-12 px-6 rounded-xl border-[1.5px] border-brick text-brick font-bold text-sm flex items-center gap-2" data-testid="bt-connecting-btn">
                <Loader size={15} className="animate-spin" /> Connecting…
              </button>
            ) : (
              <button
                onClick={handleConnect}
                data-testid="bt-connect-btn"
                className="h-12 px-6 rounded-xl border-[1.5px] border-brick text-brick font-bold text-sm flex items-center gap-2 hover:bg-brick hover:text-white transition-colors"
              >
                <Bluetooth size={16} /> Connect Printer
              </button>
            )}

            <div className="text-[11px] text-mocha text-center max-w-[260px]">
              {btState === "idle" || btState === "saved"
                ? "Tap to pair your BTP-802 thermal printer over Bluetooth"
                : btState === "connecting"
                ? "Select Printer001 from the list Chrome shows you"
                : "Sends ESC/POS receipt directly to your thermal printer"}
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2 text-xs">
              <label className="flex items-center gap-1 text-mocha">
                Bluetooth print mode:
                <select value={printMode} onChange={(e) => changeMode(e.target.value)} data-testid="bt-mode-select"
                  className="h-8 border border-line rounded-lg px-2 bg-cream text-[#1F1512] font-bold">
                  <option value="image">Image (recommended)</option>
                  <option value="text">Text</option>
                </select>
              </label>
              <label className="flex items-center gap-1 text-mocha">
                Paper:
                <select value={paperDots} onChange={(e) => changePaper(e.target.value)} data-testid="bt-paper-select"
                  className="h-8 border border-line rounded-lg px-2 bg-cream text-[#1F1512] font-bold">
                  <option value={576}>80mm</option>
                  <option value={384}>58mm</option>
                </select>
              </label>
              {(btState === "connected" || btState === "done") && (
                <button onClick={handleTestPrint} data-testid="bt-test-print-btn"
                  className="h-8 px-3 rounded-lg border border-brick text-brick font-bold hover:bg-brick hover:text-white transition-colors">
                  Test print
                </button>
              )}
            </div>
            <div className="text-[10px] text-mocha/70 font-mono" data-testid="bt-build-marker">BT v3</div>
          </div>
        )}
        {!isBTSupported() && (
          <div className="w-full flex flex-col items-center gap-1" data-testid="bt-unsupported">
            <div className="text-xs text-brick bg-[#FFE3E3] rounded-xl px-4 py-2 max-w-xs text-center">
              Bluetooth printing is not available in this browser. Open this page in Chrome on Android or desktop.
            </div>
            <div className="text-[10px] text-mocha/70 font-mono" data-testid="bt-build-marker">BT v3</div>
          </div>
        )}

        <div className="w-full border-t border-line mt-1 print:hidden" />

        <button
          onClick={printReceipt}
          data-testid="print-receipt-btn"
          className="h-12 px-6 rounded-xl border-[1.5px] border-brick text-brick font-bold text-sm flex items-center gap-2 hover:bg-brick hover:text-white transition-colors"
        >
          <Printer size={16} /> Print receipt
        </button>

        {/* ── Share via WhatsApp / SMS ── */}
        <button
          onClick={handleShare}
          data-testid="share-bill-btn"
          className="h-12 px-6 rounded-xl bg-[#25D366] text-white font-bold text-sm flex items-center gap-2 hover:bg-[#1ebe5d] transition-colors"
        >
          {shareState === "done"
            ? <><Share2 size={17} /> Shared!</>
            : <><MessageCircle size={17} /> Share via WhatsApp / SMS</>}
        </button>

        {user?.role === "admin" || user?.role === "salesperson" ? (
          <>
            <Link to="/admin/pos" data-testid="receipt-new-pos-order" className="h-12 px-6 rounded-xl bg-brick text-white font-bold text-sm flex items-center">New Order</Link>
            <Link to="/admin" data-testid="receipt-admin-dashboard" className="h-12 px-6 rounded-xl border-[1.5px] border-brick text-brick font-bold text-sm flex items-center">Dashboard</Link>
          </>
        ) : (
          <>
            <Link to="/orders" data-testid="receipt-my-orders" className="h-12 px-6 rounded-xl bg-brick text-white font-bold text-sm flex items-center">My orders</Link>
            <Link to="/" data-testid="receipt-continue-shopping" className="h-12 px-6 rounded-xl border-[1.5px] border-brick text-brick font-bold text-sm flex items-center">Continue shopping</Link>
          </>
        )}
      </div>
    </div>
  );
}
