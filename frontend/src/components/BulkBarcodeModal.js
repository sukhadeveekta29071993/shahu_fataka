import { useState, useRef, useCallback } from "react";
import { X, Upload, Download, CheckCircle, AlertCircle, FileText, RefreshCw, ScanBarcode } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import api, { apiError } from "@/lib/api";

// ── CSV parsing ───────────────────────────────────────────────────────────────
function splitLine(line) {
  const cols = []; let cur = "", inQ = false;
  for (const ch of line) {
    if (ch === '"') { inQ = !inQ; }
    else if (ch === "," && !inQ) { cols.push(cur.trim().replace(/^["']|["']$/g, "")); cur = ""; }
    else { cur += ch; }
  }
  cols.push(cur.trim().replace(/^["']|["']$/g, ""));
  return cols;
}

function parseBarcodeCSV(text) {
  const lines = text.trim().split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return null;
  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase().replace(/^["']|["']$/g, ""));
  const nameIdx    = headers.findIndex((h) => ["name", "product", "product name"].includes(h));
  const barcodeIdx = headers.findIndex((h) => ["barcode", "barcode_number", "ean", "upc", "code"].includes(h));
  if (nameIdx === -1 || barcodeIdx === -1) return null;
  return lines.slice(1).map((l) => {
    const cols = splitLine(l);
    return {
      name:    (cols[nameIdx]    ?? "").trim(),
      barcode: (cols[barcodeIdx] ?? "").trim(),
    };
  }).filter((r) => r.name);
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function BulkBarcodeModal({ onClose }) {
  const queryClient  = useQueryClient();
  const fileInputRef = useRef(null);

  const [dragOver, setDragOver] = useState(false);
  const [phase,    setPhase]    = useState("upload"); // upload | preview | results
  const [preview,  setPreview]  = useState([]);
  const [fileObj,  setFileObj]  = useState(null);
  const [results,  setResults]  = useState(null);
  const [busy,     setBusy]     = useState(false);
  const [error,    setError]    = useState("");

  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: () => api.get("/products").then((r) => r.data),
  });

  // Download template
  const downloadTemplate = () => {
    const sample = products.slice(0, 3).map((p) => `${p.name},${p.barcode || ""}`).join("\n")
      || "10 K (A),8901234567890\nAnar Big 5pcs,8906789012345";
    const csv = `name,barcode\n${sample}\n\n# -- REFERENCE (delete before uploading) --\n# Column 'name' must exactly match the product name in CrackerPOS.\n# Column 'barcode' is the manufacturer's barcode (EAN-13, UPC, Code128, etc.).\n# Leave barcode blank for a row to skip it.\n# Products not found by name will be skipped with a reason shown.`;
    const blob = new Blob([csv], { type: "text/csv" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = "barcode_assign_template.csv";
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  };

  // Client-side preview
  const processFile = useCallback((file) => {
    setError("");
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv")) { setError("Please upload a .csv file"); return; }

    const reader = new FileReader();
    reader.onload = (e) => {
      const rows = parseBarcodeCSV(e.target.result);
      if (!rows) { setError("CSV must have 'name' and 'barcode' column headers"); return; }

      const nameMap    = {};
      const barcodeMap = {};
      products.forEach((p) => {
        nameMap[p.name.trim().toLowerCase()] = p;
        if (p.barcode) barcodeMap[p.barcode.trim()] = p;
      });

      const previewRows = rows.map((r) => {
        if (!r.barcode) return { ...r, action: "skip", reason: "No barcode provided" };
        const product = nameMap[r.name.trim().toLowerCase()];
        if (!product)  return { ...r, action: "skip", reason: "Product not found" };
        const dup = barcodeMap[r.barcode.trim()];
        if (dup && dup.id !== product.id) return { ...r, action: "skip", reason: `Barcode used by "${dup.name}"` };
        return { ...r, action: "update", currentBarcode: product.barcode };
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

  const applyUpdate = async () => {
    if (!fileObj) return;
    setBusy(true); setError("");
    try {
      const formData = new FormData();
      formData.append("file", fileObj);
      const { data } = await api.post("/admin/products/bulk-barcode", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      queryClient.invalidateQueries({ queryKey: ["products"] });
      setResults(data);
      setPhase("results");
    } catch (err) {
      setError(apiError(err));
    } finally {
      setBusy(false);
    }
  };

  const reset = () => { setPhase("upload"); setPreview([]); setFileObj(null); setResults(null); setError(""); };

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
            <h2 className="font-display font-bold text-lg flex items-center gap-2" data-testid="barcode-assign-modal-title">
              <ScanBarcode size={18} className="text-brick" /> Assign Barcodes
            </h2>
            <p className="text-xs text-mocha mt-0.5">Upload a CSV to batch-assign manufacturer barcodes to your products</p>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-xl border border-line flex items-center justify-center text-mocha hover:text-ink transition-colors"
            data-testid="barcode-assign-modal-close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4 flex flex-col gap-4">

          {/* ── Phase: upload ──────────────────────────────────────────── */}
          {phase === "upload" && (
            <>
              {/* Template step */}
              <div className="bg-white border border-line rounded-2xl p-4 flex gap-3">
                <FileText size={18} className="text-mocha flex-none mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-sm mb-0.5">Step 1 — Download the template</div>
                  <div className="text-xs text-mocha mb-3">
                    Pre-filled with your current product names. Add the manufacturer barcode next to each product, then upload.
                  </div>
                  <button
                    onClick={downloadTemplate}
                    className="h-9 px-4 rounded-xl border border-brick text-brick font-bold text-[13px] flex items-center gap-2 hover:bg-brick/5 transition-colors"
                    data-testid="barcode-assign-download-template"
                  >
                    <Download size={14} /> Download template.csv
                  </button>
                </div>
              </div>

              {/* Column reference */}
              <div className="bg-white border border-line rounded-2xl p-4">
                <div className="font-bold text-sm mb-2">Column reference</div>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {[["name", true], ["barcode", true]].map(([col, req]) => (
                    <span key={col} className={"text-[11px] font-mono rounded-lg px-2 py-1 " +
                      (req ? "bg-brick/10 text-brick font-bold border border-brick/20" : "bg-chip text-mocha")}>
                      {col}{req ? " *" : ""}
                    </span>
                  ))}
                </div>
                <div className="text-[11px] text-mocha space-y-1">
                  <div><span className="text-brick font-bold">*</span> Both columns are required.</div>
                  <div>The <span className="font-mono bg-chip px-1 rounded">name</span> must exactly match a product name in CrackerPOS.</div>
                  <div>Accepted barcode formats: EAN-13, UPC-A, Code128 (any alphanumeric string).</div>
                  <div>Duplicate barcodes (already assigned to a different product) will be skipped with a reason.</div>
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
                  data-testid="barcode-assign-drop-zone"
                >
                  <Upload size={28} className="mx-auto text-mocha mb-2" />
                  <div className="font-bold text-sm">Drop your CSV here, or click to browse</div>
                  <div className="text-xs text-mocha mt-1">
                    Required columns: <span className="font-mono bg-chip px-1 rounded">name</span> and{" "}
                    <span className="font-mono bg-chip px-1 rounded">barcode</span>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv"
                    className="hidden"
                    onChange={(e) => processFile(e.target.files[0])}
                    data-testid="barcode-assign-file-input"
                  />
                </div>
              </div>

              {error && <div className="bg-[#FDE3DE] text-maroon rounded-xl px-3 py-2 text-sm" data-testid="barcode-assign-error">{error}</div>}
            </>
          )}

          {/* ── Phase: preview ─────────────────────────────────────────── */}
          {phase === "preview" && (
            <>
              {/* Summary badges */}
              <div className="flex items-center gap-2 flex-wrap">
                {toUpdate > 0 && (
                  <span className="text-xs font-bold rounded-full px-2.5 py-1 bg-[#E1EAFB] text-[#1F3F7A] flex items-center gap-1" data-testid="barcode-preview-update-count">
                    <RefreshCw size={11} /> {toUpdate} will update
                  </span>
                )}
                {toSkip > 0 && (
                  <span className="text-xs font-bold rounded-full px-2.5 py-1 bg-[#FDE3DE] text-maroon" data-testid="barcode-preview-skip-count">
                    {toSkip} will skip
                  </span>
                )}
              </div>

              {/* Preview table */}
              <div className="bg-white border border-line rounded-2xl overflow-hidden" data-testid="barcode-preview-table">
                <div className="grid grid-cols-[1fr_130px_60px] px-4 py-2 bg-chip text-xs font-bold text-mocha border-b border-line">
                  <span>Product</span>
                  <span>New Barcode</span>
                  <span className="text-center">Action</span>
                </div>
                <div className="divide-y divide-[#F1E2CC] max-h-[300px] overflow-y-auto">
                  {preview.map((row, i) => (
                    <div
                      key={i}
                      className={"grid grid-cols-[1fr_130px_60px] px-4 py-2.5 text-sm items-start " + (row.action === "skip" ? "opacity-50" : "")}
                      data-testid={`barcode-preview-row-${i}`}
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        {row.action === "skip"
                          ? <AlertCircle size={13} className="text-maroon flex-none mt-0.5" />
                          : <CheckCircle size={13} className="text-[#1F5F36] flex-none mt-0.5" />}
                        <div className="min-w-0">
                          <div className="truncate font-medium text-sm">{row.name}</div>
                          {row.action === "skip" && (
                            <div className="text-[10px] text-maroon truncate">{row.reason}</div>
                          )}
                        </div>
                      </div>
                      <span className="font-mono text-xs text-mocha truncate pt-0.5">{row.barcode || "—"}</span>
                      <span className={"text-center text-[11px] font-bold rounded-full px-2 py-0.5 mt-0.5 " +
                        (row.action === "update" ? "bg-[#E1EAFB] text-[#1F3F7A]" : "bg-[#FDE3DE] text-maroon")}>
                        {row.action === "update" ? "Update" : "Skip"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {error && <div className="bg-[#FDE3DE] text-maroon rounded-xl px-3 py-2 text-sm">{error}</div>}

              <div className="flex gap-2">
                <button
                  onClick={reset}
                  className="h-11 px-5 rounded-xl border border-line text-ink font-bold text-sm hover:bg-chip transition-colors"
                  data-testid="barcode-assign-back-btn"
                >
                  Back
                </button>
                <button
                  onClick={applyUpdate}
                  disabled={busy || toUpdate === 0}
                  className="flex-1 h-11 rounded-xl bg-brick text-white font-bold text-sm disabled:opacity-50"
                  data-testid="barcode-assign-apply-btn"
                >
                  {busy ? "Updating…" : `Assign ${toUpdate} barcode${toUpdate !== 1 ? "s" : ""}`}
                </button>
              </div>
            </>
          )}

          {/* ── Phase: results ─────────────────────────────────────────── */}
          {phase === "results" && results && (
            <>
              {/* Summary */}
              <div className="flex items-center gap-2 flex-wrap">
                {results.updated.length > 0 && (
                  <span className="text-xs font-bold rounded-full px-2.5 py-1 bg-[#DDF1E3] text-[#1F5F36]" data-testid="barcode-result-updated-count">
                    {results.updated.length} updated
                  </span>
                )}
                {results.skipped.length > 0 && (
                  <span className="text-xs font-bold rounded-full px-2.5 py-1 bg-[#FDE3DE] text-maroon" data-testid="barcode-result-skipped-count">
                    {results.skipped.length} skipped
                  </span>
                )}
              </div>

              {/* Updated list */}
              {results.updated.length > 0 && (
                <div className="bg-white border border-line rounded-2xl overflow-hidden" data-testid="barcode-results-table">
                  <div className="grid grid-cols-[1fr_140px] px-4 py-2 bg-chip text-xs font-bold text-mocha border-b border-line">
                    <span>Product</span>
                    <span>Barcode Assigned</span>
                  </div>
                  <div className="divide-y divide-[#F1E2CC] max-h-[280px] overflow-y-auto">
                    {results.updated.map((r, i) => (
                      <div key={i} className="grid grid-cols-[1fr_140px] px-4 py-2.5 items-center" data-testid={`barcode-result-row-${i}`}>
                        <div className="flex items-center gap-1.5 min-w-0">
                          <CheckCircle size={13} className="text-[#1F5F36] flex-none" />
                          <span className="truncate text-sm font-medium">{r.name}</span>
                        </div>
                        <span className="font-mono text-xs text-mocha">{r.barcode}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Skipped reasons */}
              {results.skipped.length > 0 && (
                <div className="bg-[#FDE3DE] rounded-xl p-3 flex flex-col gap-1.5 max-h-[160px] overflow-y-auto">
                  <div className="text-xs font-bold text-maroon mb-0.5">Skipped ({results.skipped.length})</div>
                  {results.skipped.map((r, i) => (
                    <div key={i} className="text-xs text-maroon">
                      <span className="font-bold">"{r.name}"</span> — {r.reason}
                    </div>
                  ))}
                </div>
              )}

              <div className="flex gap-2">
                <button
                  onClick={reset}
                  className="h-11 px-5 rounded-xl border border-line text-ink font-bold text-sm hover:bg-chip transition-colors"
                  data-testid="barcode-assign-again-btn"
                >
                  Assign more
                </button>
                <button
                  onClick={onClose}
                  className="flex-1 h-11 rounded-xl bg-brick text-white font-bold text-sm"
                  data-testid="barcode-assign-done-btn"
                >
                  Done
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
