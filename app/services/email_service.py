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
            {"email": user_email},
            {
                "$set": {
                    "auth_status": "expired",
                    "auth_error": reason
                }
            }
        )

async def get_user_credentials(user_email: str) -> Credentials:
    """Retrieve and refresh Google OAuth credentials for a user."""
    if users_collection is None:
        raise Exception("Database connection not established. Cannot fetch credentials.")
    user = await users_collection.find_one({"email": user_email})
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
                {"email": user_email},
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

async def send_email(to_email: str, subject: str, body: str, user_email: str, skip_log: bool = False, attachment_data: bytes = None, attachment_name: str = None, follow_up_delay: int = 0, follow_up_body: str = None, auto_reply_prompt: str = None, campaign_id: str = None) -> dict:
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
        
        import asyncio
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
    attachment_data: bytes = None,
    attachment_name: str = None,
    follow_up_delay: int = 0,
    follow_up_body: str = None,
    auto_reply_prompt: str = None,
    delay_seconds: float = 0.0,
    min_send_delay: float = None,
    max_send_delay: float = None,
    enable_human_pauses: bool = False,
    campaign_id: str = None
) -> dict:
    import uuid
    import asyncio
    import random
    if not campaign_id:
        campaign_id = str(uuid.uuid4())

    # Determine sender list and validate active accounts
    raw_senders = [s.strip() for s in sender_emails if s and s.strip()] if sender_emails else [user_email]
    if not raw_senders:
        raw_senders = [user_email]

    # Check database for active sender credentials
    valid_senders = []
    if users_collection is not None:
        for s in raw_senders:
            u_doc = await users_collection.find_one({"email": s})
            if u_doc and u_doc.get("auth_status") != "expired" and u_doc.get("access_token"):
                valid_senders.append(s)

    senders = valid_senders if valid_senders else raw_senders
    total_emails = len(list_of_emails)

    # Determine desired custom delay between emails
    desired_delay = float(delay_seconds) if delay_seconds and float(delay_seconds) > 0 else 0.0
    if desired_delay == 0.0 and min_send_delay is not None and float(min_send_delay) > 0:
        desired_delay = float(min_send_delay)

    print(f"[EmailService] [DISPATCH] Launching campaign {campaign_id} to {total_emails} leads across {len(senders)} sender(s): {senders}")
    print(f"[EmailService] [CUSTOM DELAY] Email #1 sends initially (immediate). Desired delay between subsequent sends: {desired_delay}s")

    # Fetch lead data mapping for personalization (case-insensitive match)
    lead_map = {}
    if leads_collection is not None:
        email_regexes = [{"email": {"$regex": f"^{re.escape(e.strip())}$", "$options": "i"}} for e in list_of_emails if e and e.strip()]
        if email_regexes:
            async for lead_doc in leads_collection.find({"$or": email_regexes}):
                if "email" in lead_doc:
                    lead_map[lead_doc["email"].lower().strip()] = lead_doc

    success_count = 0
    failed_emails = []
    error_messages = []

    for idx, recipient_email in enumerate(list_of_emails):
        # 1. Email #1 sends initially. Subsequent emails wait the desired custom delay.
        if idx > 0 and desired_delay > 0:
            print(f"[EmailService] [DELAY] Waiting desired custom delay of {desired_delay}s before dispatching email #{idx+1}/{total_emails} to {recipient_email}...")
            await asyncio.sleep(desired_delay)

        assigned_sender = senders[idx % len(senders)]
        lead_info = lead_map.get(recipient_email.lower().strip())

        # Personalize subject, body, and follow-up body for this lead
        personalized_subject = format_personalized_text(subject, lead_info, recipient_email)
        personalized_body = format_personalized_text(body, lead_info, recipient_email)
        personalized_followup = format_personalized_text(follow_up_body, lead_info, recipient_email) if follow_up_body else None

        result = await send_email(
            to_email=recipient_email,
            subject=personalized_subject,
            body=personalized_body,
            user_email=assigned_sender,
            attachment_data=attachment_data,
            attachment_name=attachment_name,
            follow_up_delay=follow_up_delay,
            follow_up_body=personalized_followup,
            auto_reply_prompt=auto_reply_prompt,
            campaign_id=campaign_id
        )

        if result.get("success"):
            success_count += 1
            print(f"[EmailService] [SUCCESS] Sent to {recipient_email} via {assigned_sender} ({idx+1}/{total_emails})")
        else:
            failed_emails.append(recipient_email)
            err = result.get("error")
            if err and err not in error_messages:
                error_messages.append(err)
            print(f"[EmailService] [FAIL] Failed sending to {recipient_email}: {err}")

    last_error = "; ".join(error_messages) if error_messages else None

    return {
        "campaign_id": campaign_id,
        "total": total_emails,
        "successful": success_count,
        "failed": len(failed_emails),
        "failed_emails": failed_emails,
        "senders_used": senders,
        "error": last_error
    }
