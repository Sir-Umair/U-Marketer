import asyncio
import base64
import json
import time
from typing import Dict, Any, Optional
from fastapi import APIRouter, Request, HTTPException, Depends, status
from fastapi.responses import RedirectResponse
import requests
import urllib.parse
from datetime import datetime
from app.config import settings
from app.db import users_collection
from app.services.security_service import encrypt_data
from jose import jwt

router = APIRouter(prefix="/api/auth", tags=["Authentication"])

SCOPES = [
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/gmail.send"
]

# Concurrency lock and result cache for OAuth authorization code exchanges
# Prevents duplicate Google token exchange calls caused by React Strict Mode or concurrent requests.
_code_exchanges: Dict[str, Dict[str, Any]] = {}
_code_exchanges_lock = asyncio.Lock()


def resolve_redirect_uri(state: Optional[str] = None, explicit_uri: Optional[str] = None) -> str:
    """Ensures redirect_uri matches identically across consent and token exchange requests."""
    if explicit_uri and explicit_uri.strip():
        return explicit_uri.strip()
    if state:
        try:
            padded = state + "=" * (-len(state) % 4)
            decoded = json.loads(base64.urlsafe_b64decode(padded.encode()).decode())
            if isinstance(decoded, dict) and decoded.get("redirect_uri"):
                return str(decoded["redirect_uri"]).strip()
        except Exception:
            pass
    return settings.redirect_uri.strip()


async def perform_token_exchange(code: str, redirect_uri: str) -> Dict[str, Any]:
    """
    Exchanges an OAuth code for tokens with deduplication and in-flight request synchronization.
    If multiple requests for the same single-use code arrive simultaneously, only one calls Google
    and the rest safely receive the shared successful result, preventing invalid_grant errors.
    """
    now = time.time()

    # 1. Clean up cache entries older than 300 seconds (5 minutes) and obtain or create entry
    async with _code_exchanges_lock:
        stale_codes = [c for c, v in _code_exchanges.items() if now - v.get("timestamp", 0) > 300]
        for c in stale_codes:
            _code_exchanges.pop(c, None)

        if code in _code_exchanges:
            entry = _code_exchanges[code]
        else:
            entry = {
                "lock": asyncio.Lock(),
                "result": None,
                "timestamp": now,
            }
            _code_exchanges[code] = entry

    # 2. Synchronize execution under the code's dedicated lock
    async with entry["lock"]:
        if entry["result"] is not None:
            # Re-use result from previous or in-flight exchange for this code
            if entry["result"].get("success"):
                return entry["result"]["data"]
            else:
                raise HTTPException(status_code=400, detail=entry["result"].get("error", "Token exchange failed"))

        # 3. Perform Google OAuth token exchange
        token_url = "https://oauth2.googleapis.com/token"
        payload = {
            "code": code,
            "client_id": settings.google_client_id.strip(),
            "client_secret": settings.google_client_secret.strip(),
            "redirect_uri": redirect_uri.strip(),
            "grant_type": "authorization_code"
        }

        loop = asyncio.get_running_loop()
        try:
            token_resp = await loop.run_in_executor(
                None,
                lambda: requests.post(token_url, data=payload, timeout=15)
            )
        except Exception as net_err:
            err_msg = f"Failed to connect to Google OAuth server: {net_err}"
            entry["result"] = {"success": False, "error": err_msg}
            raise HTTPException(status_code=502, detail=err_msg)

        if not token_resp.ok:
            err_text = token_resp.text
            entry["result"] = {"success": False, "error": f"Token exchange failed: {err_text}"}
            raise HTTPException(status_code=400, detail=f"Token exchange failed: {err_text}")

        tokens = token_resp.json()
        access_token = tokens.get("access_token")
        refresh_token = tokens.get("refresh_token")

        # 4. Fetch user info
        try:
            user_info_resp = await loop.run_in_executor(
                None,
                lambda: requests.get(
                    "https://www.googleapis.com/oauth2/v2/userinfo",
                    headers={"Authorization": f"Bearer {access_token}"},
                    timeout=15
                )
            )
            user_info = user_info_resp.json()
        except Exception as info_err:
            err_msg = f"Failed to retrieve Google user profile: {info_err}"
            entry["result"] = {"success": False, "error": err_msg}
            raise HTTPException(status_code=502, detail=err_msg)

        email = user_info.get("email")
        name = user_info.get("name")

        if not email:
            err_msg = "Google profile did not provide an email address"
            entry["result"] = {"success": False, "error": err_msg}
            raise HTTPException(status_code=400, detail=err_msg)

        # 5. Check account connection limit
        if users_collection is None:
            err_msg = "Database connection not established"
            entry["result"] = {"success": False, "error": err_msg}
            raise HTTPException(status_code=500, detail=err_msg)

        existing_user = await users_collection.find_one({"email": email})
        if not existing_user or not existing_user.get("access_token"):
            connected_count = await users_collection.count_documents({
                "access_token": {"$exists": True},
                "auth_status": {"$ne": "expired"}
            })
            max_limit = max(10, existing_user.get("max_connected_accounts", 10)) if existing_user else 10
            if connected_count >= max_limit:
                limit_err = f"Inbox Connection Limit Reached! Your plan allows a maximum of {max_limit} connected Gmail accounts ({connected_count} currently active). Please upgrade your plan or disconnect an account to proceed."
                entry["result"] = {"success": False, "error": limit_err}
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=limit_err)

        # 6. Encrypt & persist user document
        update_doc = {
            "email": email,
            "name": name,
            "access_token": encrypt_data(access_token),
            "token_uri": "https://oauth2.googleapis.com/token",
            "client_id": settings.google_client_id.strip(),
            "client_secret": settings.google_client_secret.strip(),
            "scopes": SCOPES,
            "auth_status": "active",
            "auth_error": None,
            "last_login": datetime.utcnow()
        }

        if not existing_user:
            update_doc["plan_tier"] = "pro"
            update_doc["credits_balance"] = 5000
            update_doc["max_connected_accounts"] = 10
            update_doc["api_keys"] = []

        if refresh_token:
            update_doc["refresh_token"] = encrypt_data(refresh_token)

        await users_collection.update_one(
            {"email": email},
            {"$set": update_doc},
            upsert=True
        )

        # 7. Generate JWT token
        token = jwt.encode({"sub": email}, settings.secret_key, algorithm="HS256")
        data = {
            "token": token,
            "email": email,
            "name": name or "User"
        }
        entry["result"] = {"success": True, "data": data}
        return data


@router.get("/login")
async def login(request: Request):
    if not settings.google_client_id:
        raise HTTPException(status_code=500, detail="Google Client ID not configured")

    req_redirect = request.query_params.get("redirect_uri")
    redirect_uri = (req_redirect or settings.redirect_uri).strip()

    # Encode redirect_uri into state so token exchange always receives an identical URI
    state_payload = {
        "redirect_uri": redirect_uri,
        "ts": int(time.time())
    }
    state = base64.urlsafe_b64encode(json.dumps(state_payload).encode()).decode()

    params = {
        "client_id": settings.google_client_id.strip(),
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": " ".join(SCOPES),
        "access_type": "offline",
        "prompt": "select_account consent",
        "include_granted_scopes": "true",
        "state": state
    }

    auth_url = f"https://accounts.google.com/o/oauth2/v2/auth?{urllib.parse.urlencode(params)}"
    return {"auth_url": auth_url}


@router.post("/exchange")
async def exchange_token(request: Request):
    """
    Exchanges an OAuth code for application credentials.
    Designed for frontend single-page apps; guarded against duplicate code usage.
    """
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    code = body.get("code")
    state = body.get("state")
    explicit_uri = body.get("redirect_uri")

    if not code:
        raise HTTPException(status_code=400, detail="Missing authorization code")

    redirect_uri = resolve_redirect_uri(state, explicit_uri)
    try:
        data = await perform_token_exchange(code=code, redirect_uri=redirect_uri)
        return {"success": True, **data}
    except HTTPException:
        raise
    except Exception as e:
        error_msg = getattr(e, "detail", str(e))
        raise HTTPException(status_code=400, detail=str(error_msg))


@router.get("/callback")
async def callback(request: Request, code: str, state: str = None):
    wants_json = (
        "application/json" in request.headers.get("accept", "")
        or request.query_params.get("format") == "json"
    )
    redirect_uri = resolve_redirect_uri(state, request.query_params.get("redirect_uri"))

    try:
        data = await perform_token_exchange(code=code, redirect_uri=redirect_uri)
        token = data["token"]
        email = data["email"]

        if wants_json:
            return {"success": True, **data}

        return RedirectResponse(url=f"{settings.frontend_url}/auth/callback?token={token}&email={email}")
    except Exception as e:
        error_msg = getattr(e, "detail", str(e))
        print(f"[Auth Error] OAuth callback exception: {type(e).__name__}: {error_msg}")

        if "DNS" in str(error_msg) or "resolution lifetime expired" in str(error_msg):
            error_msg = "Database connection timed out during DNS resolution. Please retry or check network settings."

        if wants_json:
            status_code = getattr(e, "status_code", 400)
            raise HTTPException(status_code=status_code, detail=str(error_msg))

        encoded_err = urllib.parse.quote(str(error_msg))
        return RedirectResponse(url=f"{settings.frontend_url}/login?error={encoded_err}")

async def get_current_user(request: Request):
    import hashlib
    if not users_collection:
        print("[Auth] ERROR: users_collection is None. Check MongoDB connection.")
        raise HTTPException(status_code=500, detail="Database connection not available")

    default_email = settings.email_user or "umairsahib242@gmail.com"

    # 1. Check for X-API-Key Header
    x_api_key = request.headers.get("X-API-Key")
    if x_api_key and x_api_key.startswith("sk_live_"):
        hashed = hashlib.sha256(x_api_key.encode()).hexdigest()
        user = await users_collection.find_one({
            "api_keys.hashed_key": hashed,
            "api_keys.is_active": True
        })
        if user:
            return user
        raise HTTPException(status_code=401, detail="Invalid or revoked X-API-Key")

    # 2. Check for Authorization Header
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        token = auth_header.split(" ")[1]

        # Handle Bearer sk_live_... API Keys
        if token.startswith("sk_live_"):
            hashed = hashlib.sha256(token.encode()).hexdigest()
            user = await users_collection.find_one({
                "api_keys.hashed_key": hashed,
                "api_keys.is_active": True
            })
            if user:
                return user
            raise HTTPException(status_code=401, detail="Invalid or revoked API key")

        # Handle JWT Bearer Tokens
        try:
            payload = jwt.decode(token, settings.secret_key, algorithms=["HS256"])
            email = payload.get("sub")
            
            user = await users_collection.find_one({"email": email})
            if user:
                if "credits_balance" not in user or user["credits_balance"] is None: user["credits_balance"] = 1000
                if "plan_tier" not in user: user["plan_tier"] = "starter"
                if "max_connected_accounts" not in user: user["max_connected_accounts"] = 2
                return user
        except jwt.JWTError as e:
            print(f"[Auth] JWT notice: {e}. Resolving to primary system user.")

    # 3. Local Workspace Fallback:
    # If unauthenticated or token expired, seamlessly use the primary system user
    user = await users_collection.find_one({"email": default_email})
    if not user:
        user = await users_collection.find_one()
    if user:
        if "credits_balance" not in user or user["credits_balance"] is None: user["credits_balance"] = 1000
        if "plan_tier" not in user: user["plan_tier"] = "starter"
        if "max_connected_accounts" not in user: user["max_connected_accounts"] = 2
        return user

    raise HTTPException(status_code=401, detail="Missing or invalid authentication credentials")


@router.get("/status")
async def get_status(user: dict = Depends(get_current_user)):
    """Compatibility endpoint for status check."""
    return {"authenticated": True, "email": user.get("email")}

@router.get("/me")
async def get_me(user: dict = Depends(get_current_user)):
    """Returns the current user profile, excluding sensitive secrets, with a refreshed token."""
    token = jwt.encode({"sub": user["email"]}, settings.secret_key, algorithm="HS256")
    user["_id"] = str(user["_id"])
    
    # Strictly define what we return to the frontend
    safe_user = {
        "id": user["_id"],
        "email": user["email"],
        "name": user.get("name", "Sir Umair"),
        "token": token,
        "plan_tier": user.get("plan_tier", "starter"),
        "credits_balance": user.get("credits_balance", 1000),
        "max_connected_accounts": user.get("max_connected_accounts", 2),
        "last_login": user.get("last_login"),
        "scopes": user.get("scopes", []),
        "auth_status": user.get("auth_status", "active"),
        "auth_error": user.get("auth_error"),
    }
    return safe_user


@router.get("/accounts")
async def get_connected_accounts(user: dict = Depends(get_current_user)):
    """Returns all connected Gmail user accounts available for multi-account dispatching."""
    if users_collection is None:
        raise HTTPException(status_code=500, detail="Database connection not established")
    
    cursor = users_collection.find({"access_token": {"$exists": True}})
    accounts = []
    async for account in cursor:
        accounts.append({
            "id": str(account["_id"]),
            "email": account.get("email"),
            "name": account.get("name", ""),
            "last_login": account.get("last_login"),
            "auth_status": account.get("auth_status", "active"),
            "auth_error": account.get("auth_error"),
            "is_current": account.get("email") == user.get("email")
        })
    return {"accounts": accounts}

@router.delete("/accounts/{target_email}")
async def disconnect_account(target_email: str, user: dict = Depends(get_current_user)):
    """Disconnects a Gmail account by removing its token data."""
    if users_collection is None:
        raise HTTPException(status_code=500, detail="Database connection not established")
        
    res = await users_collection.delete_one({"email": target_email})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Account not found")
    return {"success": True, "message": f"Account {target_email} disconnected successfully"}

