import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";

const badge = (status) =>
  status === "paid"
    ? "bg-[#DDF1E3] text-[#1F5F36]"
    : status === "pending"
    ? "bg-[#FFF0C9] text-[#5C3F00]"
    : "bg-[#E1EAFB] text-[#1F3F7A]";

export default function Orders() {
  const { data: orders = [], isLoading } = useQuery({
    queryKey: ["orders"],
    queryFn: () => api.get("/orders").then((r) => r.data),
  });

  if (isLoading) {
    return <div className="max-w-6xl mx-auto px-4 py-20 text-center text-mocha text-sm">Loading orders…</div>;
  }

  return (
    <div className="max-w-2xl mx-auto px-5 py-6" data-testid="orders-page">
      <h1 className="font-display font-bold text-2xl mb-5">My orders</h1>

      {orders.length === 0 ? (
        <div className="bg-white border border-line rounded-2xl p-10 text-center" data-testid="orders-empty">
          <div className="font-bold mb-1">No orders yet</div>
          <p className="text-mocha text-sm mb-5">Your invoices will appear here after your first purchase.</p>
          <Link to="/" data-testid="orders-empty-shop-btn" className="inline-flex h-12 items-center rounded-xl bg-brick text-white font-bold text-sm px-6">
            Shop fireworks
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-3" data-testid="orders-list">
          {orders.map((o) => (
            <Link
              key={o.id}
              to={`/order/${o.id}`}
              data-testid={`order-row-${o.invoice_no.replace(/[^a-zA-Z0-9]+/g, "-")}`}
              className="bg-white border border-line rounded-2xl px-5 py-4 flex items-center justify-between gap-3 hover:border-brick transition-colors"
            >
              <div className="min-w-0">
                <div className="font-bold text-sm">{o.invoice_no}</div>
                <div className="text-xs text-mocha">
                  {new Date(o.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })} · {o.items.length} items · {o.payment_mode.toUpperCase()}
                </div>
              </div>
              <div className="flex items-center gap-3 flex-none">
                <div className="font-display font-bold text-base">₹{o.total.toLocaleString("en-IN")}</div>
                <span className={"text-xs font-bold rounded-full px-2.5 py-1 " + badge(o.status)} data-testid={`order-status-${o.invoice_no.replace(/[^a-zA-Z0-9]+/g, "-")}`}>
                  {o.status === "paid" ? "Paid" : "Pending"}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
