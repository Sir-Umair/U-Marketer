from pydantic import BaseModel, EmailStr, Field
from datetime import datetime

class EmailLogCreate(BaseModel):
    email: EmailStr
    subject: str
    body: str
    type: str = "sent"
