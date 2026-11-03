from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / '.env')

from fastapi import FastAPI, APIRouter, HTTPException, Request, Response, UploadFile, File, BackgroundTasks
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from bson import ObjectId
from pydantic import BaseModel, ConfigDict
from typing import List
import bcrypt
import jwt
import os
import csv
import io
import re
import secrets
import random
import string
import logging
import ipaddress
import httpx
from html import escape
from html.parser import HTMLParser
from urllib.parse import urlparse
from datetime import datetime, timezone, timedelta, date

logger = logging.getLogger(__name__)

# ── Email (Emergent Managed Resend) ──────────────────────────────────────────
EMAIL_BASE_URL = "https://integrations.emergentagent.com"
EMAIL_KEY = os.environ.get("EMERGENT_EMAIL_KEY", "")
EMAIL_FROM_NAME = os.environ.get("EMAIL_FROM_NAME", "CrackerPOS")
FRONTEND_URL = os.environ.get("FRONTEND_URL", "").rstrip("/")
ADMIN_NOTIFY_EMAIL = os.environ.get("ADMIN_NOTIFY_EMAIL", "")

_SHORTENERS = ("bit.ly","tinyurl.com","t.co","is.gd","cutt.ly","goo.gl","rebrand.ly")
_CRED_ASK = ("reply with your password","reply with the code","send your password","cvv",
             "send us your password","enter your password below","confirm your card number",
             "your full card number","seed phrase","recovery phrase","verify your card",
             "social security number","confirm your bank details")
_HOSTISH = re.compile(r"\b(?:https?://)?((?:[a-z0-9-]+\.)+[a-z]{2,})", re.I)

def _host_ok(host: str) -> bool:
    if not host or "xn--" in host: return False
    try:
        ipaddress.ip_address(host); return False
    except ValueError: pass
    return not any(host == s or host.endswith("." + s) for s in _SHORTENERS)

def _same_site(shown: str, real: str) -> bool:
    return shown == real or real.endswith("." + shown) or shown.endswith("." + real)

class _EmailScan(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tags, self.urls, self.anchors = set(), [], []
        self._href, self._text = None, []
    def handle_starttag(self, tag, attrs):
        self.tags.add(tag.lower())
        self.urls += [v for k, v in attrs if k.lower() in ("href","src") and v]
        if tag.lower() == "a":
            self._href = dict((k.lower(), v) for k, v in attrs).get("href")
            self._text = []
    def handle_data(self, data):
        if self._href is not None: self._text.append(data)
    def handle_endtag(self, tag):
        if tag.lower() == "a" and self._href is not None:
            self.anchors.append((self._href, "".join(self._text)))
            self._href, self._text = None, []

def _assert_safe_email(subject: str, html: str) -> None:
    scan = _EmailScan(); scan.feed(html)
    if scan.tags & {"form","input","textarea","select"}:
        raise ValueError("No forms or input fields in email (G2)")
    body = f"{subject}\n{html}".lower()
    for p in _CRED_ASK:
        if p in body: raise ValueError(f"Credential ask: {p!r}")
    for url in scan.urls:
        low = url.strip().lower()
        if low.startswith(("mailto:","tel:","cid:","#")): continue
        if not low.startswith("https://"): raise ValueError(f"Non-https link: {url!r}")
        host = urlparse(low).hostname or ""
        if not _host_ok(host) or urlparse(low).username is not None:
            raise ValueError(f"Suspicious URL: {url!r}")
    for href, text in scan.anchors:
        real = urlparse(href.strip().lower()).hostname or ""
        if not real: continue
        for m in _HOSTISH.finditer(text):
            if not _same_site(m.group(1).lower(), real):
                raise ValueError(f"Anchor mismatch: {m.group(1)!r} vs {real!r}")

async def send_email(*, to: str, subject: str, html: str) -> str | None:
    _assert_safe_email(subject, html)
    payload = {"to": [to], "subject": subject, "html": html, "from_name": EMAIL_FROM_NAME}
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{EMAIL_BASE_URL}/api/v1/email/send",
                headers={"X-Email-Key": EMAIL_KEY},
                json=payload,
            )
        resp.raise_for_status()
        return resp.json().get("id")
    except httpx.HTTPStatusError as e:
        try: code = e.response.json().get("code", "")
        except Exception: code = ""
        if code in ("insufficient_credits","integration_disabled","daily_limit_reached"):
            logger.warning(f"Email paused: {code}")
            raise HTTPException(status_code=503, detail="Email is temporarily unavailable")
        if code == "undeliverable_recipient":
            raise HTTPException(status_code=400, detail="This email address could not receive mail. Please use a real email address.")
        logger.error(f"Email send failed: {e.response.status_code} {e.response.text}")
        raise HTTPException(status_code=502, detail="Failed to send email")
    except Exception as e:
        logger.error(f"Email send error: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to send email")

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI(title="CrackerPOS API", openapi_url="/api/openapi.json", docs_url="/api/docs", redoc_url=None)
api_router = APIRouter(prefix="/api")

JWT_ALGORITHM = "HS256"


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))


def create_access_token(user_id: str, email: str) -> str:
    payload = {"sub": user_id, "email": email, "exp": datetime.now(timezone.utc) + timedelta(minutes=15), "type": "access"}
    return jwt.encode(payload, os.environ["JWT_SECRET"], algorithm=JWT_ALGORITHM)


def create_refresh_token(user_id: str) -> str:
    payload = {"sub": user_id, "exp": datetime.now(timezone.utc) + timedelta(days=7), "type": "refresh"}
    return jwt.encode(payload, os.environ["JWT_SECRET"], algorithm=JWT_ALGORITHM)


def set_auth_cookies(response: Response, user_id: str, email: str):
    response.set_cookie(key="access_token", value=create_access_token(user_id, email), httponly=True, secure=True, samesite="none", max_age=28800, path="/")
    response.set_cookie(key="refresh_token", value=create_refresh_token(user_id), httponly=True, secure=True, samesite="none", max_age=604800, path="/")


async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(token, os.environ["JWT_SECRET"], algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "access":
            raise HTTPException(status_code=401, detail="Invalid token type")
        user = await db.users.find_one({"_id": ObjectId(payload["sub"])})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        user["_id"] = str(user["_id"])
        user.pop("password_hash", None)
        return user
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


# ---------- Models ----------

class RegisterIn(BaseModel):
    name: str
    email: str
    password: str
    phone: str = ""
    customer_type: str = "retail"
    business_name: str = ""
    gstin: str = ""


class LoginIn(BaseModel):
    email: str
    password: str


class OrderItemIn(BaseModel):
    product_id: str
    qty: int


class OrderIn(BaseModel):
    items: List[OrderItemIn]
    payment_mode: str = "upi"
    utr: str = ""
    customer_name: str = ""
    customer_phone: str = ""
    customer_email: str = ""


class POSOrderIn(BaseModel):
    customer_name: str = "Walk-in Customer"
    customer_phone: str = ""
    customer_type: str = "retail"
    items: List[OrderItemIn]
    payment_mode: str = "cash"
    utr: str = ""
    salesperson_id: str = ""
    discount_type: str = "none"   # "none" | "percent" | "flat"
    discount_value: float = 0.0


class ProductOut(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    name: str
    category: str
    pack_type: str
    pack_size: str
    icon: str
    retail_price: float
    wholesale_price: float
    purchase_price: float = 0.0
    stock: int
    hsn: str
    brand: str = ""
    barcode: str = ""


class UserOut(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    name: str
    email: str
    phone: str = ""
    role: str = "customer"
    customer_type: str = "retail"
    approved: bool = True
    business_name: str = ""
    gstin: str = ""
    salesperson_id: str = ""


class OrderItemOut(BaseModel):
    name: str
    pack_type: str
    pack_size: str
    hsn: str
    price: float
    qty: int


class OrderOut(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    invoice_no: str
    customer_name: str
    customer_type: str
    customer_phone: str = ""
    is_pos: bool = False
    items: List[OrderItemOut]
    subtotal: float
    discount: float
    taxable_value: float
    cgst: float
    sgst: float
    round_off: float
    total: float
    payment_mode: str
    utr: str
    status: str
    created_at: str
    salesperson_name: str = ""


def user_out(doc: dict) -> dict:
    return {
        "id": str(doc["_id"]),
        "name": doc.get("name", ""),
        "email": doc.get("email", ""),
        "phone": doc.get("phone", ""),
        "role": doc.get("role", "customer"),
        "customer_type": doc.get("customer_type", "retail"),
        "approved": doc.get("approved", True),
        "business_name": doc.get("business_name", ""),
        "gstin": doc.get("gstin", ""),
        "salesperson_id": doc.get("salesperson_id", ""),
    }


def product_out(doc: dict) -> dict:
    return {
        "id": str(doc["_id"]),
        "name": doc.get("name", ""),
        "category": doc.get("category", ""),
        "pack_type": doc.get("pack_type", ""),
        "pack_size": doc.get("pack_size", ""),
        "icon": doc.get("icon", "anar"),
        "retail_price": doc.get("retail_price", 0),
        "wholesale_price": doc.get("wholesale_price", 0),
        "purchase_price": doc.get("purchase_price", 0),
        "stock": doc.get("stock", 0),
        "hsn": doc.get("hsn", "3604"),
        "brand": doc.get("brand", ""),
        "barcode": doc.get("barcode", ""),
    }


def order_out(doc: dict) -> dict:
    return {
        "id": str(doc["_id"]),
        "invoice_no": doc.get("invoice_no", ""),
        "customer_name": doc.get("customer_name", ""),
        "customer_type": doc.get("customer_type", ""),
        "customer_phone": doc.get("customer_phone", ""),
        "is_pos": doc.get("is_pos", False),
        "items": doc.get("items", []),
        "subtotal": doc.get("subtotal", 0),
        "discount": doc.get("discount", 0),
        "taxable_value": doc.get("taxable_value", 0),
        "cgst": doc.get("cgst", 0),
        "sgst": doc.get("sgst", 0),
        "round_off": doc.get("round_off", 0),
        "total": doc.get("total", 0),
        "payment_mode": doc.get("payment_mode", ""),
        "utr": doc.get("utr", ""),
        "status": doc.get("status", ""),
        "created_at": doc.get("created_at", ""),
        "salesperson_name": doc.get("salesperson_name", ""),
    }


# ---------- Auth endpoints ----------

@api_router.post("/auth/register", response_model=UserOut)
async def register(input: RegisterIn, response: Response):
    email = input.email.strip().lower()
    if "@" not in email:
        raise HTTPException(status_code=400, detail="Enter a valid email address")
    if len(input.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    if not input.name.strip():
        raise HTTPException(status_code=400, detail="Full name is required")
    customer_type = input.customer_type if input.customer_type in ("retail", "wholesale") else "retail"
    existing = await db.users.find_one({"email": email})
    if existing:
        raise HTTPException(status_code=400, detail="An account with this email already exists. Try logging in.")
    doc = {
        "name": input.name.strip(),
        "email": email,
        "password_hash": hash_password(input.password),
        "phone": input.phone.strip(),
        "customer_type": customer_type,
        "approved": customer_type != "wholesale",
        "business_name": input.business_name.strip(),
        "gstin": input.gstin.strip().upper(),
        "role": "customer",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    result = await db.users.insert_one(doc)
    user_id = str(result.inserted_id)
    set_auth_cookies(response, user_id, email)
    doc["_id"] = user_id
    return user_out(doc)


def get_client_ip(request: Request) -> str:
    """Extract real client IP, respecting Kubernetes ingress X-Forwarded-For."""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


@api_router.post("/auth/login", response_model=UserOut)
async def login(input: LoginIn, response: Response, request: Request):
    ip = get_client_ip(request)
    email = input.email.strip().lower()

    # ── IP-based rate limit ─────────────────────────────────────────────────
    attempt = await db.login_attempts.find_one({"_id": ip})
    if attempt and attempt.get("count", 0) >= 5:
        locked_until = attempt.get("locked_until")
        if locked_until:
            if locked_until.tzinfo is None:
                locked_until = locked_until.replace(tzinfo=timezone.utc)
            remaining = locked_until - datetime.now(timezone.utc)
            if remaining.total_seconds() > 0:
                secs = int(remaining.total_seconds())
                raise HTTPException(
                    status_code=429,
                    detail=f"Too many failed attempts. Try again in {secs // 60}m {secs % 60}s.",
                )
        # Lock window expired — reset
        await db.login_attempts.delete_one({"_id": ip})
        attempt = None

    user = await db.users.find_one({"email": email})
    if not user or not verify_password(input.password, user.get("password_hash", "")):
        current_count = (attempt.get("count", 0) if attempt else 0) + 1
        update_fields: dict = {"count": current_count, "last_attempt": datetime.now(timezone.utc), "email_hint": email}
        if current_count >= 5:
            update_fields["locked_until"] = datetime.now(timezone.utc) + timedelta(minutes=15)
        await db.login_attempts.update_one({"_id": ip}, {"$set": update_fields}, upsert=True)
        raise HTTPException(status_code=401, detail="Incorrect email or password")

    # Success — clear rate limit record for this IP
    await db.login_attempts.delete_one({"_id": ip})
    user_id = str(user["_id"])
    set_auth_cookies(response, user_id, email)
    user["_id"] = user_id
    return user_out(user)


@api_router.post("/auth/logout")
async def logout(response: Response):
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/")
    return {"ok": True}


@api_router.get("/auth/me", response_model=UserOut)
async def auth_me(request: Request):
    """Return the currently authenticated user (used on page refresh)."""
    user = await get_current_user(request)
    return user_out(user)


class AdminProfileIn(BaseModel):
    current_password: str
    new_email: str = ""
    new_password: str = ""
    new_name: str = ""


@api_router.patch("/admin/profile", response_model=UserOut)
async def admin_change_profile(input: AdminProfileIn, request: Request, response: Response):
    """Admin changes their own email, name, or password. Requires current password."""
    await require_admin(request)
    user = await get_current_user(request)

    # Re-fetch full doc so we have password_hash
    user_doc = await db.users.find_one({"_id": ObjectId(user["_id"])})
    if not user_doc:
        raise HTTPException(status_code=404, detail="User not found")

    # Always require current password for any profile change
    if not verify_password(input.current_password, user_doc.get("password_hash", "")):
        raise HTTPException(status_code=400, detail="Current password is incorrect")

    update: dict = {}

    if input.new_name.strip():
        update["name"] = input.new_name.strip()

    if input.new_email.strip():
        new_email = input.new_email.strip().lower()
        if new_email != user_doc.get("email", ""):
            conflict = await db.users.find_one({"email": new_email})
            if conflict and str(conflict["_id"]) != user["_id"]:
                raise HTTPException(status_code=400, detail="Email already in use")
            update["email"] = new_email

    if input.new_password.strip():
        if len(input.new_password.strip()) < 6:
            raise HTTPException(status_code=400, detail="New password must be at least 6 characters")
        update["password_hash"] = hash_password(input.new_password.strip())

    if not update:
        raise HTTPException(status_code=400, detail="Nothing to update — provide new email, name or password")

    await db.users.update_one({"_id": ObjectId(user["_id"])}, {"$set": update})

    # Immediately expire both cookies so the old session is dead
    response.delete_cookie("access_token",  path="/")
    response.delete_cookie("refresh_token", path="/")

    updated = await db.users.find_one({"_id": ObjectId(user["_id"])})
    return user_out(updated)


@api_router.post("/auth/refresh")
async def refresh_token(request: Request, response: Response):
    token = request.cookies.get("refresh_token")
    if not token:
        raise HTTPException(status_code=401, detail="No refresh token")
    try:
        payload = jwt.decode(token, os.environ["JWT_SECRET"], algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "refresh":
            raise HTTPException(status_code=401, detail="Invalid token type")
        user = await db.users.find_one({"_id": ObjectId(payload["sub"])})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        set_auth_cookies(response, str(user["_id"]), user["email"])
        return {"message": "ok"}
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Refresh token expired — please log in again")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid refresh token")


@api_router.get("/admin/settings")
async def get_settings(request: Request):
    await require_admin(request)
    s = await db.settings.find_one({"_id": "shop"}) or {}
    return {
        "shop_name":          s.get("shop_name",         "Balaji Fataka"),
        "address":            s.get("address",           ""),
        "phone":              s.get("phone",             ""),
        "gst_no":             s.get("gst_no",            ""),
        "fire_license_no":    s.get("fire_license_no",   ""),
        "admin_notify_email": s.get("admin_notify_email", ADMIN_NOTIFY_EMAIL),
        "upi_id":             s.get("upi_id",            "paytm.d95113099@pty"),
        "upi_name":           s.get("upi_name",          "Balaji Fataka"),
        "scanner_mode":       s.get("scanner_mode",      False),
        "gst_enabled":        s.get("gst_enabled",       False),
        "default_category":   s.get("default_category",  ""),
        "hero_title":         s.get("hero_title",        ""),
        "hero_subtitle":      s.get("hero_subtitle",     ""),
        "hero_image_url":     s.get("hero_image_url",    ""),
        "label_width_mm":     s.get("label_width_mm",    50),
        "label_height_mm":    s.get("label_height_mm",   25),
    }

@api_router.get("/settings/public")
async def get_public_settings():
    """Public shop info used by receipts and checkout (no auth required)."""
    s = await db.settings.find_one({"_id": "shop"}) or {}
    return {
        "shop_name":        s.get("shop_name",        "Balaji Fataka"),
        "address":          s.get("address",          ""),
        "phone":            s.get("phone",            ""),
        "gst_no":           s.get("gst_no",           ""),
        "fire_license_no":  s.get("fire_license_no",  ""),
        "gst_enabled":      s.get("gst_enabled",      False),
        "upi_id":           s.get("upi_id",           "paytm.d95113099@pty"),
        "upi_name":         s.get("upi_name",         "Balaji Fataka"),
        "default_category": s.get("default_category", ""),
        "hero_title":       s.get("hero_title",       ""),
        "hero_subtitle":    s.get("hero_subtitle",    ""),
        "hero_image_url":   s.get("hero_image_url",   ""),
    }

@api_router.patch("/admin/settings")
async def update_settings(request: Request):
    await require_admin(request)
    body = await request.json()
    allowed = {"shop_name", "address", "phone", "gst_no", "fire_license_no",
               "admin_notify_email", "upi_id", "upi_name", "scanner_mode",
               "gst_enabled", "default_category", "hero_title", "hero_subtitle", "hero_image_url",
               "label_width_mm", "label_height_mm"}
    update = {k: v for k, v in body.items() if k in allowed}
    for k, label in (("label_width_mm", "Label width"), ("label_height_mm", "Label height")):
        if k in update:
            v = update[k]
            if isinstance(v, bool) or not isinstance(v, (int, float)) or not 20 <= v <= 150:
                raise HTTPException(status_code=400, detail=f"{label} must be a number between 20 and 150 mm")
            update[k] = int(v) if float(v).is_integer() else round(float(v), 1)
    if not update:
        raise HTTPException(status_code=400, detail="Nothing to update")
    await db.settings.update_one({"_id": "shop"}, {"$set": update}, upsert=True)
    return {"ok": True}


@api_router.get("/admin/locked-ips")
async def list_locked_ips(request: Request):
    """Return all IPs currently locked due to failed login attempts."""
    await require_admin(request)
    now = datetime.now(timezone.utc)
    docs = await db.login_attempts.find().to_list(200)
    result = []
    for d in docs:
        locked_until = d.get("locked_until")
        if locked_until:
            if locked_until.tzinfo is None:
                locked_until = locked_until.replace(tzinfo=timezone.utc)
            if locked_until > now:
                secs = int((locked_until - now).total_seconds())
                result.append({
                    "ip": d["_id"],
                    "attempts": d.get("count", 0),
                    "locked_until": locked_until.isoformat(),
                    "unlocks_in": f"{secs // 60}m {secs % 60}s",
                    "email_hint": d.get("email_hint", ""),
                })
    return result


@api_router.delete("/admin/locked-ips/{ip}")
async def unlock_ip(ip: str, request: Request):
    """Manually unlock a specific IP."""
    await require_admin(request)
    result = await db.login_attempts.delete_one({"_id": ip})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="IP not found or already unlocked")
    return {"ok": True}


# ── Forgot / Reset Password ───────────────────────────────────────────────────

class ForgotPasswordIn(BaseModel):
    email: str

class VerifyOtpIn(BaseModel):
    email: str
    otp: str

class ResetPasswordIn(BaseModel):
    email: str
    otp: str
    new_password: str

def _gen_otp(length: int = 6) -> str:
    return "".join(secrets.choice(string.digits) for _ in range(length))

@api_router.post("/auth/forgot-password")
async def forgot_password(body: ForgotPasswordIn):
    email = body.email.strip().lower()
    user = await db.users.find_one({"email": email})
    # Always return success — never reveal whether email exists (security)
    if not user:
        return {"ok": True, "message": "If this email is registered, an OTP has been sent."}

    otp = _gen_otp()
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=10)

    await db.password_reset_otps.update_one(
        {"email": email},
        {"$set": {"otp": otp, "expires_at": expires_at, "used": False}},
        upsert=True,
    )

    name = user.get("name", "there")
    subject = f"Your {EMAIL_FROM_NAME} password reset OTP"
    html = f"""<table role="presentation" width="100%" cellpadding="0" cellspacing="0"
        style="background:#fdf6ef;padding:0;margin:0">
      <tr><td align="center" style="padding:32px 16px">
        <table role="presentation" width="100%" style="max-width:480px;background:#fff;
          border-radius:16px;padding:32px 28px;font-family:Arial,sans-serif;color:#1F1512">
          <tr><td>
            <p style="font-size:20px;font-weight:700;margin:0 0 6px">
              Password Reset — {escape(EMAIL_FROM_NAME)}
            </p>
            <p style="font-size:14px;color:#7A5C4F;margin:0 0 24px">
              Hi {escape(name)}, we received a request to reset your password.
            </p>
            <p style="font-size:13px;margin:0 0 8px">Your one-time password (OTP):</p>
            <div style="font-size:36px;font-weight:700;letter-spacing:10px;
              background:#fdf6ef;border-radius:12px;padding:16px 24px;
              text-align:center;color:#7B1A1A;margin:0 0 20px">
              {escape(otp)}
            </div>
            <p style="font-size:13px;color:#7A5C4F;margin:0 0 24px">
              This OTP is valid for <strong>10 minutes</strong>.
              Do not share it with anyone.
            </p>
            <hr style="border:none;border-top:1px dashed #E5D8CE;margin:0 0 16px" />
            <p style="font-size:11px;color:#aaa;margin:0">
              Sent by {escape(EMAIL_FROM_NAME)}. If you did not request a password reset,
              you can safely ignore this email.
            </p>
          </td></tr>
        </table>
      </td></tr>
    </table>"""

    await send_email(to=email, subject=subject, html=html)
    return {"ok": True, "message": "If this email is registered, an OTP has been sent."}


@api_router.post("/auth/verify-otp")
async def verify_otp(body: VerifyOtpIn):
    email = body.email.strip().lower()
    rec = await db.password_reset_otps.find_one({"email": email})
    if not rec or rec.get("used"):
        raise HTTPException(status_code=400, detail="Invalid or expired OTP")
    expires_at = rec.get("expires_at")
    if expires_at:
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if datetime.now(timezone.utc) > expires_at:
            raise HTTPException(status_code=400, detail="OTP has expired. Please request a new one.")
    if rec.get("otp") != body.otp.strip():
        raise HTTPException(status_code=400, detail="Incorrect OTP")
    return {"ok": True}


@api_router.post("/auth/reset-password")
async def reset_password(body: ResetPasswordIn):
    email = body.email.strip().lower()
    if len(body.new_password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")

    rec = await db.password_reset_otps.find_one({"email": email})
    if not rec or rec.get("used"):
        raise HTTPException(status_code=400, detail="Invalid or expired OTP")
    expires_at = rec.get("expires_at")
    if expires_at:
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if datetime.now(timezone.utc) > expires_at:
            raise HTTPException(status_code=400, detail="OTP has expired. Please request a new one.")
    if rec.get("otp") != body.otp.strip():
        raise HTTPException(status_code=400, detail="Incorrect OTP")

    new_hash = hash_password(body.new_password)
    await db.users.update_one({"email": email}, {"$set": {"password_hash": new_hash}})
    await db.password_reset_otps.update_one({"email": email}, {"$set": {"used": True}})
    # Clear any brute-force lockout so they can log in immediately
    await db.login_attempts.delete_one({"identifier": email})
    return {"ok": True, "message": "Password updated successfully"}


# ── Manage Admins ────────────────────────────────────────────────────────────

@api_router.get("/admin/admins")
async def list_admins(request: Request):
    """List all admin accounts."""
    await require_admin(request)
    docs = await db.users.find({"role": "admin"}).sort("created_at", 1).to_list(50)
    return [{"id": str(d["_id"]), "name": d.get("name", ""), "email": d.get("email", "")} for d in docs]


class AdminCreateIn(BaseModel):
    name: str
    email: str
    password: str


@api_router.post("/admin/admins")
async def create_admin(body: AdminCreateIn, request: Request):
    """Create a new admin account."""
    current = await require_admin(request)
    name    = body.name.strip()
    email   = body.email.strip().lower()
    pwd     = body.password.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required")
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="Valid email is required")
    if len(pwd) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="An account with this email already exists")
    doc = {
        "name": name,
        "email": email,
        "password_hash": hash_password(pwd),
        "role": "admin",
        "customer_type": "retail",
        "approved": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    result = await db.users.insert_one(doc)
    return {"id": str(result.inserted_id), "name": name, "email": email}


@api_router.delete("/admin/admins/{admin_id}")
async def delete_admin(admin_id: str, request: Request):
    """Remove an admin account. Cannot delete self or the last remaining admin."""
    current = await require_admin(request)
    if str(current["_id"]) == admin_id:
        raise HTTPException(status_code=400, detail="You cannot delete your own account")
    total = await db.users.count_documents({"role": "admin"})
    if total <= 1:
        raise HTTPException(status_code=400, detail="Cannot delete the last admin account")
    try:
        result = await db.users.delete_one({"_id": ObjectId(admin_id), "role": "admin"})
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid admin ID")
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Admin not found")
    return {"ok": True}


async def require_admin(request: Request) -> dict:
    user = await get_current_user(request)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


async def require_pos_access(request: Request) -> dict:
    """Allows both admin and salesperson roles to access POS."""
    user = await get_current_user(request)
    if user.get("role") not in ("admin", "salesperson"):
        raise HTTPException(status_code=403, detail="Not authorized")
    return user


# ---------- Products ----------

@api_router.get("/products/barcode/{code}", response_model=ProductOut)
async def get_product_by_barcode(code: str):
    p = await db.products.find_one({"barcode": code.strip()})
    if not p:
        raise HTTPException(status_code=404, detail="Product not found for this barcode")
    return product_out(p)


@api_router.get("/products", response_model=List[ProductOut])
async def list_products(category: str = "", q: str = ""):
    query = {}
    if category and category != "All":
        query["category"] = category
    if q:
        query["name"] = {"$regex": q.strip(), "$options": "i"}
    docs = await db.products.find(query).sort("name", 1).to_list(500)
    return [product_out(d) for d in docs]


# ---------- Orders ----------

def fy_label() -> str:
    today = date.today()
    y = today.year if today.month >= 4 else today.year - 1
    return f"{y}-{(y + 1) % 100:02d}"


def _items_table_html(items: list) -> str:
    rows = ""
    for it in items:
        amt = it["price"] * it["qty"]
        rows += f"""<tr style="border-bottom:1px solid #F1E2CC">
          <td style="padding:6px 8px;font-size:13px">{escape(it['name'])}</td>
          <td style="padding:6px 8px;font-size:13px;text-align:center">{it['qty']}</td>
          <td style="padding:6px 8px;font-size:13px;text-align:right">Rs {it['price']:.2f}</td>
          <td style="padding:6px 8px;font-size:13px;text-align:right;font-weight:700">Rs {amt:.2f}</td>
        </tr>"""
    return rows


async def _send_admin_order_alert(order: dict) -> None:
    # Read from DB settings first, fall back to env
    s = await db.settings.find_one({"_id": "shop"}) or {}
    notify_email = s.get("admin_notify_email", ADMIN_NOTIFY_EMAIL)
    if not notify_email:
        return
    try:
        receipt_url = f"{FRONTEND_URL}/receipt/{order['id']}"
        mode_label = {"upi": "UPI", "cash": "Cash", "card": "Card"}.get(order.get("payment_mode", ""), "UPI")
        status_color = "#1F5F36" if order.get("status") == "paid" else "#7B4F00"
        status_label = "PAID" if order.get("status") == "paid" else "PENDING"
        items_html = _items_table_html(order.get("items", []))
        subject = f"New Order {order['invoice_no']} — Rs {order['total']:.2f} ({status_label})"
        html = f"""<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fdf6ef;padding:0;margin:0">
          <tr><td align="center" style="padding:32px 16px">
            <table role="presentation" width="100%" style="max-width:520px;background:#fff;border-radius:16px;padding:32px 28px;font-family:Arial,sans-serif;color:#1F1512">
              <tr><td>
                <p style="font-size:11px;font-weight:700;letter-spacing:2px;color:#7A5C4F;margin:0 0 6px;text-transform:uppercase">{escape(EMAIL_FROM_NAME)}</p>
                <p style="font-size:22px;font-weight:700;margin:0 0 4px">New Order Received</p>
                <p style="font-size:14px;color:#7A5C4F;margin:0 0 20px">Invoice {escape(order['invoice_no'])}</p>

                <table width="100%" style="font-size:13px;margin-bottom:16px">
                  <tr><td style="color:#7A5C4F;padding:3px 0">Customer</td><td style="font-weight:700;text-align:right">{escape(order.get('customer_name','—'))}</td></tr>
                  <tr><td style="color:#7A5C4F;padding:3px 0">Phone</td><td style="text-align:right">{escape(order.get('customer_phone','—'))}</td></tr>
                  <tr><td style="color:#7A5C4F;padding:3px 0">Type</td><td style="text-align:right;text-transform:capitalize">{escape(order.get('customer_type','retail'))}</td></tr>
                  <tr><td style="color:#7A5C4F;padding:3px 0">Payment</td><td style="text-align:right">{mode_label}</td></tr>
                  <tr><td style="color:#7A5C4F;padding:3px 0">Status</td><td style="text-align:right;font-weight:700;color:{status_color}">{status_label}</td></tr>
                </table>

                <table width="100%" style="border-collapse:collapse;margin-bottom:16px">
                  <thead><tr style="background:#fdf6ef">
                    <th style="padding:6px 8px;font-size:12px;text-align:left">Item</th>
                    <th style="padding:6px 8px;font-size:12px;text-align:center">Qty</th>
                    <th style="padding:6px 8px;font-size:12px;text-align:right">Price</th>
                    <th style="padding:6px 8px;font-size:12px;text-align:right">Amount</th>
                  </tr></thead>
                  <tbody>{items_html}</tbody>
                </table>

                <table width="100%" style="font-size:14px;margin-bottom:20px">
                  <tr><td style="color:#7A5C4F">Subtotal</td><td style="text-align:right">Rs {order.get('subtotal',0):.2f}</td></tr>
                  <tr><td style="font-weight:700;font-size:16px;padding-top:8px">Total</td><td style="font-weight:700;font-size:16px;text-align:right;color:#7B1A1A;padding-top:8px">Rs {order['total']:.2f}</td></tr>
                </table>

                <a href="{receipt_url}" style="display:block;background:#7B1A1A;color:#fff;text-decoration:none;font-weight:700;font-size:14px;text-align:center;padding:14px 24px;border-radius:12px;margin-bottom:20px">View Full Receipt</a>

                <hr style="border:none;border-top:1px dashed #E5D8CE;margin:0 0 12px" />
                <p style="font-size:11px;color:#aaa;margin:0">Sent by {escape(EMAIL_FROM_NAME)} · Order notification</p>
              </td></tr>
            </table>
          </td></tr>
        </table>"""
        await send_email(to=notify_email, subject=subject, html=html)
    except Exception as e:
        logger.error(f"Admin alert email failed: {e}")


async def _send_customer_confirmation(order: dict) -> None:
    cust_email = order.get("customer_email", "").strip()
    if not cust_email:
        return
    try:
        receipt_url = f"{FRONTEND_URL}/receipt/{order['id']}"
        name = order.get("customer_name", "there")
        items_html = _items_table_html(order.get("items", []))
        paid = order.get("status") == "paid"
        upi_section = "" if paid else f"""
          <div style="background:#fdf6ef;border-radius:12px;padding:16px;text-align:center;margin-bottom:16px">
            <p style="font-size:13px;font-weight:700;margin:0 0 6px">Pay via UPI</p>
            <p style="font-size:20px;font-weight:700;color:#7B1A1A;letter-spacing:1px;margin:0 0 4px">paytm.d95113099@pty</p>
            <p style="font-size:13px;color:#7A5C4F;margin:0">Amount: Rs {order['total']:.2f} · Ref: {escape(order['invoice_no'])}</p>
          </div>"""
        subject = f"Order confirmed — Invoice {order['invoice_no']} | {escape(EMAIL_FROM_NAME)}"
        html = f"""<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fdf6ef;padding:0;margin:0">
          <tr><td align="center" style="padding:32px 16px">
            <table role="presentation" width="100%" style="max-width:520px;background:#fff;border-radius:16px;padding:32px 28px;font-family:Arial,sans-serif;color:#1F1512">
              <tr><td>
                <p style="font-size:11px;font-weight:700;letter-spacing:2px;color:#7A5C4F;margin:0 0 6px;text-transform:uppercase">{escape(EMAIL_FROM_NAME)}</p>
                <p style="font-size:22px;font-weight:700;margin:0 0 4px">Order Confirmed!</p>
                <p style="font-size:14px;color:#7A5C4F;margin:0 0 20px">Hi {escape(name)}, your order has been received.</p>

                <table width="100%" style="font-size:13px;margin-bottom:16px">
                  <tr><td style="color:#7A5C4F;padding:3px 0">Invoice No</td><td style="font-weight:700;text-align:right">{escape(order['invoice_no'])}</td></tr>
                  <tr><td style="color:#7A5C4F;padding:3px 0">Payment</td><td style="text-align:right;text-transform:capitalize">{order.get('payment_mode','upi')}</td></tr>
                  <tr><td style="color:#7A5C4F;padding:3px 0">Status</td><td style="text-align:right;font-weight:700;color:{'#1F5F36' if paid else '#7B4F00'}">{'PAID' if paid else 'PAYMENT PENDING'}</td></tr>
                </table>

                <table width="100%" style="border-collapse:collapse;margin-bottom:16px">
                  <thead><tr style="background:#fdf6ef">
                    <th style="padding:6px 8px;font-size:12px;text-align:left">Item</th>
                    <th style="padding:6px 8px;font-size:12px;text-align:center">Qty</th>
                    <th style="padding:6px 8px;font-size:12px;text-align:right">Price</th>
                    <th style="padding:6px 8px;font-size:12px;text-align:right">Amount</th>
                  </tr></thead>
                  <tbody>{items_html}</tbody>
                </table>

                <table width="100%" style="font-size:14px;margin-bottom:20px">
                  <tr><td style="font-weight:700;font-size:16px">Total</td><td style="font-weight:700;font-size:16px;text-align:right;color:#7B1A1A">Rs {order['total']:.2f}</td></tr>
                </table>

                {upi_section}

                <a href="{receipt_url}" style="display:block;background:#7B1A1A;color:#fff;text-decoration:none;font-weight:700;font-size:14px;text-align:center;padding:14px 24px;border-radius:12px;margin-bottom:20px">View Your Receipt</a>

                <hr style="border:none;border-top:1px dashed #E5D8CE;margin:0 0 12px" />
                <p style="font-size:12px;color:#7A5C4F;margin:0 0 4px">Thank you for shopping with us!</p>
                <p style="font-size:11px;color:#aaa;margin:0">Goods once sold will not be taken back. Keep fireworks away from children.</p>
              </td></tr>
            </table>
          </td></tr>
        </table>"""
        await send_email(to=cust_email, subject=subject, html=html)
    except Exception as e:
        logger.error(f"Customer confirmation email failed: {e}")


@api_router.post("/orders", response_model=OrderOut)
async def create_order(input: OrderIn, request: Request, background_tasks: BackgroundTasks):
    user = await get_current_user(request)
    if not input.items:
        raise HTTPException(status_code=400, detail="Cart is empty")
    use_wholesale = user.get("customer_type") == "wholesale" and user.get("approved", False)

    order_items = []
    subtotal = 0.0
    for item in input.items:
        if item.qty < 1:
            raise HTTPException(status_code=400, detail="Invalid quantity")
        try:
            pid = ObjectId(item.product_id)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid product")
        product = await db.products.find_one({"_id": pid})
        if not product:
            raise HTTPException(status_code=400, detail="Product no longer available")
        price = product["wholesale_price"] if use_wholesale else product["retail_price"]
        result = await db.products.update_one(
            {"_id": pid, "stock": {"$gte": item.qty}},
            {"$inc": {"stock": -item.qty}},
        )
        if result.modified_count == 0:
            raise HTTPException(status_code=400, detail=f"Only {product.get('stock', 0)} left in stock for {product['name']}")
        subtotal += price * item.qty
        order_items.append({
            "product_id": item.product_id,
            "name": product["name"],
            "pack_type": product.get("pack_type", ""),
            "pack_size": product.get("pack_size", ""),
            "hsn": product.get("hsn", "3604"),
            "price": price,
            "qty": item.qty,
        })

    discount = 0.0
    taxable = subtotal - discount
    # GST — read shop setting
    shop_settings = await db.settings.find_one({"_id": "shop"}) or {}
    gst_enabled = shop_settings.get("gst_enabled", False)
    cgst = round(taxable * 0.09, 2) if gst_enabled else 0.0
    sgst = round(taxable * 0.09, 2) if gst_enabled else 0.0
    grand = round(taxable + cgst + sgst)
    round_off = round(grand - (taxable + cgst + sgst), 2)

    counter = await db.counters.find_one_and_update({"_id": "invoice"}, {"$inc": {"seq": 1}}, upsert=True, return_document=True)
    seq = counter["seq"] if counter and "seq" in counter else 1
    invoice_no = f"FW/{fy_label()}/{seq:04d}"

    doc = {
        "user_id": str(user["_id"]),
        "invoice_no": invoice_no,
        "customer_name": input.customer_name.strip() or user.get("name", ""),
        "customer_phone": input.customer_phone.strip() or user.get("phone", ""),
        "customer_email": input.customer_email.strip() or user.get("email", ""),
        "customer_type": user.get("customer_type", "retail"),
        "items": order_items,
        "subtotal": round(subtotal, 2),
        "discount": discount,
        "taxable_value": round(taxable, 2),
        "cgst": cgst,
        "sgst": sgst,
        "round_off": round_off,
        "total": grand,
        "payment_mode": input.payment_mode if input.payment_mode in ("upi", "cash", "card") else "upi",
        "utr": input.utr.strip(),
        "status": "paid" if input.payment_mode == "upi" else "pending",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    result = await db.orders.insert_one(doc)
    doc["_id"] = result.inserted_id
    order_data = order_out(doc)
    order_dict = order_data.model_dump() if hasattr(order_data, "model_dump") else dict(order_data)
    background_tasks.add_task(_send_admin_order_alert, order_dict)
    background_tasks.add_task(_send_customer_confirmation, order_dict)
    return order_data


@api_router.get("/orders", response_model=List[OrderOut])
async def list_orders(request: Request):
    user = await get_current_user(request)
    docs = await db.orders.find({"user_id": str(user["_id"])}).sort("created_at", -1).to_list(200)
    return [order_out(d) for d in docs]


@api_router.get("/orders/{order_id}", response_model=OrderOut)
async def get_order(order_id: str, request: Request):
    user = await get_current_user(request)
    try:
        oid = ObjectId(order_id)
    except Exception:
        raise HTTPException(status_code=404, detail="Order not found")
    doc = await db.orders.find_one({"_id": oid})
    if not doc:
        raise HTTPException(status_code=404, detail="Order not found")
    if user.get("role") != "admin" and doc.get("user_id") != str(user["_id"]):
        raise HTTPException(status_code=404, detail="Order not found")
    return order_out(doc)


@api_router.get("/")
async def root():
    return {"message": "CrackerPOS API"}


# ---------- Admin endpoints ----------

@api_router.get("/admin/stats")
async def admin_stats(request: Request):
    await require_admin(request)
    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    today_pipeline = [
        {"$match": {"created_at": {"$gte": today_start}}},
        {"$group": {"_id": None, "count": {"$sum": 1}, "revenue": {"$sum": "$total"}}},
    ]
    today_res = await db.orders.aggregate(today_pipeline).to_list(1)
    today_orders = today_res[0]["count"] if today_res else 0
    today_revenue = today_res[0]["revenue"] if today_res else 0.0
    all_pipeline = [{"$group": {"_id": None, "count": {"$sum": 1}, "revenue": {"$sum": "$total"}}}]
    all_res = await db.orders.aggregate(all_pipeline).to_list(1)
    total_orders = all_res[0]["count"] if all_res else 0
    total_revenue = all_res[0]["revenue"] if all_res else 0.0
    pending_wholesale = await db.users.count_documents(
        {"customer_type": "wholesale", "approved": False, "rejected": {"$ne": True}}
    )
    low_stock_docs = await db.products.find({"stock": {"$lte": 10}}).sort("stock", 1).to_list(20)
    return {
        "today_orders": today_orders,
        "today_revenue": round(today_revenue, 2),
        "total_orders": total_orders,
        "total_revenue": round(total_revenue, 2),
        "pending_wholesale": pending_wholesale,
        "low_stock": [product_out(p) for p in low_stock_docs],
    }


@api_router.get("/admin/orders")
async def admin_all_orders(request: Request, limit: int = 50):
    await require_admin(request)
    docs = await db.orders.find({}).sort("created_at", -1).to_list(limit)
    return [order_out(d) for d in docs]


@api_router.get("/admin/wholesale")
async def admin_wholesale_users(request: Request):
    await require_admin(request)
    docs = await db.users.find({"customer_type": "wholesale"}).sort("created_at", -1).to_list(200)
    result = []
    for d in docs:
        result.append({
            "id": str(d["_id"]),
            "name": d.get("name", ""),
            "email": d.get("email", ""),
            "phone": d.get("phone", ""),
            "business_name": d.get("business_name", ""),
            "gstin": d.get("gstin", ""),
            "approved": d.get("approved", False),
            "rejected": d.get("rejected", False),
            "created_at": d.get("created_at", ""),
        })
    return result


@api_router.patch("/admin/wholesale/{user_id}/approve")
async def admin_approve_wholesale(user_id: str, request: Request):
    await require_admin(request)
    try:
        result = await db.users.update_one(
            {"_id": ObjectId(user_id)}, {"$set": {"approved": True, "rejected": False}}
        )
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid user ID")
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    return {"ok": True}


@api_router.patch("/admin/wholesale/{user_id}/reject")
async def admin_reject_wholesale(user_id: str, request: Request):
    await require_admin(request)
    try:
        result = await db.users.update_one(
            {"_id": ObjectId(user_id)}, {"$set": {"approved": False, "rejected": True}}
        )
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid user ID")
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    return {"ok": True}


@api_router.post("/admin/pos", response_model=OrderOut)
async def admin_pos_order(input: POSOrderIn, request: Request):
    actor = await require_pos_access(request)

    # Auto-attribute to salesperson when they place the order themselves
    auto_sp_name = ""
    auto_sp_id = ""
    if actor.get("role") == "salesperson":
        sp_id = actor.get("salesperson_id", "")
        if sp_id:
            try:
                sp_doc = await db.salespersons.find_one({"_id": ObjectId(sp_id)})
                if sp_doc:
                    auto_sp_name = sp_doc.get("name", "")
                    auto_sp_id = sp_id
            except Exception:
                pass
    if not input.items:
        raise HTTPException(status_code=400, detail="Cart is empty")
    use_wholesale = input.customer_type == "wholesale"
    order_items = []
    subtotal = 0.0
    for item in input.items:
        if item.qty < 1:
            raise HTTPException(status_code=400, detail="Invalid quantity")
        try:
            pid = ObjectId(item.product_id)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid product")
        product = await db.products.find_one({"_id": pid})
        if not product:
            raise HTTPException(status_code=400, detail="Product no longer available")
        price = product["wholesale_price"] if use_wholesale else product["retail_price"]
        result = await db.products.update_one(
            {"_id": pid, "stock": {"$gte": item.qty}},
            {"$inc": {"stock": -item.qty}},
        )
        if result.modified_count == 0:
            raise HTTPException(status_code=400, detail=f"Only {product.get('stock', 0)} left in stock for {product['name']}")
        subtotal += price * item.qty
        order_items.append({
            "product_id": item.product_id,
            "name": product["name"],
            "pack_type": product.get("pack_type", ""),
            "pack_size": product.get("pack_size", ""),
            "hsn": product.get("hsn", "3604"),
            "price": price,
            "qty": item.qty,
        })
    # Compute discount from input
    discount = 0.0
    if input.discount_type == "percent" and input.discount_value > 0:
        discount = round(subtotal * min(input.discount_value, 100) / 100, 2)
    elif input.discount_type == "flat" and input.discount_value > 0:
        discount = round(min(input.discount_value, subtotal), 2)
    taxable = subtotal - discount
    # GST — read shop setting
    shop_settings = await db.settings.find_one({"_id": "shop"}) or {}
    gst_enabled = shop_settings.get("gst_enabled", False)
    cgst = round(taxable * 0.09, 2) if gst_enabled else 0.0
    sgst = round(taxable * 0.09, 2) if gst_enabled else 0.0
    grand = round(taxable + cgst + sgst)
    round_off = round(grand - (taxable + cgst + sgst), 2)
    counter = await db.counters.find_one_and_update(
        {"_id": "invoice"}, {"$inc": {"seq": 1}}, upsert=True, return_document=True
    )
    seq = counter["seq"] if counter and "seq" in counter else 1
    invoice_no = f"FW/{fy_label()}/{seq:04d}"
    doc = {
        "user_id": str(actor["_id"]),
        "invoice_no": invoice_no,
        "customer_name": input.customer_name.strip() or "Walk-in Customer",
        "customer_phone": input.customer_phone.strip(),
        "customer_type": input.customer_type if input.customer_type in ("retail", "wholesale") else "retail",
        "items": order_items,
        "subtotal": round(subtotal, 2),
        "discount": discount,
        "taxable_value": round(taxable, 2),
        "cgst": cgst,
        "sgst": sgst,
        "round_off": round_off,
        "total": grand,
        "payment_mode": input.payment_mode if input.payment_mode in ("upi", "cash", "card") else "cash",
        "utr": input.utr.strip(),
        "status": "paid" if input.payment_mode in ("upi", "cash") else "pending",
        "is_pos": True,
        "salesperson_name": auto_sp_name,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    # Resolve salesperson from dropdown (admin flow) — overrides auto if set
    if not auto_sp_name and input.salesperson_id:
        try:
            sp = await db.salespersons.find_one({"_id": ObjectId(input.salesperson_id)})
            if sp:
                doc["salesperson_name"] = sp.get("name", "")
        except Exception:
            pass
    result = await db.orders.insert_one(doc)
    doc["_id"] = result.inserted_id
    return order_out(doc)


class StockUpdateIn(BaseModel):
    stock: int


@api_router.patch("/admin/products/{product_id}/stock")
async def admin_update_stock(product_id: str, input: StockUpdateIn, request: Request):
    await require_admin(request)
    if input.stock < 0:
        raise HTTPException(status_code=400, detail="Stock cannot be negative")
    try:
        result = await db.products.update_one(
            {"_id": ObjectId(product_id)}, {"$set": {"stock": input.stock}}
        )
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid product ID")
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Product not found")
    return {"ok": True, "stock": input.stock}


@api_router.get("/admin/products/export")
async def admin_export_products(request: Request):
    """Export full product catalogue as CSV — same columns as import template."""
    await require_admin(request)
    products = await db.products.find({}).sort("name", 1).to_list(5000)
    headers = ["name", "category", "brand", "pack_type", "pack_size",
               "retail_price", "wholesale_price", "purchase_price", "stock", "hsn", "icon"]

    def quote(v):
        s = str(v) if v is not None else ""
        if "," in s or '"' in s:
            s = '"' + s.replace('"', '""') + '"'
        return s

    rows = [",".join(headers)]
    for p in products:
        rows.append(",".join(quote(p.get(h, "")) for h in headers))

    csv_text = "\n".join(rows)
    from fastapi.responses import Response as FastResponse
    return FastResponse(
        content=csv_text.encode("utf-8-sig"),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=products_export.csv"},
    )


@api_router.get("/admin/products/barcode-export")
async def admin_export_barcodes(request: Request):
    """Export product barcodes as CSV for offline label printing."""
    await require_admin(request)
    products = await db.products.find({}).sort("name", 1).to_list(5000)
    headers = ["name", "brand", "category", "barcode", "retail_price"]
    labels = ["Product Name", "Brand", "Category", "Barcode", "Retail Price (Rs)"]

    def quote(v):
        s = str(v) if v is not None else ""
        if "," in s or '"' in s:
            s = '"' + s.replace('"', '""') + '"'
        return s

    rows = [",".join(labels)]
    for p in products:
        rows.append(",".join(quote(p.get(h, "")) for h in headers))

    csv_text = "\n".join(rows)
    from fastapi.responses import Response as FastResponse
    return FastResponse(
        content=csv_text.encode("utf-8-sig"),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=barcodes_export.csv"},
    )


@api_router.post("/admin/products/bulk-barcode")
async def admin_bulk_barcode(file: UploadFile, request: Request):
    """Batch-assign manufacturer barcodes from a CSV (name,barcode)."""
    await require_admin(request)
    try:
        content = (await file.read()).decode("utf-8-sig")
    except Exception:
        raise HTTPException(status_code=400, detail="Could not read file. Ensure it is UTF-8 encoded CSV.")

    lines = [l for l in content.strip().splitlines() if l.strip()]
    if len(lines) < 2:
        raise HTTPException(status_code=400, detail="CSV must have a header row and at least one data row.")

    raw_headers = [h.strip().lower().strip('"').strip("'") for h in lines[0].split(",")]
    name_idx    = next((i for i, h in enumerate(raw_headers) if h in ["name", "product", "product name"]), -1)
    barcode_idx = next((i for i, h in enumerate(raw_headers) if h in ["barcode", "barcode_number", "ean", "upc", "code"]), -1)
    if name_idx == -1 or barcode_idx == -1:
        raise HTTPException(status_code=400, detail="CSV must have 'name' and 'barcode' columns.")

    # Build lookup maps
    all_products = await db.products.find({}).to_list(5000)
    name_map    = {p["name"].strip().lower(): p for p in all_products}
    barcode_map = {p["barcode"].strip(): p for p in all_products if p.get("barcode", "").strip()}

    def split_csv_line(line):
        cols, cur, in_q = [], "", False
        for ch in line:
            if ch == '"': in_q = not in_q
            elif ch == "," and not in_q: cols.append(cur.strip().strip('"')); cur = ""
            else: cur += ch
        cols.append(cur.strip().strip('"'))
        return cols

    updated, skipped = [], []

    for line in lines[1:]:
        cols    = split_csv_line(line)
        name    = (cols[name_idx].strip()    if name_idx    < len(cols) else "").strip()
        barcode = (cols[barcode_idx].strip() if barcode_idx < len(cols) else "").strip()

        if not name:
            continue
        if not barcode:
            skipped.append({"name": name, "reason": "No barcode provided"})
            continue

        product = name_map.get(name.lower())
        if not product:
            skipped.append({"name": name, "reason": "Product not found"})
            continue

        # Duplicate check — barcode used by a DIFFERENT product?
        dup = barcode_map.get(barcode)
        if dup and str(dup["_id"]) != str(product["_id"]):
            skipped.append({"name": name, "barcode": barcode, "reason": f"Barcode already used by \"{dup.get('name', '')}\"" })
            continue

        # Perform update
        old_bc = product.get("barcode", "").strip()
        await db.products.update_one({"_id": product["_id"]}, {"$set": {"barcode": barcode}})

        # Keep maps consistent for the rest of the batch
        if old_bc and old_bc in barcode_map:
            del barcode_map[old_bc]
        barcode_map[barcode] = product
        updated.append({"name": name, "barcode": barcode})

    return {"updated": updated, "skipped": skipped}


@api_router.post("/admin/products/bulk-stock")
async def admin_bulk_stock(request: Request, file: UploadFile = File(...)):
    await require_admin(request)
    content = await file.read()
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="File must be UTF-8 encoded CSV")

    try:
        reader = csv.DictReader(io.StringIO(text))
        fieldnames = reader.fieldnames or []
    except Exception:
        raise HTTPException(status_code=400, detail="Could not parse CSV file")

    if not fieldnames:
        raise HTTPException(status_code=400, detail="CSV has no header row")

    norm = {f.strip().lower().strip('"').strip("'"): f for f in fieldnames}
    name_col = norm.get("name") or norm.get("product") or norm.get("product name")
    stock_col = norm.get("stock") or norm.get("qty") or norm.get("quantity")

    if not name_col or not stock_col:
        raise HTTPException(status_code=400, detail="CSV must have 'name' and 'stock' columns")

    all_products = await db.products.find({}).to_list(2000)
    product_map = {p["name"].strip().lower(): p for p in all_products}

    updated, not_found, errors = [], [], []
    seen = set()

    for row in reader:
        raw_name = row.get(name_col, "").strip().strip('"').strip("'")
        raw_stock = row.get(stock_col, "").strip()
        if not raw_name:
            continue
        key = raw_name.lower()
        if key in seen:
            continue
        seen.add(key)
        try:
            new_stock = int(float(raw_stock))
            if new_stock < 0:
                raise ValueError("negative")
        except (ValueError, TypeError):
            errors.append({"name": raw_name, "value": raw_stock, "error": "Invalid stock value"})
            continue
        product = product_map.get(key)
        if not product:
            not_found.append({"name": raw_name, "value": new_stock})
            continue
        old_stock = product.get("stock", 0)
        await db.products.update_one({"_id": product["_id"]}, {"$set": {"stock": new_stock}})
        updated.append({
            "id": str(product["_id"]),
            "name": product["name"],
            "old_stock": old_stock,
            "new_stock": new_stock,
        })

    return {"updated": updated, "not_found": not_found, "errors": errors}


@api_router.post("/admin/products/bulk-import")
async def admin_bulk_import(request: Request, file: UploadFile = File(...)):
    """Full product upsert from CSV. Creates new products or updates existing ones by name."""
    await require_admin(request)
    content = await file.read()
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="File must be UTF-8 encoded CSV")

    try:
        reader = csv.DictReader(io.StringIO(text))
        fieldnames = reader.fieldnames or []
    except Exception:
        raise HTTPException(status_code=400, detail="Could not parse CSV file")

    if not fieldnames:
        raise HTTPException(status_code=400, detail="CSV has no header row")

    # Normalise column names
    norm = {f.strip().lower().strip('"').strip("'"): f for f in fieldnames}

    def col(keys):
        for k in keys:
            if k in norm:
                return norm[k]
        return None

    name_col = col(["name", "product name", "product"])
    price_col = col(["retail_price", "retail price", "price"])

    if not name_col or not price_col:
        raise HTTPException(status_code=400, detail="CSV must have 'name' and 'retail_price' columns")

    # Optional columns
    cat_col         = col(["category"])
    brand_col       = col(["brand"])
    pack_type_col   = col(["pack_type", "pack type"])
    pack_size_col   = col(["pack_size", "pack size"])
    ws_price_col    = col(["wholesale_price", "wholesale price"])
    purchase_col    = col(["purchase_price", "purchase price", "cost_price", "cost price", "cost"])
    stock_col       = col(["stock", "qty", "quantity"])
    hsn_col         = col(["hsn"])
    icon_col        = col(["icon"])

    all_products = await db.products.find({}).to_list(2000)
    product_map = {p["name"].strip().lower(): p for p in all_products}

    created, updated, skipped = [], [], []
    seen = set()

    def get(row, col_key):
        if col_key is None:
            return ""
        return row.get(col_key, "").strip().strip('"').strip("'")

    for row in reader:
        raw_name = get(row, name_col)
        if not raw_name:
            continue
        key = raw_name.lower()
        if key in seen:
            continue
        seen.add(key)

        raw_price = get(row, price_col)
        try:
            retail_price = float(raw_price)
            if retail_price <= 0:
                raise ValueError("non-positive")
        except (ValueError, TypeError):
            skipped.append({"name": raw_name, "reason": f"Invalid retail_price: '{raw_price}'"})
            continue

        raw_ws = get(row, ws_price_col)
        try:
            wholesale_price = float(raw_ws) if raw_ws else retail_price * 0.85
        except ValueError:
            wholesale_price = retail_price * 0.85

        raw_purchase = get(row, purchase_col)
        try:
            purchase_price = float(raw_purchase) if raw_purchase else 0.0
        except ValueError:
            purchase_price = 0.0

        raw_stock = get(row, stock_col)
        try:
            stock = max(0, int(float(raw_stock))) if raw_stock else 0
        except ValueError:
            stock = 0

        existing = product_map.get(key)

        if existing:
            # Update only non-empty fields
            patch = {"retail_price": retail_price, "wholesale_price": wholesale_price, "purchase_price": purchase_price}
            if get(row, cat_col):   patch["category"]   = get(row, cat_col)
            if get(row, brand_col): patch["brand"]      = get(row, brand_col)
            if get(row, pack_type_col): patch["pack_type"] = get(row, pack_type_col)
            if get(row, pack_size_col): patch["pack_size"] = get(row, pack_size_col)
            if get(row, hsn_col):   patch["hsn"]        = get(row, hsn_col)
            if get(row, icon_col):  patch["icon"]        = get(row, icon_col)
            if raw_stock:           patch["stock"]       = stock
            await db.products.update_one({"_id": existing["_id"]}, {"$set": patch})
            updated.append({"name": raw_name, "id": str(existing["_id"])})
        else:
            # Create new product
            doc = {
                "name": raw_name,
                "category": get(row, cat_col) or "",
                "brand": get(row, brand_col) or "",
                "pack_type": get(row, pack_type_col) or "",
                "pack_size": get(row, pack_size_col) or "",
                "icon": get(row, icon_col) or "anar",
                "retail_price": retail_price,
                "wholesale_price": wholesale_price,
                "purchase_price": purchase_price,
                "stock": stock,
                "hsn": get(row, hsn_col) or "3604",
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
            result = await db.products.insert_one(doc)
            created.append({"name": raw_name, "id": str(result.inserted_id)})

    return {"created": created, "updated": updated, "skipped": skipped}


class ProductIn(BaseModel):
    name: str
    brand: str = ""
    category: str = ""
    pack_type: str = ""
    pack_size: str = ""
    icon: str = "anar"
    retail_price: float
    wholesale_price: float
    purchase_price: float = 0.0
    stock: int = 0
    hsn: str = "3604"
    barcode: str = ""


def _gen_barcode() -> str:
    """Generate a unique 12-digit numeric barcode (Code128 compatible)."""
    return "890" + "".join([str(secrets.randbelow(10)) for _ in range(9)])


@api_router.post("/admin/products", response_model=ProductOut)
async def admin_create_product(input: ProductIn, request: Request):
    await require_admin(request)
    if not input.name.strip():
        raise HTTPException(status_code=400, detail="Name is required")
    if input.retail_price <= 0 or input.wholesale_price <= 0:
        raise HTTPException(status_code=400, detail="Prices must be positive")
    doc = {
        "name": input.name.strip(),
        "brand": input.brand.strip(),
        "category": input.category.strip(),
        "pack_type": input.pack_type.strip(),
        "pack_size": input.pack_size.strip(),
        "icon": input.icon,
        "retail_price": round(input.retail_price, 2),
        "wholesale_price": round(input.wholesale_price, 2),
        "purchase_price": round(max(0, input.purchase_price), 2),
        "stock": max(0, input.stock),
        "hsn": input.hsn.strip() or "3604",
        "barcode": input.barcode.strip() or _gen_barcode(),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    result = await db.products.insert_one(doc)
    doc["_id"] = result.inserted_id
    return product_out(doc)


@api_router.patch("/admin/products/{product_id}")
async def admin_update_product(product_id: str, input: ProductIn, request: Request):
    await require_admin(request)
    if not input.name.strip():
        raise HTTPException(status_code=400, detail="Name is required")
    if input.retail_price <= 0 or input.wholesale_price <= 0:
        raise HTTPException(status_code=400, detail="Prices must be positive")
    try:
        patch = {
            "name": input.name.strip(),
            "brand": input.brand.strip(),
            "category": input.category.strip(),
            "pack_type": input.pack_type.strip(),
            "pack_size": input.pack_size.strip(),
            "icon": input.icon,
            "retail_price": round(input.retail_price, 2),
            "wholesale_price": round(input.wholesale_price, 2),
            "purchase_price": round(max(0, input.purchase_price), 2),
            "stock": max(0, input.stock),
            "hsn": input.hsn.strip() or "3604",
        }
        # Only update barcode if a new value is explicitly provided
        if input.barcode.strip():
            patch["barcode"] = input.barcode.strip()
        result = await db.products.update_one(
            {"_id": ObjectId(product_id)},
            {"$set": patch},
        )
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid product ID")
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Product not found")
    doc = await db.products.find_one({"_id": ObjectId(product_id)})
    return product_out(doc)


@api_router.delete("/admin/products/{product_id}")
async def admin_delete_product(product_id: str, request: Request):
    await require_admin(request)
    try:
        result = await db.products.delete_one({"_id": ObjectId(product_id)})
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid product ID")
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Product not found")
    return {"ok": True}


# ---------- Salesperson endpoints ----------

class SalespersonIn(BaseModel):
    name: str


@api_router.get("/admin/salespersons")
async def list_salespersons(request: Request):
    await require_admin(request)
    docs = await db.salespersons.find({}).sort("name", 1).to_list(200)
    return [{"id": str(d["_id"]), "name": d["name"], "has_pin": bool(d.get("pin_hash")), "has_account": bool(d.get("user_id")), "email": d.get("email", "")} for d in docs]


@api_router.post("/admin/salespersons")
async def create_salesperson(input: SalespersonIn, request: Request):
    await require_admin(request)
    name = input.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required")
    result = await db.salespersons.insert_one({"name": name, "created_at": datetime.now(timezone.utc).isoformat()})
    return {"id": str(result.inserted_id), "name": name, "has_pin": False}


@api_router.patch("/admin/salespersons/{sp_id}/pin")
async def set_salesperson_pin(sp_id: str, request: Request):
    await require_admin(request)
    body = await request.json()
    pin = str(body.get("pin", "")).strip()
    if not pin.isdigit() or len(pin) != 4:
        raise HTTPException(status_code=400, detail="PIN must be exactly 4 digits")
    try:
        oid = ObjectId(sp_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid ID")
    pin_hash = hash_password(pin)
    result = await db.salespersons.update_one({"_id": oid}, {"$set": {"pin_hash": pin_hash}})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Salesperson not found")
    return {"ok": True}


@api_router.post("/admin/salespersons/verify-pin")
async def verify_salesperson_pin(request: Request):
    await require_admin(request)
    body = await request.json()
    sp_id = body.get("salesperson_id", "")
    pin = str(body.get("pin", "")).strip()
    try:
        oid = ObjectId(sp_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid ID")
    sp = await db.salespersons.find_one({"_id": oid})
    if not sp:
        raise HTTPException(status_code=404, detail="Salesperson not found")
    if not sp.get("pin_hash"):
        raise HTTPException(status_code=400, detail="No PIN set for this salesperson")
    if not verify_password(pin, sp["pin_hash"]):
        raise HTTPException(status_code=401, detail="Wrong PIN")
    # Log shift start
    await db.shift_logs.insert_one({
        "salesperson_id": str(sp["_id"]),
        "salesperson_name": sp["name"],
        "event": "start",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })
    return {"ok": True, "name": sp["name"]}


@api_router.post("/admin/salespersons/shift-start-no-pin")
async def shift_start_no_pin(request: Request):
    """Log shift start for salespersons without a PIN."""
    await require_pos_access(request)
    body = await request.json()
    sp_id = body.get("salesperson_id", "")
    try:
        oid = ObjectId(sp_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid ID")
    sp = await db.salespersons.find_one({"_id": oid})
    if not sp:
        raise HTTPException(status_code=404, detail="Salesperson not found")
    await db.shift_logs.insert_one({
        "salesperson_id": str(sp["_id"]),
        "salesperson_name": sp["name"],
        "event": "start",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })
    return {"ok": True, "name": sp["name"]}


@api_router.post("/admin/salespersons/shift-end")
async def shift_end(request: Request):
    await require_pos_access(request)
    body = await request.json()
    sp_id = body.get("salesperson_id", "")
    sp_name = body.get("salesperson_name", "")
    await db.shift_logs.insert_one({
        "salesperson_id": sp_id,
        "salesperson_name": sp_name,
        "event": "end",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })
    return {"ok": True}


@api_router.get("/admin/shift-logs")
async def list_shift_logs(request: Request, from_date: str = "", to_date: str = "", sp_name: str = ""):
    await require_admin(request)
    match: dict = {}
    if from_date or to_date:
        ts_filter: dict = {}
        if from_date:
            ts_filter["$gte"] = from_date
        if to_date:
            ts_filter["$lte"] = to_date + "T23:59:59.999999+00:00"
        match["timestamp"] = ts_filter
    if sp_name:
        match["salesperson_name"] = sp_name
    docs = await db.shift_logs.find(match).sort("timestamp", -1).to_list(500)
    return [
        {
            "id": str(d["_id"]),
            "salesperson_name": d.get("salesperson_name", ""),
            "event": d.get("event", ""),
            "timestamp": d.get("timestamp", ""),
        }
        for d in docs
    ]


@api_router.delete("/admin/salespersons/{sp_id}")
async def delete_salesperson(sp_id: str, request: Request):
    await require_admin(request)
    try:
        result = await db.salespersons.delete_one({"_id": ObjectId(sp_id)})
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid ID")
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Salesperson not found")
    return {"ok": True}


@api_router.post("/admin/salespersons/{sp_id}/create-account")
async def create_salesperson_account(sp_id: str, request: Request):
    await require_admin(request)
    body = await request.json()
    email = body.get("email", "").strip().lower()
    password = body.get("password", "").strip()
    if not email or not password:
        raise HTTPException(status_code=400, detail="Email and password are required")
    if len(password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    try:
        oid = ObjectId(sp_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid ID")
    sp = await db.salespersons.find_one({"_id": oid})
    if not sp:
        raise HTTPException(status_code=404, detail="Salesperson not found")
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Email already in use")
    user_doc = {
        "name": sp["name"],
        "email": email,
        "password_hash": hash_password(password),
        "role": "salesperson",
        "customer_type": "retail",
        "approved": True,
        "salesperson_id": sp_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    result = await db.users.insert_one(user_doc)
    await db.salespersons.update_one({"_id": oid}, {"$set": {"user_id": str(result.inserted_id), "email": email}})
    return {"ok": True, "email": email}


@api_router.patch("/admin/salespersons/{sp_id}/reset-password")
async def reset_salesperson_password(sp_id: str, request: Request):
    await require_admin(request)
    body = await request.json()
    new_password = body.get("password", "").strip()
    if len(new_password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    try:
        oid = ObjectId(sp_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid ID")
    sp = await db.salespersons.find_one({"_id": oid})
    if not sp or not sp.get("user_id"):
        raise HTTPException(status_code=404, detail="No account found for this salesperson")
    await db.users.update_one(
        {"_id": ObjectId(sp["user_id"])},
        {"$set": {"password_hash": hash_password(new_password)}}
    )
    return {"ok": True}


@api_router.post("/admin/salespersons/{sp_id}/send-reset-email")
async def send_sp_reset_email(sp_id: str, request: Request):
    """Admin triggers a password reset OTP email for a salesperson."""
    await require_admin(request)
    try:
        oid = ObjectId(sp_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid ID")
    sp = await db.salespersons.find_one({"_id": oid})
    if not sp or not sp.get("user_id"):
        raise HTTPException(status_code=404, detail="No account linked to this salesperson")
    user = await db.users.find_one({"_id": ObjectId(sp["user_id"])})
    if not user or not user.get("email"):
        raise HTTPException(status_code=404, detail="No email found for this salesperson account")

    email = user["email"]
    name = sp.get("name", "there")
    otp = _gen_otp()
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=10)

    await db.password_reset_otps.update_one(
        {"email": email},
        {"$set": {"otp": otp, "expires_at": expires_at, "used": False}},
        upsert=True,
    )

    subject = f"Your {EMAIL_FROM_NAME} password reset OTP"
    html = f"""<table role="presentation" width="100%" cellpadding="0" cellspacing="0"
        style="background:#fdf6ef;padding:0;margin:0">
      <tr><td align="center" style="padding:32px 16px">
        <table role="presentation" width="100%" style="max-width:480px;background:#fff;
          border-radius:16px;padding:32px 28px;font-family:Arial,sans-serif;color:#1F1512">
          <tr><td>
            <p style="font-size:20px;font-weight:700;margin:0 0 6px">
              Password Reset — {escape(EMAIL_FROM_NAME)}
            </p>
            <p style="font-size:14px;color:#7A5C4F;margin:0 0 24px">
              Hi {escape(name)}, your admin has requested a password reset for your account.
            </p>
            <p style="font-size:13px;margin:0 0 8px">Your one-time password (OTP):</p>
            <div style="font-size:36px;font-weight:700;letter-spacing:10px;
              background:#fdf6ef;border-radius:12px;padding:16px 24px;
              text-align:center;color:#7B1A1A;margin:0 0 20px">
              {escape(otp)}
            </div>
            <p style="font-size:13px;color:#7A5C4F;margin:0 0 24px">
              This OTP is valid for <strong>10 minutes</strong>.
              Go to the login page, click <em>Forgot password?</em> and enter this code.
            </p>
            <hr style="border:none;border-top:1px dashed #E5D8CE;margin:0 0 16px" />
            <p style="font-size:11px;color:#aaa;margin:0">
              Sent by {escape(EMAIL_FROM_NAME)}. If you did not expect this email,
              please contact your shop admin.
            </p>
          </td></tr>
        </table>
      </td></tr>
    </table>"""

    await send_email(to=email, subject=subject, html=html)
    return {"ok": True, "email": email}



class CategoryIn(BaseModel):
    name: str


@api_router.get("/categories")
async def list_categories():
    docs = await db.categories.find({}).sort("sort_order", 1).to_list(200)
    return [{"id": str(d["_id"]), "name": d["name"]} for d in docs]


@api_router.post("/admin/categories")
async def create_category(input: CategoryIn, request: Request):
    await require_admin(request)
    name = input.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required")
    if await db.categories.find_one({"name": {"$regex": f"^{name}$", "$options": "i"}}):
        raise HTTPException(status_code=400, detail="Category already exists")
    count = await db.categories.count_documents({})
    result = await db.categories.insert_one({
        "name": name,
        "sort_order": count,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return {"id": str(result.inserted_id), "name": name}


@api_router.patch("/admin/categories/{cat_id}")
async def rename_category(cat_id: str, input: CategoryIn, request: Request):
    await require_admin(request)
    name = input.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required")
    try:
        oid = ObjectId(cat_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid ID")
    old_doc = await db.categories.find_one({"_id": oid})
    if not old_doc:
        raise HTTPException(status_code=404, detail="Category not found")
    old_name = old_doc["name"]
    await db.categories.update_one({"_id": oid}, {"$set": {"name": name}})
    # Update all products that used the old name
    await db.products.update_many({"category": old_name}, {"$set": {"category": name}})
    return {"id": cat_id, "name": name}


@api_router.delete("/admin/categories/{cat_id}")
async def delete_category(cat_id: str, request: Request):
    await require_admin(request)
    try:
        oid = ObjectId(cat_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid ID")
    cat = await db.categories.find_one({"_id": oid})
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")
    in_use = await db.products.count_documents({"category": cat["name"]})
    if in_use > 0:
        raise HTTPException(status_code=400, detail=f"Cannot delete — {in_use} product(s) use this category")
    await db.categories.delete_one({"_id": oid})
    return {"ok": True}


# ---------- Reports ----------

@api_router.get("/admin/reports/salesperson")
async def salesperson_report(request: Request, from_date: str = "", to_date: str = ""):
    await require_admin(request)
    match: dict = {"salesperson_name": {"$ne": "", "$exists": True}}
    if from_date or to_date:
        date_filter: dict = {}
        if from_date:
            date_filter["$gte"] = from_date
        if to_date:
            # to_date is a date string like "2025-11-05"; include full day by appending end-of-day
            date_filter["$lte"] = to_date + "T23:59:59.999999+00:00"
        match["created_at"] = date_filter
    pipeline = [
        {"$match": match},
        {"$group": {
            "_id": "$salesperson_name",
            "orders": {"$sum": 1},
            "revenue": {"$sum": "$total"},
            "last_sale": {"$max": "$created_at"},
        }},
        {"$sort": {"revenue": -1}},
    ]
    rows = await db.orders.aggregate(pipeline).to_list(200)
    all_sp = await db.salespersons.find({}).sort("name", 1).to_list(200)
    agg = {r["_id"]: r for r in rows}
    result = []
    for sp in all_sp:
        name = sp["name"]
        row = agg.get(name, {})
        result.append({
            "name": name,
            "orders": row.get("orders", 0),
            "revenue": round(row.get("revenue", 0.0), 2),
            "last_sale": row.get("last_sale", None),
        })
    result.sort(key=lambda x: (-x["revenue"], x["name"]))
    return result


@api_router.get("/admin/reports/dashboard-summary")
async def dashboard_summary(request: Request):
    """All-in-one card: today's snapshot, 7-day trend, top products, category breakdown, GST summary."""
    await require_admin(request)
    now = datetime.now(timezone.utc)

    def iso(dt): return dt.isoformat()

    today_start = iso(now.replace(hour=0, minute=0, second=0, microsecond=0))
    week_start  = iso((now - timedelta(days=6)).replace(hour=0, minute=0, second=0, microsecond=0))
    month_start = iso(now.replace(day=1, hour=0, minute=0, second=0, microsecond=0))

    today_orders = await db.orders.find({"created_at": {"$gte": today_start}}).to_list(10000)
    week_orders  = await db.orders.find({"created_at": {"$gte": week_start}}).to_list(10000)
    month_orders = await db.orders.find({"created_at": {"$gte": month_start}}).to_list(10000)
    products     = await db.products.find({}).to_list(5000)

    purchase_map = {p["name"].strip().lower(): p.get("purchase_price", 0) for p in products}
    cat_map      = {p["name"].strip().lower(): p.get("category", "Other") for p in products}

    # ── Today snapshot ────────────────────────────────────────────
    today_revenue = sum(o.get("total", 0) for o in today_orders)
    today_items   = sum(i.get("qty", 0) for o in today_orders for i in o.get("items", []))
    today_cost    = sum(
        purchase_map.get(i.get("name", "").strip().lower(), 0) * i.get("qty", 0)
        for o in today_orders for i in o.get("items", [])
    )

    # ── 7-day revenue trend ────────────────────────────────────────
    daily: dict = {}
    for d in range(6, -1, -1):
        key = (now - timedelta(days=d)).strftime("%d %b")
        daily[key] = 0.0
    for o in week_orders:
        try:
            dt  = datetime.fromisoformat(o["created_at"].replace("Z", "+00:00"))
            key = dt.strftime("%d %b")
            if key in daily:
                daily[key] += o.get("total", 0)
        except Exception:
            pass
    trend = [{"day": k, "revenue": round(v, 2)} for k, v in daily.items()]

    # ── Top 5 products this week ────────────────────────────────────
    prod_sales: dict = {}
    for o in week_orders:
        for item in o.get("items", []):
            name = item.get("name", "")
            if name not in prod_sales:
                prod_sales[name] = {"name": name, "qty": 0, "revenue": 0.0}
            prod_sales[name]["qty"]     += item.get("qty", 0)
            prod_sales[name]["revenue"] += item.get("price", 0) * item.get("qty", 0)
    top5 = sorted(prod_sales.values(), key=lambda x: -x["qty"])[:5]

    # ── Category breakdown this week ────────────────────────────────
    cat_rev: dict = {}
    week_total = 0.0
    for o in week_orders:
        for item in o.get("items", []):
            cat = cat_map.get(item.get("name", "").strip().lower(), "Other")
            rev = item.get("price", 0) * item.get("qty", 0)
            cat_rev[cat] = cat_rev.get(cat, 0) + rev
            week_total  += rev
    categories = [
        {"category": k, "revenue": round(v, 2),
         "pct": round(v / week_total * 100, 1) if week_total else 0}
        for k, v in sorted(cat_rev.items(), key=lambda x: -x[1])[:6]
    ]

    # ── GST summary this month ──────────────────────────────────────
    total_cgst = sum(o.get("cgst", 0) for o in month_orders)
    total_sgst = sum(o.get("sgst", 0) for o in month_orders)

    return {
        "today": {
            "revenue":    round(today_revenue, 2),
            "orders":     len(today_orders),
            "profit":     round(today_revenue - today_cost, 2),
            "items_sold": today_items,
        },
        "trend":      trend,
        "top_products": [{**p, "revenue": round(p["revenue"], 2)} for p in top5],
        "categories": categories,
        "gst": {
            "cgst":          round(total_cgst, 2),
            "sgst":          round(total_sgst, 2),
            "month_revenue": round(sum(o.get("total", 0) for o in month_orders), 2),
            "month":         now.strftime("%B %Y"),
        },
    }


@api_router.get("/admin/reports/profit")
async def profit_report(request: Request, from_date: str = "", to_date: str = ""):
    """Profit report: compares order selling prices with current product purchase prices."""
    await require_admin(request)
    match: dict = {}
    if from_date or to_date:
        date_filter: dict = {}
        if from_date:
            date_filter["$gte"] = from_date
        if to_date:
            date_filter["$lte"] = to_date + "T23:59:59.999999+00:00"
        match["created_at"] = date_filter

    orders = await db.orders.find(match).to_list(10000)
    products = await db.products.find({}).to_list(5000)
    # Build lookup: product name (lower) → purchase_price
    purchase_map = {p["name"].strip().lower(): p.get("purchase_price", 0) for p in products}

    total_revenue = 0.0
    total_cost    = 0.0
    product_profit: dict = {}

    for order in orders:
        total_revenue += order.get("total", 0)
        for item in order.get("items", []):
            name_key = item.get("name", "").strip().lower()
            sell_price = float(item.get("price", 0))
            qty        = int(item.get("qty", 0))
            cost_price = purchase_map.get(name_key, 0)
            profit     = (sell_price - cost_price) * qty
            cost       = cost_price * qty
            total_cost += cost
            key = item.get("name", "")
            if key not in product_profit:
                product_profit[key] = {"name": key, "qty": 0, "revenue": 0.0, "cost": 0.0, "profit": 0.0}
            product_profit[key]["qty"]     += qty
            product_profit[key]["revenue"] += sell_price * qty
            product_profit[key]["cost"]    += cost
            product_profit[key]["profit"]  += profit

    top_products = sorted(product_profit.values(), key=lambda x: -x["profit"])[:10]
    return {
        "total_revenue": round(total_revenue, 2),
        "total_cost":    round(total_cost, 2),
        "total_profit":  round(total_revenue - total_cost, 2),
        "margin_pct":    round((total_revenue - total_cost) / total_revenue * 100, 1) if total_revenue else 0,
        "orders_count":  len(orders),
        "top_products":  [
            {**p, "revenue": round(p["revenue"], 2), "cost": round(p["cost"], 2), "profit": round(p["profit"], 2)}
            for p in top_products
        ],
    }

SEED_CATEGORIES = ["Anar", "Fulzadi", "Bomb & Sutli", "Fancy Phatake", "Ladi", "Rockets"]

SEED_PRODUCTS = [
    {"name": "Anar Big", "category": "Anar", "pack_type": "Box", "pack_size": "5 pcs", "icon": "anar", "retail_price": 320, "wholesale_price": 270, "stock": 24, "hsn": "3604"},
    {"name": "Fulzadi 10 cm", "category": "Fulzadi", "pack_type": "Packet", "pack_size": "10 pcs", "icon": "fulzadi", "retail_price": 60, "wholesale_price": 48, "stock": 60, "hsn": "3604"},
    {"name": "Sutli Bomb", "category": "Bomb & Sutli", "pack_type": "Packet", "pack_size": "100 pcs", "icon": "bomb", "retail_price": 140, "wholesale_price": 115, "stock": 7, "hsn": "3604"},
    {"name": "Whistling Rocket", "category": "Rockets", "pack_type": "Box", "pack_size": "3 pcs", "icon": "rocket", "retail_price": 180, "wholesale_price": 150, "stock": 30, "hsn": "3604"},
    {"name": "Ladi 1000 Wala", "category": "Ladi", "pack_type": "Roll", "pack_size": "1000 shots", "icon": "ladi", "retail_price": 450, "wholesale_price": 390, "stock": 4, "hsn": "3604"},
    {"name": "Fancy Crackle Box", "category": "Fancy Phatake", "pack_type": "Box", "pack_size": "12 pcs", "icon": "crackle", "retail_price": 260, "wholesale_price": 220, "stock": 18, "hsn": "3604"},
    {"name": "Chakri Big", "category": "Fancy Phatake", "pack_type": "Packet", "pack_size": "10 pcs", "icon": "chakri", "retail_price": 90, "wholesale_price": 75, "stock": 5, "hsn": "3604"},
    {"name": "Twinkling Star", "category": "Fancy Phatake", "pack_type": "Box", "pack_size": "20 pcs", "icon": "star", "retail_price": 120, "wholesale_price": 99, "stock": 6, "hsn": "3604"},
]


async def seed():
    await db.users.create_index("email", unique=True)
    await db.login_attempts.create_index("identifier")

    if await db.categories.count_documents({}) == 0:
        await db.categories.insert_many([
            {"name": c, "sort_order": i, "created_at": datetime.now(timezone.utc).isoformat()}
            for i, c in enumerate(SEED_CATEGORIES)
        ])

    if await db.products.count_documents({}) == 0:
        await db.products.insert_many([dict(p) for p in SEED_PRODUCTS])

    # Seed two admin accounts if none exist
    SEED_ADMINS = [
        {"name": "Admin 1", "email": os.environ.get("ADMIN_EMAIL"), "password": os.environ.get("ADMIN_PASSWORD")},
        {"name": "Admin 2", "email": os.environ.get("ADMIN2_EMAIL"), "password": os.environ.get("ADMIN2_PASSWORD")},
    ]
    if not await db.users.find_one({"role": "admin"}):
        for adm in SEED_ADMINS:
            if not adm["email"] or not adm["password"]:
                continue
            if not await db.users.find_one({"email": adm["email"]}):
                await db.users.insert_one({
                    "name": adm["name"],
                    "email": adm["email"],
                    "password_hash": hash_password(adm["password"]),
                    "role": "admin",
                    "customer_type": "retail",
                    "approved": True,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                })

    if not await db.users.find_one({"email": "demo@crackerpos.in"}):
        await db.users.insert_one({
            "name": "Demo Customer",
            "email": "demo@crackerpos.in",
            "password_hash": hash_password("demo1234"),
            "phone": "98765 43210",
            "role": "customer",
            "customer_type": "retail",
            "approved": True,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })

    if not await db.users.find_one({"email": "wholesale@crackerpos.in"}):
        await db.users.insert_one({
            "name": "Wholesale Buyer",
            "email": "wholesale@crackerpos.in",
            "password_hash": hash_password("demo1234"),
            "phone": "98765 43211",
            "role": "customer",
            "customer_type": "wholesale",
            "approved": False,
            "business_name": "Sri Traders",
            "gstin": "",
            "created_at": datetime.now(timezone.utc).isoformat(),
        })


@app.on_event("startup")
async def startup():
    await seed()


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()


# ---------- CORS Configuration ----------

allowed_origins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "https://shahu-fataka-qdh3vfnge-rebusi.vercel.app",
]

origins_env = os.environ.get("CORS_ORIGINS", "").strip()

if origins_env:
    allowed_origins = [
        origin.strip().rstrip("/")
        for origin in origins_env.split(",")
        if origin.strip()
    ]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)
