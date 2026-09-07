from googleapiclient.discovery import build
import base64
from email.message import EmailMessage
from app.services.email_service import get_user_credentials, send_email
from app.services.ai_service import ai_service
from app.services.sheets_service import sheets_service
from app.db import email_logs_collection, settings_collection
from datetime import datetime, timedelta
import asyncio
import traceback
import re

class AutoReplyService:
    async def check_all_accounts_replies(self):
        """Iterates over all active Gmail accounts in users_collection and processes inboxes concurrently."""
        from app.db import users_collection
        if users_collection is None:
            return {"status": "error", "message": "Database not connected"}

        try:
            active_users = await users_collection.find({
                "access_token": {"$exists": True},
                "auth_status": {"$ne": "expired"}
            }).to_list(100)
            if not active_users:
                print("[AutoReply] No active connected user accounts found.")
                return {"status": "success", "accounts": 0}

            print(f"[AutoReply] Running concurrent inbox check for {len(active_users)} connected account(s)...")
            tasks = [self.check_and_reply_to_emails(u["email"]) for u in active_users if "email" in u]
            results = await asyncio.gather(*tasks, return_exceptions=True)
            return {"status": "success", "accounts": len(tasks), "results": results}
        except Exception as e:
            print(f"[AutoReply] Error in check_all_accounts_replies: {e}")
            return {"status": "error", "message": str(e)}

    @staticmethod
    def _clean_subject(subject: str) -> str:
        """Normalizes subject by stripping 'Re:', 'Fwd:', extra spaces for bulletproof grouping."""
        if not subject:
            return ""
        s = subject.strip().lower()
        pattern = r'^(re|fwd|fw|aw|r)\s*(\[\d+\])?\s*:\s*'
        while re.match(pattern, s, flags=re.IGNORECASE):
            s = re.sub(pattern, '', s, count=1, flags=re.IGNORECASE).strip()
        s = re.sub(r'\s+', ' ', s)
        return s.strip()

    def _get_recursive_body(self, payload) -> str:
        """Helper to recursively find text/plain body in nested email parts."""
        # 1. Check if this part itself is the text body
        if payload.get('mimeType') == 'text/plain':
            data = payload.get('body', {}).get('data', '')
            if data:
                return base64.urlsafe_b64decode(data).decode('utf-8', errors='replace')
        
        # 2. If it has parts, search them recursively
        if 'parts' in payload:
            for part in payload['parts']:
                body = self._get_recursive_body(part)
                if body:
                    return body
        return ""

    async def check_and_reply_to_emails(self, user_email: str):
        """Checks for unread emails and processes them using Gmail API in parallel."""
        try:
            # Check if auto-reply is enabled for this user (case-insensitive)
            user_settings = await settings_collection.find_one({
                "user_email": {"$regex": f"^{user_email}$", "$options": "i"}
            })
            
            auto_reply_enabled = True
            if user_settings and not user_settings.get("auto_reply_enabled", True):
                print(f"[AutoReply] Syncing logs only (Auto-reply is paused for {user_email})")
                auto_reply_enabled = False

            creds = await get_user_credentials(user_email)
            service = build('gmail', 'v1', credentials=creds)

            # Search for messages in the inbox
            # We include recently read messages in case the user clicked them in Gmail, 
            # ensuring they are still processed by our sync.
            query = "label:inbox -from:me newer_than:3d"
            results = await asyncio.to_thread(service.users().messages().list(userId='me', q=query).execute)
            messages = results.get('messages', [])
            
            if not messages:
                print(f"[AutoReply] No new messages found in inbox for {user_email}")
                return {"status": "success", "processed": 0, "replies_sent": 0}

            print(f"[AutoReply] Found {len(messages)} messages to check for {user_email}")

            # Get already processed IDs for this user
            already_processed = set()
            if email_logs_collection is not None:
                cursor = email_logs_collection.find(
                    {"user_email": user_email, "message_id": {"$exists": True}},
                    {"message_id": 1}
                )
                async for doc in cursor:
                    already_processed.add(doc.get("message_id"))

            # Filter out already processed messages
            new_messages = [m for m in messages if m['id'] not in already_processed]
            
            if not new_messages:
                print(f"[AutoReply] All {len(messages)} inbox messages were already processed for {user_email}")
                return {"status": "success", "processed": 0, "replies_sent": 0}

            # Process new messages in parallel with a concurrency limit
            semaphore = asyncio.Semaphore(20)
            
            async def bounded_process(msg_id):
                async with semaphore:
                    return await self._process_single_message(creds, user_email, msg_id, auto_reply_enabled)

            tasks = [bounded_process(msg_item['id']) for msg_item in new_messages]
            results = await asyncio.gather(*tasks, return_exceptions=True)

            processed_count = 0
            replied_count = 0
            skipped_count = len(messages) - len(new_messages)

            for res in results:
                if isinstance(res, dict):
                    if res.get("status") == "success":
                        processed_count += 1
                        if res.get("replied"):
                            replied_count += 1
                    elif res.get("status") == "skipped":
                        skipped_count += 1
                elif isinstance(res, Exception):
                    print(f"[AutoReply] Task failed with exception: {res}")

            return {
                "status": "success",
                "processed": processed_count,
                "replies_sent": replied_count,
                "skipped": skipped_count
            }

        except Exception as e:
            err_str = str(e)
            if "429" in err_str or "rateLimitExceeded" in err_str or "User-rate limit exceeded" in err_str:
                print(f"[AutoReply] Gmail API Rate Limit exceeded for {user_email}. Pausing until next cycle.")
                return {"status": "rate_limited", "message": "Rate limit exceeded. Will retry automatically."}
            elif "invalid_grant" in err_str or "Authentication expired" in err_str or "RefreshError" in type(e).__name__:
                from app.services.email_service import mark_user_auth_expired
                await mark_user_auth_expired(user_email, "Authentication expired. Please reconnect your Gmail account.")
                print(f"[AutoReply] Authentication expired or invalid for {user_email}. User needs to reconnect Gmail account.")
            else:
                print(f"[AutoReply] Error in auto-reply service for {user_email}: {e}")
                import traceback
                traceback.print_exc()
            return {"status": "error", "message": str(e)}

    async def _process_single_message(self, creds, user_email: str, msg_id: str, auto_reply_enabled: bool = True):
        """Processes a single Gmail message: categorizes, replies, marks as read, and logs."""
        try:
            # Build service locally for this task (thread-safety)
            service = build('gmail', 'v1', credentials=creds)
            msg = await asyncio.to_thread(service.users().messages().get(userId='me', id=msg_id, format='full').execute)
            
            payload = msg.get('payload', {})
            headers = payload.get('headers', [])
            thread_id = msg.get('threadId')
            
            subject = next((h['value'] for h in headers if h['name'].lower() == 'subject'), '(No Subject)')
            sender_raw = next((h['value'] for h in headers if h['name'].lower() == 'from'), '')
            
            # Basic sender parsing
            if "<" in sender_raw:
                sender_name = sender_raw.split("<")[0].strip().strip('"')
                sender_email = sender_raw.split("<")[1].strip().rstrip(">")
            else:
                sender_email = sender_raw.strip()
                sender_name = sender_email.split("@")[0]

            if sender_email.lower() == user_email.lower():
                return {"status": "skipped", "reason": "self-email"}

            print(f"[AutoReply] Processing email from: {sender_email} (Subject: {subject})")

            # Get body recursively
            body = self._get_recursive_body(payload)
            if not body:
                # Fallback for simple messages
                data = payload.get('body', {}).get('data', '')
                if data:
                    body = base64.urlsafe_b64decode(data).decode('utf-8', errors='replace')

            # 1. Look for original campaign instructions and sent message
            campaign_instruction = None
            orig_log = None
            clean_subj = self._clean_subject(subject)

            if email_logs_collection is not None:
                # Priority 1: Exact thread_id match for this user
                if thread_id:
                    orig_log = await email_logs_collection.find_one({
                        "user_email": user_email,
                        "type": "sent",
                        "thread_id": thread_id
                    })
                
                # Priority 2: Exact thread_id match across all sent logs (multi-account rotation)
                if not orig_log and thread_id:
                    orig_log = await email_logs_collection.find_one({
                        "type": "sent",
                        "thread_id": thread_id
                    })

                # Priority 3: Clean subject + Recipient match
                if not orig_log and clean_subj:
                    sent_candidates = await email_logs_collection.find({
                        "type": "sent",
                        "$or": [
                            {"recipient": {"$regex": f"^{re.escape(sender_email)}$", "$options": "i"}},
                            {"user_email": {"$regex": f"^{re.escape(sender_email)}$", "$options": "i"}}
                        ]
                    }).sort("timestamp", -1).to_list(length=100)

                    for cand in sent_candidates:
                        if self._clean_subject(cand.get("subject", "")) == clean_subj:
                            orig_log = cand
                            break
                
                # Priority 4: Fallback to recipient email match for this user (recent within 60 days)
                if not orig_log:
                    cutoff_date = datetime.utcnow() - timedelta(days=60)
                    orig_log = await email_logs_collection.find_one({
                        "user_email": user_email,
                        "type": "sent",
                        "recipient": {"$regex": f"^{re.escape(sender_email)}$", "$options": "i"},
                        "timestamp": {"$gte": cutoff_date}
                    }, sort=[("timestamp", -1)])

                # Priority 5: Fallback across any sent log to this recipient (within 60 days)
                if not orig_log:
                    cutoff_date = datetime.utcnow() - timedelta(days=60)
                    orig_log = await email_logs_collection.find_one({
                        "type": "sent",
                        "recipient": {"$regex": f"^{re.escape(sender_email)}$", "$options": "i"},
                        "timestamp": {"$gte": cutoff_date}
                    }, sort=[("timestamp", -1)])
                
            if not orig_log:
                print(f"[AutoReply] SKIPPED: No previous sent email found for {sender_email}. Not a lead response.")
                return {"status": "skipped", "reason": "not-a-lead"}

            campaign_instruction = orig_log.get("auto_reply_prompt")

            # 2. Process with AI
            email_data = {
                "body": body or "", 
                "name": sender_name, 
                "email": sender_email, 
                "subject": subject,
                "instruction": campaign_instruction
            }
            graph_result = await ai_service.process_with_graph(email_data)
            intent = graph_result.get("intent", "unknown")
            reply_content = graph_result.get("reply_body", "")

            # Send reply if needed
            reply_sent = False
            if auto_reply_enabled and reply_content:
                result = await send_email(
                    to_email=sender_email,
                    subject=f"Re: {subject}",
                    body=reply_content,
                    user_email=user_email,
                    skip_log=True
                )
                reply_sent = result.get("success", False)
            elif not auto_reply_enabled:
                print(f"[AutoReply] LOG ONLY: Skipping automated response to {sender_email} as service is paused.")
                
            # Mark as read in Gmail
            await asyncio.to_thread(service.users().messages().batchModify(userId='me', body={
                'ids': [msg_id],
                'removeLabelIds': ['UNREAD']
            }).execute)

            # Log to MongoDB
            if email_logs_collection is not None:
                record = {
                    "user_email": user_email,
                    "message_id": msg_id,
                    "thread_id": msg.get('threadId'),
                    "campaign_id": orig_log.get("campaign_id"), # Link to campaign
                    "name": sender_name,
                    "email": sender_email,
                    "subject": subject,
                    "intent": intent,
                    "message": (body or ""), # Full message as requested
                    "ai_reply": reply_content,
                    "reply_sent": reply_sent,
                    "timestamp": datetime.utcnow(),
                }
                await email_logs_collection.insert_one(record)
                
                # Detect reply and mark original 'sent' message to prevent follow-ups & show in dashboard
                if orig_log and "_id" in orig_log:
                    await email_logs_collection.update_one(
                        {"_id": orig_log["_id"]},
                        {"$set": {"reply_received": True}}
                    )

                if orig_log and orig_log.get("campaign_id"):
                    await email_logs_collection.update_many(
                        {
                            "campaign_id": orig_log["campaign_id"],
                            "recipient": {"$regex": f"^{re.escape(sender_email)}$", "$options": "i"}
                        },
                        {"$set": {"reply_received": True}}
                    )
                else:
                    query = {"type": "sent"}
                    if msg.get('threadId'):
                        query["$or"] = [{"thread_id": msg.get('threadId')}, {"recipient": {"$regex": f"^{re.escape(sender_email)}$", "$options": "i"}}]
                    else:
                        query["recipient"] = {"$regex": f"^{re.escape(sender_email)}$", "$options": "i"}
                    
                    await email_logs_collection.update_many(
                        query,
                        {"$set": {"reply_received": True}}
                    )
            
            # Log to Google Sheets
            try:
                await sheets_service.log_responder_to_sheet(
                    name=sender_name,
                    email=sender_email,
                    message_snippet=(body or "")[:200]
                )
            except Exception as e:
                print(f"[AutoReply] Sheet logging failed: {e}")

            return {"status": "success", "replied": reply_sent}

        except Exception as e:
            print(f"Error processing message {msg_id}: {e}")
            return {"status": "error", "error": str(e)}

auto_reply_service = AutoReplyService()

