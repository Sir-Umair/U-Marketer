from fastapi import APIRouter, Depends
from app.db import email_logs_collection
from bson import ObjectId
from app.api.auth import get_current_user

router = APIRouter(prefix="/responses", tags=["Responses"])


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


def _get_log_date_str(log: dict) -> str:
    ts = log.get("timestamp")
    if not ts:
        return "unknown"
    if hasattr(ts, "date"):
        return str(ts.date())
    if isinstance(ts, str):
        return ts.split("T")[0]
    return str(ts)


def clean_subject(subject: str) -> str:
    """Removes 'Re:', 'Fwd:', and extra whitespace to normalize subjects for grouping."""
    if not subject:
        return ""
    # Normalize to lowercase and strip whitespace
    s = subject.strip().lower()
    while s.startswith("re:") or s.startswith("fwd:"):
        if s.startswith("re:"):
            s = s[3:].strip()
        elif s.startswith("fwd:"):
            s = s[4:].strip()
    return s.strip()


@router.get("/campaigns")
async def get_campaign_dashboard(user: dict = Depends(get_current_user)):
    """Returns a grouped dashboard of campaigns and lead responses."""
    if email_logs_collection is None:
        return []

    # 1. Fetch all 'sent' logs for this user to identify campaigns
    sent_cursor = email_logs_collection.find(
        {"user_email": user["email"], "type": "sent"}
    ).sort("timestamp", -1)
    sent_logs = await sent_cursor.to_list(length=1000)

    # 2. Fetch all responses for this user
    resp_cursor = email_logs_collection.find(
        {"user_email": user["email"], "intent": {"$exists": True}}
    ).sort("timestamp", -1)
    all_responses = await resp_cursor.to_list(length=1000)

    # 3. Group by campaign_id
    campaigns = {}
    processed_leads = set() # (campaign_id, email)
    
    for log in sent_logs:
        subject = log.get("subject", "")
        # Use campaign_id or a normalized subject+date for legacy logs
        c_id = log.get("campaign_id") or f"legacy-{clean_subject(subject)}-{_get_log_date_str(log)}"
        recipient = log.get("recipient")
        
        # Deduplicate leads within a campaign (e.g. if follow-ups were sent)
        lead_key = (c_id, recipient)
        if lead_key in processed_leads:
            continue
        processed_leads.add(lead_key)

        if c_id not in campaigns:
            ts_val = log.get("timestamp")
            ts_iso = ts_val.isoformat() if hasattr(ts_val, "isoformat") else str(ts_val) if ts_val else ""
            campaigns[c_id] = {
                "id": c_id,
                "subject": subject if not log.get("campaign_id") else subject, # Keep original subject
                "timestamp": ts_iso,
                "leads": []
            }
        
        # Check if this lead replied
        # A reply matches by email AND (campaign_id OR subject/thread)
        response = next((r for r in all_responses if r.get("email") == recipient and 
                         (r.get("campaign_id") == log.get("campaign_id") or r.get("thread_id") == log.get("thread_id"))), None)
        
        lead_ts = log.get("timestamp")
        lead_ts_str = lead_ts.isoformat() if hasattr(lead_ts, "isoformat") else str(lead_ts) if lead_ts else ""

        campaigns[c_id]["leads"].append({
            "email": recipient,
            "replied": response is not None,
            "response": _serialize(response) if response else None,
            "sent_at": lead_ts_str,
            "subject": log.get("subject", ""),
            "body": log.get("body", ""),
            "thread_id": log.get("thread_id", ""),
            "follow_up_delay": log.get("follow_up_delay"),
            "follow_up_sent": log.get("follow_up_sent", False)
        })

    # Compute high-level campaign summary stats
    campaign_list = list(campaigns.values())
    for camp in campaign_list:
        leads = camp.get("leads", [])
        total = len(leads)
        replies = sum(1 for l in leads if l.get("replied"))
        camp["total_leads"] = total
        camp["emails_sent"] = total
        camp["replies_count"] = replies
        camp["reply_rate"] = round((replies / total) * 100, 1) if total > 0 else 0

    return campaign_list


@router.get("/thread/{thread_id}")
async def get_thread(thread_id: str, user: dict = Depends(get_current_user)):
    """Returns all emails in a specific thread."""
    if email_logs_collection is None:
        return []
    cursor = email_logs_collection.find(
        {"user_email": user["email"], "thread_id": thread_id}
    ).sort("timestamp", 1)  # oldest to newest
    docs = await cursor.to_list(length=100)
    return [_serialize(doc) for doc in docs]


@router.delete("/campaign/{campaign_id}")
async def delete_campaign(campaign_id: str, user: dict = Depends(get_current_user)):
    """Deletes all logs associated with a specific campaign ID or legacy ID."""
    if email_logs_collection is None:
        return {"error": "DB not available"}
    
    if campaign_id.startswith("legacy-"):
        all_sent = await email_logs_collection.find({"user_email": user["email"], "type": "sent"}).to_list(length=None)
        ids_to_delete = []
        for log in all_sent:
            subj = log.get("subject", "")
            generated_id = f"legacy-{clean_subject(subj)}-{_get_log_date_str(log)}"
            if generated_id == campaign_id:
                ids_to_delete.append(log["_id"])

        
        if not ids_to_delete:
            return {"deleted_count": 0}
            
        # Also find all responses linked to these sent logs (via thread_id or recipient)
        # For simplicity, we delete the sent logs and any response with the same campaign_id if it exists
        result = await email_logs_collection.delete_many({
            "user_email": user["email"],
            "$or": [
                {"_id": {"$in": ids_to_delete}},
                {"campaign_id": campaign_id}
            ]
        })
    else:
        # Standard campaign_id deletion
        result = await email_logs_collection.delete_many({
            "user_email": user["email"],
            "campaign_id": campaign_id
        })
        
    return {"deleted_count": result.deleted_count}


@router.delete("/{response_id}")
async def delete_response(response_id: str, user: dict = Depends(get_current_user)):
    """Deletes a single response log entry."""
    if email_logs_collection is None:
        return {"error": "DB not available"}
    await email_logs_collection.delete_one({
        "_id": ObjectId(response_id),
        "user_email": user["email"]
    })
    return {"deleted": True}
