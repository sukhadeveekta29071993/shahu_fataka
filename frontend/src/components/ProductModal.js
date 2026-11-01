import { useState, useEffect } from "react";
import { X, Printer } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Barcode from "react-barcode";
import ProductIcon, { iconBg } from "@/components/ProductIcon";
import api, { apiError } from "@/lib/api";

const ALL_ICONS = ["anar", "fulzadi", "bomb", "rocket", "ladi", "crackle", "chakri", "star"];

const EMPTY = {
  name: "", brand: "", category: "", pack_type: "", pack_size: "",
  icon: "anar", retail_price: "", wholesale_price: "", purchase_price: "", hsn: "3604", stock: "", barcode: "",
};

export default function ProductModal({ product, onClose, onPrintLabel }) {
  const queryClient = useQueryClient();
  const isEdit = !!product?.id;

  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: () => api.get("/categories").then((r) => r.data),
  });

  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [savedProduct, setSavedProduct] = useState(null); // holds the created product for barcode display
  const [barcodeCheck, setBarcodeCheck] = useState({ status: "idle", product: null });
  // status: 'idle' | 'checking' | 'ok' | 'duplicate'

  // Debounced barcode uniqueness check
  useEffect(() => {
    const bc = form.barcode.trim();
    if (!bc) { setBarcodeCheck({ status: "idle", product: null }); return; }
    // In edit mode, unchanged value is always ok
    if (isEdit && bc === (product?.barcode ?? "")) { setBarcodeCheck({ status: "ok", product: null }); return; }

    setBarcodeCheck({ status: "checking", product: null });
    const t = setTimeout(async () => {
      try {
        const { data } = await api.get(`/products/barcode/${encodeURIComponent(bc)}`);
        // Found — is it the same product we're editing?
        if (isEdit && data.id === product?.id) {
          setBarcodeCheck({ status: "ok", product: null });
        } else {
          setBarcodeCheck({ status: "duplicate", product: data });
        }
      } catch (e) {
        // 404 = barcode is free
        if (e?.response?.status === 404) {
          setBarcodeCheck({ status: "ok", product: null });
        }
        // Other network errors — don't block, fall back to idle
      }
    }, 480);
    return () => clearTimeout(t);
  }, [form.barcode, product?.barcode, product?.id, isEdit]); // eslint-disable-line

  useEffect(() => {
    if (product?.id) {
      setForm({
        name: product.name ?? "",
        brand: product.brand ?? "",
        category: product.category ?? (categories[0]?.name ?? ""),
        pack_type: product.pack_type ?? "",
        pack_size: product.pack_size ?? "",
        icon: product.icon ?? "anar",
        retail_price: product.retail_price ?? "",
        wholesale_price: product.wholesale_price ?? "",
        purchase_price: product.purchase_price ?? "",
        hsn: product.hsn ?? "3604",
        stock: product.stock ?? 0,
        barcode: product.barcode ?? "",
      });
    } else {
      setForm((f) => ({ ...EMPTY, category: f.category || categories[0]?.name || "" }));
    }
    setConfirmDelete(false);
    setError("");
    setBarcodeCheck({ status: "idle", product: null });
  }, [product, categories]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { setError("Product name is required"); return; }
    if (!form.retail_price || Number(form.retail_price) <= 0) { setError("Enter a valid retail price"); return; }
    if (!form.wholesale_price || Number(form.wholesale_price) <= 0) { setError("Enter a valid wholesale price"); return; }
    if (form.barcode.trim() && barcodeCheck.status === "duplicate") {
      setError(`Barcode already used by "${barcodeCheck.product?.name}". Enter a different barcode or clear the field to auto-generate.`);
      return;
    }

    const payload = {
      name: form.name.trim(),
      brand: form.brand.trim(),
      category: form.category,
      pack_type: form.pack_type.trim(),
      pack_size: form.pack_size.trim(),
      icon: form.icon,
      retail_price: Number(form.retail_price),
      wholesale_price: Number(form.wholesale_price),
      purchase_price: Number(form.purchase_price) || 0,
      hsn: form.hsn.trim() || "3604",
      stock: Number(form.stock) || 0,
      barcode: form.barcode.trim(),
    };

    setBusy(true);
    setError("");
    try {
      if (isEdit) {
        await api.patch(`/admin/products/${product.id}`, payload);
        queryClient.invalidateQueries({ queryKey: ["products"] });
        queryClient.invalidateQueries({ queryKey: ["admin-stats"] });
        onClose();
      } else {
        const { data } = await api.post("/admin/products", payload);
        queryClient.invalidateQueries({ queryKey: ["products"] });
        queryClient.invalidateQueries({ queryKey: ["admin-stats"] });
        setSavedProduct(data); // Show barcode success screen
      }
    } catch (err) {
      setError(apiError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    setBusy(true);
    setError("");
    try {
      await api.delete(`/admin/products/${product.id}`);
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["admin-stats"] });
      onClose();
    } catch (err) {
      setError(apiError(err));
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-ink/40"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-cream w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[92vh]">

        {/* ── Success / barcode screen (new product only) ── */}
        {savedProduct ? (
          <>
            <div className="flex items-center justify-between px-5 py-4 border-b border-line flex-none">
              <h2 className="font-display font-bold text-lg text-[#1F5F36]" data-testid="product-modal-success-title">
                Product Added!
              </h2>
              <button onClick={onClose} className="w-9 h-9 rounded-xl border border-line flex items-center justify-center text-mocha hover:text-ink transition-colors" data-testid="product-modal-close">
                <X size={18} />
              </button>
            </div>
            <div className="px-5 py-6 flex flex-col items-center gap-4 flex-1">
              <div className="bg-white border border-line rounded-2xl p-5 flex flex-col items-center gap-2 w-full">
                <div className="font-bold text-base text-ink text-center">{savedProduct.name}</div>
                {savedProduct.brand && <div className="text-xs font-bold text-brick uppercase tracking-wide">{savedProduct.brand}</div>}
                <div className="text-sm text-mocha">₹{savedProduct.retail_price}</div>
                {savedProduct.barcode ? (
                  <>
                    <div className="mt-1" data-testid="new-product-barcode">
                      <Barcode value={savedProduct.barcode} width={1.6} height={48} fontSize={11} margin={0} />
                    </div>
                    <div className="text-xs font-mono text-mocha">{savedProduct.barcode}</div>
                  </>
                ) : (
                  <div className="text-xs text-mocha">No barcode assigned</div>
                )}
              </div>
              <p className="text-xs text-mocha text-center">Print the barcode label now, or find it later in Products &amp; Stock.</p>
            </div>
            <div className="px-5 py-4 border-t border-line flex items-center gap-2 flex-none">
              {savedProduct.barcode && onPrintLabel && (
                <button
                  onClick={() => { onPrintLabel(savedProduct); onClose(); }}
                  className="h-11 flex-1 rounded-xl border border-brick text-brick font-bold text-sm flex items-center justify-center gap-2 hover:bg-[#FDE3DE] transition-colors"
                  data-testid="new-product-print-label-btn"
                >
                  <Printer size={16} /> Print Label
                </button>
              )}
              <button
                onClick={onClose}
                className="h-11 flex-1 rounded-xl bg-brick text-white font-bold text-sm"
                data-testid="product-modal-done-btn"
              >
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-line flex-none">
              <h2 className="font-display font-bold text-lg" data-testid="product-modal-title">
                {isEdit ? "Edit Product" : "Add Product"}
              </h2>
              <button
                onClick={onClose}
                className="w-9 h-9 rounded-xl border border-line flex items-center justify-center text-mocha hover:text-ink transition-colors"
                data-testid="product-modal-close"
              >
                <X size={18} />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="overflow-y-auto flex flex-col flex-1">
              <div className="px-5 py-4 flex flex-col gap-3">

                {/* Name */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-mocha uppercase tracking-wide">Product Name *</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={set("name")}
                    placeholder="e.g. Anar Big 5pcs"
                    className="h-11 border border-line rounded-xl px-3 text-sm outline-none focus:border-brick bg-white"
                    data-testid="product-name-input"
                  />
                </div>

                {/* Brand */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-mocha uppercase tracking-wide">Brand / Company</label>
                  <input
                    type="text"
                    value={form.brand}
                    onChange={set("brand")}
                    placeholder="e.g. Standard, Laxmi, Royal"
                    className="h-11 border border-line rounded-xl px-3 text-sm outline-none focus:border-brick bg-white"
                    data-testid="product-brand-input"
                  />
                </div>

                {/* Category + Icon */}
                <div className="grid grid-cols-2 gap-2.5">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-mocha uppercase tracking-wide">Category</label>
                    <select
                      value={form.category}
                      onChange={set("category")}
                      className="h-11 border border-line rounded-xl px-3 text-sm outline-none focus:border-brick bg-white"
                      data-testid="product-category-select"
                    >
                      {categories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-mocha uppercase tracking-wide">Icon</label>
                    <div className="grid grid-cols-4 gap-1">
                      {ALL_ICONS.map((icon) => (
                        <button
                          key={icon}
                          type="button"
                          onClick={() => setForm((f) => ({ ...f, icon }))}
                          className={"h-10 rounded-xl flex items-center justify-center transition-all " +
                            (form.icon === icon ? "ring-2 ring-brick scale-105" : "ring-1 ring-line hover:ring-brick")}
                          style={{ background: iconBg(icon) }}
                          data-testid={`icon-option-${icon}`}
                          title={icon}
                        >
                          <ProductIcon icon={icon} size={20} />
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Pack type + size */}
                <div className="grid grid-cols-2 gap-2.5">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-mocha uppercase tracking-wide">Pack Type</label>
                    <input
                      type="text"
                      value={form.pack_type}
                      onChange={set("pack_type")}
                      placeholder="Box / Packet"
                      className="h-11 border border-line rounded-xl px-3 text-sm outline-none focus:border-brick bg-white"
                      data-testid="product-packtype-input"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-mocha uppercase tracking-wide">Pack Size</label>
                    <input
                      type="text"
                      value={form.pack_size}
                      onChange={set("pack_size")}
                      placeholder="5 pcs / 100 pcs"
                      className="h-11 border border-line rounded-xl px-3 text-sm outline-none focus:border-brick bg-white"
                      data-testid="product-packsize-input"
                    />
                  </div>
                </div>

                {/* Prices */}
                <div className="grid grid-cols-2 gap-2.5">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-mocha uppercase tracking-wide">Retail Price (₹) *</label>
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={form.retail_price}
                      onChange={set("retail_price")}
                      placeholder="320"
                      className="h-11 border border-line rounded-xl px-3 text-sm outline-none focus:border-brick bg-white"
                      data-testid="product-retail-price-input"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-mocha uppercase tracking-wide">Wholesale (₹) *</label>
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={form.wholesale_price}
                      onChange={set("wholesale_price")}
                      placeholder="270"
                      className="h-11 border border-line rounded-xl px-3 text-sm outline-none focus:border-brick bg-white"
                      data-testid="product-wholesale-price-input"
                    />
                  </div>
                </div>

                {/* Purchase Price */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-mocha uppercase tracking-wide flex items-center gap-1.5">
                    Purchase Price (₹)
                    <span className="text-[10px] font-normal text-mocha bg-chip px-1.5 py-0.5 rounded-md">Admin only · for profit tracking</span>
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.purchase_price}
                    onChange={set("purchase_price")}
                    placeholder="200 (what you paid the supplier)"
                    className="h-11 border border-line rounded-xl px-3 text-sm outline-none focus:border-brick bg-white"
                    data-testid="product-purchase-price-input"
                  />
                </div>

                {/* HSN + Stock */}
                <div className="grid grid-cols-2 gap-2.5">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-mocha uppercase tracking-wide">HSN Code</label>
                    <input
                      type="text"
                      value={form.hsn}
                      onChange={set("hsn")}
                      placeholder="3604"
                      className="h-11 border border-line rounded-xl px-3 text-sm outline-none focus:border-brick bg-white"
                      data-testid="product-hsn-input"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-mocha uppercase tracking-wide">{isEdit ? "Stock" : "Initial Stock"}</label>
                    <input
                      type="number"
                      min="0"
                      value={form.stock}
                      onChange={set("stock")}
                      placeholder="0"
                      className="h-11 border border-line rounded-xl px-3 text-sm outline-none focus:border-brick bg-white"
                      data-testid="product-stock-input"
                    />
                  </div>
                </div>

                {/* Barcode — editable for both add and edit */}
                <div className="flex flex-col gap-1.5 border-t border-line pt-3">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-mocha uppercase tracking-wide">Barcode</label>
                    {isEdit && onPrintLabel && (
                      <button
                        type="button"
                        onClick={() => onPrintLabel({ ...product, barcode: form.barcode || product?.barcode })}
                        className="flex items-center gap-1 text-xs font-bold text-brick hover:underline"
                        data-testid="edit-product-print-label-btn"
                      >
                        <Printer size={12} /> Print Label
                      </button>
                    )}
                  </div>
                  <div className="relative">
                    <input
                      type="text"
                      value={form.barcode}
                      onChange={set("barcode")}
                      placeholder={isEdit ? "Enter new barcode to override" : "e.g. 8906012345678 — leave blank to auto-generate"}
                      className={`h-11 border rounded-xl px-3 pr-10 text-sm outline-none bg-white w-full font-mono tracking-wide transition-colors ${
                        barcodeCheck.status === "duplicate"
                          ? "border-amber-400 focus:border-amber-500"
                          : barcodeCheck.status === "ok" && form.barcode
                          ? "border-[#1F5F36] focus:border-[#1F5F36]"
                          : "border-line focus:border-brick"
                      }`}
                      data-testid="product-barcode-input"
                      autoComplete="off"
                    />
                    {form.barcode && (
                      <button
                        type="button"
                        onClick={() => setForm((f) => ({ ...f, barcode: "" }))}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-mocha hover:text-ink transition-colors"
                        data-testid="product-barcode-clear"
                        title="Clear barcode"
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>

                  {/* Status indicator */}
                  {barcodeCheck.status === "checking" && (
                    <p className="text-xs text-mocha flex items-center gap-1.5" data-testid="barcode-checking">
                      <span className="inline-block w-3 h-3 border-2 border-mocha border-t-transparent rounded-full animate-spin" />
                      Checking barcode…
                    </p>
                  )}
                  {barcodeCheck.status === "duplicate" && (
                    <div className="flex items-start gap-2 bg-amber-50 border border-amber-300 rounded-xl px-3 py-2" data-testid="barcode-duplicate-warning">
                      <span className="text-amber-600 mt-0.5 flex-none text-xs">⚠</span>
                      <p className="text-xs text-amber-800">
                        <span className="font-bold">Barcode already in use</span> — currently assigned to{" "}
                        <span className="font-bold">"{barcodeCheck.product?.name}"</span>.
                        Enter a different barcode or clear the field to auto-generate a unique one.
                      </p>
                    </div>
                  )}
                  {barcodeCheck.status === "ok" && form.barcode && (
                    <p className="text-xs text-[#1F5F36] font-bold flex items-center gap-1" data-testid="barcode-available">
                      <span>✓</span> Barcode is available
                    </p>
                  )}
                  {barcodeCheck.status === "idle" && (
                    <p className="text-xs text-mocha">
                      {isEdit
                        ? "Leave blank to keep the current barcode. Enter a value to override it."
                        : "Leave blank to auto-generate a unique barcode."}
                    </p>
                  )}
                </div>

                {error && (
                  <div className="bg-[#FDE3DE] text-maroon rounded-xl px-3 py-2 text-sm" data-testid="product-modal-error">{error}</div>
                )}
              </div>

              {/* Footer */}
              <div className="px-5 py-4 border-t border-line flex items-center gap-2 flex-none">
                {isEdit && (
                  confirmDelete ? (
                    <div className="flex items-center gap-2 flex-1">
                      <span className="text-xs text-maroon font-bold">Delete this product?</span>
                      <button
                        type="button"
                        onClick={handleDelete}
                        disabled={busy}
                        className="h-9 px-3 rounded-xl bg-maroon text-white font-bold text-xs disabled:opacity-60"
                        data-testid="product-delete-confirm"
                      >
                        Yes, delete
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(false)}
                        className="h-9 px-3 rounded-xl border border-line text-mocha font-bold text-xs"
                        data-testid="product-delete-cancel"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(true)}
                      className="h-9 px-3 rounded-xl border border-[#D9534F] text-maroon font-bold text-xs hover:bg-[#FDE3DE] transition-colors flex-none"
                      data-testid="product-delete-btn"
                    >
                      Delete
                    </button>
                  )
                )}
                <div className="flex gap-2 ml-auto">
                  <button
                    type="button"
                    onClick={onClose}
                    className="h-11 px-5 rounded-xl border border-line text-ink font-bold text-sm hover:bg-chip transition-colors"
                    data-testid="product-modal-cancel"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={busy}
                    className="h-11 px-6 rounded-xl bg-brick text-white font-bold text-sm disabled:opacity-60"
                    data-testid="product-modal-save"
                  >
                    {busy ? "Saving…" : (isEdit ? "Save changes" : "Add product")}
                  </button>
                </div>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
