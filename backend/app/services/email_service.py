from email.message import EmailMessage
import mimetypes
import re
from datetime import datetime, timedelta
import asyncio
import base64
from app.config import settings
from app.db import email_logs_collection, users_collection, leads_collection
from app.services.security_service import decrypt_data, encrypt_data
from app.services.sheets_service import sheets_service
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from google.auth.transport.requests import Request
import google.auth.exceptions

async def mark_user_auth_expired(user_email: str, reason: str = "Authentication expired. Please reconnect your Gmail account."):
    if users_collection is not None:
        await users_collection.update_one(
            {"email": {"$regex": f"^{re.escape(user_email.strip())}$", "$options": "i"}},
            {
                "$set": {
                    "auth_status": "expired",
                    "auth_error": reason
                }
            }
        )

def parse_google_retry_after(error_str: str) -> datetime:
    """Extracts 'Retry after <ISO_TIMESTAMP>' from Google 429 error, adding a 60-second safety margin."""
    match = re.search(r'Retry after\s+([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?Z?)', str(error_str))
    if match:
        iso_str = match.group(1).rstrip("Z")
        try:
            retry_dt = datetime.fromisoformat(iso_str)
            return retry_dt + timedelta(seconds=60)
        except Exception:
            pass
    # Fallback to 16 minutes from now if timestamp cannot be parsed
    return datetime.utcnow() + timedelta(minutes=16)

async def set_account_rate_limit(user_email: str, until: datetime):
    """Persists rate-limit cooldown timestamp and status in MongoDB users_collection."""
    if users_collection is not None:
        await users_collection.update_one(
            {"email": {"$regex": f"^{re.escape(user_email.strip())}$", "$options": "i"}},
            {
                "$set": {
                    "auth_status": "rate_limited",
                    "rate_limit_until": until,
                    "auth_error": f"Google rate limit cooldown until {until.strftime('%H:%M:%S UTC')}"
                }
            }
        )
        print(f"[EmailService] Account {user_email} set to rate_limited until {until.strftime('%H:%M:%S UTC')}")

async def is_account_healthy(user_email: str) -> tuple[bool, str, int]:
    """
    Checks if account is healthy for sending.
    Returns: (is_healthy, status_str, cooldown_minutes_remaining)
    """
    if users_collection is None:
        return True, "active", 0
    u_doc = await users_collection.find_one(
        {"email": {"$regex": f"^{re.escape(user_email.strip())}$", "$options": "i"}}
    )
    if not u_doc:
        return False, "not_found", 0
    if u_doc.get("auth_status") == "expired":
        return False, "expired", 0
    rate_until = u_doc.get("rate_limit_until")
    if rate_until:
        if isinstance(rate_until, str):
            try:
                rate_until = datetime.fromisoformat(rate_until.rstrip("Z"))
            except Exception:
                rate_until = None
        if rate_until and datetime.utcnow() < rate_until:
            mins_left = max(1, int((rate_until - datetime.utcnow()).total_seconds() / 60))
            return False, "rate_limited", mins_left
        else:
            # Cooldown expired! Auto-restore status to active
            await users_collection.update_one(
                {"_id": u_doc["_id"]},
                {"$set": {"auth_status": "active"}, "$unset": {"rate_limit_until": "", "auth_error": ""}}
            )
    return True, "active", 0

async def get_user_credentials(user_email: str) -> Credentials:
    """Retrieve and refresh Google OAuth credentials for a user."""
    if users_collection is None:
        raise Exception("Database connection not established. Cannot fetch credentials.")
    user = await users_collection.find_one({"email": {"$regex": f"^{re.escape(user_email.strip())}$", "$options": "i"}})
    if not user:
        raise Exception(f"User {user_email} not found or not connected to Gmail.")
    
    # Check for missing metadata (requires re-login)
    required_keys = ["access_token", "token_uri", "client_id", "client_secret"]
    if not all(k in user for k in required_keys):
        raise Exception("Account setup incomplete. Please log out and log in again to refresh your connection.")

    creds = Credentials(
        token=decrypt_data(user["access_token"]),
        refresh_token=decrypt_data(user["refresh_token"]) if user.get("refresh_token") else None,
        token_uri=user["token_uri"],
        client_id=user["client_id"],
        client_secret=user["client_secret"],
        scopes=user.get("scopes", ["https://www.googleapis.com/auth/gmail.send"])
    )
    
    if creds.expired and creds.refresh_token:
        try:
            import asyncio
            await asyncio.to_thread(creds.refresh, Request())
            # Update tokens in DB
            await users_collection.update_one(
                {"_id": user["_id"]},
                {
                    "$set": {
                        "access_token": encrypt_data(creds.token),
                        "last_token_refresh": datetime.utcnow()
                    }
                }
            )
        except google.auth.exceptions.RefreshError as e:
            print(f"Token refresh failed for {user_email}: {e}")
            await mark_user_auth_expired(user_email, f"Authentication expired ({e}). Please reconnect your Gmail account.")
            raise Exception("Authentication expired. Please reconnect your Gmail account.")
            
    return creds

async def send_email(to_email: str, subject: str, body: str, user_email: str, skip_log: bool = False, attachment_data: bytes = None, attachment_name: str = None, follow_up_delay: int = 0, follow_up_body: str = None, auto_reply_prompt: str = None, campaign_id: str = None, campaign_name: str = None) -> dict:
    """
    Sends a single email via Gmail API using OAuth 2.0 with optional PDF attachment and optional follow-up scheduling.
    """
    try:
        creds = await get_user_credentials(user_email)
        service = build('gmail', 'v1', credentials=creds)
        
        message = EmailMessage()
        message.set_content(body)
        message["To"] = to_email
        message["From"] = user_email
        message["Subject"] = subject
        
        if attachment_data and attachment_name:
            guessed = mimetypes.guess_type(attachment_name)[0]
            if guessed:
                maintype, subtype = guessed.split('/', 1)
            else:
                maintype, subtype = "application", "pdf" # Default guess
            message.add_attachment(
                attachment_data,
                maintype=maintype,
                subtype=subtype,
                filename=attachment_name
            )
        
        # encoded message
        encoded_message = base64.urlsafe_b64encode(message.as_bytes()).decode()
        
        create_message = {'raw': encoded_message}
        
        send_result = await asyncio.to_thread(
            service.users().messages().send(userId="me", body=create_message).execute
        )
        
        # Log to MongoDB (unless skipped)
        if not skip_log and email_logs_collection is not None:
            log_entry = {
                "user_email": user_email,
                "recipient": to_email,
                "subject": subject,
                "body": body,
                "type": "sent",
                "campaign_id": campaign_id,
                "campaign_name": campaign_name,
                "gmail_id": send_result.get("id"),
                "thread_id": send_result.get("threadId"),
                "reply_received": False,
                "follow_up_sent": False,
                "timestamp": datetime.utcnow(),
            }
            
            # Store follow-up instructions if provided
            if follow_up_delay > 0:
                log_entry["follow_up_delay"] = follow_up_delay
                log_entry["follow_up_body"] = follow_up_body # Optional: if None, service generates one
                log_entry["follow_up_at"] = datetime.utcnow() + timedelta(minutes=follow_up_delay)
            
            if auto_reply_prompt:
                log_entry["auto_reply_prompt"] = auto_reply_prompt

            await email_logs_collection.insert_one(log_entry)

        # Log to Google Sheets
        await sheets_service.log_campaign_to_sheet(
            recipient=to_email,
            subject=subject,
            timestamp=datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
        )

        print(f"[EmailService] Email sent from {user_email} to {to_email}")
        return {"success": True, "message_id": send_result.get("id")}

    except Exception as e:
        err_str = str(e)
        if "invalid_grant" in err_str or "Authentication expired" in err_str or "RefreshError" in type(e).__name__:
            await mark_user_auth_expired(user_email, "Authentication expired. Please reconnect your Gmail account.")
        elif "429" in err_str or "rateLimitExceeded" in err_str or "User-rate limit exceeded" in err_str:
            cooldown_until = parse_google_retry_after(err_str)
            await set_account_rate_limit(user_email, cooldown_until)
        print(f"[EmailService] Error sending email from {user_email}: {e}")
        return {"success": False, "error": str(e)}

def format_personalized_text(text: str, lead: dict = None, to_email: str = "") -> str:
    if not text:
        return ""

    lead_name = ""
    if lead:
        lead_name = (
            lead.get("name") or 
            lead.get("Name") or 
            lead.get("full_name") or 
            lead.get("FullName") or 
            lead.get("first_name") or 
            lead.get("FirstName") or 
            ""
        ).strip()

    if not lead_name or lead_name.lower() in ["n/a", "none", "null"]:
        lead_name = to_email.split("@")[0].replace(".", " ").replace("_", " ").title() if to_email else "Friend"

    first_name = lead_name.split()[0] if lead_name else "Friend"
    company = ""
    if lead:
        company = (lead.get("company") or lead.get("Company") or "").strip()
    if not company or company.lower() in ["n/a", "none", "null"]:
        company = "your company"

    notes = ""
    if lead:
        notes = (lead.get("notes") or lead.get("Notes") or "").strip()

    # Support all variations of variable tags: {name}, \name, [name], {{name}}, $name
    patterns = [
        (r"(?:\{name\}|\\name|\[name\]|\{\{name\}\}|\$name|\<name\>)", lead_name),
        (r"(?:\{first_name\}|\\first_name|\[first_name\]|\{\{first_name\}\}|\$first_name|\{firstname\}|\\firstname|\[firstname\]|\$firstname)", first_name),
        (r"(?:\{company\}|\\company|\[company\]|\{\{company\}\}|\$company|\<company\>)", company),
        (r"(?:\{email\}|\\email|\[email\]|\{\{email\}\}|\$email)", to_email),
        (r"(?:\{notes\}|\\notes|\[notes\]|\{\{notes\}\}|\$notes)", notes),
    ]

    result = text
    for pattern, replacement in patterns:
        result = re.sub(pattern, lambda m: replacement, result, flags=re.IGNORECASE)

    return result

async def send_bulk_emails(
    list_of_emails: list[str],
    subject: str,
    body: str,
    user_email: str,
    sender_emails: list[str] = None,
    dispatch_mode: str = "all_accounts",
    attachment_data: bytes = None,
    attachment_name: str = None,
    follow_up_delay: int = 0,
    follow_up_body: str = None,
    auto_reply_prompt: str = None,
    delay_seconds: float = 0.0,
    min_send_delay: float = None,
    max_send_delay: float = None,
    enable_human_pauses: bool = False,
    campaign_id: str = None,
    campaign_name: str = None
) -> dict:
    import uuid
    if not campaign_id:
        campaign_id = str(uuid.uuid4())
    from app.api.responses import clean_campaign_title
    if campaign_name and campaign_name.strip():
        effective_campaign_name = clean_campaign_title(campaign_name)
    elif subject and subject.strip():
        effective_campaign_name = clean_campaign_title(subject)
    else:
        effective_campaign_name = "Cold Outreach Campaign"

    # Pre-flight check on requested senders
    raw_senders = [s.strip() for s in sender_emails if s and s.strip()] if sender_emails else [user_email]
    if not raw_senders:
        raw_senders = [user_email]

    # Deduplicate while preserving user ordering
    seen_senders = set()
    deduped_senders = []
    for s in raw_senders:
        sl = s.lower()
        if sl not in seen_senders:
            seen_senders.add(sl)
            deduped_senders.append(s)

    healthy_senders = []
    skipped_senders = {}
    warnings = []

    for s in deduped_senders:
        is_healthy, status_str, mins_left = await is_account_healthy(s)
        if is_healthy:
            healthy_senders.append(s)
        else:
            reason = f"Google rate limit cooldown (~{mins_left}m remaining)" if status_str == "rate_limited" else f"account status: {status_str}"
            skipped_senders[s] = reason
            warnings.append(f"Account {s} is currently unavailable ({reason}).")

    if not healthy_senders:
        # All requested senders are cooling down or expired!
        error_msg = f"None of the selected sender accounts are available to dispatch emails. {'; '.join(warnings)}"
        print(f"[EmailService] [ERROR] {error_msg}")
        return {
            "campaign_id": campaign_id,
            "total": len(list_of_emails),
            "successful": 0,
            "failed": len(list_of_emails),
            "failed_emails": list_of_emails,
            "senders_requested": deduped_senders,
            "senders_used": [],
            "distribution": {},
            "failover_events": [],
            "warnings": warnings,
            "dispatch_mode": dispatch_mode,
            "error": error_msg
        }

    senders = healthy_senders
    total_leads = len(list_of_emails)

    # Determine desired custom delay between emails
    desired_delay = float(delay_seconds) if delay_seconds and float(delay_seconds) > 0 else 0.0
    if desired_delay == 0.0 and min_send_delay is not None and float(min_send_delay) > 0:
        desired_delay = float(min_send_delay)

    # Fetch lead data mapping for personalization (case-insensitive match)
    lead_map = {}
    if leads_collection is not None:
        email_regexes = [{"email": {"$regex": f"^{re.escape(e.strip())}$", "$options": "i"}} for e in list_of_emails if e and e.strip()]
        if email_regexes:
            async for lead_doc in leads_collection.find({"$or": email_regexes}):
                if "email" in lead_doc:
                    lead_map[lead_doc["email"].lower().strip()] = lead_doc

    # Construct dispatch jobs based on dispatch_mode
    # 1. "all_accounts": Every selected Gmail account will send to every lead in list_of_emails
    # 2. "round_robin": Rotate senders across leads (1 email per lead)
    # 3. "single": Send all emails from 1 sender
    dispatch_jobs = []
    if dispatch_mode == "all_accounts":
        for recipient_email in list_of_emails:
            for s in senders:
                dispatch_jobs.append({
                    "recipient": recipient_email,
                    "sender": s,
                    "is_all_accounts": True
                })
    elif dispatch_mode == "round_robin":
        for idx, recipient_email in enumerate(list_of_emails):
            primary_assigned = senders[idx % len(senders)]
            dispatch_jobs.append({
                "recipient": recipient_email,
                "sender": primary_assigned,
                "is_all_accounts": False
            })
    else:  # "single"
        chosen_sender = senders[0] if senders else user_email
        for recipient_email in list_of_emails:
            dispatch_jobs.append({
                "recipient": recipient_email,
                "sender": chosen_sender,
                "is_all_accounts": False
            })

    total_dispatches = len(dispatch_jobs)
    print(f"[EmailService] [DISPATCH] Launching campaign '{effective_campaign_name}' ({campaign_id}) | Mode: {dispatch_mode}")
    print(f"[EmailService] [DISPATCH] Total dispatches: {total_dispatches} ({total_leads} lead(s) across {len(senders)} account(s): {senders})")
    print(f"[EmailService] [CUSTOM DELAY] Email #1 sends immediately. Delay between subsequent dispatches: {desired_delay}s")

    success_count = 0
    failed_emails = []
    error_messages = []
    actual_senders_used = set()
    distribution = {}
    failover_events = []
    temporary_inactive_senders = set()

    for job_idx, job in enumerate(dispatch_jobs):
        recipient_email = job["recipient"]
        target_sender = job["sender"]

        # Wait custom delay between dispatches (after the very first email)
        if job_idx > 0 and desired_delay > 0:
            print(f"[EmailService] [DELAY] Waiting {desired_delay}s before dispatch #{job_idx+1}/{total_dispatches} (from {target_sender} to {recipient_email})...")
            await asyncio.sleep(desired_delay)

        lead_info = lead_map.get(recipient_email.lower().strip())
        personalized_subject = format_personalized_text(subject, lead_info, recipient_email)
        personalized_body = format_personalized_text(body, lead_info, recipient_email)
        personalized_followup = format_personalized_text(follow_up_body, lead_info, recipient_email) if follow_up_body else None

        if job.get("is_all_accounts"):
            # In all_accounts mode, target_sender is the exact account intended for this dispatch
            candidate_list = [target_sender]
        else:
            # In round_robin/single mode, failover to other healthy accounts if target fails
            active_candidates = [s for s in senders if s not in temporary_inactive_senders]
            if not active_candidates:
                temporary_inactive_senders.clear()
                active_candidates = senders
            if target_sender in active_candidates:
                candidate_list = [target_sender] + [s for s in active_candidates if s != target_sender]
            else:
                candidate_list = active_candidates

        send_success = False
        last_err = None
        sender_used = None

        for candidate_sender in candidate_list:
            result = await send_email(
                to_email=recipient_email,
                subject=personalized_subject,
                body=personalized_body,
                user_email=candidate_sender,
                attachment_data=attachment_data,
                attachment_name=attachment_name,
                follow_up_delay=follow_up_delay,
                follow_up_body=personalized_followup,
                auto_reply_prompt=auto_reply_prompt,
                campaign_id=campaign_id,
                campaign_name=effective_campaign_name
            )

            if result.get("success"):
                send_success = True
                sender_used = candidate_sender
                actual_senders_used.add(candidate_sender)
                distribution[candidate_sender] = distribution.get(candidate_sender, 0) + 1

                if not job.get("is_all_accounts") and candidate_sender != target_sender:
                    failover_events.append({
                        "recipient": recipient_email,
                        "assigned_sender": target_sender,
                        "actual_sender": candidate_sender,
                        "reason": last_err or "Primary sender failed"
                    })
                    print(f"[EmailService] [FAILOVER RECORDED] Lead {recipient_email} reassigned from {target_sender} to {candidate_sender}")
                break
            else:
                last_err = result.get("error", "Unknown error")
                print(f"[EmailService] [FAILOVER] Account {candidate_sender} failed for {recipient_email}: {last_err}")
                if "429" in str(last_err) or "rateLimitExceeded" in str(last_err) or "expired" in str(last_err).lower():
                    temporary_inactive_senders.add(candidate_sender)

        if send_success:
            success_count += 1
            print(f"[EmailService] [SUCCESS] ({job_idx+1}/{total_dispatches}) Sent to {recipient_email} via {sender_used}")
        else:
            failed_emails.append(f"{target_sender} -> {recipient_email}")
            if last_err and last_err not in error_messages:
                error_messages.append(last_err)
            print(f"[EmailService] [FAIL] Failed sending to {recipient_email} via {target_sender}: {last_err}")

    last_error = "; ".join(error_messages) if error_messages else None

    return {
        "campaign_id": campaign_id,
        "campaign_name": effective_campaign_name,
        "total": total_dispatches,
        "successful": success_count,
        "failed": len(failed_emails),
        "failed_emails": failed_emails,
        "senders_requested": deduped_senders,
        "senders_used": list(actual_senders_used) if actual_senders_used else senders,
        "distribution": distribution,
        "failover_events": failover_events,
        "warnings": warnings,
        "dispatch_mode": dispatch_mode,
        "error": last_error
    }
