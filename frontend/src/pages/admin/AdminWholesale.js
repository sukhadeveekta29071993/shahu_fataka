import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Phone, Mail, CheckCircle, XCircle, Clock } from "lucide-react";
import api from "@/lib/api";

const FILTERS = ["All", "Pending", "Approved", "Rejected"];

function statusOf(u) {
  if (u.rejected) return "Rejected";
  if (u.approved) return "Approved";
  return "Pending";
}

const statusStyle = {
  Approved: "bg-[#DDF1E3] text-[#1F5F36]",
  Pending: "bg-[#FFF0C9] text-[#5C3F00]",
  Rejected: "bg-[#FDE3DE] text-maroon",
};

export default function AdminWholesale() {
  const [filter, setFilter] = useState("All");
  const [busy, setBusy] = useState({});
  const queryClient = useQueryClient();

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["admin-wholesale"],
    queryFn: () => api.get("/admin/wholesale").then((r) => r.data),
  });

  const filtered = users.filter((u) => filter === "All" || statusOf(u) === filter);

  const doAction = async (id, action) => {
    setBusy((b) => ({ ...b, [id + action]: true }));
    try {
      await api.patch(`/admin/wholesale/${id}/${action}`);
      queryClient.invalidateQueries({ queryKey: ["admin-wholesale"] });
      queryClient.invalidateQueries({ queryKey: ["admin-stats"] });
    } catch (e) {
      console.error("Wholesale action failed:", e);
      // list stays unchanged — user can retry
    } finally {
      setBusy((b) => ({ ...b, [id + action]: false }));
    }
  };

  const counts = {
    All: users.length,
    Pending: users.filter((u) => statusOf(u) === "Pending").length,
    Approved: users.filter((u) => statusOf(u) === "Approved").length,
    Rejected: users.filter((u) => statusOf(u) === "Rejected").length,
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-5" data-testid="admin-wholesale">
      <h1 className="font-display font-bold text-2xl mb-4">Wholesale Buyers</h1>

      {/* Filter tabs */}
      <div className="flex bg-chip rounded-[14px] p-1 gap-1 mb-4" data-testid="wholesale-filter-tabs">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={"flex-1 h-10 rounded-[10px] font-bold text-[13px] transition-colors " +
              (filter === f ? "bg-brick text-white" : "text-[#5A3A30] hover:text-ink")}
            data-testid={`wholesale-filter-${f.toLowerCase()}`}
          >
            {f}
            {counts[f] > 0 && (
              <span className={"ml-1.5 text-[11px] rounded-full px-1.5 py-0.5 " +
                (filter === f ? "bg-white/20 text-white" : "bg-white text-mocha")}>
                {counts[f]}
              </span>
            )}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-2.5">
          {[...Array(3)].map((_, i) => <div key={i} className="bg-white border border-line rounded-2xl h-28 animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white border border-line rounded-2xl p-10 text-center" data-testid="wholesale-empty">
          <div className="text-mocha text-sm">No {filter === "All" ? "" : filter.toLowerCase() + " "}wholesale accounts yet.</div>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5" data-testid="wholesale-list">
          {filtered.map((u) => {
            const st = statusOf(u);
            return (
              <div key={u.id} className="bg-white border border-line rounded-2xl px-4 py-3.5 flex flex-col gap-2.5" data-testid={`wholesale-user-${u.id}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-bold text-[15px]">{u.name}</div>
                    {u.business_name && (
                      <div className="flex items-center gap-1 text-xs text-mocha mt-0.5">
                        <Building2 size={12} /> {u.business_name}
                      </div>
                    )}
                  </div>
                  <span className={"flex-none text-xs font-bold rounded-full px-2.5 py-1 " + statusStyle[st]} data-testid={`wholesale-status-${u.id}`}>
                    {st}
                  </span>
                </div>

                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-mocha">
                  <span className="flex items-center gap-1"><Mail size={12} /> {u.email}</span>
                  {u.phone && <span className="flex items-center gap-1"><Phone size={12} /> {u.phone}</span>}
                  {u.gstin && <span className="font-mono">GSTIN: {u.gstin}</span>}
                  <span>
                    Registered: {new Date(u.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                  </span>
                </div>

                {st !== "Approved" && (
                  <button
                    onClick={() => doAction(u.id, "approve")}
                    disabled={busy[u.id + "approve"]}
                    className="h-9 rounded-xl bg-[#1F5F36] text-white font-bold text-[13px] flex items-center justify-center gap-1.5 disabled:opacity-60 hover:bg-[#174d2c] transition-colors"
                    data-testid={`approve-btn-${u.id}`}
                  >
                    <CheckCircle size={15} /> {busy[u.id + "approve"] ? "Approving…" : "Approve — unlock wholesale prices"}
                  </button>
                )}
                {st !== "Rejected" && st !== "Pending" && (
                  <button
                    onClick={() => doAction(u.id, "reject")}
                    disabled={busy[u.id + "reject"]}
                    className="h-9 rounded-xl border border-[#D9534F] text-maroon font-bold text-[13px] flex items-center justify-center gap-1.5 disabled:opacity-60 hover:bg-[#FDE3DE] transition-colors"
                    data-testid={`revoke-btn-${u.id}`}
                  >
                    <XCircle size={15} /> {busy[u.id + "reject"] ? "Revoking…" : "Revoke approval"}
                  </button>
                )}
                {st === "Pending" && (
                  <button
                    onClick={() => doAction(u.id, "reject")}
                    disabled={busy[u.id + "reject"]}
                    className="h-9 rounded-xl border border-line text-mocha font-bold text-[13px] flex items-center justify-center gap-1.5 disabled:opacity-60 hover:bg-chip transition-colors"
                    data-testid={`reject-btn-${u.id}`}
                  >
                    <XCircle size={15} /> {busy[u.id + "reject"] ? "Rejecting…" : "Reject"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
