import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { LogoMark } from "@/components/Layout";
import api, { apiError } from "@/lib/api";

const STEPS = { EMAIL: 1, OTP: 2, PASSWORD: 3, DONE: 4 };

export default function ForgotPassword() {
  const navigate = useNavigate();
  const [step, setStep] = useState(STEPS.EMAIL);
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);

  // ── Step 1: Send OTP ────────────────────────────────────────────────────────
  const handleSendOtp = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await api.post("/auth/forgot-password", { email: email.trim().toLowerCase() });
      setStep(STEPS.OTP);
      startResendCooldown();
    } catch (err) {
      setError(apiError(err));
    } finally {
      setBusy(false);
    }
  };

  // ── Step 2: Verify OTP ──────────────────────────────────────────────────────
  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await api.post("/auth/verify-otp", { email, otp: otp.trim() });
      setStep(STEPS.PASSWORD);
    } catch (err) {
      setError(apiError(err));
    } finally {
      setBusy(false);
    }
  };

  // ── Step 3: Reset password ──────────────────────────────────────────────────
  const handleResetPassword = async (e) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    if (newPassword.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }
    setError("");
    setBusy(true);
    try {
      await api.post("/auth/reset-password", {
        email,
        otp: otp.trim(),
        new_password: newPassword,
      });
      setStep(STEPS.DONE);
    } catch (err) {
      setError(apiError(err));
    } finally {
      setBusy(false);
    }
  };

  // ── Resend cooldown (30s) ───────────────────────────────────────────────────
  const startResendCooldown = () => {
    setResendCooldown(30);
    const interval = setInterval(() => {
      setResendCooldown((prev) => {
        if (prev <= 1) { clearInterval(interval); return 0; }
        return prev - 1;
      });
    }, 1000);
  };

  const handleResend = async () => {
    if (resendCooldown > 0) return;
    setError("");
    setBusy(true);
    try {
      await api.post("/auth/forgot-password", { email });
      startResendCooldown();
    } catch (err) {
      setError(apiError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] flex flex-col" data-testid="forgot-password-page">
      {/* Header */}
      <div className="bg-maroon px-6 pt-10 pb-14">
        <div className="flex items-center gap-2.5 mb-3.5">
          <LogoMark size={40} />
          <div className="font-display font-bold text-[22px] text-white">CrackerPOS</div>
        </div>
        <div className="font-display font-bold text-[28px] leading-[34px] text-white">
          {step === STEPS.EMAIL && "Forgot password?"}
          {step === STEPS.OTP && "Check your email"}
          {step === STEPS.PASSWORD && "Set new password"}
          {step === STEPS.DONE && "Password updated!"}
        </div>
        <div className="text-sm text-[#F3D9C4] mt-1.5">
          {step === STEPS.EMAIL && "Enter your email and we'll send a one-time code."}
          {step === STEPS.OTP && `We sent a 6-digit OTP to ${email}`}
          {step === STEPS.PASSWORD && "Choose a new password for your account."}
          {step === STEPS.DONE && "You can now log in with your new password."}
        </div>
      </div>

      <div className="flex-1 -mt-6 bg-cream rounded-t-[24px] px-4 py-5 flex flex-col gap-4">

        {/* Step indicator */}
        {step !== STEPS.DONE && (
          <div className="flex items-center gap-2">
            {[STEPS.EMAIL, STEPS.OTP, STEPS.PASSWORD].map((s) => (
              <div
                key={s}
                className={"h-1.5 flex-1 rounded-full transition-colors " +
                  (step >= s ? "bg-brick" : "bg-line")}
              />
            ))}
          </div>
        )}

        {/* ── Step 1: Email ── */}
        {step === STEPS.EMAIL && (
          <form onSubmit={handleSendOtp} className="flex flex-col gap-3.5" data-testid="fp-email-form">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold text-[#5A3A30]">Email address</label>
              <input
                type="email"
                required
                autoFocus
                data-testid="fp-email-input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="h-12 border-[1.5px] border-line rounded-xl bg-white px-3.5 text-base outline-none focus:border-brick"
              />
            </div>
            {error && (
              <div className="bg-[#FDE3DE] text-maroon rounded-xl px-3.5 py-2.5 text-sm font-medium" data-testid="fp-error">
                {error}
              </div>
            )}
            <button
              type="submit"
              disabled={busy}
              data-testid="fp-send-otp-btn"
              className="h-14 rounded-2xl bg-brick text-white font-bold text-base disabled:opacity-60"
            >
              {busy ? "Sending…" : "Send OTP"}
            </button>
            <Link to="/login" className="text-center text-sm text-brick font-bold py-2" data-testid="fp-back-to-login">
              Back to Login
            </Link>
          </form>
        )}

        {/* ── Step 2: OTP ── */}
        {step === STEPS.OTP && (
          <form onSubmit={handleVerifyOtp} className="flex flex-col gap-3.5" data-testid="fp-otp-form">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold text-[#5A3A30]">6-digit OTP</label>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                autoFocus
                data-testid="fp-otp-input"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="000000"
                className="h-14 border-[1.5px] border-line rounded-xl bg-white px-3.5 text-2xl font-bold tracking-[0.4em] outline-none focus:border-brick text-center"
              />
              <div className="text-xs text-mocha">
                Check your inbox (and spam folder). OTP is valid for 10 minutes.
              </div>
            </div>
            {error && (
              <div className="bg-[#FDE3DE] text-maroon rounded-xl px-3.5 py-2.5 text-sm font-medium" data-testid="fp-error">
                {error}
              </div>
            )}
            <button
              type="submit"
              disabled={busy || otp.length !== 6}
              data-testid="fp-verify-otp-btn"
              className="h-14 rounded-2xl bg-brick text-white font-bold text-base disabled:opacity-60"
            >
              {busy ? "Verifying…" : "Verify OTP"}
            </button>
            <div className="flex items-center justify-between text-sm">
              <button
                type="button"
                onClick={handleResend}
                disabled={resendCooldown > 0 || busy}
                data-testid="fp-resend-btn"
                className="text-brick font-bold disabled:text-mocha disabled:font-normal"
              >
                {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend OTP"}
              </button>
              <button
                type="button"
                onClick={() => { setStep(STEPS.EMAIL); setOtp(""); setError(""); }}
                className="text-mocha"
                data-testid="fp-change-email-btn"
              >
                Change email
              </button>
            </div>
          </form>
        )}

        {/* ── Step 3: New Password ── */}
        {step === STEPS.PASSWORD && (
          <form onSubmit={handleResetPassword} className="flex flex-col gap-3.5" data-testid="fp-password-form">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold text-[#5A3A30]">New password</label>
              <input
                type="password"
                required
                autoFocus
                data-testid="fp-new-password-input"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="At least 6 characters"
                className="h-12 border-[1.5px] border-line rounded-xl bg-white px-3.5 text-base outline-none focus:border-brick"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold text-[#5A3A30]">Confirm new password</label>
              <input
                type="password"
                required
                data-testid="fp-confirm-password-input"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repeat password"
                className="h-12 border-[1.5px] border-line rounded-xl bg-white px-3.5 text-base outline-none focus:border-brick"
              />
            </div>
            {error && (
              <div className="bg-[#FDE3DE] text-maroon rounded-xl px-3.5 py-2.5 text-sm font-medium" data-testid="fp-error">
                {error}
              </div>
            )}
            <button
              type="submit"
              disabled={busy}
              data-testid="fp-reset-password-btn"
              className="h-14 rounded-2xl bg-brick text-white font-bold text-base disabled:opacity-60"
            >
              {busy ? "Updating…" : "Update Password"}
            </button>
          </form>
        )}

        {/* ── Step 4: Done ── */}
        {step === STEPS.DONE && (
          <div className="flex flex-col gap-4 items-center pt-4" data-testid="fp-done">
            <div className="w-16 h-16 rounded-full bg-[#DDF1E3] flex items-center justify-center">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#1F5F36" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <div className="text-center">
              <div className="font-bold text-lg text-ink">Password updated!</div>
              <div className="text-sm text-mocha mt-1">Log in with your new password.</div>
            </div>
            <button
              onClick={() => navigate("/login")}
              data-testid="fp-go-to-login-btn"
              className="h-14 w-full rounded-2xl bg-brick text-white font-bold text-base"
            >
              Go to Login
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
