from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import asyncio
from app.api import leads, emails, settings, responses, logs, auth, developer
from app.services.follow_up_service import follow_up_service
from app.services.auto_reply_service import auto_reply_service

async def background_monitoring_task():
    """Runs continuously in the background to sync emails across all connected accounts and send follow-ups."""
    while True:
        try:
            print("[Background Worker] Executing auto-reply and follow-up checks...")
            # 1. Process incoming replies for all connected accounts concurrently
            await auto_reply_service.check_all_accounts_replies()
            
            # 2. Send pending AI automated follow-ups
            await follow_up_service.process_pending_follow_ups()
            
        except Exception as e:
            print(f"[Background Worker] Error: {e}")
            
        await asyncio.sleep(120) # Run every 2 minutes to prevent Google API rate limits

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: spawn the background task
    task = asyncio.create_task(background_monitoring_task())
    yield
    # Shutdown: wait and cancel
    task.cancel()

app = FastAPI(
    title="Email Marketing Agent Backend",
    description="Backend for AI-powered Email Marketing with Auto Follow-ups and Reply Detection",
    version="1.0.0",
    lifespan=lifespan
)

# CORS Configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:8000",
        "http://127.0.0.1:8000"
    ],
    allow_origin_regex=".*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include Routers
app.include_router(auth.router)
app.include_router(developer.router)
app.include_router(leads.router)
app.include_router(emails.router)
app.include_router(settings.router)
app.include_router(responses.router)
app.include_router(logs.router)

@app.get("/")
async def root():
    return {"message": "Welcome to the Email Marketing Agent API. Visit /docs for Swagger UI."}
