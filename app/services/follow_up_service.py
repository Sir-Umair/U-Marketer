from datetime import datetime, timedelta
from app.db import email_logs_collection, settings_collection
from app.services.email_service import send_email
from app.services.ai_service import ai_service
from bson import ObjectId

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

        import asyncio
        semaphore = asyncio.Semaphore(15)

        async def process_log(log):
            async with semaphore:
                user_email = log.get("user_email")
                
                # Check if automation is paused or auth is expired for this user
                if user_email:
                    from app.db import users_collection
                    if users_collection is not None:
                        user_doc = await users_collection.find_one({"email": user_email})
                        if user_doc and user_doc.get("auth_status") == "expired":
                            print(f"[FollowUp] SKIPPED: Authentication expired for {user_email}")
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
                    return {"id": str(log["_id"]), "recipient": log["recipient"], "status": "failed", "error": send_result.get("error")}

        tasks = []
        async for log in pending_campaigns:
            tasks.append(process_log(log))
            
        results = await asyncio.gather(*tasks)
        return [r for r in results if r is not None]

follow_up_service = FollowUpService()
