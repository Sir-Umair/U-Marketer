import re
from fastapi import APIRouter, Depends
from app.db import email_logs_collection, users_collection
from bson import ObjectId
from app.api.auth import get_current_user

router = APIRouter(prefix="/responses", tags=["Responses"])


def _serialize(doc: dict) -> dict:
    if not doc:
        return doc
    doc_copy = dict(doc)
    if "_id" in doc_copy:
        doc_copy["id"] = str(doc_copy.pop("_id"))
    elif "id" in doc_copy:
        doc_copy["id"] = str(doc_copy["id"])
    if "timestamp" in doc_copy and doc_copy["timestamp"]:
        if hasattr(doc_copy["timestamp"], "isoformat"):
            doc_copy["timestamp"] = doc_copy["timestamp"].isoformat()
        else:
            doc_copy["timestamp"] = str(doc_copy["timestamp"])
    return doc_copy


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
    """Removes 'Re:', 'Fwd:', brackets, and extra whitespace to normalize subjects for grouping."""
    if not subject:
        return ""
    s = subject.strip().lower()
    pattern = r'^(re|fwd|fw|aw|r)\s*(\[\d+\])?\s*:\s*'
    while re.match(pattern, s, flags=re.IGNORECASE):
        s = re.sub(pattern, '', s, count=1, flags=re.IGNORECASE).strip()
    s = re.sub(r'\s+', ' ', s)
    return s.strip()


@router.get("/campaigns")
async def get_campaign_dashboard(user: dict = Depends(get_current_user)):
    """Returns a grouped dashboard of campaigns and lead responses across connected workspace accounts."""
    if email_logs_collection is None:
        return []

    # 1. Fetch all connected user emails in the workspace
    all_user_emails = [user["email"]]
    if users_collection is not None:
        try:
            connected_docs = await users_collection.find(
                {"access_token": {"$exists": True}},
                {"email": 1}
            ).to_list(100)
            for d in connected_docs:
                if d.get("email"):
                    all_user_emails.append(d["email"])
        except Exception as e:
            print(f"[Responses] Error fetching connected accounts: {e}")
    
    all_user_emails = list(set(e.lower().strip() for e in all_user_emails if e))
    email_regex_patterns = [f"^{re.escape(e)}$" for e in all_user_emails]

    # 2. Fetch all 'sent' logs for this workspace to identify campaigns
    sent_cursor = email_logs_collection.find({
        "type": "sent",
        "$or": [
            {"user_email": {"$in": all_user_emails}},
            {"user_email": {"$regex": "|".join(email_regex_patterns), "$options": "i"}}
        ]
    }).sort("timestamp", -1)
    sent_logs = await sent_cursor.to_list(length=2000)

    # 3. Fetch all inbound responses / replies
    resp_cursor = email_logs_collection.find({
        "type": {"$ne": "sent"}
    }).sort("timestamp", -1)
    all_responses = await resp_cursor.to_list(length=2000)

    # 4. Group by campaign_id
    campaigns = {}
    processed_leads = set() # (campaign_id, email)
    
    for log in sent_logs:
        subject = log.get("subject", "")
        # Use campaign_id or a normalized subject+date for legacy logs
        c_id = log.get("campaign_id") or f"legacy-{clean_subject(subject)}-{_get_log_date_str(log)}"
        recipient = (log.get("recipient") or "").strip()
        recipient_norm = recipient.lower()
        
        # Deduplicate leads within a campaign (e.g. if follow-ups were sent)
        lead_key = (c_id, recipient_norm)
        if lead_key in processed_leads:
            continue
        processed_leads.add(lead_key)

        if c_id not in campaigns:
            ts_val = log.get("timestamp")
            ts_iso = ts_val.isoformat() if hasattr(ts_val, "isoformat") else str(ts_val) if ts_val else ""
            campaigns[c_id] = {
                "id": c_id,
                "subject": subject if not log.get("campaign_id") else subject,
                "timestamp": ts_iso,
                "leads": []
            }
        
        # Match inbound response to this lead
        sent_clean_subj = clean_subject(subject)
        sent_cid = log.get("campaign_id")
        sent_tid = log.get("thread_id")
        matched_response = None

        # Priority 1: Exact Thread ID match
        if sent_tid:
            matched_response = next((r for r in all_responses if r.get("thread_id") == sent_tid), None)

        # Priority 2: Exact campaign ID match + Email match
        if not matched_response and sent_cid:
            matched_response = next((r for r in all_responses if r.get("campaign_id") == sent_cid and (
                (r.get("email") or "").strip().lower() == recipient_norm or
                ((r.get("email") or "").strip().lower() in all_user_emails and recipient_norm in all_user_emails)
            )), None)

        # Priority 3: Clean subject match + Email match
        if not matched_response and sent_clean_subj:
            matched_response = next((r for r in all_responses if clean_subject(r.get("subject", "")) == sent_clean_subj and (
                (r.get("email") or "").strip().lower() == recipient_norm or
                ((r.get("email") or "").strip().lower() in all_user_emails and recipient_norm in all_user_emails)
            )), None)

        # Priority 4: If log has reply_received == True, find any reply from this recipient
        if not matched_response and log.get("reply_received"):
            matched_response = next((r for r in all_responses if (r.get("email") or "").strip().lower() == recipient_norm), None)

        is_replied = bool(matched_response is not None or log.get("reply_received"))

        lead_ts = log.get("timestamp")
        lead_ts_str = lead_ts.isoformat() if hasattr(lead_ts, "isoformat") else str(lead_ts) if lead_ts else ""

        # Construct serialized response representation
        serialized_response = _serialize(matched_response) if matched_response else None
        if is_replied and not serialized_response:
            serialized_response = {
                "id": str(log.get("_id", "")),
                "email": recipient,
                "subject": log.get("subject", ""),
                "intent": "REPLY",
                "message": "Inbound reply received and confirmed via Gmail sync",
                "reply_sent": log.get("follow_up_sent", False),
                "timestamp": lead_ts_str
            }

        campaigns[c_id]["leads"].append({
            "email": recipient,
            "replied": is_replied,
            "response": serialized_response,
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
        {"thread_id": thread_id}
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
        # Standard campaign_id deletion across workspace accounts
        result = await email_logs_collection.delete_many({
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
