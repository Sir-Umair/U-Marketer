from pydantic import BaseModel, EmailStr
from typing import List, Optional
from datetime import datetime

class FollowUpBase(BaseModel):
    lead_email: EmailStr
    subject: str
    body: str
    delay_hours: int = 24  # Send after X hours
    condition: str = "no_reply" # e.g., "no_reply", "always"

class FollowUpCreate(FollowUpBase):
    pass

class FollowUpResponse(FollowUpBase):
    id: str
    user_email: str
    status: str # "pending", "sent", "cancelled"
    scheduled_for: datetime
    created_at: datetime
