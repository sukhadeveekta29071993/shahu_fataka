# CrackerPOS — Fireworks E-Commerce (PRD)

## Original problem statement
"Build me this for e comm fire works" — based on the uploaded 'CrackerPOS Mockups' HTML (fireworks shop app, India market: ₹ pricing, CGST/SGST 9%+9%, UPI, retail/wholesale). User choices: **customer e-commerce only** (shop, cart, checkout, login/signup), **mock UPI payment** (QR + mark-as-received), **email+password auth**, **plain tool-like UI faithful to mockups**.

Phase 2 (Owner Dashboard & Wholesale Approvals): Added shop-owner POS billing screen, dashboard with stats, and wholesale buyer approval UI.

## User personas
- Retail customer: browses fireworks, adds to cart, pays via mock UPI or cash/card on delivery, tracks orders.
- Wholesale buyer: signs up as wholesale, sees retail prices until shop approves; wholesale prices unlock after approval.
- Shop owner (admin): views dashboard stats, bills walk-in customers via POS screen, approves/rejects wholesale accounts.

## Architecture
- Backend: FastAPI (server.py) + MongoDB (motor), JWT auth (httpOnly cookies + Bearer fallback), bcrypt hashing, brute-force lockout, CORS allow-origin-regex for preview hosts.
- Collections: users, products, orders, counters (invoice seq), login_attempts.
- Frontend: React CRA + Tailwind, contexts (Auth, Cart), react-router, react-query, qrcode.react for UPI QR.
- Order pipeline: server-side price resolution (retail/wholesale), stock guard ($gte) + decrement, CGST 9% + SGST 9%, round-off, invoice no FW/{FY}/{seq}.
- Admin routes: /admin, /admin/pos, /admin/wholesale — protected by AdminLayout + require_admin backend guard.

## Core requirements (static)
- Product catalog with 6 categories (Anar, Fulzadi, Bomb & Sutli, Fancy Phatake, Ladi, Rockets), search, stock badges.
- Cart with qty steppers, GST totals, persisted in localStorage.
- Checkout: UPI (QR, UTR, instant Paid) / Cash / Card (Pending, pay on delivery).
- Receipt: 80mm-style tax invoice, HSN GST summary, rupees-in-words, verify QR, safety notes.
- Auth: email+password register/login, retail vs wholesale signup with business name/GSTIN.

## Implemented

### Phase 1 (2026-10-18)
- Full backend API + seed (8 products, demo retail/wholesale customers, admin).
- Shop, Cart, Checkout, Receipt, Orders, Login, Signup pages; header + mobile bottom nav; sticky cart bar.
- Verified: curl chain (login→me→order→stock decrement→401 guard) and desktop+mobile screenshot flows.

### Phase 2 (2026-10-18)
- **Owner Dashboard** `/admin`: Stats cards (today revenue, today orders, total orders, pending wholesale), low-stock alert panel (products ≤10 in stock), recent orders table (all customers, links to receipts).
- **POS Billing** `/admin/pos`: Two-panel layout (products grid + sticky order panel), walk-in customer name/phone inputs, retail/wholesale selector, cash/upi/card payment, stock-guarded order creation, navigates to receipt with admin-specific buttons (New Order / Dashboard).
- **Wholesale Approvals** `/admin/wholesale`: All/Pending/Approved/Rejected filter tabs, user cards with business details, Approve (unlock wholesale prices) and Reject/Revoke buttons.
- **Admin navigation**: Header switches to Dashboard/POS/Wholesale for admin users; mobile bottom nav does too; admin redirect on login.
- **Role in JWT response**: `user_out` and `UserOut` model now expose `role` field.
- **POS receipt**: Shows customer phone, `is_pos` flag on order; receipt shows "New Order" / "Dashboard" buttons for admin.
- **Admin order view**: Admin can view any order receipt via `GET /api/orders/{id}` (role bypass).

### Phase 3 (2026-10-18)
- **Stock Restock Tool** on admin dashboard: Products & Stock section lists all products; pencil icon opens inline number input; Save/Cancel/Escape to commit or discard; invalidates both low-stock alert and POS product list on save.
- **Print Receipt**: "Print receipt" button on all receipt pages; triggers `window.print()`; `@page { size: 80mm auto; margin: 4mm }` in CSS; header/nav hidden via `@media print`; receipt card rendered full-width, shadow/border removed for clean thermal output.

## API endpoints
- `POST /api/auth/register` & `POST /api/auth/login` & `POST /api/auth/logout`
- `GET /api/auth/me` — returns `role` field
- `GET /api/products`
- `POST /api/orders` (customer), `GET /api/orders`, `GET /api/orders/{id}`
- `GET /api/admin/stats`
- `GET /api/admin/orders?limit=N`
- `GET /api/admin/wholesale`
- `PATCH /api/admin/wholesale/{id}/approve`
- `PATCH /api/admin/wholesale/{id}/reject`
- `POST /api/admin/pos`
- `PATCH /api/admin/products/{id}/stock` (body `{stock: int}`)
- `POST /api/admin/products` (body: full `ProductIn`)
- `PATCH /api/admin/products/{id}` (body: full `ProductIn`, updates all fields + stock)
- `DELETE /api/admin/products/{id}`

## DB schema
- `users`: `{_id, name, email, phone, hashed_password, role, customer_type, approved, rejected, business_name, gstin, created_at}`
- `products`: `{_id, name, brand, category, pack_type, pack_size, icon, retail_price, wholesale_price, stock, hsn}`
- `orders`: `{_id, user_id, invoice_no, customer_name, customer_phone, customer_type, items, subtotal, cgst, sgst, round_off, total, status, payment_mode, utr, is_pos, created_at}`

### Phase 4 (2026-10-18)
- **Product Management**: "Add product" button in Products & Stock section opens a modal (name, category dropdown, 8-icon picker, pack type, pack size, retail price, wholesale price, HSN, initial stock). PenLine icon on each row opens the same modal pre-filled. Delete with inline confirm. Backed by `POST`, `PATCH`, `DELETE /api/admin/products/{id}`.
- **Order Filters**: Above the orders table on the admin dashboard — date quick-filters (All time, Today, Last 7 days, Last 30 days), status chips (Paid / Pending), type chips (POS / Online). All client-side on 100 loaded orders. Filters compose (AND logic). Count badges show matching totals.

### Phase 5 (2026-10-18)
- **Bulk Stock Import**: "Import CSV" button in Products & Stock section header opens a 3-phase modal: (1) Upload — download pre-filled template.csv or drag-drop a CSV file; (2) Preview — client-side parse, 3-column table (Product / Current / New) with checkmark/warning icons and summary badges; (3) Results — before/after table. Backend `POST /api/admin/products/bulk-stock` parses CSV, deduplicates by name, validates non-negative integers, returns `{updated, not_found, errors}`.
### Phase 6 (2026-10-18)
- **Brand / Company field on Products**: Added optional `brand` field (e.g. Standard, Laxmi, Royal) to product schema. Admins set it via Add/Edit modal ("Brand / Company" input). Shows as a small red uppercase label on same line as product name (right-aligned) on Shop cards and POS cards.
- **Salesperson Management**: Admin can add/remove salespersons from the dashboard. POS screen has a salesperson dropdown. Salesperson name stored on order and shown on the printed bill/receipt.

### Phase 7 (2026-10-18)
- **Code Quality Hardening**: `server.py get_order()` restructured so `doc` is always assigned; `CartContext`/`AuthContext` functions in `useCallback` + values in `useMemo`; empty catch blocks now log via `console.error`; array-index keys replaced with composite keys in `Receipt.js` and `BulkStockModal.js`; receipt `useQuery` uses `retry: 1`.

### Phase 8 (2026-10-18)
- **Salesperson Report**: New `/admin/reports` page (Reports tab in admin nav). Shows 3 summary cards (revenue, orders, top seller) and a per-salesperson breakdown table (orders, revenue, last sale date). Salespersons with 0 orders appear with dashes.
- **Real Shop Details on Receipt**: Bill now shows Balaji Fataka, address, Ph: 9637662411, GSTIN: 27BGPPA1777A1ZL, Explosives Lic: 108975582503.

### Phase 10 (2026-10-18)
- **Category Filter on Shop**: Chips now sticky below search bar so they stay visible while scrolling. Each chip shows product count badge (e.g. "Fancy Phatake 3"). Active chip is maroon/filled. Typing in search auto-resets category to All.


- **Date Filter on Salesperson Report**: Quick chips — All time / Today / This week / This month / Custom. Custom option reveals two date pickers (from/to). Summary cards and breakdown table re-fetch for the selected range. Range label shown under each summary card.

- P1: Real UPI gateway (Razorpay).
- P2: Discounts/coupons, forgot-password flow, delivery addresses.
- P3: Analytics charts on dashboard (revenue trend, top products).


### Phase 11 (2026-10-18)
- **Low Stock Alert Banner**: Prominent amber banner at top of Admin Dashboard when any product has ≤ 10 units. Shows product name, brand, stock badge, and Restock quick-link. Collapsible and dismissable per session.

### Phase 12 (2026-10-18)
- **Category Management in Admin**: Categories moved from hardcoded array to MongoDB. Admin can add, rename, and delete categories from the Dashboard. Delete blocked if products use that category (shows tooltip + disabled state). Each category shows product count. Shop chips and Product modal dropdown both use live API. Duplicate block in AdminPOS product cards also fixed.

### Phase 13 (2026-10-18)
- **Salesperson Shift PIN System**: Admin sets a 4-digit PIN per salesperson from Dashboard. On POS, "Start Shift" button opens a picker modal — select salesperson, enter PIN → shift goes active. All bills auto-attribute to that salesperson (no per-bill dropdown). Salespersons without PIN start shift directly. "End Shift" clears session. Receipt and reports update automatically. PIN stored as bcrypt hash.

### Phase 18 (2026-02-xx) — Barcode in Product Modal + Bulk Barcode Export
- **Barcode on New Products**: After saving a new product via "Add Product" modal, the modal transitions to a success screen showing the auto-generated barcode SVG (`react-barcode`), product name, and price. Staff can tap "Print Label" (triggers `setPrintLabelProduct` in Dashboard) or "Done" to close.
- **Barcode in Edit Modal**: Editing an existing product now shows a read-only Barcode section at the bottom of the form with the barcode SVG and a "Print Label" shortcut button.
- **Bulk Barcode CSV Export**: "Barcode CSV" button added to the Products & Stock header. Downloads a CSV via new `GET /api/admin/products/barcode-export` endpoint with columns: Product Name, Brand, Category, Barcode, Retail Price — ready for offline label printing or import into a label software.
- **Print CSS fix**: Label print `useEffect` now uses `visibility: hidden / visible` approach (instead of `display: none`) so nested DOM elements print correctly.
- **DB Seeding**: `gen_barcodes.py` run — assigned unique 12-digit `890xxxxxxxxx` barcodes to all 65 existing products.
- **Backend fix**: `product_out()` helper updated to include `barcode` field in all product API responses.
- **Admin Dashboard — Print Labels**: Each product row now has a "Print Label" printer-icon button (`data-testid="print-label-btn-{id}"`). Header also has "Print Labels" bulk button. Clicking either injects `@page { size: 62mm 35mm }` CSS and calls `window.print()` showing only the selected label(s) — product name, brand, price, and `react-barcode` SVG.
- **Admin Dashboard — Scanner Mode toggle**: New toggle switch in Shop Settings (`data-testid="settings-scanner-mode-toggle"`) saves `scanner_mode: bool` to the `settings` MongoDB collection alongside existing UPI/email fields.
- **Admin POS — Scanner Mode bar**: When `scanner_mode` is ON, a persistent highlighted input bar appears at the top of the product list (`data-testid="scanner-bar"`). USB/BT barcode scanners fire keystrokes ending in Enter; the bar captures these, calls `GET /api/products/barcode/{code}`, and auto-adds the matched product to cart. Green flash on success, red + "Not found" on miss. Scanner input auto-refocuses after every cart change.
- **Forgot Password (OTP via Email)**: 3-step flow on `/forgot-password` — Step 1: enter email → OTP sent via Emergent Managed Resend; Step 2: enter 6-digit OTP (10-min expiry, resend with 30s cooldown); Step 3: set new password. Backend: `POST /api/auth/forgot-password`, `POST /api/auth/verify-otp`, `POST /api/auth/reset-password`. OTPs stored in `password_reset_otps` MongoDB collection. Brute-force lockout cleared on successful reset.
- **"Forgot password?" link** added to Login page.
- **Bluetooth ESC/POS Print**: Web Bluetooth API integration for BTP-802 thermal printer (shows as "Printer001"). "Connect Printer" button auto-discovers BLE GATT characteristic across 5 known service UUIDs. "Print via Bluetooth" sends full ESC/POS receipt directly over BLE in 20-byte chunks. Falls back to `window.print()` on desktop. Built in `/app/frontend/src/lib/btPrinter.js`.
- **Brand name layout**: Brand moved to its own line below pack info, red bold text, on both Shop cards and POS cards.
- **Dedicated Salesperson Login (Option B)**: Salespersons get their own email/password accounts (role: salesperson). Admin creates accounts from Dashboard. On login, salespersons land directly on /admin/pos — all other admin routes redirect back to /admin/pos. Shift auto-starts silently (no PIN modal). Static "On shift" bar shown — no Start/End controls. Orders auto-attributed to salesperson via JWT.
- **Bug fixes**: UserOut model now exposes salesperson_id; password field naming unified to password_hash; Login.js handles salesperson redirect; AdminProtected in App.js allows salesperson role; shift-start-no-pin and shift-end endpoints now use require_pos_access so salespersons can call them.

### Phase 25 (2026-02-xx) — IP-based Login Lockout (Security)
- **Upgraded from email-based to IP-based lockout**: `get_client_ip()` reads `X-Forwarded-For` (Kubernetes ingress) falling back to `request.client.host`. After 5 failed attempts from the same IP, that IP is blocked for 15 minutes.
- **Exact countdown in error**: 429 response includes `"Try again in 14m 59s."` with live remaining seconds.
- **Login page lockout UI**: 429 response triggers a `ShieldAlert` banner, disables form inputs and button, shows "Temporarily Locked" on the submit button.
- **Admin Blocked IPs panel**: `GET /api/admin/locked-ips` lists all active locks with attempt count, email tried, and countdown. `DELETE /api/admin/locked-ips/{ip}` manually clears any lock. Rendered as `LockedIPsPanel` in Admin Dashboard settings tab — auto-refreshes every 30 seconds.
- **Counter resets on success**: Successful login from the same IP clears the record immediately.

### Phase 24 (2026-02-xx) — Admin Credential Change (Security Fix)
- **Root cause**: No `PATCH /admin/profile` endpoint existed. Any credential "change" the admin attempted was silently ignored, and the hardcoded `.env` defaults kept the old session working.
- **`PATCH /api/admin/profile`**: New endpoint requiring `current_password` + optional `new_email` / `new_password`. Verifies current password via bcrypt, saves new hash to DB, then immediately **deletes both cookies** — old session is dead the instant the change saves.
- **Change Credentials UI**: New `ChangeCredentialsSection` component in Admin Dashboard — current password (required), new email, new password, confirm password, show/hide toggles. After save: 1.8s success toast → auto-logout → redirect to `/login`.
- **Security verified**: Wrong current password returns 400; old password is rejected immediately after change; new password works on first try.

### Phase 23 (2026-02-xx) — Popular Products + Shop Hero Banner
- **8 Popular products assigned**: 10 K STD, 10 K (A), Payali sparkle, FULZADI LONG, Anar 4 Inch, Fancy Crackle Box, Pop Pop (Box), Whistling Rocket — moved to "Popular" category and visible in the Popular Picks view.
- **Shop Hero Banner**: `HeroBanner` component renders above the search bar when `hero_title` or `hero_image_url` is set in Settings. Uses real fireworks photo from Unsplash with a dark gradient overlay for text legibility.
- **Admin Settings — Hero section**: Three inputs (Headline, Subheading, Image URL) with a live preview tile. All three fields are optional; leaving them blank hides the hero entirely.
- **Backend**: `hero_title`, `hero_subtitle`, `hero_image_url` added to both `/admin/settings` (GET/PATCH) and `/settings/public` (no-auth GET).
- Default hero seeded: "Biggest Sale of the Season" with multicoloured fireworks Unsplash photo.

### Phase 23 (2026-02-xx) — Admin Dashboard Accordion Effect
- **Accordion on all list cards**: Low Stock banner, Orders, Products & Stock, and Salespersons sections now cap their lists at 5 items by default with a "Show N more" chevron toggle button at the bottom. Clicking it expands to show all items and clicking again collapses back to 5.
- `showAllLowStock`, `showAllOrders`, `showAllProducts`, `showAllSalespersons` states added to `AdminDashboard`.
- `filteredProducts` extracted into `useMemo` (products filtered by category chip) to avoid duplicate expression.
- Orders section: removed old `max-h-[380px]` overflow container in favour of the accordion toggle.

### Phase 22 (2026-02-xx) — Popular Picks Banner on Shop
- **PopularBanner component**: Shows a rich dark banner (ink + brick gradient accent, gold headline, Sparkles icon, decorative stars) between the category chips and product grid whenever the "Popular" category is selected — works both as a default and when the customer manually taps the chip.
- The banner shows `{count} items` badge when the Popular category has products assigned.
- `Star` import removed, decorative elements use Unicode for reliability.

### Phase 21 (2026-02-xx) — UPI/GST Invoice Bug Fixes
- **Dynamic UPI on QR codes**: Added `GET /api/settings/public` (no auth) returning `upi_id` + `upi_name` from DB. `Receipt.js` and `Checkout.js` now fetch this endpoint — QR code and UPI text always reflect the current shop UPI ID set in Settings.
- **GST stale-cache fix**: `AdminPOS.js` settings query uses `staleTime: 0, refetchOnMount: true` so POS always reads latest `gst_enabled` when opened. `SettingsSection` now calls `queryClient.invalidateQueries(["admin-settings"])` and `["shop-info"]` after save — all subscribers get fresh data immediately.
- **`/api/auth/me` endpoint added**: `GET /api/auth/me` now returns the current user. `AuthContext` was already calling this on mount; its absence meant hard page reloads on protected routes logged users out.

### Phase 20 (2026-02-xx) — GST Toggle in Settings
- **GST Toggle**: New toggle in Shop Settings (`data-testid="settings-gst-toggle"`) labelled "GST on Bills (CGST 9% + SGST 9%)". When ON, all bills add CGST 9% + SGST 9% on the taxable amount; when OFF, no GST.
- **Backend**: `gst_enabled` added to settings GET/PATCH. Both POS (`POST /api/admin/pos`) and customer checkout (`POST /api/orders`) read `gst_enabled` from the `settings` collection and compute `cgst`/`sgst` dynamically.
- **POS live preview**: CGST and SGST rows appear in the order panel totals when GST is on (`data-testid="pos-cgst-line"`, `pos-sgst-line"`).
- **Receipt**: CGST/SGST rows shown on the printed invoice when `order.cgst > 0` (`data-testid="receipt-cgst"`, `"receipt-sgst"`).
- **`computeTotals`**: Updated to accept `gstEnabled` third argument and return correct `cgst`, `sgst` and `grand`.

### Phase 19 (2026-02-xx) — POS Scanner & Customer Info Bug Fixes
- **New-product scanner bug fixed**: `addToCart` now stores `retail_price` + `wholesale_price` directly in cart state. `lines` uses them as a fallback when the product isn't yet in the React-Query cache. Also invalidates the products cache on each successful scan so the grid refreshes. This means any product added to inventory is immediately billable via scanner — no page reload required.
- **Scanner focus-steal bug fixed**: Scanner input `onBlur` handler now checks `relatedTarget.tagName` before re-focusing — it only re-grabs focus if going to a non-input element. The `useEffect` that refocuses on cart changes also checks `document.activeElement` to avoid stealing from other inputs. Customer name and phone fields can now be filled while scanner mode is active.

### Phase 14 (2026-10-18)
- **Bug Fix — Not Authenticated**: Access token extended from 15 min → 8 hours. Added POST /api/auth/refresh endpoint + axios interceptor (skips /auth/me, /auth/login, verify-pin) for silent session renewal. Fixed duplicate endShift in AdminPOS.js and infinite /login redirect loop.
- **Shift History Log**: New /admin/shifts page with date filters (Today/Week/Month/All/Custom) + salesperson filter dropdown. Shows Shifts Started / Ended / People Active summary cards. Activity log table with timestamps and start/end badges.
- **Export CSV on Reports**: "Export CSV" button on /admin/reports downloads a formatted spreadsheet for the selected date range.

### Label size change (2026-10-31)
- Barcode label print (single + bulk, `printLabels` in AdminDashboard.js) resized from 62mm-wide to 50mm x 25mm pages: `@page { size: 50mm 25mm; margin: 0 }`, one label per page, name+brand on top row (ellipsis), CODE128 SVG scaled to 47x14.5mm via viewBox, price below.

### Label Size Setting (2026-10-31)
- `settings.label_width_mm` / `label_height_mm` (default 50x25, validated 20-150mm, 400 otherwise) on GET/PATCH /api/admin/settings.
- Shop Settings: "Barcode Label Size" presets (50x25 default, 38x25, 40x30, 62x35, 100x50) + Custom w/h inputs + to-scale preview.
- `printLabels(products, {w,h})` uses saved size for @page and scales layout by min(w/50, h/25).
- Labels show the shop name (settings.shop_name, fallback "Balaji Fataka") as a small uppercase line under the price, 5pt at 50x25, scaled; barcode height reduced by 2mm*scale (width unchanged).

### Invoice print fix (2026-10-31)
- BT ESC/POS (lib/btPrinter.js): acknowledged writes (writeValueWithResponse preferred) in 20-byte chunks with 30ms delay; silent GATT reconnect via ensureConnected(); null-safe builder; ASCII sanitising (₹→Rs., dashes/quotes/diacritics mapped); CGST/SGST lines; shop header/UPI from settings with old hardcoded fallbacks; errors surfaced via sonner toast (Toaster mounted in App.js).
- Browser print: restored "Print receipt" button (print-receipt-btn); invalid `@page { size: 80mm auto }` replaced (80mm 297mm fallback + per-print injected 80mm x receipt-height style removed on afterprint).
- BT v2 (2026-10-31): every connect/print early-return shows a toast (unsupported browser, busy, no order data, chooser cancelled, permission/security errors); immediate "Printing..." state+toast; 10s timeouts on gatt.connect/getPrimaryService/getCharacteristic/each write; visible build marker "BT v2" (data-testid bt-build-marker).
- BT v3 (2026-10-31): default Bluetooth mode = raster image (lib/btRaster.js: receipt rows drawn on canvas at 576/384 dots, 1-bit, GS v 0 per run of <=24 inked rows, blank rows as ESC J feed); text mode kept with FS . + ESC t 0 prefix; Test print (A text, B text Chinese-off, C image, D TSPL label); mode + paper (80/58mm) dropdowns in localStorage (bt_print_mode, bt_paper_dots); characteristic discovery enumerates services and writes only to a writable characteristic, logged + shown (bt-char-info); 180-byte packets with automatic 20-byte fallback; progress toast.
