import { useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { apiError } from "@/lib/api";
import { LogoMark } from "@/components/Layout";
import { ShieldAlert } from "lucide-react";

export default function Login() {
  const { user, loading, login } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [locked, setLocked] = useState(false);   // true when HTTP 429
  const [busy, setBusy] = useState(false);

  if (loading) return <div className="min-h-screen bg-cream" />;
  if (user) return <Navigate to={user.role === "admin" ? "/admin" : user.role === "salesperson" ? "/admin/pos" : (location.state?.from || "/")} replace />;

  const submit = async (e) => {
    e.preventDefault();
    if (locked) return;
    setBusy(true);
    setError("");
    setLocked(false);
    try {
      const data = await login(email, password);
      navigate(data.role === "admin" ? "/admin" : data.role === "salesperson" ? "/admin/pos" : (location.state?.from || "/"), { replace: true });
    } catch (err) {
      const status = err?.response?.status;
      const msg = apiError(err);
      if (status === 429) {
        setLocked(true);
      }
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] flex flex-col" data-testid="login-page">
      <div className="bg-maroon px-6 pt-10 pb-14">
        <div className="flex items-center gap-2.5 mb-3.5">
          <LogoMark size={40} />
          <div className="font-display font-bold text-[22px] text-white">CrackerPOS</div>
        </div>
        <div className="font-display font-bold text-[32px] leading-[38px] text-white">Welcome back</div>
        <div className="text-sm leading-5 text-[#F3D9C4] mt-1.5">Login to see your orders, invoices and wholesale prices.</div>
      </div>

      <div className="flex-1 -mt-6 bg-cream rounded-t-[24px] px-4 py-5 flex flex-col gap-3.5">
        <div className="flex bg-chip rounded-[14px] p-1 gap-1">
          <button className="flex-1 h-11 rounded-[10px] bg-brick text-white font-bold text-sm">Login</button>
          <Link to="/signup" data-testid="login-to-signup" className="flex-1 h-11 rounded-[10px] text-[#5A3A30] font-bold text-sm flex items-center justify-center">Sign up</Link>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-3.5" data-testid="login-form">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="email" className="text-xs font-bold text-[#5A3A30]">Email</label>
            <input
              id="email"
              data-testid="login-email"
              type="email"
              required
              disabled={locked}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="h-12 border-[1.5px] border-line rounded-xl bg-white px-3.5 text-base outline-none focus:border-brick disabled:opacity-50 disabled:cursor-not-allowed"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="password" className="text-xs font-bold text-[#5A3A30]">Password</label>
            <input
              id="password"
              data-testid="login-password"
              type="password"
              required
              disabled={locked}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Your password"
              className="h-12 border-[1.5px] border-line rounded-xl bg-white px-3.5 text-base outline-none focus:border-brick disabled:opacity-50 disabled:cursor-not-allowed"
            />
          </div>

          {/* Lockout banner */}
          {locked && (
            <div data-testid="login-lockout-banner"
              className="flex items-start gap-2.5 bg-[#FDE3DE] border border-[#F5B7B1] text-maroon rounded-xl px-3.5 py-3">
              <ShieldAlert size={18} className="flex-none mt-0.5 text-brick" />
              <div className="flex flex-col gap-0.5">
                <span className="font-bold text-sm">Access temporarily locked</span>
                <span className="text-xs leading-[17px]">{error}</span>
              </div>
            </div>
          )}

          {/* Regular error */}
          {error && !locked && (
            <div className="bg-[#FDE3DE] text-maroon rounded-xl px-3.5 py-2.5 text-sm font-medium" data-testid="login-error">{error}</div>
          )}

          <button type="submit" disabled={busy || locked} data-testid="login-submit"
            className="h-14 rounded-2xl bg-brick text-white font-bold text-base disabled:opacity-60 disabled:cursor-not-allowed">
            {locked ? "Temporarily Locked" : busy ? "Logging in…" : "Login"}
          </button>

          <div className="text-center">
            <Link to="/forgot-password" data-testid="login-forgot-password" className="text-sm text-brick font-bold">
              Forgot password?
            </Link>
          </div>
        </form>

        <div className="bg-[#FFF0C9] text-[#5C3F00] rounded-xl px-3 py-2.5 text-xs leading-[17px]" data-testid="login-demo-hint">
          Demo accounts: <b>demo@crackerpos.in</b> / demo1234 (retail) · <b>wholesale@crackerpos.in</b> / demo1234 (wholesale, pending approval)
        </div>

        <div className="mt-auto flex flex-col items-center gap-0.5 pt-4">
          <div className="flex items-center gap-1 text-sm text-[#5A3A30]">
            New to CrackerPOS?
            <Link to="/signup" data-testid="login-create-account" className="h-11 flex items-center px-1 text-brick font-bold">Create account</Link>
          </div>
          <div className="text-xs text-mocha">Shop owner or staff? Use the staff console.</div>
        </div>
      </div>
    </div>
  );
}
