import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, LogIn, LogOut, Clock, User } from "lucide-react";
import api from "@/lib/api";

function toISO(d) { return d.toISOString().slice(0, 10); }

const QUICK = [
  { label: "Today",      key: "today" },
  { label: "This week",  key: "week" },
  { label: "This month", key: "month" },
  { label: "All time",   key: "all" },
  { label: "Custom",     key: "custom" },
];

function quickRange(key) {
  const now = new Date();
  if (key === "today")  return { from: toISO(now), to: toISO(now) };
  if (key === "week")   { const s = new Date(now); s.setDate(now.getDate() - now.getDay()); return { from: toISO(s), to: toISO(now) }; }
  if (key === "month")  return { from: toISO(new Date(now.getFullYear(), now.getMonth(), 1)), to: toISO(now) };
  return { from: "", to: "" };
}

function fmtTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true });
}

function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export default function ShiftHistory() {
  const [preset, setPreset] = useState("today");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo,   setCustomTo]   = useState("");
  const [filterSP, setFilterSP]     = useState("all");

  const { from, to } = useMemo(() => {
    if (preset === "custom") return { from: customFrom, to: customTo };
    return quickRange(preset);
  }, [preset, customFrom, customTo]);

  const params = useMemo(() => {
    const p = new URLSearchParams();
    if (from) p.set("from_date", from);
    if (to)   p.set("to_date", to);
    return p.toString();
  }, [from, to]);

  const { data: logs = [], isLoading } = useQuery({
    queryKey: ["shift-logs", params],
    queryFn: () => api.get(`/admin/shift-logs${params ? "?" + params : ""}`).then((r) => r.data),
  });

  const { data: salespersons = [] } = useQuery({
    queryKey: ["salespersons"],
    queryFn: () => api.get("/admin/salespersons").then((r) => r.data),
  });

  // Filter by salesperson
  const filtered = filterSP === "all" ? logs : logs.filter((l) => l.salesperson_name === filterSP);

  // Summary stats
  const startCount = filtered.filter((l) => l.event === "start").length;
  const endCount   = filtered.filter((l) => l.event === "end").length;
  const uniqueSPs  = [...new Set(filtered.map((l) => l.salesperson_name))].length;

  return (
    <div className="max-w-4xl mx-auto px-4 py-5" data-testid="shift-history">
      <h1 className="font-display font-bold text-2xl mb-4">Shift History</h1>

      {/* Filters */}
      <div className="bg-white border border-line rounded-2xl px-4 py-3 mb-4 flex flex-col gap-3" data-testid="shift-filter-bar">
        <div className="flex gap-1.5 flex-wrap">
          {QUICK.map(({ label, key }) => (
            <button key={key} onClick={() => setPreset(key)}
              data-testid={`shift-filter-${key}`}
              className={"h-8 px-3.5 rounded-lg font-bold text-xs transition-colors " +
                (preset === key ? "bg-brick text-white" : "bg-chip text-mocha hover:text-ink")}>
              {label}
            </button>
          ))}
          {/* Salesperson filter */}
          <select value={filterSP} onChange={(e) => setFilterSP(e.target.value)}
            className="h-8 border border-line rounded-lg px-2 text-xs outline-none focus:border-brick bg-white ml-auto"
            data-testid="shift-sp-filter">
            <option value="all">All Salespersons</option>
            {salespersons.map((sp) => <option key={sp.id} value={sp.name}>{sp.name}</option>)}
          </select>
        </div>
        {preset === "custom" && (
          <div className="flex items-center gap-2 flex-wrap" data-testid="shift-custom-range">
            <CalendarDays size={14} className="text-mocha" />
            <span className="text-xs text-mocha font-medium">From</span>
            <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)}
              className="h-8 border border-line rounded-lg px-2 text-xs outline-none focus:border-brick bg-cream"
              data-testid="shift-custom-from" />
            <span className="text-xs text-mocha font-medium">To</span>
            <input type="date" value={customTo} min={customFrom} onChange={(e) => setCustomTo(e.target.value)}
              className="h-8 border border-line rounded-lg px-2 text-xs outline-none focus:border-brick bg-cream"
              data-testid="shift-custom-to" />
          </div>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="bg-white border border-line rounded-2xl p-3 flex flex-col gap-1" data-testid="shift-stat-starts">
          <div className="w-7 h-7 rounded-xl bg-[#DDF1E3] flex items-center justify-center"><LogIn size={13} className="text-[#1F5F36]" /></div>
          <div className="font-display font-bold text-xl text-[#1F5F36]">{startCount}</div>
          <div className="text-xs text-mocha">Shifts Started</div>
        </div>
        <div className="bg-white border border-line rounded-2xl p-3 flex flex-col gap-1" data-testid="shift-stat-ends">
          <div className="w-7 h-7 rounded-xl bg-[#FFE3B8] flex items-center justify-center"><LogOut size={13} className="text-maroon" /></div>
          <div className="font-display font-bold text-xl text-maroon">{endCount}</div>
          <div className="text-xs text-mocha">Shifts Ended</div>
        </div>
        <div className="bg-white border border-line rounded-2xl p-3 flex flex-col gap-1" data-testid="shift-stat-people">
          <div className="w-7 h-7 rounded-xl bg-[#E1EAFB] flex items-center justify-center"><User size={13} className="text-[#1F3F7A]" /></div>
          <div className="font-display font-bold text-xl text-[#1F3F7A]">{uniqueSPs}</div>
          <div className="text-xs text-mocha">People Active</div>
        </div>
      </div>

      {/* Log table */}
      <div className="bg-white border border-line rounded-2xl" data-testid="shift-log-table">
        <div className="flex items-center justify-between px-4 py-3 border-b border-line">
          <span className="font-bold text-sm">Activity Log</span>
          <span className="text-xs text-mocha">{filtered.length} events</span>
        </div>
        {isLoading ? (
          <div className="p-8 text-center text-mocha text-sm">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center text-mocha text-sm" data-testid="shift-log-empty">No shift events in this period.</div>
        ) : (
          <>
            <div className="grid grid-cols-[1fr_90px_160px] px-4 py-2 bg-chip text-xs font-bold text-mocha border-b border-line">
              <span>Salesperson</span>
              <span className="text-center">Event</span>
              <span className="text-right">Time</span>
            </div>
            <div className="divide-y divide-[#F1E2CC]">
              {filtered.map((log) => (
                <div key={log.id} className="grid grid-cols-[1fr_90px_160px] px-4 py-2.5 items-center" data-testid={`shift-log-row-${log.id}`}>
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-xl bg-chip flex items-center justify-center flex-none">
                      <User size={13} className="text-mocha" />
                    </div>
                    <span className="font-medium text-sm">{log.salesperson_name}</span>
                  </div>
                  <div className="flex justify-center">
                    <span className={"text-[11px] font-bold rounded-full px-2.5 py-0.5 flex items-center gap-1 " +
                      (log.event === "start" ? "bg-[#DDF1E3] text-[#1F5F36]" : "bg-[#FFE3B8] text-maroon")}>
                      {log.event === "start" ? <LogIn size={10} /> : <LogOut size={10} />}
                      {log.event === "start" ? "Start" : "End"}
                    </span>
                  </div>
                  <div className="text-right text-xs text-mocha flex items-center justify-end gap-1">
                    <Clock size={11} className="flex-none" />
                    {fmtTime(log.timestamp)}
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
