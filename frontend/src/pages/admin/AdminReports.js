import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { TrendingUp, ShoppingBag, User, CalendarDays, Download, IndianRupee, PackageCheck } from "lucide-react";
import api from "@/lib/api";
import { money } from "@/lib/totals";

// ── helpers ──────────────────────────────────────────────────────────────────
function toISO(d) { return d.toISOString().slice(0, 10); }

const QUICK = [
  { label: "All time",   key: "all" },
  { label: "Today",      key: "today" },
  { label: "This week",  key: "week" },
  { label: "This month", key: "month" },
  { label: "Custom",     key: "custom" },
];

function quickRange(key) {
  const now = new Date();
  if (key === "today")  return { from: toISO(now), to: toISO(now) };
  if (key === "week") {
    const start = new Date(now); start.setDate(now.getDate() - now.getDay());
    return { from: toISO(start), to: toISO(now) };
  }
  if (key === "month")  return { from: toISO(new Date(now.getFullYear(), now.getMonth(), 1)), to: toISO(now) };
  return { from: "", to: "" };
}

// ─────────────────────────────────────────────────────────────────────────────
export default function AdminReports() {
  const [preset, setPreset] = useState("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo,   setCustomTo]   = useState("");

  const { from, to } = useMemo(() => {
    if (preset === "custom") return { from: customFrom, to: customTo };
    return quickRange(preset);
  }, [preset, customFrom, customTo]);

  const params = useMemo(() => {
    const p = new URLSearchParams();
    if (from) p.set("from_date", from);
    if (to)   p.set("to_date",   to);
    return p.toString();
  }, [from, to]);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["sp-report", params],
    queryFn: () => api.get(`/admin/reports/salesperson${params ? "?" + params : ""}`).then((r) => r.data),
  });

  const { data: profit } = useQuery({
    queryKey: ["profit-report", params],
    queryFn: () => api.get(`/admin/reports/profit${params ? "?" + params : ""}`).then((r) => r.data),
    staleTime: 30000,
  });

  const exportCSV = () => {
    const header = ["Salesperson", "Orders", "Revenue (INR)", "Last Sale"];
    const csvRows = rows.map((r) => [
      `"${r.name}"`,
      r.orders,
      r.revenue.toFixed(2),
      r.last_sale ? new Date(r.last_sale).toLocaleDateString("en-IN") : "",
    ]);
    const csv = [header, ...csvRows].map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url;
    a.download = `salesperson-report-${from || "all"}-to-${to || "all"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
  const totalOrders  = rows.reduce((s, r) => s + r.orders,  0);
  const topSeller    = rows.find((r) => r.orders > 0);

  // label shown under summary cards
  const rangeLabel = useMemo(() => {
    if (preset === "all")    return "all time";
    if (preset === "today")  return "today";
    if (preset === "week")   return "this week";
    if (preset === "month")  return "this month";
    if (from && to)          return `${from} – ${to}`;
    if (from)                return `from ${from}`;
    if (to)                  return `until ${to}`;
    return "custom range";
  }, [preset, from, to]);

  return (
    <div className="max-w-4xl mx-auto px-4 py-5" data-testid="admin-reports">
      <h1 className="font-display font-bold text-2xl mb-4">Salesperson Report</h1>

      {/* ── Date filter bar ── */}
      <div className="bg-white border border-line rounded-2xl px-4 py-3 mb-4 flex flex-col gap-3" data-testid="report-date-filter">
        {/* Quick chips */}
        <div className="flex gap-1.5 flex-wrap">
          {QUICK.map(({ label, key }) => (
            <button
              key={key}
              onClick={() => setPreset(key)}
              data-testid={`filter-${key}`}
              className={
                "h-8 px-3.5 rounded-lg font-bold text-xs transition-colors " +
                (preset === key ? "bg-brick text-white" : "bg-chip text-mocha hover:text-ink")
              }
            >
              {label}
            </button>
          ))}
        </div>

        {/* Custom date inputs */}
        {preset === "custom" && (
          <div className="flex items-center gap-2 flex-wrap" data-testid="custom-range-inputs">
            <div className="flex items-center gap-2">
              <CalendarDays size={15} className="text-mocha flex-none" />
              <span className="text-xs text-mocha font-medium">From</span>
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="h-9 border border-line rounded-xl px-3 text-sm outline-none focus:border-brick bg-cream"
                data-testid="custom-from"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-mocha font-medium">To</span>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                min={customFrom}
                className="h-9 border border-line rounded-xl px-3 text-sm outline-none focus:border-brick bg-cream"
                data-testid="custom-to"
              />
            </div>
          </div>
        )}
      </div>

      {/* ── Summary cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-5">
        <div className="bg-white border border-line rounded-2xl p-4 flex flex-col gap-1.5" data-testid="report-total-revenue">
          <div className="w-8 h-8 rounded-xl bg-[#DDF1E3] flex items-center justify-center">
            <TrendingUp size={16} className="text-[#1F5F36]" />
          </div>
          <div className="font-display font-bold text-xl text-[#1F5F36]">
            {isLoading ? <span className="inline-block w-20 h-6 bg-chip rounded animate-pulse" /> : money(totalRevenue)}
          </div>
          <div className="text-xs text-mocha font-medium">Revenue · {rangeLabel}</div>
        </div>

        <div className="bg-white border border-line rounded-2xl p-4 flex flex-col gap-1.5" data-testid="report-total-orders">
          <div className="w-8 h-8 rounded-xl bg-[#FFE3B8] flex items-center justify-center">
            <ShoppingBag size={16} className="text-maroon" />
          </div>
          <div className="font-display font-bold text-xl text-maroon">
            {isLoading ? <span className="inline-block w-12 h-6 bg-chip rounded animate-pulse" /> : totalOrders}
          </div>
          <div className="text-xs text-mocha font-medium">Orders · {rangeLabel}</div>
        </div>

        <div className="bg-white border border-line rounded-2xl p-4 flex flex-col gap-1.5 col-span-2 sm:col-span-1" data-testid="report-top-seller">
          <div className="w-8 h-8 rounded-xl bg-[#E1EAFB] flex items-center justify-center">
            <User size={16} className="text-[#1F3F7A]" />
          </div>
          <div className="font-display font-bold text-xl text-[#1F3F7A] truncate">
            {topSeller ? topSeller.name : "—"}
          </div>
          <div className="text-xs text-mocha font-medium">Top Seller · {rangeLabel}</div>
        </div>
      </div>

      {/* ── Profit Summary ── */}
      {profit && (
        <div className="bg-white border border-line rounded-2xl mb-5" data-testid="profit-section">
          <div className="px-4 py-3 border-b border-line flex items-center gap-2">
            <IndianRupee size={16} className="text-[#1F5F36]" />
            <span className="font-bold text-sm">Profit Overview</span>
            {profit.total_cost === 0 && (
              <span className="ml-auto text-[10px] text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full font-medium">
                Add purchase prices to products for accurate profit
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-line">
            <div className="p-4 flex flex-col gap-1">
              <div className="text-xs text-mocha font-medium">Revenue</div>
              <div className="font-bold text-base text-ink">{money(profit.total_revenue)}</div>
            </div>
            <div className="p-4 flex flex-col gap-1">
              <div className="text-xs text-mocha font-medium">Total Cost</div>
              <div className="font-bold text-base text-ink">{money(profit.total_cost)}</div>
            </div>
            <div className="p-4 flex flex-col gap-1">
              <div className="text-xs text-mocha font-medium">Gross Profit</div>
              <div className={"font-bold text-base " + (profit.total_profit >= 0 ? "text-[#1F5F36]" : "text-maroon")}>
                {money(profit.total_profit)}
              </div>
            </div>
            <div className="p-4 flex flex-col gap-1">
              <div className="text-xs text-mocha font-medium">Margin %</div>
              <div className={"font-bold text-base " + (profit.margin_pct >= 0 ? "text-[#1F5F36]" : "text-maroon")}>
                {profit.margin_pct}%
              </div>
            </div>
          </div>

          {/* Top profitable products */}
          {profit.top_products?.length > 0 && (
            <div className="border-t border-line">
              <div className="px-4 py-2.5 flex items-center gap-1.5 border-b border-line">
                <PackageCheck size={14} className="text-mocha" />
                <span className="text-xs font-bold text-mocha">Top 10 Products by Profit</span>
              </div>
              <div className="divide-y divide-[#F1E2CC]">
                {profit.top_products.map((p, i) => (
                  <div key={p.name} className="grid grid-cols-[1fr_60px_90px_90px] px-4 py-2.5 items-center text-xs gap-2" data-testid={`profit-row-${i}`}>
                    <span className="font-medium truncate">{p.name}</span>
                    <span className="text-center text-mocha">{p.qty} sold</span>
                    <span className="text-right text-mocha">{money(p.revenue)}</span>
                    <span className={"text-right font-bold " + (p.profit >= 0 ? "text-[#1F5F36]" : "text-maroon")}>
                      {money(p.profit)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Performance table ── */}
      <div className="bg-white border border-line rounded-2xl" data-testid="sp-report-table">
        <div className="flex items-center justify-between px-4 py-3 border-b border-line">
          <span className="font-bold text-sm">Performance Breakdown</span>
          <div className="flex items-center gap-2">
            <span className="text-xs text-mocha capitalize">{rangeLabel}</span>
            {rows.length > 0 && (
              <button onClick={exportCSV}
                className="flex items-center gap-1.5 h-8 px-3 rounded-lg border border-line text-xs font-bold text-mocha hover:border-brick hover:text-brick transition-colors"
                data-testid="export-csv-btn">
                <Download size={13} /> Export CSV
              </button>
            )}
          </div>
        </div>

        {isLoading ? (
          <div className="p-8 text-center text-mocha text-sm">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center text-mocha text-sm" data-testid="sp-report-empty">
            No salespersons added yet. Add them from the Dashboard.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-[1fr_80px_120px_110px] px-4 py-2 bg-chip text-xs font-bold text-mocha border-b border-line">
              <span>Salesperson</span>
              <span className="text-center">Orders</span>
              <span className="text-right">Revenue</span>
              <span className="text-right">Last Sale</span>
            </div>

            <div className="divide-y divide-[#F1E2CC]">
              {rows.map((row) => (
                <div
                  key={row.name}
                  className="grid grid-cols-[1fr_80px_120px_110px] px-4 py-3 items-center"
                  data-testid={`sp-report-row-${row.name.toLowerCase().replace(/\s+/g, "-")}`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-xl bg-chip flex items-center justify-center flex-none">
                      <User size={15} className="text-mocha" />
                    </div>
                    <span className="font-medium text-sm truncate">{row.name}</span>
                  </div>

                  <div className="text-center">
                    <span
                      className={"text-sm font-bold rounded-full px-2.5 py-0.5 " +
                        (row.orders > 0 ? "bg-[#DDF1E3] text-[#1F5F36]" : "bg-chip text-mocha")}
                      data-testid={`sp-orders-${row.name.toLowerCase().replace(/\s+/g, "-")}`}
                    >
                      {row.orders}
                    </span>
                  </div>

                  <div className="text-right font-bold text-sm" data-testid={`sp-revenue-${row.name.toLowerCase().replace(/\s+/g, "-")}`}>
                    {row.revenue > 0
                      ? money(row.revenue)
                      : <span className="text-mocha font-normal">—</span>}
                  </div>

                  <div className="text-right text-xs text-mocha">
                    {row.last_sale
                      ? new Date(row.last_sale).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
                      : "—"}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
