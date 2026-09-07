from fastapi import APIRouter
from app.db import email_logs_collection
from app.api.auth import get_current_user
from fastapi import APIRouter, Depends

router = APIRouter(prefix="/logs", tags=["Logs"])


def _serialize(doc: dict) -> dict:
    if not doc:
        return doc
    doc["id"] = str(doc.pop("_id"))
    if "timestamp" in doc and doc["timestamp"]:
        if hasattr(doc["timestamp"], "isoformat"):
            doc["timestamp"] = doc["timestamp"].isoformat()
        else:
            doc["timestamp"] = str(doc["timestamp"])
    return doc


@router.get("/recent")
async def get_recent_logs(limit: int = 50, user: dict = Depends(get_current_user)):
    """Returns the most recent activity logs for the authenticated user."""
    if email_logs_collection is None:
        return []
    cursor = email_logs_collection.find({"user_email": user["email"]}).sort("timestamp", -1).limit(limit)
    docs = await cursor.to_list(length=limit)
    return [_serialize(doc) for doc in docs]


@router.get("/stats")
async def get_stats(user: dict = Depends(get_current_user)):
    """Returns aggregated stats for the dashboard."""
    if email_logs_collection is None:
        return {"sent": 0, "replies": 0}
    
    sent_count = await email_logs_collection.count_documents({
        "user_email": user["email"],
        "type": "sent"
    })
    
    reply_count = await email_logs_collection.count_documents({
        "user_email": user["email"],
        "intent": {"$exists": True}
    })
    
    return {
        "sent": sent_count,
        "replies": reply_count
    }


@router.delete("/{log_id}")
async def delete_log(log_id: str, user: dict = Depends(get_current_user)):
    """Deletes a specific log entry."""
    from bson import ObjectId
    if email_logs_collection is None:
        return {"error": "DB not available"}
    await email_logs_collection.delete_one({
        "_id": ObjectId(log_id),
        "user_email": user["email"]
    })
    return {"deleted": True}
