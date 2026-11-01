import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { apiError } from "@/lib/api";
import { LogoMark } from "@/components/Layout";

export default function Signup() {
  const { user, loading, register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    phone: "",
    customer_type: "retail",
    business_name: "",
    gstin: "",
  });
  const [terms, setTerms] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (loading) return <div className="min-h-screen bg-cream" />;
  if (user) return <Navigate to="/" replace />;

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (!terms) {
      setError("Please accept the Terms and Privacy Policy");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await register(form);
      navigate("/", { replace: true });
    } catch (err) {
      setError(apiError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] flex flex-col" data-testid="signup-page">
      <div className="bg-maroon px-6 pt-8 pb-12">
        <div className="font-display font-bold text-[30px] leading-9 text-white">Create your account</div>
        <div className="text-sm leading-5 text-[#F3D9C4] mt-1.5">Order online, track bills and get wholesale rates.</div>
      </div>

      <div className="flex-1 -mt-6 bg-cream rounded-t-[24px] px-4 py-5 flex flex-col gap-3">
        <div className="flex bg-chip rounded-[14px] p-1 gap-1">
          <Link to="/login" data-testid="signup-to-login" className="flex-1 h-11 rounded-[10px] text-[#5A3A30] font-bold text-sm flex items-center justify-center">Login</Link>
          <button className="flex-1 h-11 rounded-[10px] bg-brick text-white font-bold text-sm">Sign up</button>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-3" data-testid="signup-form">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="fullname" className="text-xs font-bold text-[#5A3A30]">Full name</label>
            <input id="fullname" data-testid="signup-name" type="text" required value={form.name} onChange={set("name")} placeholder="Your name" className="h-12 border-[1.5px] border-line rounded-xl bg-white px-3.5 text-base outline-none focus:border-brick" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="email" className="text-xs font-bold text-[#5A3A30]">Email</label>
            <input id="email" data-testid="signup-email" type="email" required value={form.email} onChange={set("email")} placeholder="you@example.com" className="h-12 border-[1.5px] border-line rounded-xl bg-white px-3.5 text-base outline-none focus:border-brick" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="password" className="text-xs font-bold text-[#5A3A30]">Password</label>
            <input id="password" data-testid="signup-password" type="password" required minLength={6} value={form.password} onChange={set("password")} placeholder="At least 6 characters" className="h-12 border-[1.5px] border-line rounded-xl bg-white px-3.5 text-base outline-none focus:border-brick" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="phone" className="text-xs font-bold text-[#5A3A30]">Mobile number</label>
            <div className="flex gap-2">
              <div className="w-16 h-12 border-[1.5px] border-line rounded-xl bg-white flex items-center justify-center font-bold text-sm">+91</div>
              <input id="phone" data-testid="signup-phone" type="tel" value={form.phone} onChange={set("phone")} placeholder="10-digit mobile number" className="flex-1 min-w-0 h-12 border-[1.5px] border-line rounded-xl bg-white px-3.5 text-base outline-none focus:border-brick" />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="text-xs font-bold text-[#5A3A30]">I am a</div>
            <div className="flex bg-chip rounded-[14px] p-1 gap-1" data-testid="signup-type-toggle">
              {[
                { key: "retail", label: "Retail customer" },
                { key: "wholesale", label: "Wholesale buyer" },
              ].map((t) => (
                <button
                  key={t.key}
                  type="button"
                  data-testid={`signup-type-${t.key}`}
                  onClick={() => setForm((f) => ({ ...f, customer_type: t.key }))}
                  className={"flex-1 h-11 rounded-[10px] font-bold text-sm transition-colors " + (form.customer_type === t.key ? "bg-gold text-ink" : "text-[#5A3A30]")}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {form.customer_type === "wholesale" && (
            <>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="business" className="text-xs font-bold text-[#5A3A30]">Business / shop name</label>
                <input id="business" data-testid="signup-business" type="text" value={form.business_name} onChange={set("business_name")} placeholder="Name on your GST registration" className="h-12 border-[1.5px] border-line rounded-xl bg-white px-3.5 text-base outline-none focus:border-brick" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="gstin" className="text-xs font-bold text-[#5A3A30]">GSTIN (optional)</label>
                <input id="gstin" data-testid="signup-gstin" type="text" value={form.gstin} onChange={set("gstin")} placeholder="15-character GSTIN" className="h-12 border-[1.5px] border-line rounded-xl bg-white px-3.5 text-base outline-none focus:border-brick" />
              </div>
              <div className="bg-[#FFF0C9] text-[#5C3F00] rounded-[10px] px-3 py-2 text-xs leading-[17px]" data-testid="signup-wholesale-note">
                Wholesale prices unlock once the shop approves your account.
              </div>
            </>
          )}

          <label className="flex items-center gap-2.5 min-h-11 text-[13px] text-[#5A3A30]">
            <input type="checkbox" data-testid="signup-terms" checked={terms} onChange={(e) => setTerms(e.target.checked)} style={{ width: 22, height: 22, accentColor: "#D13A1F" }} className="m-0 flex-none" />
            I agree to the Terms and Privacy Policy
          </label>

          {error && <div className="bg-[#FDE3DE] text-maroon rounded-xl px-3.5 py-2.5 text-sm font-medium" data-testid="signup-error">{error}</div>}

          <button type="submit" disabled={busy} data-testid="signup-submit" className="h-14 rounded-2xl bg-brick text-white font-bold text-base disabled:opacity-60">
            {busy ? "Creating account…" : "Create account"}
          </button>

          <div className="flex justify-center items-center gap-1 text-sm text-[#5A3A30] pb-2">
            Already have an account?
            <Link to="/login" data-testid="signup-login-link" className="h-11 flex items-center px-1 text-brick font-bold">Login</Link>
          </div>
        </form>
      </div>
    </div>
  );
}
