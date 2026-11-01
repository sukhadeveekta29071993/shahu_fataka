import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { Store, ShoppingCart, ReceiptText, LogIn, LogOut, LayoutDashboard, ShoppingBag, Users } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useCart } from "@/context/CartContext";

export function LogoMark({ size = 36 }) {
  return (
    <div style={{ width: size, height: size, borderRadius: "50%", background: "#F5B82E", display: "flex", alignItems: "center", justifyContent: "center", flex: "0 0 auto" }}>
      <svg width={size * 0.62} height={size * 0.62} viewBox="0 0 48 48" fill="none" stroke="#7A1410" strokeWidth="3.5" strokeLinecap="round" aria-hidden="true">
        <path d="M24 6v10M24 32v10M6 24h10M32 24h10M11 11l7 7M30 30l7 7M37 11l-7 7M18 30l-7 7" />
      </svg>
    </div>
  );
}

export default function Layout() {
  const { user, logout } = useAuth();
  const { items } = useCart();
  const units = items.reduce((s, i) => s + i.qty, 0);
  const navigate = useNavigate();

  const doLogout = async () => {
    await logout();
    navigate("/");
  };

  const navCls = ({ isActive }) =>
    "h-11 px-4 rounded-xl flex items-center font-bold text-sm " +
    (isActive ? "bg-brick text-white" : "text-[#F3D9C4] hover:text-white");

  const mobileCls = ({ isActive }) =>
    "flex-1 flex flex-col items-center justify-center gap-0.5 text-[11px] " +
    (isActive ? "text-brick font-bold" : "text-mocha font-medium");

  return (
    <div className="min-h-screen bg-cream text-ink flex flex-col">
      <header className="bg-maroon sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between gap-3">
          <Link to="/" data-testid="header-logo" className="flex items-center gap-2.5">
            <LogoMark />
            <span className="font-display font-bold text-white text-xl">CrackerPOS</span>
          </Link>
          <nav className="hidden md:flex items-center gap-1.5">
            {user?.role === "admin" ? (
              <>
                <NavLink to="/admin" end className={navCls} data-testid="nav-admin-dashboard">Dashboard</NavLink>
                <NavLink to="/admin/pos" className={navCls} data-testid="nav-admin-pos">POS</NavLink>
                <NavLink to="/admin/wholesale" className={navCls} data-testid="nav-admin-wholesale">Wholesale</NavLink>
              </>
            ) : (
              <>
                <NavLink to="/" end className={navCls} data-testid="nav-shop">Shop</NavLink>
                <NavLink to="/orders" className={navCls} data-testid="nav-orders">My Orders</NavLink>
                <NavLink to="/cart" className={navCls} data-testid="nav-cart">
                  Cart
                  {units > 0 && (
                    <span data-testid="header-cart-badge" className="ml-1.5 bg-gold text-ink text-[11px] font-bold rounded-full px-2 py-0.5">{units}</span>
                  )}
                </NavLink>
              </>
            )}
            {user ? (
              <button onClick={doLogout} data-testid="header-logout" className="h-11 px-4 rounded-xl border-[1.5px] border-gold text-gold font-bold text-sm flex items-center gap-2">
                <LogOut size={16} /> {user.name.split(" ")[0]}
              </button>
            ) : (
              <Link to="/login" data-testid="header-login" className="h-11 px-6 rounded-xl bg-gold text-ink font-bold text-sm flex items-center">Login</Link>
            )}
          </nav>
          {user?.role !== "admin" && (
            <Link to="/cart" data-testid="header-cart-mobile" className="relative md:hidden w-11 h-11 flex items-center justify-center text-white">
              <ShoppingCart size={24} />
              {units > 0 && (
                <span data-testid="header-cart-badge-mobile" className="absolute -top-0.5 -right-0.5 bg-gold text-ink text-[11px] font-bold rounded-full min-w-[20px] h-5 px-1 flex items-center justify-center">{units}</span>
              )}
            </Link>
          )}
        </div>
      </header>

      <main className="flex-1 pb-20 md:pb-0">
        <Outlet />
      </main>

      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 h-16 bg-white border-t border-line flex items-stretch justify-around">
        {user?.role === "admin" ? (
          <>
            <NavLink to="/admin" end className={mobileCls} data-testid="tab-admin-dashboard">
              <LayoutDashboard size={24} /> Dashboard
            </NavLink>
            <NavLink to="/admin/pos" className={mobileCls} data-testid="tab-admin-pos">
              <ShoppingBag size={24} /> POS
            </NavLink>
            <NavLink to="/admin/wholesale" className={mobileCls} data-testid="tab-admin-wholesale">
              <Users size={24} /> Wholesale
            </NavLink>
            <button onClick={doLogout} data-testid="tab-logout" className="flex-1 flex flex-col items-center justify-center gap-0.5 text-[11px] text-mocha font-medium">
              <LogOut size={24} /> Logout
            </button>
          </>
        ) : (
          <>
            <NavLink to="/" end className={mobileCls} data-testid="tab-shop">
              <Store size={24} /> Shop
            </NavLink>
            <NavLink to="/cart" className={mobileCls} data-testid="tab-cart">
              <ShoppingCart size={24} /> Cart
            </NavLink>
            <NavLink to="/orders" className={mobileCls} data-testid="tab-orders">
              <ReceiptText size={24} /> Orders
            </NavLink>
            {user ? (
              <button onClick={doLogout} data-testid="tab-logout" className="flex-1 flex flex-col items-center justify-center gap-0.5 text-[11px] text-mocha font-medium">
                <LogOut size={24} /> Logout
              </button>
            ) : (
              <NavLink to="/login" className={mobileCls} data-testid="tab-login">
                <LogIn size={24} /> Login
              </NavLink>
            )}
          </>
        )}
      </nav>
    </div>
  );
}
