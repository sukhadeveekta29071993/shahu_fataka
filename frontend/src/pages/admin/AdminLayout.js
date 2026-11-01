import { NavLink, Outlet, Navigate, useLocation } from "react-router-dom";
import { LayoutDashboard, ShoppingBag, Users, BarChart2, History } from "lucide-react";
import { useAuth } from "@/context/AuthContext";

export default function AdminLayout() {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <div className="min-h-[50vh] flex items-center justify-center text-mocha text-sm">Loading…</div>;
  if (!user || (user.role !== "admin" && user.role !== "salesperson")) return <Navigate to="/" replace />;

  // Salesperson can only access /admin/pos
  if (user.role === "salesperson" && !location.pathname.startsWith("/admin/pos")) {
    return <Navigate to="/admin/pos" replace />;
  }

  const tabCls = ({ isActive }) =>
    "flex items-center gap-1.5 px-4 h-11 text-sm font-bold border-b-2 whitespace-nowrap transition-colors " +
    (isActive ? "border-brick text-brick" : "border-transparent text-mocha hover:text-ink");

  return (
    <div>
      <div className="bg-white border-b border-line sticky top-16 z-30">
        <div className="max-w-6xl mx-auto px-4 flex overflow-x-auto">
          {user.role === "salesperson" ? (
            <NavLink to="/admin/pos" className={tabCls} data-testid="admin-tab-pos"><ShoppingBag size={15} /> POS Billing</NavLink>
          ) : (
            <>
              <NavLink to="/admin" end className={tabCls} data-testid="admin-tab-dashboard"><LayoutDashboard size={15} /> Dashboard</NavLink>
              <NavLink to="/admin/pos" className={tabCls} data-testid="admin-tab-pos"><ShoppingBag size={15} /> POS Billing</NavLink>
              <NavLink to="/admin/wholesale" className={tabCls} data-testid="admin-tab-wholesale"><Users size={15} /> Wholesale</NavLink>
              <NavLink to="/admin/reports" className={tabCls} data-testid="admin-tab-reports"><BarChart2 size={15} /> Reports</NavLink>
              <NavLink to="/admin/shifts" className={tabCls} data-testid="admin-tab-shifts"><History size={15} /> Shifts</NavLink>
            </>
          )}
        </div>
      </div>
      <Outlet />
    </div>
  );
}
