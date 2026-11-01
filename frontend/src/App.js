import { useEffect } from "react";
import { Component } from "react";
import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { Toaster } from "sonner";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { CartProvider } from "@/context/CartContext";
import Layout from "@/components/Layout";
import Shop from "@/pages/Shop";
import Cart from "@/pages/Cart";
import Checkout from "@/pages/Checkout";
import Receipt from "@/pages/Receipt";
import Orders from "@/pages/Orders";
import Login from "@/pages/Login";
import Signup from "@/pages/Signup";
import ForgotPassword from "@/pages/ForgotPassword";
import AdminLayout from "@/pages/admin/AdminLayout";
import AdminDashboard from "@/pages/admin/AdminDashboard";
import AdminPOS from "@/pages/admin/AdminPOS";
import AdminWholesale from "@/pages/admin/AdminWholesale";
import AdminReports from "@/pages/admin/AdminReports";
import ShiftHistory from "@/pages/admin/ShiftHistory";

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: false };
  }
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-cream text-ink p-6 text-center">
          <div>
            <div className="font-display font-bold text-xl mb-2">Something went wrong</div>
            <button data-testid="app-reload" className="text-brick font-bold underline" onClick={() => (window.location.href = "/")}>
              Back to shop
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

function PageLoader() {
  return <div className="min-h-[50vh] flex items-center justify-center text-mocha text-sm">Loading…</div>;
}

function Protected({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <PageLoader />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return children;
}

function AdminProtected({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <PageLoader />;
  if (!user || (user.role !== "admin" && user.role !== "salesperson")) return <Navigate to="/" replace />;
  return children;
}

function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <CartProvider>
            <ScrollToTop />
            <Toaster position="top-center" richColors />
            <Routes>
              <Route element={<Layout />}>
                <Route path="/" element={<Shop />} />
                <Route path="/cart" element={<Cart />} />
                <Route path="/checkout" element={<Protected><Checkout /></Protected>} />
                <Route path="/order/:id" element={<Protected><Receipt /></Protected>} />
                <Route path="/orders" element={<Protected><Orders /></Protected>} />
                <Route path="/login" element={<Login />} />
                <Route path="/signup" element={<Signup />} />
                <Route path="/forgot-password" element={<ForgotPassword />} />
                <Route element={<AdminLayout />}>
                  <Route path="/admin" element={<AdminProtected><AdminDashboard /></AdminProtected>} />
                  <Route path="/admin/pos" element={<AdminProtected><AdminPOS /></AdminProtected>} />
                  <Route path="/admin/wholesale" element={<AdminProtected><AdminWholesale /></AdminProtected>} />
                  <Route path="/admin/reports" element={<AdminProtected><AdminReports /></AdminProtected>} />
                  <Route path="/admin/shifts" element={<AdminProtected><ShiftHistory /></AdminProtected>} />
                </Route>
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
          </CartProvider>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}

export default App;
