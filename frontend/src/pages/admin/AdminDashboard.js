import { useState, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { TrendingUp, ShoppingBag, Clock, AlertTriangle, Pencil, X, Check, Plus, PenLine, FileUp, Download, UserPlus, Trash2, ChevronDown, ChevronUp, PackageOpen, Tag, Printer, ScanBarcode, KeyRound, Eye, EyeOff, ShieldAlert, ShieldCheck, Trash, Users, UserCog } from "lucide-react";
import JsBarcode from "jsbarcode";
import api from "@/lib/api";
import { money } from "@/lib/totals";
import ProductIcon, { iconBg } from "@/components/ProductIcon";
import ProductModal from "@/components/ProductModal";
import BulkStockModal from "@/components/BulkStockModal";
import BulkImportModal from "@/components/BulkImportModal";
import BulkBarcodeModal from "@/components/BulkBarcodeModal";
import { useAuth } from "@/context/AuthContext";

// ── Barcode label printing via new window (no CSS conflicts) ──────────────────
function _escHtml(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function _barcodeSvg(code) {
  try {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    JsBarcode(svg, code, {
      format: "CODE128", width: 1.4, height: 36, fontSize: 12, textMargin: 1,
      margin: 0, displayValue: true, lineColor: "#000", background: "#fff",
    });
    svg.setAttribute("viewBox", `0 0 ${parseFloat(svg.getAttribute("width"))} ${parseFloat(svg.getAttribute("height"))}`);
    return svg.outerHTML;
  } catch {
    return `<div style="font-size:8pt;color:#888;text-align:center;padding:4px;">Invalid barcode</div>`;
  }
}

export function printLabels(products, size = { w: 50, h: 25, shop: "Balaji Fataka" }) {
  const { w, h } = size;
  const shop = (size.shop || "").trim() || "Balaji Fataka";
  const s = Math.min(w / 50, h / 25);
  const mm = (v) => `${(v * s).toFixed(2)}mm`;
  const pt = (v) => `${(v * s).toFixed(2)}pt`;
  const innerW = `${(w - 3 * s).toFixed(2)}mm`;
  const bcH = `${(h - 12.5 * s).toFixed(2)}mm`;
  const items = products.map((p) => ({
    svgHTML: p.barcode ? _barcodeSvg(p.barcode) : "",
    name: p.name,
    brand: p.brand || "",
    retail_price: p.retail_price,
    barcode: p.barcode || "",
  }));

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Barcode Labels</title>
<style>
  @page { size: ${w}mm ${h}mm; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; font-family: Arial, sans-serif; }
  .label { width: ${w}mm; height: ${h}mm; padding: ${mm(1)} ${mm(1.5)}; display: flex; flex-direction: column; align-items: center; justify-content: space-between; overflow: hidden; page-break-after: always; break-after: page; background: #fff; }
  .label:last-child { page-break-after: auto; break-after: auto; }
  .top { width: ${innerW}; display: flex; align-items: baseline; justify-content: center; gap: ${mm(1)}; white-space: nowrap; overflow: hidden; line-height: 1.2; }
  .name { font-size: ${pt(7)}; font-weight: bold; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  .brand { font-size: ${pt(5.5)}; color: #a00; font-weight: bold; text-transform: uppercase; letter-spacing: 0.03em; flex-shrink: 0; }
  .label svg { display: block; width: ${innerW} !important; height: ${bcH} !important; }
  .price { font-size: ${pt(8.5)}; font-weight: bold; line-height: 1; }
  .shop { width: ${innerW}; font-size: ${pt(5)}; line-height: 1.1; text-align: center; text-transform: uppercase; letter-spacing: 0.04em; color: #333; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .no-bc { width: ${innerW}; height: ${bcH}; background: #f5f5f5; display: flex; align-items: center; justify-content: center; font-size: ${pt(7)}; color: #888; }
  @media screen { body { background: #ddd; padding: 4mm; } .label { margin-bottom: 4mm; outline: 0.3mm dashed #999; } }
</style></head>
<body>
${items.map((p) => `<div class="label">
  <div class="top"><span class="name">${_escHtml(p.name)}</span>${p.brand ? `<span class="brand">${_escHtml(p.brand)}</span>` : ""}</div>
  ${p.svgHTML || `<div class="no-bc">No barcode</div>`}
  <div class="price">&#8377;${p.retail_price}</div>
  <div class="shop">${_escHtml(shop)}</div>
</div>`).join("\n")}
</body></html>`;

  const blob = new Blob([html], { type: "text/html" });
  const blobUrl = URL.createObjectURL(blob);
  const win = window.open(blobUrl, "_blank", "width=640,height=480");
  if (!win) { alert("Allow popups to print labels, then try again."); URL.revokeObjectURL(blobUrl); return; }
  win.focus();
  setTimeout(() => {
    try { win.print(); } catch (e) { console.warn("Print dialog closed:", e.message); }
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
  }, 500);
}

const orderBadge = (status) =>
  status === "paid" ? "bg-[#DDF1E3] text-[#1F5F36]" : "bg-[#FFF0C9] text-[#5C3F00]";

const stockCls = (stock) =>
  stock === 0
    ? "bg-[#FDE3DE] text-maroon"
    : stock <= 10
    ? "bg-[#FFE3A3] text-[#5C3F00]"
    : "bg-[#DDF1E3] text-[#1F5F36]";

function FilterChip({ label, active, onClick, count }) {
  return (
    <button
      onClick={onClick}
      className={"h-8 px-3 rounded-lg font-bold text-xs transition-colors whitespace-nowrap " +
        (active ? "bg-brick text-white" : "bg-chip text-mocha hover:text-ink")}
    >
      {label}
      {count != null && count > 0 && (
        <span className={"ml-1.5 text-[10px] rounded-full px-1.5 py-0.5 " + (active ? "bg-white/20" : "bg-white text-mocha")}>
          {count}
        </span>
      )}
    </button>
  );
}

export default function AdminDashboard() {
  const queryClient = useQueryClient();

  // Stock inline edit
  const [editingId, setEditingId] = useState(null);
  const [editStock, setEditStock] = useState("");
  const [stockBusy, setStockBusy] = useState(false);
  const [stockError, setStockError] = useState("");

  // Low-stock banner
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [bannerExpanded, setBannerExpanded] = useState(true);

  // Product modal
  const [modalProduct, setModalProduct] = useState(null); // null = closed, {} = add, product obj = edit
  const modalOpen = modalProduct !== null;
  const [catsExpanded, setCatsExpanded] = useState(true);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [barcodeOpen, setBarcodeOpen] = useState(false);

  const handleExportProducts = async () => {
    try {
      const { data } = await api.get("/admin/products/export", { responseType: "blob" });
      const url = URL.createObjectURL(new Blob([data], { type: "text/csv" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `products_export_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a); URL.revokeObjectURL(url);
    } catch {
      alert("Export failed. Please try again.");
    }
  };

  const handleExportBarcodes = async () => {
    try {
      const { data } = await api.get("/admin/products/barcode-export", { responseType: "blob" });
      const url = URL.createObjectURL(new Blob([data], { type: "text/csv" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `barcodes_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a); URL.revokeObjectURL(url);
    } catch {
      alert("Barcode export failed. Please try again.");
    }
  };

  // Salesperson management
  const [spName, setSpName] = useState("");
  const [spBusy, setSpBusy] = useState(false);
  const [spError, setSpError] = useState("");
  const [settingPinFor, setSettingPinFor] = useState(null);
  const [pinVal, setPinVal] = useState("");
  const [pinBusy, setPinBusy] = useState(false);
  const [pinError, setPinError] = useState("");
  const [accountFormFor, setAccountFormFor] = useState(null); // sp id
  const [acctEmail, setAcctEmail] = useState("");
  const [acctPass, setAcctPass] = useState("");
  const [acctBusy, setAcctBusy] = useState(false);
  const [acctError, setAcctError] = useState("");
  const [emailResetSent, setEmailResetSent] = useState({});
  const [prodCategory, setProdCategory] = useState("All"); // { [sp_id]: 'sending'|'sent'|'error' }

  // Accordion show-all toggles (max 5 visible by default)
  const [showAllLowStock, setShowAllLowStock] = useState(false);
  const [showAllOrders, setShowAllOrders] = useState(false);
  const [showAllProducts, setShowAllProducts] = useState(false);
  const [showAllSalespersons, setShowAllSalespersons] = useState(false);

  const sendResetEmail = async (spId) => {
    setEmailResetSent((prev) => ({ ...prev, [spId]: "sending" }));
    try {
      await api.post(`/admin/salespersons/${spId}/send-reset-email`);
      setEmailResetSent((prev) => ({ ...prev, [spId]: "sent" }));
      setTimeout(() => setEmailResetSent((prev) => { const n = { ...prev }; delete n[spId]; return n; }), 4000);
    } catch (e) {
      setEmailResetSent((prev) => ({ ...prev, [spId]: "error" }));
      setTimeout(() => setEmailResetSent((prev) => { const n = { ...prev }; delete n[spId]; return n; }), 4000);
    }
  };

  // Category management
  const [catName, setCatName] = useState("");
  const [catBusy, setCatBusy] = useState(false);
  const [catError, setCatError] = useState("");
  const [renamingId, setRenamingId] = useState(null);
  const [renameVal, setRenameVal] = useState("");

  // Order filters
  const [dateFilter, setDateFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ["admin-stats"],
    queryFn: () => api.get("/admin/stats").then((r) => r.data),
    refetchInterval: 30000,
  });

  const { data: orders = [], isLoading: ordersLoading } = useQuery({
    queryKey: ["admin-orders"],
    queryFn: () => api.get("/admin/orders?limit=100").then((r) => r.data),
    refetchInterval: 30000,
  });

  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: () => api.get("/products").then((r) => r.data),
  });

  const { data: shopSettings } = useQuery({
    queryKey: ["admin-settings"],
    queryFn: () => api.get("/admin/settings").then((r) => r.data),
  });
  const labelSize = { w: shopSettings?.label_width_mm || 50, h: shopSettings?.label_height_mm || 25, shop: shopSettings?.shop_name };

  const { data: salespersons = [], refetch: refetchSP } = useQuery({
    queryKey: ["salespersons"],
    queryFn: () => api.get("/admin/salespersons").then((r) => r.data),
  });

  const { data: categories = [], refetch: refetchCats } = useQuery({
    queryKey: ["categories"],
    queryFn: () => api.get("/categories").then((r) => r.data),
  });

  const addCategory = async () => {
    const name = catName.trim();
    if (!name) { setCatError("Enter a category name"); return; }
    setCatBusy(true); setCatError("");
    try {
      await api.post("/admin/categories", { name });
      setCatName(""); refetchCats();
      queryClient.invalidateQueries({ queryKey: ["categories"] });
    } catch (e) {
      setCatError(e?.response?.data?.detail || "Could not save — try again");
    } finally { setCatBusy(false); }
  };

  const renameCategory = async (id) => {
    const name = renameVal.trim();
    if (!name) return;
    setCatBusy(true); setCatError("");
    try {
      await api.patch(`/admin/categories/${id}`, { name });
      setRenamingId(null); setRenameVal("");
      refetchCats();
      queryClient.invalidateQueries({ queryKey: ["categories", "products"] });
    } catch (e) {
      setCatError(e?.response?.data?.detail || "Could not rename");
    } finally { setCatBusy(false); }
  };

  const deleteCategory = async (id) => {
    setCatError("");
    try {
      await api.delete(`/admin/categories/${id}`);
      refetchCats();
      queryClient.invalidateQueries({ queryKey: ["categories"] });
    } catch (e) {
      setCatError(e?.response?.data?.detail || "Could not delete");
    }
  };

  const addSalesperson = async () => {
    const name = spName.trim();
    if (!name) { setSpError("Enter a name"); return; }
    setSpBusy(true); setSpError("");
    try {
      await api.post("/admin/salespersons", { name });
      setSpName("");
      refetchSP();
    } catch { setSpError("Could not save — try again"); }
    finally { setSpBusy(false); }
  };

  const savePin = async (spId) => {
    if (!/^\d{4}$/.test(pinVal)) { setPinError("Enter exactly 4 digits"); return; }
    setPinBusy(true); setPinError("");
    try {
      await api.patch(`/admin/salespersons/${spId}/pin`, { pin: pinVal });
      setSettingPinFor(null); setPinVal("");
      refetchSP();
    } catch (e) {
      setPinError(e?.response?.data?.detail || "Could not save PIN");
    } finally { setPinBusy(false); }
  };

  const saveAccount = async (spId) => {
    if (!acctEmail.trim() || !acctPass.trim()) { setAcctError("Email and password required"); return; }
    setAcctBusy(true); setAcctError("");
    try {
      await api.post(`/admin/salespersons/${spId}/create-account`, { email: acctEmail.trim(), password: acctPass });
      setAccountFormFor(null); setAcctEmail(""); setAcctPass("");
      refetchSP();
    } catch (e) {
      setAcctError(e?.response?.data?.detail || "Could not create account");
    } finally { setAcctBusy(false); }
  };

  const resetPassword = async (spId) => {
    if (!acctPass.trim()) { setAcctError("Enter new password"); return; }
    setAcctBusy(true); setAcctError("");
    try {
      await api.patch(`/admin/salespersons/${spId}/reset-password`, { password: acctPass });
      setAccountFormFor(null); setAcctPass("");
      refetchSP();
    } catch (e) {
      setAcctError(e?.response?.data?.detail || "Could not reset password");
    } finally { setAcctBusy(false); }
  };

  const deleteSalesperson = async (id) => {
    try {
      await api.delete(`/admin/salespersons/${id}`);
      refetchSP();
    } catch (e) {
      console.error("Delete salesperson failed:", e);
    }
  };

  // Filtered orders
  const filteredOrders = useMemo(() => {
    let result = orders;

    if (dateFilter !== "all") {
      const start = new Date();
      if (dateFilter === "today") { start.setHours(0, 0, 0, 0); }
      else if (dateFilter === "week") { start.setDate(start.getDate() - 7); }
      else if (dateFilter === "month") { start.setDate(start.getDate() - 30); }
      result = result.filter((o) => new Date(o.created_at) >= start);
    }
    if (statusFilter !== "all") result = result.filter((o) => o.status === statusFilter);
    if (typeFilter !== "all") result = result.filter((o) => typeFilter === "pos" ? o.is_pos : !o.is_pos);

    return result;
  }, [orders, dateFilter, statusFilter, typeFilter]);

  // Stock counts for filter badges
  const orderCounts = useMemo(() => {
    const base = (() => {
      let r = orders;
      if (dateFilter !== "all") {
        const start = new Date();
        if (dateFilter === "today") { start.setHours(0, 0, 0, 0); }
        else if (dateFilter === "week") { start.setDate(start.getDate() - 7); }
        else if (dateFilter === "month") { start.setDate(start.getDate() - 30); }
        r = r.filter((o) => new Date(o.created_at) >= start);
      }
      return r;
    })();
    return {
      paid: base.filter((o) => o.status === "paid").length,
      pending: base.filter((o) => o.status === "pending").length,
      pos: base.filter((o) => o.is_pos).length,
      online: base.filter((o) => !o.is_pos).length,
    };
  }, [orders, dateFilter]);

  // Filtered products (by category chip)
  const filteredProducts = useMemo(
    () => prodCategory === "All" ? products : products.filter((p) => p.category === prodCategory),
    [products, prodCategory]
  );

  // Inline stock edit
  const startEdit = (p) => { setEditingId(p.id); setEditStock(String(p.stock)); setStockError(""); };
  const cancelEdit = () => { setEditingId(null); setEditStock(""); setStockError(""); };
  const saveStock = async (productId) => {
    const val = parseInt(editStock, 10);
    if (isNaN(val) || val < 0) { setStockError("Enter a valid number ≥ 0"); return; }
    setStockBusy(true);
    setStockError("");
    try {
      await api.patch(`/admin/products/${productId}/stock`, { stock: val });
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["admin-stats"] });
      setEditingId(null);
    } catch { setStockError("Save failed — try again"); }
    finally { setStockBusy(false); }
  };

  const statCards = [
    { label: "Today's Revenue", value: money(stats?.today_revenue ?? 0), icon: TrendingUp, color: "text-[#1F5F36]", bg: "bg-[#DDF1E3]" },
    { label: "Today's Orders", value: stats?.today_orders ?? 0, icon: ShoppingBag, color: "text-maroon", bg: "bg-[#FFE3B8]" },
    { label: "Total Orders", value: stats?.total_orders ?? 0, icon: ShoppingBag, color: "text-[#1F3F7A]", bg: "bg-[#E1EAFB]" },
    { label: "Pending Wholesale", value: stats?.pending_wholesale ?? 0, icon: Clock, color: "text-[#5C3F00]", bg: "bg-[#FFF0C9]" },
  ];

  return (
    <div className="max-w-6xl mx-auto px-4 py-5" data-testid="admin-dashboard">
      <h1 className="font-display font-bold text-2xl mb-4">Owner Dashboard</h1>

      {/* ── Low stock alert banner ── */}
      {!statsLoading && stats?.low_stock?.length > 0 && !bannerDismissed && (
        <div
          className="mb-4 rounded-2xl border border-[#F5C842] bg-[#FFFBE6] overflow-hidden"
          data-testid="low-stock-banner"
        >
          {/* Header row */}
          <div className="flex items-center justify-between px-4 py-3">
            <button
              className="flex items-center gap-2.5 flex-1 text-left"
              onClick={() => setBannerExpanded((v) => !v)}
              data-testid="low-stock-banner-toggle"
            >
              <div className="w-8 h-8 rounded-xl bg-[#FFE3A3] flex items-center justify-center flex-none">
                <AlertTriangle size={15} className="text-maroon" />
              </div>
              <div>
                <span className="font-bold text-sm text-ink">
                  {stats.low_stock.length} product{stats.low_stock.length > 1 ? "s" : ""} running low on stock
                </span>
                <span className="ml-2 text-[11px] font-bold bg-maroon text-white rounded-full px-2 py-0.5">
                  ≤ 10 units
                </span>
              </div>
              <div className="ml-auto mr-2 text-mocha">
                {bannerExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </div>
            </button>
            <button
              onClick={() => setBannerDismissed(true)}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-mocha hover:text-maroon transition-colors flex-none"
              data-testid="low-stock-banner-dismiss"
              title="Dismiss"
            >
              <X size={14} />
            </button>
          </div>

          {/* Expanded product list */}
          {bannerExpanded && (
            <div className="border-t border-[#F5C842]/60 px-4 py-3 flex flex-col gap-1.5" data-testid="low-stock-list">
              {(showAllLowStock ? stats.low_stock : stats.low_stock.slice(0, 5)).map((p) => (
                <div key={p.id} className="flex items-center justify-between py-0.5" data-testid={`low-stock-item-${p.id}`}>
                  <div className="flex items-center gap-2 min-w-0">
                    <PackageOpen size={13} className="text-mocha flex-none" />
                    <span className="text-sm text-ink truncate">{p.name}</span>
                    {p.brand && <span className="text-[10px] font-bold text-brick uppercase tracking-wide flex-none">{p.brand}</span>}
                  </div>
                  <div className="flex items-center gap-2 flex-none">
                    <span className={"text-xs font-bold rounded-full px-2 py-0.5 " + stockCls(p.stock)}>
                      {p.stock === 0 ? "Out" : `${p.stock} left`}
                    </span>
                    <button
                      onClick={() => { startEdit(p); document.getElementById("products-section")?.scrollIntoView({ behavior: "smooth" }); }}
                      className="text-[11px] font-bold text-brick hover:underline"
                      data-testid={`low-stock-restock-${p.id}`}
                    >
                      Restock
                    </button>
                  </div>
                </div>
              ))}
              {stats.low_stock.length > 5 && (
                <button
                  onClick={() => setShowAllLowStock((v) => !v)}
                  data-testid="low-stock-show-more"
                  className="mt-1 text-[11px] font-bold text-[#5C3F00] hover:text-maroon flex items-center gap-1 self-start"
                >
                  {showAllLowStock
                    ? <><ChevronUp size={12} /> Show less</>
                    : <><ChevronDown size={12} /> Show {stats.low_stock.length - 5} more</>}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        {statCards.map((s) => (
          <div key={s.label} className="bg-white border border-line rounded-2xl p-4 flex flex-col gap-2"
            data-testid={`stat-${s.label.toLowerCase().replace(/[^a-z]+/g, "-")}`}>
            <div className={"w-9 h-9 rounded-xl flex items-center justify-center " + s.bg}>
              <s.icon size={18} className={s.color} />
            </div>
            <div className={"font-display font-bold text-2xl leading-7 " + s.color}>
              {statsLoading ? <span className="inline-block w-16 h-7 bg-chip rounded animate-pulse" /> : s.value}
            </div>
            <div className="text-xs text-mocha font-medium">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Orders */}
      <div className="bg-white border border-line rounded-2xl flex flex-col mb-5"
        data-testid="admin-orders-section">
          <div className="px-4 pt-3 pb-2 border-b border-line flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-sm">Orders</span>
              <span className="text-xs text-mocha">{filteredOrders.length} shown</span>
            </div>
            {/* Date filters */}
            <div className="flex gap-1.5 overflow-x-auto pb-0.5" data-testid="order-date-filter">
              {[["all", "All time"], ["today", "Today"], ["week", "Last 7 days"], ["month", "Last 30 days"]].map(([val, label]) => (
                <FilterChip key={val} label={label} active={dateFilter === val} onClick={() => setDateFilter(val)} />
              ))}
            </div>
            {/* Status + Type filters */}
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex gap-1" data-testid="order-status-filter">
                <FilterChip label="Any status" active={statusFilter === "all"} onClick={() => setStatusFilter("all")} />
                <FilterChip label="Paid" active={statusFilter === "paid"} onClick={() => setStatusFilter("paid")} count={orderCounts.paid} />
                <FilterChip label="Pending" active={statusFilter === "pending"} onClick={() => setStatusFilter("pending")} count={orderCounts.pending} />
              </div>
              <div className="w-px h-5 bg-line" />
              <div className="flex gap-1" data-testid="order-type-filter">
                <FilterChip label="All types" active={typeFilter === "all"} onClick={() => setTypeFilter("all")} />
                <FilterChip label="POS" active={typeFilter === "pos"} onClick={() => setTypeFilter("pos")} count={orderCounts.pos} />
                <FilterChip label="Online" active={typeFilter === "online"} onClick={() => setTypeFilter("online")} count={orderCounts.online} />
              </div>
            </div>
          </div>

          {ordersLoading ? (
            <div className="p-8 text-center text-mocha text-sm">Loading orders…</div>
          ) : filteredOrders.length === 0 ? (
            <div className="p-8 text-center text-mocha text-sm" data-testid="admin-orders-empty">
              No orders match your filters.
            </div>
          ) : (
            <>
              <div className="divide-y divide-[#F1E2CC]">
                {(showAllOrders ? filteredOrders : filteredOrders.slice(0, 5)).map((o) => (
                  <Link key={o.id} to={`/order/${o.id}`}
                    className="flex items-center justify-between px-4 py-3 hover:bg-cream transition-colors gap-3"
                    data-testid={`admin-order-row-${o.id}`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-bold text-sm">{o.invoice_no}</div>
                      <div className="text-xs text-mocha truncate">
                        {o.customer_name}
                        {o.is_pos && <span className="ml-1.5 text-[#1F3F7A] font-bold">· POS</span>}
                        {" · "}{new Date(o.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                      </div>
                    </div>
                    <div className="flex items-center gap-2.5 flex-none">
                      <span className="font-bold text-sm">₹{o.total.toLocaleString("en-IN")}</span>
                      <span className={"text-xs font-bold rounded-full px-2.5 py-0.5 " + orderBadge(o.status)}>
                        {o.status === "paid" ? "Paid" : "Pending"}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
              {filteredOrders.length > 5 && (
                <button
                  onClick={() => setShowAllOrders((v) => !v)}
                  data-testid="orders-show-more"
                  className="w-full px-4 py-2.5 text-xs font-bold text-mocha hover:text-brick flex items-center justify-center gap-1 border-t border-line transition-colors"
                >
                  {showAllOrders
                    ? <><ChevronUp size={13} /> Show less</>
                    : <><ChevronDown size={13} /> Show {filteredOrders.length - 5} more orders</>}
                </button>
              )}
            </>
          )}
        </div>

      {/* Products & Stock */}
      <div className="bg-white border border-line rounded-2xl" id="products-section" data-testid="admin-products-section">
        <div className="flex items-center justify-between px-4 py-3 border-b border-line">
          <span className="font-bold text-sm">Products & Stock</span>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={handleExportProducts}
              className="h-9 px-3.5 rounded-xl border border-line text-mocha font-bold text-[13px] flex items-center gap-1.5 hover:border-brick hover:text-brick transition-colors"
              data-testid="export-products-btn"
            >
              <Download size={14} /> Export CSV
            </button>
            <button
              onClick={handleExportBarcodes}
              className="h-9 px-3.5 rounded-xl border border-line text-mocha font-bold text-[13px] flex items-center gap-1.5 hover:border-brick hover:text-brick transition-colors"
              data-testid="export-barcodes-btn"
              title="Download barcodes CSV for offline label printing"
            >
              <Download size={14} /> Barcode CSV
            </button>
            <button
              onClick={() => setBarcodeOpen(true)}
              className="h-9 px-3.5 rounded-xl border border-line text-mocha font-bold text-[13px] flex items-center gap-1.5 hover:border-brick hover:text-brick transition-colors"
              data-testid="assign-barcodes-btn"
              title="Upload a CSV to batch-assign manufacturer barcodes"
            >
              <ScanBarcode size={14} /> Assign Barcodes
            </button>
            <button
              onClick={() => setBulkOpen(true)}
              className="h-9 px-3.5 rounded-xl border border-line text-mocha font-bold text-[13px] flex items-center gap-1.5 hover:border-brick hover:text-brick transition-colors"
              data-testid="bulk-import-btn"
            >
              <FileUp size={14} /> Stock CSV
            </button>
            <button
              onClick={() => setImportOpen(true)}
              className="h-9 px-3.5 rounded-xl border border-line text-mocha font-bold text-[13px] flex items-center gap-1.5 hover:border-brick hover:text-brick transition-colors"
              data-testid="product-import-btn"
            >
              <FileUp size={14} /> Products CSV
            </button>
            <button
              onClick={() => setModalProduct({})}
              className="h-9 px-3.5 rounded-xl bg-brick text-white font-bold text-[13px] flex items-center gap-1.5"
              data-testid="add-product-btn"
            >
              <Plus size={15} /> Add product
            </button>
            <button
              onClick={() => printLabels(prodCategory === "All" ? products : products.filter((p) => p.category === prodCategory), labelSize)}
              className="h-9 px-3.5 rounded-xl border border-line text-mocha font-bold text-[13px] flex items-center gap-1.5 hover:border-brick hover:text-brick transition-colors"
              data-testid="print-all-labels-btn"
              title="Print barcode labels for all shown products"
            >
              <Printer size={14} /> Print Labels
            </button>
          </div>
        </div>

        {stockError && (
          <div className="px-4 py-2 text-sm text-maroon bg-[#FDE3DE] border-b border-[#F1E2CC]">{stockError}</div>
        )}

        {/* Category filter chips */}
        {categories.length > 0 && (
          <div className="flex gap-1.5 overflow-x-auto px-4 py-2.5 border-b border-line" style={{ scrollbarWidth: "none" }} data-testid="product-category-filter">
            {[{ id: "all", name: "All" }, ...categories].map((c) => (
              <button
                key={c.id}
                onClick={() => setProdCategory(c.name)}
                data-testid={`prod-cat-chip-${c.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                className={"flex-none h-7 px-3 rounded-xl border font-bold text-xs transition-colors " +
                  (prodCategory === c.name
                    ? "bg-brick border-brick text-white"
                    : "bg-cream border-line text-ink hover:border-brick/50")}
              >
                {c.name}
              </button>
            ))}
          </div>
        )}

        <div className="divide-y divide-[#F1E2CC]">
          {(showAllProducts ? filteredProducts : filteredProducts.slice(0, 5)).map((p) => (
            <div key={p.id} className="flex items-center px-4 py-2.5 gap-3" data-testid={`product-stock-row-${p.id}`}>
              <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-none" style={{ background: iconBg(p.icon) }}>
                <ProductIcon icon={p.icon} size={22} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm truncate">{p.name}</div>
                <div className="text-xs text-mocha">{p.pack_type} · {p.pack_size}</div>
              </div>
              <div className="text-xs text-mocha flex-none hidden sm:flex gap-1.5 flex-col items-end">
                <span>R ₹{p.retail_price} · W ₹{p.wholesale_price}</span>
                {p.purchase_price > 0 && (
                  <span className="text-[10px] text-[#7B4F00] bg-[#FFF3CD] px-1.5 py-0.5 rounded-md font-medium">
                    Cost ₹{p.purchase_price} · Margin ₹{(p.retail_price - p.purchase_price).toFixed(0)}
                  </span>
                )}
              </div>

              {editingId === p.id ? (
                <div className="flex items-center gap-1.5 flex-none">
                  <input
                    type="number"
                    value={editStock}
                    onChange={(e) => setEditStock(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") saveStock(p.id); if (e.key === "Escape") cancelEdit(); }}
                    className="w-[68px] h-9 border-[1.5px] border-brick rounded-xl px-2 text-sm font-bold text-center outline-none"
                    min="0"
                    autoFocus
                    data-testid={`stock-input-${p.id}`}
                  />
                  <button onClick={() => saveStock(p.id)} disabled={stockBusy}
                    className="h-9 w-9 rounded-xl bg-brick text-white flex items-center justify-center disabled:opacity-60"
                    data-testid={`stock-save-${p.id}`}>
                    <Check size={15} />
                  </button>
                  <button onClick={cancelEdit}
                    className="h-9 w-9 rounded-xl border border-line text-mocha flex items-center justify-center hover:border-brick transition-colors"
                    data-testid={`stock-cancel-${p.id}`}>
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 flex-none">
                  {/* Barcode number — hidden on mobile */}
                  {p.barcode && (
                    <span className="hidden xl:flex text-[10px] text-mocha font-mono bg-chip rounded px-1.5 py-0.5 flex-none" data-testid={`barcode-text-${p.id}`}>
                      {p.barcode}
                    </span>
                  )}
                  <span className={"text-xs font-bold rounded-full px-2.5 py-1 " + stockCls(p.stock)}
                    data-testid={`stock-badge-${p.id}`}>
                    {p.stock === 0 ? "Out" : p.stock}
                  </span>
                  <button onClick={() => printLabels([p], labelSize)} title="Print barcode label"
                    className="w-9 h-9 rounded-xl border border-line flex items-center justify-center text-mocha hover:border-brick hover:text-brick transition-colors"
                    data-testid={`print-label-btn-${p.id}`}>
                    <Printer size={14} />
                  </button>
                  <button onClick={() => startEdit(p)} title="Edit stock"
                    className="w-9 h-9 rounded-xl border border-line flex items-center justify-center text-mocha hover:border-brick hover:text-brick transition-colors"
                    data-testid={`stock-edit-btn-${p.id}`}>
                    <Pencil size={14} />
                  </button>
                  <button onClick={() => setModalProduct(p)} title="Edit product"
                    className="w-9 h-9 rounded-xl border border-line flex items-center justify-center text-mocha hover:border-brick hover:text-brick transition-colors"
                    data-testid={`product-edit-btn-${p.id}`}>
                    <PenLine size={14} />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
        {filteredProducts.length > 5 && (
          <button
            onClick={() => setShowAllProducts((v) => !v)}
            data-testid="products-show-more"
            className="w-full px-4 py-2.5 text-xs font-bold text-mocha hover:text-brick flex items-center justify-center gap-1 border-t border-line transition-colors"
          >
            {showAllProducts
              ? <><ChevronUp size={13} /> Show less</>
              : <><ChevronDown size={13} /> Show {filteredProducts.length - 5} more products</>}
          </button>
        )}
      </div>

      {/* Product modal */}
      {modalOpen && (
        <ProductModal
          product={modalProduct?.id ? modalProduct : null}
          onClose={() => setModalProduct(null)}
          onPrintLabel={(p) => printLabels([p], labelSize)}
        />
      )}

      {/* Bulk stock import modal */}
      {bulkOpen && <BulkStockModal onClose={() => setBulkOpen(false)} />}

      {/* Product import modal */}
      {importOpen && <BulkImportModal onClose={() => setImportOpen(false)} />}

      {/* Bulk barcode assign modal */}
      {barcodeOpen && <BulkBarcodeModal onClose={() => setBarcodeOpen(false)} />}

      {/* Categories */}
      <div className="bg-white border border-line rounded-2xl mt-5" data-testid="categories-section">
        <button
          onClick={() => setCatsExpanded((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-3 border-b border-line hover:bg-chip/40 transition-colors rounded-t-2xl"
          data-testid="categories-toggle"
        >
          <div className="flex items-center gap-2">
            <Tag size={15} className="text-mocha" />
            <span className="font-bold text-sm">Categories</span>
            <span className="text-xs text-mocha bg-chip rounded-full px-2 py-0.5">{categories.length}</span>
          </div>
          {catsExpanded ? <ChevronUp size={16} className="text-mocha" /> : <ChevronDown size={16} className="text-mocha" />}
        </button>

        {catsExpanded && (
          <>
            {/* Add row */}
            <div className="px-4 py-3 border-b border-line flex items-center gap-2">
              <input
                type="text"
                value={catName}
                onChange={(e) => { setCatName(e.target.value); setCatError(""); }}
                onKeyDown={(e) => e.key === "Enter" && addCategory()}
                placeholder="New category name (e.g. Sky Shots)"
                className="flex-1 h-10 border border-line rounded-xl px-3 text-sm outline-none focus:border-brick bg-cream"
                data-testid="cat-name-input"
              />
              <button
                onClick={addCategory}
                disabled={catBusy}
                className="h-10 px-4 rounded-xl bg-brick text-white font-bold text-sm flex items-center gap-1.5 disabled:opacity-60 flex-none"
                data-testid="cat-add-btn"
              >
                <Plus size={15} /> Add
              </button>
            </div>
            {catError && <div className="px-4 py-2 text-sm text-maroon bg-[#FDE3DE]" data-testid="cat-error">{catError}</div>}

            {categories.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-mocha" data-testid="cat-empty">No categories yet.</div>
            ) : (
              <div className="divide-y divide-[#F1E2CC]">
                {categories.map((cat) => {
                  const inUse = products.filter((p) => p.category === cat.name).length;
                  return (
                    <div key={cat.id} className="flex items-center gap-2 px-4 py-2.5" data-testid={`cat-row-${cat.id}`}>
                      {renamingId === cat.id ? (
                        <>
                          <input
                            autoFocus
                            type="text"
                            value={renameVal}
                            onChange={(e) => setRenameVal(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") renameCategory(cat.id); if (e.key === "Escape") setRenamingId(null); }}
                            className="flex-1 h-9 border border-brick rounded-xl px-3 text-sm outline-none bg-cream"
                            data-testid={`cat-rename-input-${cat.id}`}
                          />
                          <button onClick={() => renameCategory(cat.id)} disabled={catBusy}
                            className="w-8 h-8 rounded-lg bg-brick text-white flex items-center justify-center"
                            data-testid={`cat-rename-save-${cat.id}`}>
                            <Check size={13} />
                          </button>
                          <button onClick={() => setRenamingId(null)}
                            className="w-8 h-8 rounded-lg border border-line text-mocha flex items-center justify-center"
                            data-testid={`cat-rename-cancel-${cat.id}`}>
                            <X size={13} />
                          </button>
                        </>
                      ) : (
                        <>
                          <span className="text-sm font-medium flex-1">{cat.name}</span>
                          <span className="text-[11px] text-mocha bg-chip rounded-full px-2 py-0.5 flex-none">
                            {inUse} product{inUse !== 1 ? "s" : ""}
                          </span>
                          <button
                            onClick={() => { setRenamingId(cat.id); setRenameVal(cat.name); setCatError(""); }}
                            className="w-8 h-8 rounded-lg border border-line flex items-center justify-center text-mocha hover:border-brick hover:text-brick transition-colors"
                            data-testid={`cat-rename-btn-${cat.id}`}
                            title="Rename"
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            onClick={() => deleteCategory(cat.id)}
                            disabled={inUse > 0}
                            className="w-8 h-8 rounded-lg border border-line flex items-center justify-center text-mocha hover:border-maroon hover:text-maroon transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                            data-testid={`cat-delete-btn-${cat.id}`}
                            title={inUse > 0 ? `Used by ${inUse} product(s) — reassign first` : "Delete"}
                          >
                            <Trash2 size={13} />
                          </button>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* Salespersons */}
      <div className="bg-white border border-line rounded-2xl mt-5" data-testid="salespersons-section">
        <div className="flex items-center justify-between px-4 py-3 border-b border-line">
          <span className="font-bold text-sm">Salespersons</span>
          <span className="text-xs text-mocha">{salespersons.length} added</span>
        </div>

        {/* Add row */}
        <div className="px-4 py-3 border-b border-line flex items-center gap-2">
          <input
            type="text"
            value={spName}
            onChange={(e) => { setSpName(e.target.value); setSpError(""); }}
            onKeyDown={(e) => e.key === "Enter" && addSalesperson()}
            placeholder="Salesperson name"
            className="flex-1 h-10 border border-line rounded-xl px-3 text-sm outline-none focus:border-brick bg-cream"
            data-testid="sp-name-input"
          />
          <button
            onClick={addSalesperson}
            disabled={spBusy}
            className="h-10 px-4 rounded-xl bg-brick text-white font-bold text-sm flex items-center gap-1.5 disabled:opacity-60"
            data-testid="sp-add-btn"
          >
            <UserPlus size={15} /> Add
          </button>
        </div>
        {spError && <div className="px-4 py-2 text-sm text-maroon bg-[#FDE3DE]">{spError}</div>}

        {salespersons.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-mocha" data-testid="sp-empty">No salespersons added yet.</div>
        ) : (
          <>
            <div className="divide-y divide-[#F1E2CC]">
              {(showAllSalespersons ? salespersons : salespersons.slice(0, 5)).map((sp) => (
              <div key={sp.id} className="px-4 py-2.5" data-testid={`sp-row-${sp.id}`}>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium flex-1 min-w-0">{sp.name}</span>

                  {/* Account badge */}
                  {sp.has_account
                    ? <span className="text-[11px] font-bold bg-[#DDF1E3] text-[#1F5F36] rounded-full px-2 py-0.5 flex-none" data-testid={`sp-acct-status-${sp.id}`}>Account: {sp.email}</span>
                    : <span className="text-[11px] font-bold bg-chip text-mocha rounded-full px-2 py-0.5 flex-none" data-testid={`sp-acct-status-${sp.id}`}>No account</span>
                  }

                  {/* PIN status badge */}
                  <span className={"text-[11px] font-bold rounded-full px-2 py-0.5 flex-none " +
                    (sp.has_pin ? "bg-[#DDF1E3] text-[#1F5F36]" : "bg-chip text-mocha")}
                    data-testid={`sp-pin-status-${sp.id}`}>
                    {sp.has_pin ? "PIN set" : "No PIN"}
                  </span>

                  <button onClick={() => { setSettingPinFor(settingPinFor === sp.id ? null : sp.id); setPinVal(""); setPinError(""); setAccountFormFor(null); }}
                    className="text-xs font-bold text-brick hover:underline flex-none"
                    data-testid={`sp-set-pin-btn-${sp.id}`}>
                    {sp.has_pin ? "Change PIN" : "Set PIN"}
                  </button>

                  <button onClick={() => { setAccountFormFor(accountFormFor === sp.id ? null : sp.id); setAcctEmail(sp.email || ""); setAcctPass(""); setAcctError(""); setSettingPinFor(null); }}
                    className="text-xs font-bold text-brick hover:underline flex-none"
                    data-testid={`sp-acct-btn-${sp.id}`}>
                    {sp.has_account ? "Reset Password" : "Create Account"}
                  </button>

                  {sp.has_account && (
                    <button
                      onClick={() => sendResetEmail(sp.id)}
                      disabled={emailResetSent[sp.id] === "sending"}
                      data-testid={`sp-send-reset-email-${sp.id}`}
                      className={`text-xs font-bold flex-none ${
                        emailResetSent[sp.id] === "sent" ? "text-[#1F5F36]" :
                        emailResetSent[sp.id] === "error" ? "text-maroon" :
                        "text-brick hover:underline"
                      }`}
                    >
                      {emailResetSent[sp.id] === "sending" ? "Sending…" :
                       emailResetSent[sp.id] === "sent" ? "Email sent!" :
                       emailResetSent[sp.id] === "error" ? "Send failed" :
                       "Email Reset"}
                    </button>
                  )}

                  <button onClick={() => deleteSalesperson(sp.id)}
                    className="w-8 h-8 rounded-lg border border-line flex items-center justify-center text-mocha hover:border-maroon hover:text-maroon transition-colors flex-none"
                    data-testid={`sp-delete-${sp.id}`} title="Remove">
                    <Trash2 size={14} />
                  </button>
                </div>

                {/* PIN form */}
                {settingPinFor === sp.id && (
                  <div className="mt-2 flex items-center gap-2" data-testid={`sp-pin-form-${sp.id}`}>
                    <input type="password" inputMode="numeric" maxLength={4} value={pinVal}
                      onChange={(e) => { setPinVal(e.target.value.replace(/\D/g, "").slice(0, 4)); setPinError(""); }}
                      onKeyDown={(e) => e.key === "Enter" && savePin(sp.id)}
                      placeholder="4-digit PIN"
                      className="w-28 h-9 border border-line rounded-xl px-3 text-sm text-center tracking-widest font-bold outline-none focus:border-brick bg-cream"
                      autoFocus data-testid={`sp-pin-input-${sp.id}`} />
                    <button onClick={() => savePin(sp.id)} disabled={pinBusy}
                      className="h-9 px-3 rounded-xl bg-brick text-white font-bold text-xs disabled:opacity-60"
                      data-testid={`sp-pin-save-${sp.id}`}>Save</button>
                    <button onClick={() => { setSettingPinFor(null); setPinVal(""); }}
                      className="h-9 px-3 rounded-xl border border-line text-mocha text-xs">Cancel</button>
                    {pinError && <span className="text-xs text-maroon">{pinError}</span>}
                  </div>
                )}

                {/* Account form */}
                {accountFormFor === sp.id && (
                  <div className="mt-2 flex flex-col gap-2" data-testid={`sp-acct-form-${sp.id}`}>
                    {!sp.has_account && (
                      <input type="email" value={acctEmail}
                        onChange={(e) => { setAcctEmail(e.target.value); setAcctError(""); }}
                        placeholder="Email address"
                        className="h-9 border border-line rounded-xl px-3 text-sm outline-none focus:border-brick bg-cream"
                        autoFocus data-testid={`sp-acct-email-${sp.id}`} />
                    )}
                    <div className="flex items-center gap-2">
                      <input type="password" value={acctPass}
                        onChange={(e) => { setAcctPass(e.target.value); setAcctError(""); }}
                        placeholder={sp.has_account ? "New password (min 6 chars)" : "Password (min 6 chars)"}
                        className="flex-1 h-9 border border-line rounded-xl px-3 text-sm outline-none focus:border-brick bg-cream"
                        data-testid={`sp-acct-pass-${sp.id}`} />
                      <button
                        onClick={() => sp.has_account ? resetPassword(sp.id) : saveAccount(sp.id)}
                        disabled={acctBusy}
                        className="h-9 px-3 rounded-xl bg-brick text-white font-bold text-xs disabled:opacity-60 flex-none"
                        data-testid={`sp-acct-save-${sp.id}`}>
                        {sp.has_account ? "Reset" : "Create"}
                      </button>
                      <button onClick={() => { setAccountFormFor(null); setAcctPass(""); }}
                        className="h-9 px-3 rounded-xl border border-line text-mocha text-xs flex-none">Cancel</button>
                    </div>
                    {acctError && <span className="text-xs text-maroon" data-testid={`sp-acct-error-${sp.id}`}>{acctError}</span>}
                  </div>
                )}
              </div>
            ))}
            </div>
            {salespersons.length > 5 && (
              <button
                onClick={() => setShowAllSalespersons((v) => !v)}
                data-testid="salespersons-show-more"
                className="w-full px-4 py-2.5 text-xs font-bold text-mocha hover:text-brick flex items-center justify-center gap-1 border-t border-line transition-colors"
              >
                {showAllSalespersons
                  ? <><ChevronUp size={13} /> Show less</>
                  : <><ChevronDown size={13} /> Show {salespersons.length - 5} more salespersons</>}
              </button>
            )}
          </>
        )}
      </div>
      {/* Settings */}
      <SettingsSection />
      {/* Manage Admins */}
      <ManageAdminsSection />
      {/* Change Admin Credentials */}
      <ChangeCredentialsSection />
      {/* Blocked IPs */}
      <LockedIPsPanel />
      {/* Report Card */}
      <ReportCard />
    </div>
  );
}

// ── Locked IPs Panel ─────────────────────────────────────────────────────────
function LockedIPsPanel() {
  const { data: locks = [], refetch, isLoading } = useQuery({
    queryKey: ["locked-ips"],
    queryFn: () => api.get("/admin/locked-ips").then(r => r.data),
    refetchInterval: 30000,
  });
  const [clearing, setClearing] = useState(null);

  const unlock = async (ip) => {
    setClearing(ip);
    try {
      await api.delete(`/admin/locked-ips/${encodeURIComponent(ip)}`);
      refetch();
    } catch (e) { console.error("Unlock IP failed:", e?.response?.data?.detail || e.message); }
    finally { setClearing(null); }
  };

  return (
    <div data-testid="locked-ips-panel" className="bg-cream border border-line rounded-2xl p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldAlert size={16} className="text-brick" />
          <h3 className="font-bold text-sm text-ink">Blocked IPs</h3>
        </div>
        <button onClick={refetch} className="text-xs text-mocha hover:text-brick">Refresh</button>
      </div>
      <p className="text-xs text-mocha -mt-2">IPs blocked after 5 failed login attempts. Block lasts 15 minutes and clears automatically.</p>

      {isLoading && <p className="text-xs text-mocha">Loading…</p>}

      {!isLoading && locks.length === 0 && (
        <div className="flex items-center gap-2 text-xs text-[#1F5F36]" data-testid="no-locked-ips">
          <ShieldCheck size={14} /> No IPs currently blocked — all clear.
        </div>
      )}

      {locks.map((lock) => (
        <div key={lock.ip} data-testid={`locked-ip-${lock.ip}`}
          className="flex items-center justify-between bg-[#FDE3DE] border border-[#F5B7B1] rounded-xl px-3.5 py-2.5 gap-2">
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="font-bold text-sm text-maroon font-mono truncate">{lock.ip}</span>
            <span className="text-[11px] text-mocha">
              {lock.attempts} attempts{lock.email_hint ? ` · tried "${lock.email_hint}"` : ""} · unlocks in {lock.unlocks_in}
            </span>
          </div>
          <button
            onClick={() => unlock(lock.ip)}
            disabled={clearing === lock.ip}
            data-testid={`unlock-btn-${lock.ip}`}
            className="flex-none text-xs font-bold text-brick hover:text-maroon disabled:opacity-50 flex items-center gap-1"
          >
            <Trash size={13} /> {clearing === lock.ip ? "…" : "Unlock"}
          </button>
        </div>
      ))}
    </div>
  );
}


// ── Change Admin Credentials ──────────────────────────────────────────────────
function ChangeCredentialsSection() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [currentPwd, setCurrentPwd]   = useState("");
  const [newEmail, setNewEmail]       = useState("");
  const [newPwd, setNewPwd]           = useState("");
  const [confirmPwd, setConfirmPwd]   = useState("");
  const [showCur, setShowCur]         = useState(false);
  const [showNew, setShowNew]         = useState(false);
  const [busy, setBusy]               = useState(false);
  const [error, setError]             = useState("");
  const [success, setSuccess]         = useState("");

  const handleSave = async () => {
    setError(""); setSuccess("");
    if (!currentPwd) { setError("Current password is required"); return; }
    if (newPwd && newPwd !== confirmPwd) { setError("New passwords do not match"); return; }
    if (newPwd && newPwd.length < 6) { setError("New password must be at least 6 characters"); return; }
    if (!newEmail && !newPwd) { setError("Enter a new email or new password to update"); return; }
    setBusy(true);
    try {
      await api.patch("/admin/profile", {
        current_password: currentPwd,
        new_email: newEmail.trim(),
        new_password: newPwd,
      });
      setSuccess("Credentials updated! Logging you out now…");
      setTimeout(async () => {
        await logout();
        navigate("/login");
      }, 1800);
    } catch (e) {
      setError(e.response?.data?.detail || "Update failed. Check your current password.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-testid="change-credentials-section" className="bg-cream border border-line rounded-2xl p-5 flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <KeyRound size={16} className="text-brick" />
        <h3 className="font-bold text-sm text-ink">Change Admin Credentials</h3>
      </div>
      <p className="text-xs text-mocha -mt-2">
        Update the admin email or password. You will be logged out immediately after saving — log back in with your new credentials.
      </p>

      {error  && <div data-testid="cred-error"  className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
      {success && <div data-testid="cred-success" className="text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">{success}</div>}

      {/* Current Password */}
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-mocha">Current Password <span className="text-brick">*</span></label>
        <div className="relative">
          <input
            type={showCur ? "text" : "password"}
            value={currentPwd}
            onChange={(e) => setCurrentPwd(e.target.value)}
            placeholder="Enter your current password"
            data-testid="cred-current-password"
            className="w-full h-11 border border-line rounded-xl px-3.5 pr-10 text-sm outline-none focus:border-brick bg-white"
          />
          <button type="button" onClick={() => setShowCur(v => !v)}
            className="absolute right-3 top-3 text-mocha">
            {showCur ? <EyeOff size={16}/> : <Eye size={16}/>}
          </button>
        </div>
      </div>

      {/* New Email */}
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-mocha">New Email <span className="text-mocha/50">(leave blank to keep current)</span></label>
        <input
          type="email"
          value={newEmail}
          onChange={(e) => setNewEmail(e.target.value)}
          placeholder="new@yourdomain.com"
          data-testid="cred-new-email"
          className="h-11 border border-line rounded-xl px-3.5 text-sm outline-none focus:border-brick bg-white"
        />
      </div>

      {/* New Password */}
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-mocha">New Password <span className="text-mocha/50">(leave blank to keep current)</span></label>
        <div className="relative">
          <input
            type={showNew ? "text" : "password"}
            value={newPwd}
            onChange={(e) => setNewPwd(e.target.value)}
            placeholder="Min. 6 characters"
            data-testid="cred-new-password"
            className="w-full h-11 border border-line rounded-xl px-3.5 pr-10 text-sm outline-none focus:border-brick bg-white"
          />
          <button type="button" onClick={() => setShowNew(v => !v)}
            className="absolute right-3 top-3 text-mocha">
            {showNew ? <EyeOff size={16}/> : <Eye size={16}/>}
          </button>
        </div>
      </div>

      {/* Confirm New Password */}
      {newPwd && (
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-mocha">Confirm New Password</label>
          <input
            type="password"
            value={confirmPwd}
            onChange={(e) => setConfirmPwd(e.target.value)}
            placeholder="Repeat new password"
            data-testid="cred-confirm-password"
            className="h-11 border border-line rounded-xl px-3.5 text-sm outline-none focus:border-brick bg-white"
          />
        </div>
      )}

      <button
        onClick={handleSave}
        disabled={busy}
        data-testid="cred-save-btn"
        className="h-11 rounded-xl bg-brick text-white font-bold text-sm hover:bg-maroon transition-colors disabled:opacity-50"
      >
        {busy ? "Saving…" : "Update Credentials"}
      </button>
    </div>
  );
}


const LABEL_PRESETS = [[50, 25], [38, 25], [40, 30], [62, 35], [100, 50]];

function LabelSizeSetting({ w, h, setW, setH }) {
  const isPreset = LABEL_PRESETS.some(([pw, ph]) => pw === Number(w) && ph === Number(h));
  const [custom, setCustom] = useState(false);
  const showCustom = custom || !isPreset;
  const scale = 1.6;
  const chip = (active) => `h-8 px-3 rounded-full text-xs font-bold border transition-colors ${active ? "bg-brick text-white border-brick" : "bg-cream text-mocha border-line hover:border-brick"}`;
  return (
    <div className="flex flex-col gap-2 border-t border-line pt-3" data-testid="settings-label-size">
      <label className="text-xs font-bold text-[#5A3A30]">Barcode Label Size</label>
      <p className="text-xs text-mocha">Page size used for Print Label / Print Labels (one label per page).</p>
      <div className="flex flex-wrap gap-2">
        {LABEL_PRESETS.map(([pw, ph]) => (
          <button key={`${pw}x${ph}`} type="button" data-testid={`label-preset-${pw}x${ph}`}
            onClick={() => { setCustom(false); setW(pw); setH(ph); }}
            className={chip(!showCustom && Number(w) === pw && Number(h) === ph)}>
            {pw}×{ph} mm{pw === 50 && ph === 25 ? " (default)" : ""}
          </button>
        ))}
        <button type="button" data-testid="label-preset-custom" onClick={() => setCustom(true)} className={chip(showCustom)}>Custom</button>
      </div>
      {showCustom && (
        <div className="flex items-center gap-2">
          <input type="number" min={20} max={150} value={w} onChange={(e) => setW(e.target.value)} data-testid="label-custom-width"
            className="h-10 w-24 border border-line rounded-xl px-3 text-sm outline-none focus:border-brick bg-cream" />
          <span className="text-xs text-mocha">×</span>
          <input type="number" min={20} max={150} value={h} onChange={(e) => setH(e.target.value)} data-testid="label-custom-height"
            className="h-10 w-24 border border-line rounded-xl px-3 text-sm outline-none focus:border-brick bg-cream" />
          <span className="text-xs text-mocha">mm (20–150)</span>
        </div>
      )}
      <div className="flex items-end gap-3 pt-1">
        <div data-testid="label-size-preview"
          style={{ width: `${Math.min(Math.max(Number(w) || 0, 20), 150) * scale}px`, height: `${Math.min(Math.max(Number(h) || 0, 20), 150) * scale}px` }}
          className="border-2 border-dashed border-brick/60 rounded bg-white flex flex-col items-center justify-center gap-1 p-1 overflow-hidden">
          <div className="w-4/5 h-1/3 bg-[repeating-linear-gradient(90deg,#1F1512_0_2px,transparent_2px_4px)]" />
        </div>
        <span className="text-xs text-mocha" data-testid="label-size-preview-text">{w} × {h} mm</span>
      </div>
    </div>
  );
}

// ── Settings Section ──────────────────────────────────────────────────────────
function SettingsSection() {
  const queryClient = useQueryClient();
  const { data: saved, refetch } = useQuery({ queryKey: ["admin-settings"], queryFn: () => api.get("/admin/settings").then(r => r.data) });
  const { data: allCategories = [] } = useQuery({ queryKey: ["categories"], queryFn: () => api.get("/categories").then(r => r.data) });

  // Shop Identity
  const [shopName, setShopName]           = useState("");
  const [address, setAddress]             = useState("");
  const [phone, setPhone]                 = useState("");
  const [gstNo, setGstNo]                 = useState("");
  const [fireLicenseNo, setFireLicenseNo] = useState("");
  // Existing fields
  const [notifyEmail, setNotifyEmail]             = useState("");
  const [upiId, setUpiId]                         = useState("");
  const [upiName, setUpiName]                     = useState("");
  const [scannerMode, setScannerMode]             = useState(false);
  const [gstEnabled, setGstEnabled]               = useState(false);
  const [defaultCategory, setDefaultCategory]     = useState("");
  const [heroTitle, setHeroTitle]                 = useState("");
  const [heroSubtitle, setHeroSubtitle]           = useState("");
  const [heroImageUrl, setHeroImageUrl]           = useState("");
  const [labelW, setLabelW]                       = useState(50);
  const [labelH, setLabelH]                       = useState(25);
  const [busy, setBusy]                           = useState(false);
  const [saved2, setSaved2]                       = useState(false);
  const [error, setError]                         = useState("");

  // Populate fields once data loads
  useState(() => { if (saved) { setNotifyEmail(saved.admin_notify_email || ""); setUpiId(saved.upi_id || ""); setUpiName(saved.upi_name || ""); setScannerMode(saved.scanner_mode || false); setGstEnabled(saved.gst_enabled || false); setDefaultCategory(saved.default_category || ""); } }, [saved]);

  // Use useEffect to sync
  const prevSaved = useState(null);
  if (saved && notifyEmail === "" && upiId === "") {
    setShopName(saved.shop_name || "");
    setAddress(saved.address || "");
    setPhone(saved.phone || "");
    setGstNo(saved.gst_no || "");
    setFireLicenseNo(saved.fire_license_no || "");
    setNotifyEmail(saved.admin_notify_email || "");
    setUpiId(saved.upi_id || "");
    setUpiName(saved.upi_name || "");
    setScannerMode(saved.scanner_mode || false);
    setGstEnabled(saved.gst_enabled || false);
    setDefaultCategory(saved.default_category || "");
    setHeroTitle(saved.hero_title || "");
    setHeroSubtitle(saved.hero_subtitle || "");
    setHeroImageUrl(saved.hero_image_url || "");
    setLabelW(saved.label_width_mm || 50);
    setLabelH(saved.label_height_mm || 25);
  }

  const save = async () => {
    setError(""); setBusy(true); setSaved2(false);
    try {
      await api.patch("/admin/settings", {
        shop_name: shopName.trim(),
        address: address.trim(),
        phone: phone.trim(),
        gst_no: gstEnabled ? gstNo.trim() : gstNo.trim(),
        fire_license_no: fireLicenseNo.trim(),
        admin_notify_email: notifyEmail.trim(),
        upi_id: upiId.trim(),
        upi_name: upiName.trim(),
        scanner_mode: scannerMode,
        gst_enabled: gstEnabled,
        default_category: defaultCategory,
        hero_title: heroTitle.trim(),
        hero_subtitle: heroSubtitle.trim(),
        hero_image_url: heroImageUrl.trim(),
        label_width_mm: Number(labelW),
        label_height_mm: Number(labelH),
      });
      await queryClient.invalidateQueries({ queryKey: ["admin-settings"] });
      await queryClient.invalidateQueries({ queryKey: ["shop-info"] });
      refetch();
      setSaved2(true);
      setTimeout(() => setSaved2(false), 3000);
    } catch (e) {
      setError(e?.response?.data?.detail || "Failed to save");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white border border-line rounded-2xl mt-5" data-testid="settings-section">
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-line">
        <span className="font-bold text-sm">Shop Settings</span>
      </div>
      <div className="px-4 py-4 flex flex-col gap-4">

        {/* ── Shop Identity ── */}
        <div className="flex flex-col gap-3 pb-4 border-b border-line">
          <div className="text-xs font-bold text-mocha uppercase tracking-wide">Shop Identity</div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-[#5A3A30]">Shop Name</label>
            <p className="text-xs text-mocha">Appears on receipts, bills and WhatsApp share messages.</p>
            <input type="text" value={shopName} onChange={(e) => setShopName(e.target.value)}
              placeholder="e.g. Balaji Fataka" data-testid="settings-shop-name"
              className="h-11 border border-line rounded-xl px-3.5 text-sm outline-none focus:border-brick bg-cream" />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-[#5A3A30]">Address</label>
            <p className="text-xs text-mocha">Printed on every bill. Use Enter for a new line.</p>
            <textarea value={address} onChange={(e) => setAddress(e.target.value)}
              placeholder={"123, Main Road, Sivakasi\nTamil Nadu – 626 124"}
              rows={3} data-testid="settings-address"
              className="border border-line rounded-xl px-3.5 py-2.5 text-sm outline-none focus:border-brick bg-cream resize-none" />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-[#5A3A30]">Phone Number</label>
            <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
              placeholder="9876543210" data-testid="settings-phone"
              className="h-11 border border-line rounded-xl px-3.5 text-sm outline-none focus:border-brick bg-cream" />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-[#5A3A30]">Fire License No</label>
            <p className="text-xs text-mocha">Compliance — always printed at the bottom of every bill.</p>
            <input type="text" value={fireLicenseNo} onChange={(e) => setFireLicenseNo(e.target.value)}
              placeholder="e.g. FL/TN/2024/001234" data-testid="settings-fire-license"
              className="h-11 border border-line rounded-xl px-3.5 text-sm outline-none focus:border-brick bg-cream" />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-bold text-[#5A3A30]">Admin notification email</label>
          <p className="text-xs text-mocha">An alert email is sent to this address for every new customer order.</p>
          <input
            type="email"
            value={notifyEmail}
            onChange={(e) => setNotifyEmail(e.target.value)}
            placeholder="your@email.com"
            data-testid="settings-notify-email"
            className="h-11 border border-line rounded-xl px-3.5 text-sm outline-none focus:border-brick bg-cream"
          />
        </div>

        {/* UPI ID */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-bold text-[#5A3A30]">UPI ID</label>
          <p className="text-xs text-mocha">Used on QR codes shown on checkout and receipts.</p>
          <input
            type="text"
            value={upiId}
            onChange={(e) => setUpiId(e.target.value)}
            placeholder="yourname@upi"
            data-testid="settings-upi-id"
            className="h-11 border border-line rounded-xl px-3.5 text-sm outline-none focus:border-brick bg-cream"
          />
        </div>

        {/* UPI payee name */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-bold text-[#5A3A30]">UPI payee name</label>
          <p className="text-xs text-mocha">Name shown on customer's UPI app when they scan the QR.</p>
          <input
            type="text"
            value={upiName}
            onChange={(e) => setUpiName(e.target.value)}
            placeholder="Shop name"
            data-testid="settings-upi-name"
            className="h-11 border border-line rounded-xl px-3.5 text-sm outline-none focus:border-brick bg-cream"
          />
        </div>

        {/* Scanner Mode toggle */}
        <div className="flex items-center justify-between py-1 border-t border-line pt-3">
          <div className="flex flex-col gap-0.5">
            <label className="text-xs font-bold text-[#5A3A30]">Scanner Mode (POS)</label>
            <p className="text-xs text-mocha">When ON, the POS screen shows a dedicated barcode scanner input bar at the top.</p>
          </div>
          <button
            type="button"
            onClick={() => setScannerMode((v) => !v)}
            data-testid="settings-scanner-mode-toggle"
            className={`relative inline-flex h-6 w-11 flex-none items-center rounded-full transition-colors focus:outline-none ml-4 ${scannerMode ? "bg-brick" : "bg-chip"}`}
            aria-checked={scannerMode}
            role="switch"
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${scannerMode ? "translate-x-6" : "translate-x-1"}`} />
          </button>
        </div>

        {/* GST toggle */}
        <div className="flex items-center justify-between py-1 border-t border-line pt-3">
          <div className="flex flex-col gap-0.5">
            <label className="text-xs font-bold text-[#5A3A30]">GST on Bills (CGST 9% + SGST 9%)</label>
            <p className="text-xs text-mocha">When ON, 18% GST is added to every bill total and printed on the invoice.</p>
          </div>
          <button
            type="button"
            onClick={() => setGstEnabled((v) => !v)}
            data-testid="settings-gst-toggle"
            className={`relative inline-flex h-6 w-11 flex-none items-center rounded-full transition-colors focus:outline-none ml-4 ${gstEnabled ? "bg-brick" : "bg-chip"}`}
            aria-checked={gstEnabled}
            role="switch"
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${gstEnabled ? "translate-x-6" : "translate-x-1"}`} />
          </button>
        </div>

        {/* GST Number — always visible so admin can pre-fill it */}
        <div className="flex flex-col gap-1.5 pl-3 border-l-2 border-brick/30">
          <label className="text-xs font-bold text-[#5A3A30]">GST Number (GSTIN)</label>
          <p className="text-xs text-mocha">
            Printed on bills <strong>only when GST toggle is ON</strong>. You can save it here in advance.
          </p>
          <input type="text" value={gstNo} onChange={(e) => setGstNo(e.target.value.toUpperCase())}
            placeholder="e.g. 29AABCT1332L1ZV" maxLength={15} data-testid="settings-gst-no"
            className="h-11 border border-line rounded-xl px-3.5 text-sm outline-none focus:border-brick bg-cream font-mono tracking-wider" />
        </div>

        {/* Default Category */}
        <div className="flex flex-col gap-1.5 border-t border-line pt-3">
          <label className="text-xs font-bold text-[#5A3A30]">Default Category (Shop & POS)</label>
          <p className="text-xs text-mocha">The category selected by default when customers open the shop or staff open the POS.</p>
          <select
            value={defaultCategory}
            onChange={(e) => setDefaultCategory(e.target.value)}
            data-testid="settings-default-category"
            className="h-11 border border-line rounded-xl px-3.5 text-sm outline-none focus:border-brick bg-cream"
          >
            <option value="">All (show everything)</option>
            {allCategories.map((c) => (
              <option key={c.id} value={c.name}>{c.name}</option>
            ))}
          </select>
        </div>

        <LabelSizeSetting w={labelW} h={labelH} setW={setLabelW} setH={setLabelH} />

        {/* ── Hero Banner ── */}
        <div className="flex flex-col gap-3 border-t border-line pt-3">
          <div>
            <label className="text-xs font-bold text-[#5A3A30]">Shop Hero Banner</label>
            <p className="text-xs text-mocha mt-0.5">Shown above the search bar on the shop page. Leave all fields blank to hide the banner.</p>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-mocha">Headline</label>
            <input
              type="text"
              value={heroTitle}
              onChange={(e) => setHeroTitle(e.target.value)}
              placeholder="e.g. Biggest Sale of the Season"
              data-testid="settings-hero-title"
              className="h-11 border border-line rounded-xl px-3.5 text-sm outline-none focus:border-brick bg-cream"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-mocha">Subheading</label>
            <input
              type="text"
              value={heroSubtitle}
              onChange={(e) => setHeroSubtitle(e.target.value)}
              placeholder="e.g. Shop the best fireworks at unbeatable prices"
              data-testid="settings-hero-subtitle"
              className="h-11 border border-line rounded-xl px-3.5 text-sm outline-none focus:border-brick bg-cream"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-mocha">Background Image URL</label>
            <input
              type="url"
              value={heroImageUrl}
              onChange={(e) => setHeroImageUrl(e.target.value)}
              placeholder="https://images.unsplash.com/..."
              data-testid="settings-hero-image-url"
              className="h-11 border border-line rounded-xl px-3.5 text-sm outline-none focus:border-brick bg-cream"
            />
          </div>

          {/* Live preview */}
          {(heroTitle || heroImageUrl) && (
            <div
              data-testid="settings-hero-preview"
              className="rounded-xl overflow-hidden relative h-24 flex items-end"
              style={{
                background: heroImageUrl
                  ? `linear-gradient(to top, rgba(43,23,18,0.85) 0%, rgba(43,23,18,0.3) 60%, transparent 100%), url('${heroImageUrl}') center/cover no-repeat`
                  : "linear-gradient(135deg, #7A1410 0%, #2B1712 100%)",
              }}
            >
              <div className="px-4 pb-3">
                {heroTitle && <p className="text-white font-bold text-sm leading-tight">{heroTitle}</p>}
                {heroSubtitle && <p className="text-white/60 text-xs mt-0.5">{heroSubtitle}</p>}
              </div>
            </div>
          )}
        </div>

        {error && <div className="text-sm text-maroon bg-[#FDE3DE] rounded-xl px-3 py-2" data-testid="settings-error">{error}</div>}

        <button
          onClick={save}
          disabled={busy}
          data-testid="settings-save-btn"
          className="h-11 rounded-xl bg-brick text-white font-bold text-sm disabled:opacity-60 self-start px-6"
        >
          {busy ? "Saving…" : saved2 ? "Saved!" : "Save Settings"}
        </button>
      </div>
    </div>
  );
}


// ── Manage Admins Section ─────────────────────────────────────────────────────
function ManageAdminsSection() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm]   = useState(false);
  const [name, setName]           = useState("");
  const [email, setEmail]         = useState("");
  const [pwd, setPwd]             = useState("");
  const [showPwd, setShowPwd]     = useState(false);
  const [busy, setBusy]           = useState(false);
  const [error, setError]         = useState("");
  const [success, setSuccess]     = useState("");
  const [deleting, setDeleting]   = useState(null); // id being deleted

  const { data: admins = [], refetch } = useQuery({
    queryKey: ["admin-list"],
    queryFn: () => api.get("/admin/admins").then((r) => r.data),
  });

  const handleAdd = async () => {
    setError(""); setSuccess("");
    if (!name.trim())  { setError("Name is required"); return; }
    if (!email.trim()) { setError("Email is required"); return; }
    if (pwd.length < 6) { setError("Password must be at least 6 characters"); return; }
    setBusy(true);
    try {
      await api.post("/admin/admins", { name: name.trim(), email: email.trim(), password: pwd });
      setSuccess(`Admin "${name.trim()}" created successfully`);
      setName(""); setEmail(""); setPwd("");
      setShowForm(false);
      refetch();
      setTimeout(() => setSuccess(""), 4000);
    } catch (e) {
      setError(e.response?.data?.detail || "Failed to create admin");
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id, adminName) => {
    if (!window.confirm(`Remove admin "${adminName}"? They will no longer be able to log in.`)) return;
    setDeleting(id);
    try {
      await api.delete(`/admin/admins/${id}`);
      refetch();
    } catch (e) {
      alert(e.response?.data?.detail || "Failed to remove admin");
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div data-testid="manage-admins-section" className="bg-cream border border-line rounded-2xl p-5 flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <UserCog size={16} className="text-brick" />
          <h3 className="font-bold text-sm text-ink">Manage Admin Accounts</h3>
          <span className="text-xs text-mocha bg-chip px-2 py-0.5 rounded-full">{admins.length} admin{admins.length !== 1 ? "s" : ""}</span>
        </div>
        <button
          onClick={() => { setShowForm((v) => !v); setError(""); setSuccess(""); }}
          data-testid="add-admin-toggle"
          className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-brick text-white text-xs font-bold hover:opacity-90 transition-opacity"
        >
          <Plus size={13} /> Add Admin
        </button>
      </div>

      {error   && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2" data-testid="admin-mgmt-error">{error}</div>}
      {success && <div className="text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2" data-testid="admin-mgmt-success">{success}</div>}

      {/* Add Admin Form */}
      {showForm && (
        <div className="bg-white border border-line rounded-xl p-4 flex flex-col gap-3" data-testid="add-admin-form">
          <div className="text-xs font-bold text-mocha uppercase tracking-wide">New Admin Details</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-mocha font-medium">Full Name *</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Shiva Kumar"
                data-testid="new-admin-name"
                className="h-10 border border-line rounded-xl px-3 text-sm outline-none focus:border-brick bg-white"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-mocha font-medium">Email *</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@example.com"
                data-testid="new-admin-email"
                className="h-10 border border-line rounded-xl px-3 text-sm outline-none focus:border-brick bg-white"
              />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-mocha font-medium">Password * (min 6 characters)</label>
            <div className="relative">
              <input
                type={showPwd ? "text" : "password"}
                value={pwd}
                onChange={(e) => setPwd(e.target.value)}
                placeholder="Set a strong password"
                data-testid="new-admin-password"
                className="w-full h-10 border border-line rounded-xl px-3 pr-10 text-sm outline-none focus:border-brick bg-white"
              />
              <button type="button" onClick={() => setShowPwd((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-mocha hover:text-ink">
                {showPwd ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={handleAdd} disabled={busy} data-testid="new-admin-submit"
              className="h-9 px-5 rounded-xl bg-brick text-white text-xs font-bold disabled:opacity-60 hover:opacity-90 transition-opacity">
              {busy ? "Creating…" : "Create Admin"}
            </button>
            <button onClick={() => { setShowForm(false); setError(""); setName(""); setEmail(""); setPwd(""); }}
              className="h-9 px-4 rounded-xl border border-line text-xs font-medium text-mocha hover:border-brick transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Admin List */}
      <div className="divide-y divide-[#F1E2CC] bg-white border border-line rounded-xl overflow-hidden">
        {admins.length === 0 ? (
          <div className="p-6 text-center text-sm text-mocha">No admin accounts found.</div>
        ) : admins.map((a) => (
          <div key={a.id} className="flex items-center justify-between px-4 py-3 gap-3" data-testid={`admin-row-${a.id}`}>
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-8 h-8 rounded-xl bg-[#FFE3B8] flex items-center justify-center flex-none">
                <Users size={15} className="text-maroon" />
              </div>
              <div className="min-w-0">
                <div className="font-medium text-sm truncate">{a.name}</div>
                <div className="text-xs text-mocha truncate">{a.email}</div>
              </div>
            </div>
            <button
              onClick={() => handleDelete(a.id, a.name)}
              disabled={deleting === a.id || admins.length <= 1}
              data-testid={`delete-admin-${a.id}`}
              title={admins.length <= 1 ? "Cannot delete the last admin" : "Remove admin"}
              className="flex-none h-8 w-8 rounded-lg border border-line text-mocha hover:border-red-400 hover:text-red-500 flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {deleting === a.id ? <span className="w-3 h-3 border-2 border-mocha border-t-transparent rounded-full animate-spin" /> : <Trash2 size={14} />}
            </button>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-mocha -mt-1">
        Each admin has full access to the dashboard. You cannot delete your own account or the last remaining admin.
      </p>
    </div>
  );
}


// ── Report Card ────────────────────────────────────────────────────────────────
const CAT_COLORS = ["#C0392B","#E67E22","#F1C40F","#27AE60","#2980B9","#8E44AD"];

function ReportCard() {
  const [topPeriod, setTopPeriod] = useState("week"); // "today" | "week"

  const { data: s, isLoading } = useQuery({
    queryKey: ["dashboard-summary"],
    queryFn: () => api.get("/admin/reports/dashboard-summary").then((r) => r.data),
    refetchInterval: 60000, // refresh every minute
    staleTime: 30000,
  });

  const maxTrend = s ? Math.max(...s.trend.map((t) => t.revenue), 1) : 1;

  const todayMetrics = [
    { label: "Revenue",    value: s ? money(s.today.revenue)    : "—", color: "text-[#1F5F36]", bg: "bg-[#DDF1E3]" },
    { label: "Orders",     value: s ? s.today.orders            : "—", color: "text-maroon",    bg: "bg-[#FFE3B8]" },
    { label: "Profit",     value: s ? money(s.today.profit)     : "—", color: "text-[#1F3F7A]", bg: "bg-[#E1EAFB]" },
    { label: "Items Sold", value: s ? s.today.items_sold        : "—", color: "text-ink",        bg: "bg-chip"      },
  ];

  return (
    <div data-testid="report-card" className="bg-cream border border-line rounded-2xl overflow-hidden">
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-line">
        <div className="flex items-center gap-2">
          <TrendingUp size={16} className="text-brick" />
          <span className="font-bold text-sm text-ink">Reports Summary</span>
        </div>
        <Link to="/admin/reports" data-testid="view-full-report-link"
          className="text-xs font-bold text-brick hover:underline flex items-center gap-1">
          View Full Report →
        </Link>
      </div>

      {isLoading ? (
        <div className="p-8 text-center text-sm text-mocha">Loading report…</div>
      ) : s && (
        <div className="flex flex-col gap-0 divide-y divide-line">

          {/* ── 1. Today's Snapshot ── */}
          <div className="px-5 py-4">
            <div className="text-[11px] font-bold text-mocha uppercase tracking-wide mb-3">Today's Snapshot</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {todayMetrics.map((m) => (
                <div key={m.label} className="bg-white border border-line rounded-xl p-3 flex flex-col gap-1" data-testid={`today-${m.label.toLowerCase().replace(" ","-")}`}>
                  <div className={`text-base font-bold font-display ${m.color}`}>{m.value}</div>
                  <div className="text-[11px] text-mocha font-medium">{m.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* ── 2. 7-Day Revenue Trend ── */}
          <div className="px-5 py-4">
            <div className="text-[11px] font-bold text-mocha uppercase tracking-wide mb-3">Last 7 Days Revenue</div>
            <div className="flex items-end gap-1.5 h-20" data-testid="revenue-trend-chart">
              {s.trend.map((t, i) => {
                const isToday = i === s.trend.length - 1;
                const pct = Math.max((t.revenue / maxTrend) * 100, t.revenue > 0 ? 6 : 2);
                return (
                  <div key={t.day} className="flex flex-col items-center gap-1 flex-1 min-w-0">
                    <div className="w-full flex items-end justify-center" style={{ height: "60px" }}>
                      <div
                        title={`${t.day}: ${money(t.revenue)}`}
                        style={{ height: `${pct}%` }}
                        className={`w-full rounded-t-md transition-all ${isToday ? "bg-brick" : "bg-[#F1C0A0]"}`}
                      />
                    </div>
                    <div className={`text-[9px] font-medium truncate w-full text-center ${isToday ? "text-brick font-bold" : "text-mocha"}`}>
                      {isToday ? "Today" : t.day.split(" ")[0]}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── 3. Top 5 Products ── */}
          <div className="px-5 py-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-[11px] font-bold text-mocha uppercase tracking-wide">Top Products</div>
              <div className="flex rounded-lg border border-line overflow-hidden text-[10px] font-bold">
                {["today","week"].map((p) => (
                  <button key={p} onClick={() => setTopPeriod(p)}
                    data-testid={`top-period-${p}`}
                    className={`px-2.5 py-1 transition-colors ${topPeriod === p ? "bg-brick text-white" : "bg-white text-mocha"}`}>
                    {p === "today" ? "Today" : "This Week"}
                  </button>
                ))}
              </div>
            </div>
            {s.top_products.length === 0 ? (
              <div className="text-xs text-mocha text-center py-3">No sales data yet</div>
            ) : (
              <div className="flex flex-col gap-1.5">
                {s.top_products.map((p, i) => (
                  <div key={p.name} className="flex items-center gap-2.5" data-testid={`top-product-${i}`}>
                    <div className="w-5 h-5 rounded-md bg-chip flex items-center justify-center text-[10px] font-bold text-mocha flex-none">
                      {i + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-xs font-medium truncate">{p.name}</span>
                        <span className="text-xs text-mocha flex-none">{p.qty} sold</span>
                      </div>
                      <div className="mt-0.5 h-1.5 bg-chip rounded-full overflow-hidden">
                        <div
                          className="h-full bg-brick rounded-full"
                          style={{ width: `${Math.round((p.qty / s.top_products[0].qty) * 100)}%` }}
                        />
                      </div>
                    </div>
                    <span className="text-xs font-bold text-[#1F5F36] flex-none">{money(p.revenue)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── 4. Category Breakdown ── */}
          {s.categories.length > 0 && (
            <div className="px-5 py-4">
              <div className="text-[11px] font-bold text-mocha uppercase tracking-wide mb-3">Category Breakdown (This Week)</div>
              <div className="flex flex-col gap-2">
                {s.categories.map((c, i) => (
                  <div key={c.category} className="flex items-center gap-2.5" data-testid={`cat-row-${i}`}>
                    <div className="w-2 h-2 rounded-full flex-none" style={{ background: CAT_COLORS[i % CAT_COLORS.length] }} />
                    <span className="text-xs font-medium flex-1 min-w-0 truncate">{c.category}</span>
                    <div className="flex-none w-24 h-1.5 bg-chip rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${c.pct}%`, background: CAT_COLORS[i % CAT_COLORS.length] }} />
                    </div>
                    <span className="text-[11px] text-mocha flex-none w-8 text-right">{c.pct}%</span>
                    <span className="text-xs font-bold flex-none w-16 text-right">{money(c.revenue)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── 5. GST Summary ── */}
          <div className="px-5 py-4">
            <div className="text-[11px] font-bold text-mocha uppercase tracking-wide mb-3">
              GST Summary — {s.gst.month}
            </div>
            <div className="grid grid-cols-3 gap-2.5">
              {[
                { label: "CGST (9%)",      value: money(s.gst.cgst),          color: "text-[#1F3F7A]" },
                { label: "SGST (9%)",      value: money(s.gst.sgst),          color: "text-[#1F3F7A]" },
                { label: "Month Revenue",  value: money(s.gst.month_revenue), color: "text-[#1F5F36]" },
              ].map((g) => (
                <div key={g.label} className="bg-white border border-line rounded-xl p-3 flex flex-col gap-1" data-testid={`gst-${g.label.toLowerCase().replace(/\s|\(.*\)/g,"")}`}>
                  <div className={`text-sm font-bold font-display ${g.color}`}>{g.value}</div>
                  <div className="text-[10px] text-mocha font-medium">{g.label}</div>
                </div>
              ))}
            </div>
          </div>

        </div>
      )}
    </div>
  );
}
