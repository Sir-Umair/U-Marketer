from fastapi import APIRouter, HTTPException, status, Depends, File, Form, UploadFile, BackgroundTasks
from pydantic import BaseModel, EmailStr
from typing import List, Optional
import json
import uuid
import random
from app.services import email_service
from app.services.ai_service import ai_service
from app.services.follow_up_service import follow_up_service
from app.services.auto_reply_service import auto_reply_service
from app.services.credit_service import credit_service
from app.api.auth import get_current_user

router = APIRouter(prefix="/emails", tags=["Emails"])

class GenerateEmailRequest(BaseModel):
    prompt: str
    leads_context: Optional[List[dict]] = None
    personalize: Optional[bool] = True

class GenerateFollowUpRequest(BaseModel):
    original_subject: str
    original_body: str

@router.post("/generate-content")
async def generate_content(request: GenerateEmailRequest, user: dict = Depends(get_current_user)):
    # Deduct 5 credits for AI Email Generation
    await credit_service.deduct_credits(user["email"], 5, "AI Email Generation")
    content = await ai_service.generate_email_content(
        prompt=request.prompt,
        leads_context=request.leads_context,
        personalize=request.personalize if request.personalize is not None else True
    )
    if content.startswith("Failed to generate") or content.startswith("Error"):
        raise HTTPException(status_code=500, detail=content)
    return {"generated_content": content}

@router.post("/generate-followup-content")
async def generate_followup_content(request: GenerateFollowUpRequest, user: dict = Depends(get_current_user)):
    # Deduct 5 credits for AI Follow-Up Generation
    await credit_service.deduct_credits(user["email"], 5, "AI Follow-Up Generation")
    content = await ai_service.generate_follow_up_content(request.original_subject, request.original_body)
    if content.startswith("Failed to generate") or content.startswith("Error"):
        raise HTTPException(status_code=500, detail=content)
    return {"generated_content": content}

class GenerateFollowUpPromptRequest(BaseModel):
    prompt: str
    original_subject: str
    original_body: str

@router.post("/generate-followup-from-prompt")
async def generate_followup_from_prompt(request: GenerateFollowUpPromptRequest, user: dict = Depends(get_current_user)):
    # Deduct 5 credits for AI Prompt Follow-Up Generation
    await credit_service.deduct_credits(user["email"], 5, "AI Follow-Up Generation from Prompt")
    context = f"Context: This is a follow-up to a previous email.\nOriginal Subject: {request.original_subject}\nOriginal Body: {request.original_body}\n\nUser Request: {request.prompt}"
    content = await ai_service.generate_email_content(context)
    if content.startswith("Failed to generate") or content.startswith("Error"):
        raise HTTPException(status_code=500, detail=content)
    return {"generated_content": content}

@router.post("/send-bulk")
async def send_bulk(
    background_tasks: BackgroundTasks,
    emails_json: str = Form(...),
    subject: str = Form(...),
    body: str = Form(...),
    sender_emails_json: Optional[str] = Form(None),
    follow_up_delay: int = Form(0),
    follow_up_body: Optional[str] = Form(None),
    auto_reply_prompt: Optional[str] = Form(None),
    attachment: Optional[UploadFile] = File(None),
    delay_seconds: float = Form(0.0),
    min_send_delay: Optional[float] = Form(None),
    max_send_delay: Optional[float] = Form(None),
    enable_human_pauses: bool = Form(False),
    test_mode: bool = Form(False),
    user: dict = Depends(get_current_user)
):
    try:
        emails = json.loads(emails_json)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid email list format")

    sender_emails = None
    if sender_emails_json:
        try:
            sender_emails = json.loads(sender_emails_json)
        except json.JSONDecodeError:
            pass

    attachment_data = await attachment.read() if attachment else None
    attachment_name = attachment.filename if attachment else None

    if not emails:
        raise HTTPException(status_code=400, detail="Email list cannot be empty")

    if attachment and not attachment_name.lower().endswith('.pdf'):
        raise HTTPException(status_code=400, detail="Only PDF attachments are permitted.")

    # Determine desired custom delay
    effective_delay = float(delay_seconds) if delay_seconds > 0 else (float(min_send_delay) if min_send_delay is not None else 0.0)
    if test_mode:
        effective_delay = 1.0

    # Deduct 1 credit per recipient email
    cost = len(emails) * 1
    await credit_service.deduct_credits(user["email"], cost, f"Bulk Campaign Dispatch ({len(emails)} emails)")

    campaign_id = str(uuid.uuid4())
    # Email #1 sends initially (0s delay). Subsequent emails take effective_delay.
    estimated_duration_seconds = max(0, len(emails) - 1) * effective_delay

    # If pacing will take longer than 15s and it's not a short test, dispatch in background
    if estimated_duration_seconds > 15.0 and not test_mode:
        background_tasks.add_task(
            email_service.send_bulk_emails,
            list_of_emails=emails,
            subject=subject,
            body=body,
            user_email=user["email"],
            sender_emails=sender_emails,
            attachment_data=attachment_data,
            attachment_name=attachment_name,
            follow_up_delay=follow_up_delay,
            follow_up_body=follow_up_body,
            auto_reply_prompt=auto_reply_prompt,
            delay_seconds=effective_delay,
            min_send_delay=effective_delay,
            max_send_delay=effective_delay,
            enable_human_pauses=False,
            campaign_id=campaign_id
        )

        return {
            "campaign_id": campaign_id,
            "status": "queued",
            "is_background": True,
            "total": len(emails),
            "successful": len(emails),
            "failed": 0,
            "senders_used": sender_emails or [user["email"]],
            "estimated_minutes": round(estimated_duration_seconds / 60, 1),
            "message": f"Campaign launched! Email #1 was sent initially. Remaining emails are sending with your custom delay of {effective_delay}s in between. Progress is tracking in real time."
        }
    else:
        result = await email_service.send_bulk_emails(
            list_of_emails=emails,
            subject=subject,
            body=body,
            user_email=user["email"],
            sender_emails=sender_emails,
            attachment_data=attachment_data,
            attachment_name=attachment_name,
            follow_up_delay=follow_up_delay,
            follow_up_body=follow_up_body,
            auto_reply_prompt=auto_reply_prompt,
            delay_seconds=effective_delay,
            min_send_delay=effective_delay,
            max_send_delay=effective_delay,
            enable_human_pauses=False,
            campaign_id=campaign_id
        )

        if result["successful"] == 0 and len(emails) > 0:
            detail = result.get("error") or "All emails failed to send."
            raise HTTPException(status_code=500, detail=detail)

        return result

@router.api_route("/simulate-cadence", methods=["GET", "POST"])
async def simulate_cadence(
    request: dict = None,
    count: int = 5,
    min_delay: float = 15.0,
    max_delay: float = 45.0,
    enable_human_pauses: bool = True
):
    """
    Simulation & test tool: Generates a sample human-like schedule for N emails
    without sending any actual messages. Supports both GET (query params) and POST (JSON).
    """
    if request:
        count = int(request.get("count", count))
        min_delay = float(request.get("min_delay", min_delay))
        max_delay = float(request.get("max_delay", max_delay))
        enable_human_pauses = bool(request.get("enable_human_pauses", enable_human_pauses))

    schedule = []
    current_time_offset = 0.0

    for i in range(count):
        if i == 0:
            delay = 0.0
        else:
            delay = round(random.uniform(min(min_delay, max_delay), max(min_delay, max_delay)), 1)
            current_time_offset += delay
            if enable_human_pauses and (i % 10 == 0) and min_delay >= 5.0:
                pause = round(random.uniform(60.0, 120.0), 1)
                current_time_offset += pause

        schedule.append({
            "email_number": i + 1,
            "delay_before_send_seconds": delay,
            "approx_timestamp_offset_seconds": round(current_time_offset, 1),
            "approx_timestamp_formatted": f"+{int(current_time_offset // 60)}m {int(current_time_offset % 60)}s"
        })

    return {
        "total_emails": count,
        "min_delay": min_delay,
        "max_delay": max_delay,
        "estimated_total_seconds": round(current_time_offset, 1),
        "estimated_total_minutes": round(current_time_offset / 60, 1),
        "schedule": schedule
    }

@router.post("/process-followups")
async def process_followups():
    """Triggers the automated processing of pending follow-ups for emails without replies."""
    results = await follow_up_service.process_pending_follow_ups()
    return {"processed": len(results), "details": results}

@router.post("/auto-reply-suggestions")
async def get_suggestions(request: dict):
    subject = request.get("subject", "")
    body = request.get("body", "")
    if not subject or not body:
        return {"suggestions": ["Be professional", "Answer questions", "Try to book a call"]}
    suggestions = await ai_service.generate_response_suggestions(subject, body)
    return {"suggestions": suggestions}

@router.post("/process-replies")
async def process_replies(user: dict = Depends(get_current_user)):
    """Manually triggers the check for unread emails and auto-replies."""
    # Deduct 3 credits for Auto-Reply Processing
    await credit_service.deduct_credits(user["email"], 3, "Inbox Scan & AI Auto-Replies")
    result = await auto_reply_service.check_and_reply_to_emails(user_email=user["email"])
    if result.get("status") == "error":
        raise HTTPException(status_code=500, detail=result.get("message"))
    return result

