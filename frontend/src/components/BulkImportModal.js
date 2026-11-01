import { useState, useRef, useCallback } from "react";
import { X, Upload, Download, CheckCircle, AlertCircle, FileText, Plus, RefreshCw } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import api, { apiError } from "@/lib/api";

const COLUMNS = ["name", "category", "brand", "pack_type", "pack_size", "retail_price", "wholesale_price", "stock", "hsn", "icon"];
const REQUIRED = ["name", "retail_price"];
const ICONS = ["anar", "fulzadi", "rocket", "ladi", "bomb", "chakkar", "sparkler", "flower"];

function parseImportCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return null;
  const headers = lines[0].split(",").map((h) => h.trim().replace(/^["']|["']$/g, "").toLowerCase());
  const nameIdx = headers.findIndex((h) => ["name", "product", "product name"].includes(h));
  const priceIdx = headers.findIndex((h) => ["retail_price", "retail price", "price"].includes(h));
  if (nameIdx === -1 || priceIdx === -1) return null;

  const colIdx = (keys) => {
    for (const k of keys) {
      const i = headers.indexOf(k);
      if (i !== -1) return i;
    }
    return -1;
  };

  const idxMap = {
    name: nameIdx,
    retail_price: priceIdx,
    category: colIdx(["category"]),
    brand: colIdx(["brand"]),
    pack_type: colIdx(["pack_type", "pack type"]),
    pack_size: colIdx(["pack_size", "pack size"]),
    wholesale_price: colIdx(["wholesale_price", "wholesale price"]),
    stock: colIdx(["stock", "qty", "quantity"]),
    hsn: colIdx(["hsn"]),
    icon: colIdx(["icon"]),
  };

  return lines.slice(1).filter((l) => l.trim()).map((line) => {
    // Handle quoted fields with commas
    const cols = [];
    let cur = "", inQ = false;
    for (const ch of line) {
      if (ch === '"') { inQ = !inQ; }
      else if (ch === "," && !inQ) { cols.push(cur.trim()); cur = ""; }
      else { cur += ch; }
    }
    cols.push(cur.trim());

    const get = (key) => {
      const i = idxMap[key];
      return i !== -1 ? (cols[i] ?? "").trim().replace(/^["']|["']$/g, "") : "";
    };

    return {
      name: get("name"),
      retail_price: get("retail_price"),
      category: get("category"),
      brand: get("brand"),
      pack_type: get("pack_type"),
      pack_size: get("pack_size"),
      wholesale_price: get("wholesale_price"),
      stock: get("stock"),
      hsn: get("hsn"),
      icon: get("icon"),
    };
  });
}

export default function BulkImportModal({ onClose }) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef(null);

  const [dragOver, setDragOver] = useState(false);
  const [phase, setPhase] = useState("upload"); // upload | preview | results
  const [preview, setPreview] = useState([]);
  const [fileObj, setFileObj] = useState(null);
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: () => api.get("/products").then((r) => r.data),
  });

  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: () => api.get("/categories").then((r) => r.data),
  });

  // Download CSV template with headers + 2 sample rows
  const downloadTemplate = () => {
    const catNames = categories.map((c) => c.name).join(" / ");
    const sample1 = `Wala 25 shots,Anar,SuperBrand,Box,1 pc,250,200,10,3604,anar`;
    const sample2 = `Red Rose Sparkler,Fulzadi,BrandX,Packet,10 pcs,80,60,50,3604,fulzadi`;
    const lines = [
      COLUMNS.join(","),
      sample1,
      sample2,
    ];
    const notes = [
      ``,
      `# --- REFERENCE (delete these lines before uploading) ---`,
      `# Required columns: name  retail_price`,
      `# Available categories: ${catNames || "Add categories first in Admin Dashboard"}`,
      `# Available icons: ${ICONS.join(" / ")}`,
      `# wholesale_price defaults to 85% of retail_price if left blank`,
      `# stock defaults to 0 if left blank`,
    ];
    const blob = new Blob([[...lines, ...notes].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "product_import_template.csv";
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  };

  const processFile = useCallback((file) => {
    setError("");
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv")) { setError("Please upload a .csv file"); return; }

    const reader = new FileReader();
    reader.onload = (e) => {
      const rows = parseImportCSV(e.target.result);
      if (!rows) { setError("CSV must have 'name' and 'retail_price' column headers"); return; }

      const productMap = {};
      products.forEach((p) => { productMap[p.name.trim().toLowerCase()] = p; });

      const previewRows = rows
        .filter((r) => r.name)
        .map((r) => {
          const existing = productMap[r.name.trim().toLowerCase()] ?? null;
          const price = parseFloat(r.retail_price);
          const valid = !isNaN(price) && price > 0;
          return { ...r, existing, valid, action: valid ? (existing ? "update" : "create") : "skip" };
        });

      setPreview(previewRows);
      setFileObj(file);
      setPhase("preview");
    };
    reader.readAsText(file);
  }, [products]);

  const handleDrop = useCallback((e) => {
    e.preventDefault(); setDragOver(false);
    processFile(e.dataTransfer.files[0]);
  }, [processFile]);

  const applyImport = async () => {
    if (!fileObj) return;
    setBusy(true); setError("");
    try {
      const formData = new FormData();
      formData.append("file", fileObj);
      const { data } = await api.post("/admin/products/bulk-import", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["admin-stats"] });
      setResults(data);
      setPhase("results");
    } catch (err) {
      setError(apiError(err));
    } finally {
      setBusy(false);
    }
  };

  const reset = () => { setPhase("upload"); setPreview([]); setFileObj(null); setResults(null); setError(""); };

  const toCreate = preview.filter((r) => r.action === "create").length;
  const toUpdate = preview.filter((r) => r.action === "update").length;
  const toSkip   = preview.filter((r) => r.action === "skip").length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-ink/40"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-cream w-full sm:max-w-xl rounded-t-3xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-line flex-none">
          <div>
            <h2 className="font-display font-bold text-lg" data-testid="import-modal-title">Import Products</h2>
            <p className="text-xs text-mocha mt-0.5">Creates new products or updates existing ones by name</p>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-xl border border-line flex items-center justify-center text-mocha hover:text-ink transition-colors" data-testid="import-modal-close">
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4 flex flex-col gap-4">

          {/* ── Phase: upload ── */}
          {phase === "upload" && (
            <>
              {/* Template download */}
              <div className="bg-white border border-line rounded-2xl p-4 flex gap-3">
                <FileText size={18} className="text-mocha flex-none mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-sm mb-0.5">Step 1 — Download the template</div>
                  <div className="text-xs text-mocha mb-3">
                    Includes correct column headers and 2 sample rows. Fill in your products, delete sample rows, upload.
                  </div>
                  <button
                    onClick={downloadTemplate}
                    className="h-9 px-4 rounded-xl border border-brick text-brick font-bold text-[13px] flex items-center gap-2 hover:bg-brick/5 transition-colors"
                    data-testid="import-download-template-btn"
                  >
                    <Download size={14} /> Download template.csv
                  </button>
                </div>
              </div>

              {/* Column reference */}
              <div className="bg-white border border-line rounded-2xl p-4">
                <div className="font-bold text-sm mb-2">Column reference</div>
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {COLUMNS.map((col) => (
                    <span key={col} className={"text-[11px] font-mono rounded-lg px-2 py-1 " +
                      (REQUIRED.includes(col) ? "bg-brick/10 text-brick font-bold border border-brick/20" : "bg-chip text-mocha")}>
                      {col}{REQUIRED.includes(col) ? " *" : ""}
                    </span>
                  ))}
                </div>
                <div className="text-[11px] text-mocha"><span className="text-brick font-bold">*</span> Required. All others are optional.</div>

                {/* Available categories */}
                {categories.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-line">
                    <div className="text-[11px] font-bold text-mocha mb-1.5">Available categories</div>
                    <div className="flex flex-wrap gap-1">
                      {categories.map((c) => (
                        <span key={c.id} className="text-[11px] bg-chip text-ink font-medium rounded-lg px-2 py-0.5">{c.name}</span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Available icons */}
                <div className="mt-3 pt-3 border-t border-line">
                  <div className="text-[11px] font-bold text-mocha mb-1.5">Available icon values</div>
                  <div className="flex flex-wrap gap-1">
                    {ICONS.map((ic) => (
                      <span key={ic} className="text-[11px] font-mono bg-chip text-mocha rounded-lg px-2 py-0.5">{ic}</span>
                    ))}
                  </div>
                </div>
              </div>

              {/* Drop zone */}
              <div>
                <div className="font-bold text-sm mb-2">Step 2 — Upload your CSV</div>
                <div
                  onDrop={handleDrop}
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onClick={() => fileInputRef.current?.click()}
                  className={"border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-colors select-none " +
                    (dragOver ? "border-brick bg-brick/5" : "border-line bg-white hover:border-brick hover:bg-brick/5")}
                  data-testid="import-drop-zone"
                >
                  <Upload size={28} className="mx-auto text-mocha mb-2" />
                  <div className="font-bold text-sm">Drop your CSV here, or click to browse</div>
                  <div className="text-xs text-mocha mt-1">Required columns: <span className="font-mono bg-chip px-1 rounded">name</span> and <span className="font-mono bg-chip px-1 rounded">retail_price</span></div>
                  <input ref={fileInputRef} type="file" accept=".csv" className="hidden"
                    onChange={(e) => processFile(e.target.files[0])} data-testid="import-file-input" />
                </div>
              </div>

              {error && <div className="bg-[#FDE3DE] text-maroon rounded-xl px-3 py-2 text-sm" data-testid="import-error">{error}</div>}
            </>
          )}

          {/* ── Phase: preview ── */}
          {phase === "preview" && (
            <>
              {/* Summary badges */}
              <div className="flex items-center gap-2 flex-wrap">
                {toCreate > 0 && (
                  <span className="text-xs font-bold rounded-full px-2.5 py-1 bg-[#DDF1E3] text-[#1F5F36] flex items-center gap-1" data-testid="preview-create-count">
                    <Plus size={11} /> {toCreate} new
                  </span>
                )}
                {toUpdate > 0 && (
                  <span className="text-xs font-bold rounded-full px-2.5 py-1 bg-[#E1EAFB] text-[#1F3F7A] flex items-center gap-1" data-testid="preview-update-count">
                    <RefreshCw size={11} /> {toUpdate} update
                  </span>
                )}
                {toSkip > 0 && (
                  <span className="text-xs font-bold rounded-full px-2.5 py-1 bg-[#FDE3DE] text-maroon" data-testid="preview-skip-count">
                    {toSkip} skipped
                  </span>
                )}
              </div>

              {/* Preview table */}
              <div className="bg-white border border-line rounded-2xl overflow-hidden" data-testid="import-preview-table">
                <div className="grid grid-cols-[1fr_80px_80px_72px] px-4 py-2 bg-chip text-xs font-bold text-mocha border-b border-line">
                  <span>Name</span>
                  <span className="text-center">Retail ₹</span>
                  <span className="text-center">Category</span>
                  <span className="text-center">Action</span>
                </div>
                <div className="divide-y divide-[#F1E2CC] max-h-[280px] overflow-y-auto">
                  {preview.map((row, i) => (
                    <div
                      key={`${row.name}-${i}`}
                      className={"grid grid-cols-[1fr_80px_80px_72px] px-4 py-2.5 text-sm items-center " + (row.action === "skip" ? "opacity-40" : "")}
                      data-testid={`import-preview-row-${i}`}
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        {row.action === "skip"
                          ? <AlertCircle size={13} className="text-maroon flex-none" />
                          : <CheckCircle size={13} className="text-[#1F5F36] flex-none" />}
                        <span className="truncate font-medium">{row.name}</span>
                      </div>
                      <span className="text-center text-mocha text-xs">{row.retail_price || "—"}</span>
                      <span className="text-center text-xs text-mocha truncate">{row.category || "—"}</span>
                      <span className={"text-center text-[11px] font-bold rounded-full px-2 py-0.5 " +
                        (row.action === "create" ? "bg-[#DDF1E3] text-[#1F5F36]" :
                         row.action === "update" ? "bg-[#E1EAFB] text-[#1F3F7A]" :
                         "bg-[#FDE3DE] text-maroon")}>
                        {row.action === "create" ? "New" : row.action === "update" ? "Update" : "Skip"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {error && <div className="bg-[#FDE3DE] text-maroon rounded-xl px-3 py-2 text-sm" data-testid="import-error">{error}</div>}

              <div className="flex gap-2">
                <button onClick={reset} className="h-11 px-5 rounded-xl border border-line text-ink font-bold text-sm hover:bg-chip transition-colors" data-testid="import-back-btn">
                  Back
                </button>
                <button
                  onClick={applyImport}
                  disabled={busy || (toCreate + toUpdate === 0)}
                  className="flex-1 h-11 rounded-xl bg-brick text-white font-bold text-sm disabled:opacity-50"
                  data-testid="import-apply-btn"
                >
                  {busy ? "Importing…" : `Import ${toCreate + toUpdate} product${toCreate + toUpdate !== 1 ? "s" : ""}`}
                </button>
              </div>
            </>
          )}

          {/* ── Phase: results ── */}
          {phase === "results" && results && (
            <>
              <div className="flex items-center gap-2 flex-wrap">
                {results.created.length > 0 && (
                  <span className="text-xs font-bold rounded-full px-2.5 py-1 bg-[#DDF1E3] text-[#1F5F36]" data-testid="result-created-count">
                    {results.created.length} created
                  </span>
                )}
                {results.updated.length > 0 && (
                  <span className="text-xs font-bold rounded-full px-2.5 py-1 bg-[#E1EAFB] text-[#1F3F7A]" data-testid="result-updated-count">
                    {results.updated.length} updated
                  </span>
                )}
                {results.skipped.length > 0 && (
                  <span className="text-xs font-bold rounded-full px-2.5 py-1 bg-[#FDE3DE] text-maroon">
                    {results.skipped.length} skipped
                  </span>
                )}
              </div>

              {(results.created.length > 0 || results.updated.length > 0) && (
                <div className="bg-white border border-line rounded-2xl overflow-hidden" data-testid="import-results-table">
                  <div className="grid grid-cols-[1fr_80px] px-4 py-2 bg-chip text-xs font-bold text-mocha border-b border-line">
                    <span>Product</span>
                    <span className="text-center">Result</span>
                  </div>
                  <div className="divide-y divide-[#F1E2CC] max-h-[280px] overflow-y-auto">
                    {results.created.map((r, i) => (
                      <div key={`c-${i}`} className="grid grid-cols-[1fr_80px] px-4 py-2.5 text-sm items-center" data-testid={`result-created-${i}`}>
                        <div className="flex items-center gap-1.5 min-w-0">
                          <Plus size={13} className="text-[#1F5F36] flex-none" />
                          <span className="truncate font-medium">{r.name}</span>
                        </div>
                        <span className="text-center text-[11px] font-bold bg-[#DDF1E3] text-[#1F5F36] rounded-full px-2 py-0.5">Created</span>
                      </div>
                    ))}
                    {results.updated.map((r, i) => (
                      <div key={`u-${i}`} className="grid grid-cols-[1fr_80px] px-4 py-2.5 text-sm items-center" data-testid={`result-updated-${i}`}>
                        <div className="flex items-center gap-1.5 min-w-0">
                          <RefreshCw size={13} className="text-[#1F3F7A] flex-none" />
                          <span className="truncate font-medium">{r.name}</span>
                        </div>
                        <span className="text-center text-[11px] font-bold bg-[#E1EAFB] text-[#1F3F7A] rounded-full px-2 py-0.5">Updated</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {results.skipped.length > 0 && (
                <div className="bg-[#FDE3DE] rounded-xl p-3 text-sm text-maroon flex flex-col gap-1">
                  {results.skipped.map((r, i) => (
                    <div key={i}>"{r.name}" — {r.reason}</div>
                  ))}
                </div>
              )}

              <button onClick={onClose} className="h-11 w-full rounded-xl bg-brick text-white font-bold text-sm" data-testid="import-done-btn">
                Done
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
