import { useMemo, useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Search, Minus, Plus, ArrowRight, Sparkles } from "lucide-react";
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useCart } from "@/context/CartContext";
import ProductIcon, { iconBg } from "@/components/ProductIcon";
import { priceShort, computeTotals } from "@/lib/totals";

// ── Shop Hero Banner ──────────────────────────────────────────────────────────
function HeroBanner({ title, subtitle, imageUrl }) {
  return (
    <div
      data-testid="shop-hero-banner"
      className="relative overflow-hidden"
      style={{
        minHeight: 140,
        background: imageUrl
          ? `linear-gradient(to bottom, rgba(43,23,18,0.12) 0%, rgba(43,23,18,0.75) 70%, #7A1410 100%), url('${imageUrl}') center/cover no-repeat`
          : "linear-gradient(160deg, #D13A1F 0%, #7A1410 55%, #2B1712 100%)",
      }}
    >
      {/* Decorative glints */}
      <span className="absolute top-4 right-8 text-gold opacity-50" style={{ fontSize: 9 }}>★</span>
      <span className="absolute top-8 right-20 text-gold opacity-25" style={{ fontSize: 6 }}>✦</span>
      <span className="absolute top-3 right-36 text-gold opacity-20" style={{ fontSize: 7 }}>★</span>

      {/* Text block */}
      <div className="relative px-5 sm:px-8 pt-6 sm:pt-8 pb-5 sm:pb-7">
        <p className="text-white font-bold text-xl sm:text-3xl leading-snug tracking-tight max-w-xl drop-shadow">
          {title}
        </p>
        {subtitle && (
          <p className="text-white/70 text-sm sm:text-base mt-1.5 max-w-md leading-snug">
            {subtitle}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Popular Picks Banner ──────────────────────────────────────────────────────
function PopularBanner({ count }) {
  return (
    <div
      data-testid="popular-banner"
      className="mx-3 sm:mx-5 mt-3 sm:mt-4 rounded-2xl overflow-hidden relative"
      style={{ background: "#2B1712" }}
    >
      {/* Colour accent — left edge burst */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: "radial-gradient(ellipse 70% 130% at 0% 50%, #D13A1F 0%, #7A1410 50%, transparent 100%)",
          opacity: 0.7,
        }}
      />

      {/* Decorative stars */}
      <span className="absolute top-3 right-8 text-gold opacity-50" style={{ fontSize: 8, lineHeight: 1 }}>★</span>
      <span className="absolute bottom-3 right-20 text-gold opacity-30" style={{ fontSize: 6, lineHeight: 1 }}>★</span>
      <span className="absolute top-4 right-28 text-gold opacity-20" style={{ fontSize: 5, lineHeight: 1 }}>✦</span>
      <span className="absolute bottom-4 right-12 text-gold opacity-25" style={{ fontSize: 7, lineHeight: 1 }}>✦</span>

      {/* Content */}
      <div className="relative flex items-center gap-3 sm:gap-5 px-4 sm:px-6 py-4 sm:py-5">
        {/* Icon */}
        <div className="flex-none w-10 h-10 sm:w-14 sm:h-14 rounded-xl sm:rounded-2xl flex items-center justify-center"
          style={{ background: "rgba(245,184,46,0.15)", border: "1px solid rgba(245,184,46,0.3)" }}>
          <Sparkles size={20} className="text-gold" />
        </div>

        {/* Text */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-gold font-bold text-lg sm:text-2xl leading-tight tracking-tight">
              Popular Picks
            </span>
            {count > 0 && (
              <span
                data-testid="popular-banner-count"
                className="text-gold font-bold text-[10px] sm:text-xs px-2 py-0.5 rounded-full"
                style={{ background: "rgba(245,184,46,0.2)", border: "1px solid rgba(245,184,46,0.4)" }}
              >
                {count} items
              </span>
            )}
          </div>
          <p className="text-sm sm:text-base mt-0.5 truncate" style={{ color: "rgba(255,246,232,0.55)" }}>
            Best-selling fireworks — curated by the shop
          </p>
        </div>
      </div>
    </div>
  );
}

export default function Shop() {
  const [category, setCategory] = useState("All");
  const [q, setQ] = useState("");
  const { user } = useAuth();
  const { items, add, setQty } = useCart();

  const { data: products = [], isLoading } = useQuery({
    queryKey: ["products"],
    queryFn: () => api.get("/products").then((r) => r.data),
  });

  const { data: allCategories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: () => api.get("/categories").then((r) => r.data),
  });

  const { data: shopInfo } = useQuery({
    queryKey: ["shop-info"],
    queryFn: () => api.get("/settings/public").then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });

  // Apply default category from settings once on mount (only if user hasn't manually changed it)
  const defaultApplied = useRef(false);
  useEffect(() => {
    if (!defaultApplied.current && shopInfo?.default_category) {
      defaultApplied.current = true;
      setCategory(shopInfo.default_category);
    }
  }, [shopInfo?.default_category]);

  // Show all DB categories; compute per-category product count
  const categories = allCategories;
  const countOf = useMemo(() => {
    const map = {};
    products.forEach((p) => { map[p.category] = (map[p.category] || 0) + 1; });
    return map;
  }, [products]);

  const visible = products.filter(
    (p) =>
      (category === "All" || p.category === category) &&
      p.name.toLowerCase().includes(q.trim().toLowerCase())
  );

  const wholesale = user?.customer_type === "wholesale" && user?.approved;
  const qtyOf = (id) => items.find((i) => i.product_id === id)?.qty || 0;
  const lines = items
    .map((i) => {
      const p = products.find((x) => x.id === i.product_id);
      return p ? { ...i, price: wholesale ? p.wholesale_price : p.retail_price } : null;
    })
    .filter(Boolean);
  const totals = computeTotals(lines);

  return (
    <div className="max-w-6xl mx-auto pb-32 md:pb-20">
      {/* Search bar — hero banner sits inside the same maroon block */}
      <div className="bg-maroon md:rounded-b-2xl">
        {(shopInfo?.hero_title || shopInfo?.hero_image_url) && (
          <HeroBanner
            title={shopInfo.hero_title}
            subtitle={shopInfo.hero_subtitle}
            imageUrl={shopInfo.hero_image_url}
          />
        )}
        <div className="px-5 pb-5 pt-2">
          <div className="h-12 bg-white rounded-xl flex items-center gap-2.5 px-4 max-w-6xl mx-auto">
            <Search size={20} className="text-mocha" />
            <input
              data-testid="shop-search-input"
              type="text"
              value={q}
              onChange={(e) => { setQ(e.target.value); if (e.target.value) setCategory("All"); }}
              placeholder="Search Anar, Ladi, Rocket…"
              className="flex-1 bg-transparent outline-none text-sm text-ink placeholder:text-mocha min-w-0"
            />
          </div>
        </div>
      </div>

      {wholesale && (
        <div className="mx-5 mt-4 bg-[#DDF1E3] text-[#1F5F36] text-xs font-bold rounded-xl px-4 py-3" data-testid="wholesale-active-note">
          Wholesale pricing applied
        </div>
      )}
      {user?.customer_type === "wholesale" && !user?.approved && (
        <div className="mx-5 mt-4 bg-[#FFF0C9] text-[#5C3F00] text-xs font-bold rounded-xl px-4 py-3" data-testid="wholesale-pending-note">
          Wholesale prices unlock once the shop approves your account.
        </div>
      )}

      {/* Category chips — single horizontal scroll row */}
      <div
        className="flex gap-2 sm:gap-2.5 px-4 sm:px-5 pt-2.5 sm:pt-4 pb-2 sm:pb-3 sticky top-16 z-20 bg-cream border-b border-line overflow-x-auto"
        style={{ scrollbarWidth: "none", WebkitOverflowScrolling: "touch" }}
        data-testid="category-chips"
      >
        {[{ id: "all", name: "All" }, ...categories].map((c) => (
          <button
            key={c.id}
            data-testid={`chip-${c.name.toLowerCase().replace(/[^a-z]+/g, "-")}`}
            onClick={() => setCategory(c.name)}
            className={
              "flex-none h-7 sm:h-9 px-3 sm:px-4 rounded-xl sm:rounded-[18px] border font-bold text-xs sm:text-sm transition-colors flex items-center gap-1 sm:gap-1.5 " +
              (category === c.name
                ? "bg-maroon border-maroon text-white"
                : "bg-white border-line text-ink font-medium hover:border-maroon/40")
            }
          >
            {c.name}
            {c.id !== "all" && countOf[c.name] > 0 && (
              <span className={"text-[10px] sm:text-[11px] font-bold rounded-full px-1 sm:px-1.5 py-px leading-none " +
                (category === c.name ? "bg-white/20 text-white" : "bg-chip text-mocha")}>
                {countOf[c.name]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Popular Picks banner — shown when Popular category is active */}
      {category === "Popular" && (
        <PopularBanner count={visible.length} />
      )}

      {/* Product grid / list */}
      {isLoading ? (
        <div className="flex flex-col sm:grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 sm:gap-4 px-3 sm:px-5 pt-3 sm:pt-5" data-testid="shop-loading">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="bg-white border border-line rounded-2xl h-14 sm:h-60 animate-pulse" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className="px-5 py-20 text-center text-mocha" data-testid="shop-empty">
          No products found{q ? ` for "${q}"` : ""}.
        </div>
      ) : (
        <div className="flex flex-col sm:grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 sm:gap-4 px-3 sm:px-5 pt-3 sm:pt-5">
          {visible.map((p) => {
            const qty = qtyOf(p.id);
            const price = wholesale ? p.wholesale_price : p.retail_price;
            const out = p.stock === 0;
            const slug = p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
            return (
              <div
                key={p.id}
                data-testid={`product-card-${slug}`}
                className="bg-white border border-line rounded-2xl
                  flex items-center gap-3 px-3 py-2.5
                  sm:flex-col sm:items-stretch sm:gap-3 sm:p-4"
              >
                {/* Icon */}
                <div
                  className="w-11 h-11 flex-none rounded-xl flex items-center justify-center
                    sm:h-[88px] sm:w-full"
                  style={{ background: iconBg(p.icon) }}
                >
                  <ProductIcon icon={p.icon} />
                </div>

                {/* Info — middle */}
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-sm leading-snug">{p.name}</div>
                  <div className="text-xs text-mocha">{p.pack_type} · {p.pack_size}</div>
                  {p.brand && <div className="text-[10px] sm:text-xs font-bold text-brick uppercase tracking-wide">{p.brand}</div>}
                  {/* Price inline on mobile */}
                  <div className="font-bold text-sm text-ink mt-0.5 sm:hidden">{priceShort(price)}</div>
                  {/* Stock warning inline on mobile */}
                  {!out && p.stock <= 10 && (
                    <span className="sm:hidden text-[10px] font-bold text-maroon" data-testid={`stock-${slug}`}>
                      {p.stock} left
                    </span>
                  )}
                </div>

                {/* Desktop-only price row */}
                <div className="hidden sm:flex items-center justify-between min-h-[26px]">
                  <div className="font-display font-bold text-lg">{priceShort(price)}</div>
                  {!out && p.stock <= 10 && (
                    <span className="text-[11px] font-bold text-maroon bg-[#FFE3A3] rounded-lg px-2 py-[3px]" data-testid={`stock-${slug}`}>
                      {p.stock} left
                    </span>
                  )}
                </div>

                {/* Add / Stepper — compact on mobile, full on desktop */}
                <div className="flex-none">
                  {out ? (
                    <button disabled className="h-9 sm:h-11 w-16 sm:w-full rounded-xl bg-chip text-mocha font-bold text-xs sm:text-sm">Out</button>
                  ) : qty > 0 ? (
                    <div
                      className="h-9 sm:h-11 border-[1.5px] border-brick rounded-xl overflow-hidden flex items-stretch w-[88px] sm:w-full"
                      data-testid={`stepper-${slug}`}
                    >
                      <button
                        aria-label={`Decrease ${p.name}`}
                        data-testid={`dec-${slug}`}
                        onClick={() => setQty(p.id, qty - 1)}
                        className="w-8 sm:w-11 text-brick font-bold flex items-center justify-center"
                      >
                        <Minus size={15} />
                      </button>
                      <div className="flex-1 flex items-center justify-center font-bold text-sm" data-testid={`qty-${slug}`}>
                        {qty}
                      </div>
                      <button
                        aria-label={`Increase ${p.name}`}
                        data-testid={`inc-${slug}`}
                        onClick={() => (qty < p.stock ? add(p, 1) : null)}
                        className="w-8 sm:w-11 bg-brick text-white font-bold flex items-center justify-center"
                      >
                        <Plus size={15} />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => add(p, 1)}
                      data-testid={`add-${slug}`}
                      className="h-9 sm:h-11 px-4 sm:px-0 sm:w-full rounded-xl bg-brick text-white font-bold text-xs sm:text-sm active:scale-[0.98] transition-transform"
                    >
                      Add
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Sticky cart bar */}
      {totals.items > 0 && (
        <div className="fixed bottom-16 md:bottom-4 inset-x-0 px-5 z-30">
          <Link
            to="/cart"
            data-testid="sticky-cart-bar"
            className="max-w-6xl mx-auto h-14 rounded-2xl bg-ink text-white flex items-center justify-between px-5 hover:opacity-95 transition-opacity"
          >
            <div className="flex flex-col gap-0.5">
              <div className="text-xs text-gold font-medium">{totals.items} items · {totals.units} units</div>
              <div className="font-display font-bold text-xl leading-6">{priceShort(totals.grand)}</div>
            </div>
            <div className="flex items-center gap-2 text-gold font-bold text-[15px]">
              View cart <ArrowRight size={20} />
            </div>
          </Link>
        </div>
      )}
    </div>
  );
}
