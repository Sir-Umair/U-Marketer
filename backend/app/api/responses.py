from __future__ import annotations
import re
from typing import Optional, List, Dict, Any, Union
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from app.db import email_logs_collection, users_collection, leads_collection
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
        return "legacy"
    if hasattr(ts, "date"):
        return str(ts.date())
    if isinstance(ts, str):
        return ts.split("T")[0]
    return str(ts)


def clean_subject(subject: str) -> str:
    """Removes 'Re:', 'Fwd:', brackets, dash variations, and extra whitespace to normalize subjects for grouping."""
    if not subject:
        return ""
    s = subject.strip().lower()
    # Normalize all unicode dash/hyphen variants to standard hyphen
    s = re.sub(r'[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]', '-', s)
    pattern = r'^(re|fwd|fw|aw|r)\s*(\[\d+\])?\s*:\s*'
    while re.match(pattern, s, flags=re.IGNORECASE):
        s = re.sub(pattern, '', s, count=1, flags=re.IGNORECASE).strip()
    s = re.sub(r'\s+', ' ', s)
    return s.strip()


def clean_campaign_title(title_or_subject: Optional[str] = None) -> str:
    """
    Returns a clean, human-readable user-facing campaign title:
    - Strips email prefixes (Re:, Fwd:, Aw:, etc.)
    - Removes unrendered template tags like {first_name}, {name}, {company}, {{...}}, [name], $name
    - Strips internal cluster IDs and legacy formats
    - Normalizes spacing and punctuation
    """
    if not title_or_subject:
        return "Untitled Campaign"
    s = str(title_or_subject).strip()

    # Clean cluster identifiers: e.g. "cluster-quick-question-2026-09-22"
    if s.startswith("cluster-") or s.startswith("legacy-"):
        s = s.replace("cluster-", "").replace("legacy-", "")
        s = re.sub(r'-\d{4}-\d{2}-\d{2}$', '', s)
        s = s.replace("-", " ").title()

    # Normalize unicode dash/hyphen variants
    s = re.sub(r'[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]', '–', s)

    # Strip prefixes like Re:, Fwd:, etc.
    pattern = r'^(re|fwd|fw|aw|r)\s*(\[\d+\])?\s*:\s*'
    while re.match(pattern, s, flags=re.IGNORECASE):
        s = re.sub(pattern, '', s, count=1, flags=re.IGNORECASE).strip()

    # Clean unrendered template tokens gracefully
    # Replace "for {first_name}" or "re: {company}" cleanly
    s = re.sub(r'\bfor\s*\{[^{}]*\}', '', s, flags=re.IGNORECASE)
    s = re.sub(r'\bre:\s*\{[^{}]*\}', 'Inquiry', s, flags=re.IGNORECASE)
    s = re.sub(r'\{[^{}]*\}|\{\{[^{}]*\}\}|\[[^\[\]]*\]|\$[a-zA-Z_]+', '', s)

    # Clean dangling prepositions, hyphens, and whitespace
    s = re.sub(r'\s+[-–—]\s*$', '', s)
    s = re.sub(r'^\s*[-–—]\s+', '', s)
    s = re.sub(r'\s+', ' ', s).strip()
    s = s.strip(" :-–—,;.")

    if not s or len(s) < 2:
        return "Outreach Campaign"

    if s.islower():
        s = s.title()

    return s


def get_canonical_title(subject: str) -> str:
    """Returns a clean user-facing campaign title stripped of prefixes and template tokens."""
    return clean_campaign_title(subject)


class RenameCampaignRequest(BaseModel):
    name: str


@router.get("/campaigns")
async def get_campaign_dashboard(user: dict = Depends(get_current_user)):
    """
    Returns a scalable, consolidated dashboard of campaigns wrapping all targeted leads and inbound replies.
    Employs O(1) hash map response resolution, MongoDB index optimizations, and ensures NO received reply is lost.
    """
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

    # 2. Fetch all registered lead emails in workspace for genuine response cross-referencing
    lead_emails = set()
    if leads_collection is not None:
        try:
            lead_docs = await leads_collection.find({}, {"email": 1}).to_list(1000)
            for ld in lead_docs:
                if ld.get("email"):
                    lead_emails.add(ld["email"].lower().strip())
        except Exception as e:
            print(f"[Responses] Error fetching leads: {e}")

    known_emails = lead_emails | set(all_user_emails)

    # 3. Fetch all 'sent' logs for this workspace
    sent_cursor = email_logs_collection.find({
        "type": "sent",
        "$or": [
            {"user_email": {"$in": all_user_emails}},
            {"user_email": {"$regex": "|".join(email_regex_patterns), "$options": "i"}},
            {"user_email": None},
            {"user_email": {"$exists": False}}
        ]
    }).sort("timestamp", -1)
    sent_logs = await sent_cursor.to_list(length=3000)

    # 4. Fetch inbound responses / replies
    resp_cursor = email_logs_collection.find({
        "type": {"$ne": "sent"}
    }).sort("timestamp", -1)
    all_responses = await resp_cursor.to_list(length=3000)

    # 5. Pre-build O(1) response lookup hash tables for high-performance matching
    thread_map = {}
    cid_email_map = {}
    subj_email_map = {}
    subj_map = {}
    email_map = {}

    for r in all_responses:
        tid = r.get("thread_id")
        if tid and tid not in thread_map:
            thread_map[tid] = r

        cid = r.get("campaign_id")
        resp_email = (r.get("email") or "").strip().lower()
        if cid and resp_email and (cid, resp_email) not in cid_email_map:
            cid_email_map[(cid, resp_email)] = r

        r_subj = clean_subject(r.get("subject", ""))
        if r_subj and resp_email and (r_subj, resp_email) not in subj_email_map:
            subj_email_map[(r_subj, resp_email)] = r

        if r_subj and r_subj not in subj_map:
            subj_map[r_subj] = r

        if resp_email and resp_email not in email_map:
            email_map[resp_email] = r

    # 6. Pass 1: Group and wrap leads under campaigns from sent logs
    campaigns = {}
    processed_leads = set() # (campaign_id, email)
    matched_response_ids = set()

    for log in sent_logs:
        subject = log.get("subject", "")
        clean_subj = clean_subject(subject)
        raw_name = log.get("campaign_name")
        canonical_title = clean_campaign_title(raw_name) if raw_name else get_canonical_title(subject)
        recipient = (log.get("recipient") or log.get("email") or "").strip()
        recipient_norm = recipient.lower()

        # Determine unified campaign identifier
        explicit_cid = log.get("campaign_id")
        if explicit_cid:
            c_id = explicit_cid
        else:
            date_str = _get_log_date_str(log)
            c_id = f"cluster-{clean_subj}-{date_str}"

        ts_val = log.get("timestamp")
        ts_iso = ts_val.isoformat() if hasattr(ts_val, "isoformat") else str(ts_val) if ts_val else ""

        if c_id not in campaigns:
            campaigns[c_id] = {
                "id": c_id,
                "name": canonical_title,
                "subject": canonical_title,
                "clean_subj": clean_subj,
                "timestamp": ts_iso,
                "senders_set": set(),
                "leads": []
            }

        sender = log.get("user_email")
        if sender:
            campaigns[c_id]["senders_set"].add(sender)

        # Deduplicate leads within a campaign
        lead_key = (c_id, recipient_norm)
        if lead_key in processed_leads:
            # Append additional sender to existing lead's senders list if multi-account
            if sender:
                for existing_l in campaigns[c_id]["leads"]:
                    if existing_l.get("email", "").lower() == recipient_norm:
                        if "senders" not in existing_l:
                            existing_l["senders"] = [existing_l.get("sender_email")] if existing_l.get("sender_email") else []
                        if sender not in existing_l["senders"]:
                            existing_l["senders"].append(sender)
            continue
        processed_leads.add(lead_key)

        # O(1) Instantaneous Response Resolution
        matched_response = None
        sent_tid = log.get("thread_id")
        sent_cid = log.get("campaign_id")

        if sent_tid and sent_tid in thread_map:
            matched_response = thread_map[sent_tid]
        elif sent_cid and (sent_cid, recipient_norm) in cid_email_map:
            matched_response = cid_email_map[(sent_cid, recipient_norm)]
        elif clean_subj and (clean_subj, recipient_norm) in subj_email_map:
            matched_response = subj_email_map[(clean_subj, recipient_norm)]
        elif log.get("reply_received") and recipient_norm in email_map:
            matched_response = email_map[recipient_norm]

        if matched_response and "_id" in matched_response:
            matched_response_ids.add(str(matched_response["_id"]))

        is_replied = bool(matched_response is not None or log.get("reply_received"))

        lead_ts = log.get("timestamp")
        lead_ts_str = lead_ts.isoformat() if hasattr(lead_ts, "isoformat") else str(lead_ts) if lead_ts else ""

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
            "sender_email": sender or "",
            "senders": [sender] if sender else [],
            "follow_up_delay": log.get("follow_up_delay"),
            "follow_up_sent": log.get("follow_up_sent", False)
        })

    # 7. Pass 2: Ingest genuine received replies that weren't matched in Pass 1
    # Ensures NO inbound client reply or AI auto-reply is ever hidden or lost
    for r in all_responses:
        r_id = str(r.get("_id"))
        if r_id in matched_response_ids:
            continue

        subj = str(r.get("subject") or "")
        sender_email = (r.get("email") or "").strip()
        sender_email_norm = sender_email.lower()

        # Check if this document represents an outreach campaign reply
        is_reply = bool(
            r.get("campaign_id") or
            (
                (subj.lower().startswith("re:") or subj.lower().startswith("fwd:"))
                and (sender_email_norm in known_emails or r.get("reply_sent") or r.get("ai_reply"))
            )
        )
        if not is_reply:
            continue

        clean_s = clean_subject(subj)
        raw_r_name = r.get("campaign_name")
        title = clean_campaign_title(raw_r_name) if raw_r_name else get_canonical_title(subj)
        explicit_cid = r.get("campaign_id")

        # Find target campaign in existing campaigns dict
        target_cid = None
        if explicit_cid and explicit_cid in campaigns:
            target_cid = explicit_cid
        else:
            for cid_k, camp in campaigns.items():
                if explicit_cid and camp.get("id") == explicit_cid:
                    target_cid = cid_k
                    break
                if clean_s and camp.get("clean_subj") == clean_s:
                    target_cid = cid_k
                    break

        ts_val = r.get("timestamp")
        ts_iso = ts_val.isoformat() if hasattr(ts_val, "isoformat") else str(ts_val) if ts_val else ""

        if not target_cid:
            # Synthesize campaign wrapper so the received reply and thread are fully visible
            target_cid = explicit_cid or f"cluster-{clean_s}"
            campaigns[target_cid] = {
                "id": target_cid,
                "name": title,
                "subject": title,
                "clean_subj": clean_s,
                "timestamp": ts_iso,
                "senders_set": set(),
                "leads": []
            }

        rec_account = r.get("user_email")
        if rec_account:
            campaigns[target_cid]["senders_set"].add(rec_account)

        serialized_r = _serialize(r)

        # Check if lead already exists under this campaign
        existing_lead = None
        for l in campaigns[target_cid]["leads"]:
            if l.get("email", "").lower() == sender_email_norm:
                existing_lead = l
                break

        if existing_lead:
            existing_lead["replied"] = True
            if not existing_lead.get("response"):
                existing_lead["response"] = serialized_r
        else:
            campaigns[target_cid]["leads"].append({
                "email": sender_email or "Client Responder",
                "replied": True,
                "response": serialized_r,
                "sent_at": ts_iso,
                "subject": subj,
                "body": r.get("message", ""),
                "thread_id": r.get("thread_id", ""),
                "sender_email": rec_account or ""
            })

    # 8. Finalize campaign aggregates, sender rotation metadata, and metrics
    campaign_list = []
    for camp in campaigns.values():
        camp.pop("clean_subj", None)
        leads = camp.get("leads", [])
        total = len(leads)
        replies = sum(1 for l in leads if l.get("replied"))
        senders_list = sorted(list(camp.pop("senders_set", set())))

        camp["senders"] = senders_list
        camp["sender_accounts_count"] = len(senders_list)
        camp["total_leads"] = total
        camp["emails_sent"] = total
        camp["replies_count"] = replies
        camp["reply_rate"] = round((replies / total) * 100, 1) if total > 0 else 0
        campaign_list.append(camp)

    # Sort campaigns so newest are at top
    campaign_list.sort(key=lambda c: c.get("timestamp", ""), reverse=True)
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
    if not docs:
        # Fallback to message_id
        cursor2 = email_logs_collection.find(
            {"message_id": thread_id}
        ).sort("timestamp", 1)
        docs = await cursor2.to_list(length=100)
    return [_serialize(doc) for doc in docs]


@router.delete("/campaign/{campaign_id}")
async def delete_campaign(campaign_id: str, user: dict = Depends(get_current_user)):
    """Deletes all logs associated with a specific campaign ID or clustered ID."""
    if email_logs_collection is None:
        return {"error": "DB not available"}

    if campaign_id.startswith("cluster-") or campaign_id.startswith("legacy-"):
        # Clustered deletion: delete both sent and response logs matching this cluster
        clean_target = campaign_id.replace("cluster-", "").replace("legacy-", "")
        # Remove date suffix if present
        date_match = re.search(r'-\d{4}-\d{2}-\d{2}$', clean_target)
        if date_match:
            clean_target = clean_target[:date_match.start()]

        all_logs = await email_logs_collection.find({}).to_list(length=3000)
        ids_to_delete = []
        for log in all_logs:
            subj = log.get("subject", "")
            cs = clean_subject(subj)
            if cs == clean_target or clean_target in cs:
                ids_to_delete.append(log["_id"])

        if not ids_to_delete:
            return {"deleted_count": 0}

        result = await email_logs_collection.delete_many({
            "_id": {"$in": ids_to_delete}
        })
    else:
        # Standard explicit campaign_id deletion
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
        "_id": ObjectId(response_id)
    })
    return {"deleted": True}


@router.patch("/campaign/{campaign_id}/rename")
@router.put("/campaign/{campaign_id}/rename")
async def rename_campaign(campaign_id: str, req: RenameCampaignRequest, user: dict = Depends(get_current_user)):
    """Renames an existing campaign across all associated email activity logs."""
    if email_logs_collection is None:
        raise HTTPException(status_code=500, detail="Database connection unavailable")

    new_name = req.name.strip()
    if not new_name:
        raise HTTPException(status_code=400, detail="Campaign name cannot be empty")

    new_name = clean_campaign_title(new_name)
    updated_count = 0

    # 1. Update standard explicit campaign_id records
    res = await email_logs_collection.update_many(
        {"campaign_id": campaign_id},
        {"$set": {"campaign_name": new_name}}
    )
    updated_count += res.modified_count

    # 2. If it's a cluster or legacy ID, update all matching logs
    if campaign_id.startswith("cluster-") or campaign_id.startswith("legacy-"):
        clean_target = campaign_id.replace("cluster-", "").replace("legacy-", "")
        date_match = re.search(r'-\d{4}-\d{2}-\d{2}$', clean_target)
        if date_match:
            clean_target = clean_target[:date_match.start()]

        all_logs = await email_logs_collection.find({}).to_list(length=3000)
        ids_to_update = []
        for log in all_logs:
            subj = log.get("subject", "")
            cs = clean_subject(subj)
            if cs == clean_target or clean_target in cs:
                ids_to_update.append(log["_id"])

        if ids_to_update:
            cluster_res = await email_logs_collection.update_many(
                {"_id": {"$in": ids_to_update}},
                {"$set": {"campaign_name": new_name}}
            )
            updated_count += cluster_res.modified_count

    return {
        "success": True,
        "campaign_id": campaign_id,
        "name": new_name,
        "updated_count": updated_count,
        "message": f"Campaign successfully renamed to '{new_name}'"
    }

