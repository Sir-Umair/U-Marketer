from datetime import datetime, timedelta
from app.db import email_logs_collection, settings_collection
from app.services.email_service import send_email, is_account_healthy
from app.services.ai_service import ai_service
from bson import ObjectId
import asyncio

class FollowUpService:
    async def process_pending_follow_ups(self):
        """Automatically checks for sent emails without replies past their scheduled follow-up time."""
        if email_logs_collection is None:
            return []

        now = datetime.utcnow()

        # Find emails where:
        # 1. Type is 'sent'
        # 2. No reply received
        # 3. Follow-up not yet sent
        # 4. follow_up_at is in the past (already reached)
        pending_campaigns = email_logs_collection.find({
            "type": "sent",
            "reply_received": False,
            "follow_up_sent": {"$ne": True}, 
            "follow_up_at": {"$lte": now}
        }).limit(50)

        semaphore = asyncio.Semaphore(15)

        async def process_log(log):
            async with semaphore:
                user_email = log.get("user_email")
                
                # Check if automation is paused or auth is expired/rate-limited for this user
                if user_email:
                    is_healthy, status_str, mins_left = await is_account_healthy(user_email)
                    if not is_healthy:
                        if status_str == "rate_limited":
                            print(f"[FollowUp] SKIPPED: Account {user_email} in rate-limit cooldown (~{mins_left}m remaining). Backing off follow-up.")
                            await email_logs_collection.update_one(
                                {"_id": log["_id"]},
                                {"$set": {"follow_up_at": datetime.utcnow() + timedelta(minutes=max(15, mins_left + 2))}}
                            )
                        else:
                            print(f"[FollowUp] SKIPPED: Account {user_email} is {status_str}")
                        return None

                    user_settings = await settings_collection.find_one({"user_email": user_email})
                    if user_settings and not user_settings.get("auto_reply_enabled", True):
                        print(f"[FollowUp] SKIPPED: Automation is paused for {user_email}")
                        return None

                original_subject = log.get("subject", "")
                original_body = log.get("body", "")
                
                # Use specific follow-up body if provided, otherwise generate with AI
                follow_up_body = log.get("follow_up_body")
                if not follow_up_body:
                    follow_up_body = await ai_service.generate_follow_up_content(original_subject, original_body)
                
                follow_up_subject = original_subject if original_subject.lower().startswith("re:") else f"Re: {original_subject}"

                # Send the follow-up email
                send_result = await send_email(
                    to_email=log["recipient"],
                    subject=follow_up_subject,
                    body=follow_up_body,
                    user_email=user_email,
                    campaign_id=log.get("campaign_id"),
                    auto_reply_prompt=log.get("auto_reply_prompt")
                )
                
                if send_result.get("success"):
                    await email_logs_collection.update_one(
                        {"_id": log["_id"]},
                        {"$set": {"follow_up_sent": True, "follow_up_timestamp": datetime.utcnow()}}
                    )
                    return {"id": str(log["_id"]), "recipient": log["recipient"], "status": "sent"}
                else:
                    attempts = log.get("follow_up_attempts", 0) + 1
                    err = str(send_result.get("error", "Unknown error"))
                    if attempts >= 3 or "invalid_grant" in err or "NoSuchUser" in err or "550" in err:
                        # Max attempts reached or permanent delivery failure: abandon
                        await email_logs_collection.update_one(
                            {"_id": log["_id"]},
                            {
                                "$set": {
                                    "follow_up_sent": True,
                                    "follow_up_status": "failed",
                                    "follow_up_attempts": attempts,
                                    "follow_up_error": err
                                }
                            }
                        )
                        print(f"[FollowUp] Abandoning follow-up for {log['recipient']} after {attempts} attempts: {err}")
                    else:
                        # Temporary failure: back off by 30 mins
                        next_attempt = datetime.utcnow() + timedelta(minutes=30)
                        await email_logs_collection.update_one(
                            {"_id": log["_id"]},
                            {
                                "$set": {
                                    "follow_up_attempts": attempts,
                                    "follow_up_at": next_attempt,
                                    "last_error": err
                                }
                            }
                        )
                        print(f"[FollowUp] Backing off follow-up for {log['recipient']} (attempt {attempts}) until {next_attempt.strftime('%H:%M:%S UTC')}")
                    return {"id": str(log["_id"]), "recipient": log["recipient"], "status": "failed", "error": err}

        tasks = []
        async for log in pending_campaigns:
            tasks.append(process_log(log))
            
        results = await asyncio.gather(*tasks)
        return [r for r in results if r is not None]

follow_up_service = FollowUpService()
