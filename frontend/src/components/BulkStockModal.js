import { useState, useRef, useCallback } from "react";
import { X, Upload, Download, CheckCircle, AlertCircle, FileText } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import api, { apiError } from "@/lib/api";

// Simple 2-column CSV parser — handles header row, trims quotes
function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return null;
  const headers = lines[0].split(",").map((h) => h.trim().replace(/^["']|["']$/g, "").toLowerCase());
  const nameIdx = headers.findIndex((h) => h === "name" || h === "product");
  const stockIdx = headers.findIndex((h) => h === "stock" || h === "qty" || h === "quantity");
  if (nameIdx === -1 || stockIdx === -1) return null;
  return lines
    .slice(1)
    .filter((l) => l.trim())
    .map((l) => {
      const cols = l.split(",").map((c) => c.trim().replace(/^["']|["']$/g, ""));
      return { name: cols[nameIdx] ?? "", stock: cols[stockIdx] ?? "" };
    });
}

export default function BulkStockModal({ onClose }) {
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

  // Download pre-filled template
  const downloadTemplate = () => {
    const lines = ["name,stock", ...products.map((p) => `${p.name},${p.stock}`)];
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "stock_template.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const processFile = useCallback(
    (file) => {
      setError("");
      if (!file) return;
      if (!file.name.toLowerCase().endsWith(".csv")) {
        setError("Please upload a .csv file");
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        const rows = parseCSV(e.target.result);
        if (!rows) {
          setError("CSV must have 'name' and 'stock' column headers in the first row");
          return;
        }
        const productMap = {};
        products.forEach((p) => { productMap[p.name.trim().toLowerCase()] = p; });

        const previewRows = rows.map((r) => {
          const matched = productMap[r.name.trim().toLowerCase()] ?? null;
          const stockNum = parseInt(r.stock, 10);
          return { name: r.name, matched, newStockRaw: r.stock, stockNum: isNaN(stockNum) ? null : stockNum, valid: !isNaN(stockNum) && stockNum >= 0 };
        });

        setPreview(previewRows);
        setFileObj(file);
        setPhase("preview");
      };
      reader.readAsText(file);
    },
    [products]
  );

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault();
      setDragOver(false);
      processFile(e.dataTransfer.files[0]);
    },
    [processFile]
  );

  const applyChanges = async () => {
    if (!fileObj) return;
    setBusy(true);
    setError("");
    try {
      const formData = new FormData();
      formData.append("file", fileObj);
      const { data } = await api.post("/admin/products/bulk-stock", formData, {
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

  const validCount = preview.filter((r) => r.matched && r.valid).length;
  const notFoundCount = preview.filter((r) => !r.matched).length;
  const badCount = preview.filter((r) => r.matched && !r.valid).length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-ink/40"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-cream w-full sm:max-w-lg rounded-t-3xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-line flex-none">
          <h2 className="font-display font-bold text-lg" data-testid="bulk-modal-title">Bulk Stock Import</h2>
          <button onClick={onClose} className="w-9 h-9 rounded-xl border border-line flex items-center justify-center text-mocha hover:text-ink transition-colors" data-testid="bulk-modal-close">
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4 flex flex-col gap-4">

          {/* ── Phase: upload ── */}
          {phase === "upload" && (
            <>
              {/* Download template */}
              <div className="bg-white border border-line rounded-2xl p-4 flex gap-3">
                <FileText size={18} className="text-mocha flex-none mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-sm mb-0.5">Step 1 — Download the template</div>
                  <div className="text-xs text-mocha mb-3">Pre-filled with your {products.length} products and their current stock. Edit the Stock column, then save as CSV.</div>
                  <button
                    onClick={downloadTemplate}
                    className="h-9 px-4 rounded-xl border border-brick text-brick font-bold text-[13px] flex items-center gap-2 hover:bg-brick/5 transition-colors"
                    data-testid="download-template-btn"
                  >
                    <Download size={14} /> Download template.csv
                  </button>
                </div>
              </div>

              {/* Drop zone */}
              <div>
                <div className="font-bold text-sm mb-2">Step 2 — Upload your updated file</div>
                <div
                  onDrop={handleDrop}
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onClick={() => fileInputRef.current?.click()}
                  className={"border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-colors select-none " +
                    (dragOver ? "border-brick bg-brick/5" : "border-line bg-white hover:border-brick hover:bg-brick/5")}
                  data-testid="csv-drop-zone"
                >
                  <Upload size={28} className="mx-auto text-mocha mb-2" />
                  <div className="font-bold text-sm">Drop your CSV here, or click to browse</div>
                  <div className="text-xs text-mocha mt-1">Columns required: <span className="font-mono bg-chip px-1 rounded">name</span> and <span className="font-mono bg-chip px-1 rounded">stock</span></div>
                  <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={(e) => processFile(e.target.files[0])} data-testid="csv-file-input" />
                </div>
              </div>

              {error && <div className="bg-[#FDE3DE] text-maroon rounded-xl px-3 py-2 text-sm" data-testid="bulk-error">{error}</div>}
            </>
          )}

          {/* ── Phase: preview ── */}
          {phase === "preview" && (
            <>
              {/* Summary badges */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-bold rounded-full px-2.5 py-1 bg-[#DDF1E3] text-[#1F5F36]" data-testid="preview-valid-count">{validCount} to update</span>
                {notFoundCount > 0 && <span className="text-xs font-bold rounded-full px-2.5 py-1 bg-[#FFF0C9] text-[#5C3F00]" data-testid="preview-notfound-count">{notFoundCount} not found</span>}
                {badCount > 0 && <span className="text-xs font-bold rounded-full px-2.5 py-1 bg-[#FDE3DE] text-maroon">{badCount} invalid</span>}
              </div>

              {/* Preview table */}
              <div className="bg-white border border-line rounded-2xl overflow-hidden" data-testid="preview-table">
                <div className="grid grid-cols-[1fr_72px_72px] px-4 py-2 bg-chip text-xs font-bold text-mocha border-b border-line">
                  <span>Product</span>
                  <span className="text-center">Current</span>
                  <span className="text-center">New</span>
                </div>
                <div className="divide-y divide-[#F1E2CC] max-h-[260px] overflow-y-auto">
                  {preview.map((row, i) => (
                    <div
                      key={`${row.name}-${i}`}
                      className={"grid grid-cols-[1fr_72px_72px] px-4 py-2.5 text-sm items-center " + (!row.matched || !row.valid ? "opacity-50" : "")}
                      data-testid={`preview-row-${i}`}
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        {row.matched && row.valid
                          ? <CheckCircle size={14} className="text-[#1F5F36] flex-none" />
                          : <AlertCircle size={14} className="text-maroon flex-none" />}
                        <span className="truncate font-medium">{row.name}</span>
                        {!row.matched && <span className="text-[11px] text-mocha ml-1 flex-none">(not found)</span>}
                      </div>
                      <span className="text-center text-mocha">{row.matched ? row.matched.stock : "—"}</span>
                      <span className={"text-center font-bold " + (row.valid ? "text-ink" : "text-maroon text-xs")}>
                        {row.valid ? row.stockNum : "invalid"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {error && <div className="bg-[#FDE3DE] text-maroon rounded-xl px-3 py-2 text-sm" data-testid="bulk-error">{error}</div>}

              <div className="flex gap-2">
                <button onClick={reset} className="h-11 px-5 rounded-xl border border-line text-ink font-bold text-sm hover:bg-chip transition-colors" data-testid="bulk-back-btn">
                  Back
                </button>
                <button
                  onClick={applyChanges}
                  disabled={busy || validCount === 0}
                  className="flex-1 h-11 rounded-xl bg-brick text-white font-bold text-sm disabled:opacity-50"
                  data-testid="bulk-apply-btn"
                >
                  {busy ? "Importing…" : `Apply ${validCount} update${validCount !== 1 ? "s" : ""}`}
                </button>
              </div>
            </>
          )}

          {/* ── Phase: results ── */}
          {phase === "results" && results && (
            <>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-bold rounded-full px-2.5 py-1 bg-[#DDF1E3] text-[#1F5F36]" data-testid="result-updated-count">{results.updated.length} updated</span>
                {results.not_found.length > 0 && <span className="text-xs font-bold rounded-full px-2.5 py-1 bg-[#FFF0C9] text-[#5C3F00]">{results.not_found.length} not found</span>}
                {results.errors.length > 0 && <span className="text-xs font-bold rounded-full px-2.5 py-1 bg-[#FDE3DE] text-maroon">{results.errors.length} errors</span>}
              </div>

              {results.updated.length > 0 && (
                <div className="bg-white border border-line rounded-2xl overflow-hidden" data-testid="results-table">
                  <div className="grid grid-cols-[1fr_72px_72px] px-4 py-2 bg-chip text-xs font-bold text-mocha border-b border-line">
                    <span>Product</span>
                    <span className="text-center">Before</span>
                    <span className="text-center">After</span>
                  </div>
                  <div className="divide-y divide-[#F1E2CC] max-h-[260px] overflow-y-auto">
                    {results.updated.map((r, i) => (
                      <div key={`${r.name}-${i}`} className="grid grid-cols-[1fr_72px_72px] px-4 py-2.5 text-sm items-center" data-testid={`result-row-${i}`}>
                        <div className="flex items-center gap-1.5 min-w-0">
                          <CheckCircle size={14} className="text-[#1F5F36] flex-none" />
                          <span className="truncate font-medium">{r.name}</span>
                        </div>
                        <span className="text-center text-mocha">{r.old_stock}</span>
                        <span className="text-center font-bold text-[#1F5F36]">{r.new_stock}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {(results.not_found.length > 0 || results.errors.length > 0) && (
                <div className="bg-[#FDE3DE] rounded-xl p-3 text-sm text-maroon flex flex-col gap-1">
                  {results.not_found.map((r, i) => <div key={`nf-${r.name}-${i}`}>"{r.name}" — not found in catalog</div>)}
                  {results.errors.map((r, i) => <div key={`err-${r.name}-${i}`}>"{r.name}" — {r.error}</div>)}
                </div>
              )}

              <button onClick={onClose} className="h-11 w-full rounded-xl bg-brick text-white font-bold text-sm" data-testid="bulk-done-btn">
                Done
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
