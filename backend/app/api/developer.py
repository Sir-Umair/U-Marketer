from fastapi import APIRouter, Depends, HTTPException, status
import secrets
import hashlib
import uuid
from datetime import datetime
from typing import List
from app.db import users_collection
from app.api.auth import get_current_user
from app.models.user import APIKeyCreate, APIKeyResponse

router = APIRouter(prefix="/api/developer", tags=["Developer Portal"])

@router.post("/keys", response_model=APIKeyResponse, status_code=status.HTTP_201_CREATED)
async def create_api_key(req: APIKeyCreate, user: dict = Depends(get_current_user)):
    """
    Generates a new secure sk_live_... API key for developer integrations.
    The full plaintext key is returned ONCE in the response and never stored in plain text.
    """
    if users_collection is None:
        raise HTTPException(status_code=500, detail="Database connection not available")

    # Generate secure random 32-character key
    random_hex = secrets.token_hex(16)
    raw_key = f"sk_live_{random_hex}"
    key_id = str(uuid.uuid4())
    prefix = f"sk_live_...{raw_key[-4:]}"
    hashed_key = hashlib.sha256(raw_key.encode()).hexdigest()

    created_at = datetime.utcnow()

    key_doc = {
        "key_id": key_id,
        "name": req.name.strip(),
        "hashed_key": hashed_key,
        "prefix": prefix,
        "created_at": created_at,
        "is_active": True
    }

    # Store key metadata in user document
    await users_collection.update_one(
        {"email": user["email"]},
        {"$push": {"api_keys": key_doc}}
    )

    return {
        "key_id": key_id,
        "name": req.name.strip(),
        "prefix": prefix,
        "created_at": created_at,
        "is_active": True,
        "api_key": raw_key
    }

@router.get("/keys")
async def list_api_keys(user: dict = Depends(get_current_user)):
    """
    Returns all active API keys for the current user with masked key prefixes.
    """
    api_keys = user.get("api_keys", [])
    safe_keys = []
    for k in api_keys:
        safe_keys.append({
            "key_id": k.get("key_id"),
            "name": k.get("name"),
            "prefix": k.get("prefix"),
            "created_at": k.get("created_at"),
            "is_active": k.get("is_active", True)
        })
    return {"api_keys": safe_keys}

@router.delete("/keys/{key_id}")
async def revoke_api_key(key_id: str, user: dict = Depends(get_current_user)):
    """
    Revokes and deletes a specific developer API key.
    """
    if users_collection is None:
        raise HTTPException(status_code=500, detail="Database connection not available")

    result = await users_collection.update_one(
        {"email": user["email"]},
        {"$pull": {"api_keys": {"key_id": key_id}}}
    )

    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="API key not found")

    return {"success": True, "message": f"API key '{key_id}' revoked successfully"}
