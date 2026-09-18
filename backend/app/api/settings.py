from fastapi import APIRouter, Depends
from app.config import settings
from app.db import settings_collection
from app.api.auth import get_current_user

router = APIRouter(prefix="/settings", tags=["Settings"])

@router.get("/")
async def get_settings(user: dict = Depends(get_current_user)):
    # Try to get from database first for this specific user (case-insensitive)
    email = user["email"].lower()
    db_settings = await settings_collection.find_one({"user_email": {"$regex": f"^{email}$", "$options": "i"}})
    
    if db_settings:
        return {
            "email_user": db_settings.get("email_user", user["email"]),
            "full_name": db_settings.get("full_name", user.get("name", "")),
            "auto_reply_enabled": db_settings.get("auto_reply_enabled", True),
            "duplicate_prevention_enabled": db_settings.get("duplicate_prevention_enabled", True),
            "email_pass_set": True,
        }
        
    return {
        "email_user": user["email"],
        "full_name": user.get("name", ""),
        "auto_reply_enabled": True,
        "duplicate_prevention_enabled": True,
        "email_pass_set": True,
    }

@router.post("/")
async def update_settings(data: dict, user: dict = Depends(get_current_user)):
    # Update or insert settings for this user
    email = user["email"].lower()
    
    update_data = {}
    if "full_name" in data:
        update_data["full_name"] = data["full_name"]
    elif "fullName" in data:  # Handle camelCase from frontend
        update_data["full_name"] = data["fullName"]
        
    if "auto_reply_enabled" in data:
        update_data["auto_reply_enabled"] = data["auto_reply_enabled"]
        
    if "duplicate_prevention_enabled" in data:
        update_data["duplicate_prevention_enabled"] = data["duplicate_prevention_enabled"]
    
    # Always ensure user_email is set on upsert
    await settings_collection.update_one(
        {"user_email": {"$regex": f"^{email}$", "$options": "i"}},
        {"$set": update_data, "$setOnInsert": {"user_email": email}},
        upsert=True
    )
    
    return {"message": "Settings updated successfully"}

