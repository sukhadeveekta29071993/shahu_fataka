import axios from "axios";

const api = axios.create({
  baseURL: `${process.env.REACT_APP_BACKEND_URL}/api`,
  withCredentials: true,
});

// Auto-refresh on 401: try /auth/refresh once, then retry original request.
// Skips verify-pin (its 401 is "wrong PIN", not an expired session).
let refreshing = null;
api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const cfg = err.config;
    const is401 = err.response?.status === 401;
    const isRefreshOrLogin = cfg.url?.includes("/auth/refresh") || cfg.url?.includes("/auth/login") || cfg.url?.includes("/auth/me");
    const isVerifyPin = cfg.url?.includes("verify-pin");
    if (is401 && !cfg._retry && !isRefreshOrLogin && !isVerifyPin) {
      cfg._retry = true;
      if (!refreshing) {
        refreshing = api.post("/auth/refresh").finally(() => { refreshing = null; });
      }
      try {
        await refreshing;
        return api(cfg);
      } catch {
        // Refresh failed — redirect to login
        window.location.href = "/login";
      }
    }
    return Promise.reject(err);
  }
);

export function apiError(e, fallback = "Something went wrong. Please try again.") {
  const d = e?.response?.data?.detail;
  if (d == null) return fallback;
  if (typeof d === "string") return d;
  if (Array.isArray(d)) {
    return d
      .map((x) => (x && typeof x.msg === "string" ? x.msg : JSON.stringify(x)))
      .filter(Boolean)
      .join(", ");
  }
  if (typeof d === "object" && typeof d.msg === "string") return d.msg;
  return fallback;
}

export default api;
