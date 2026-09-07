import os
import json
import re
from typing import TypedDict, List, Annotated, Dict, Optional
from langchain_core.messages import BaseMessage, HumanMessage, SystemMessage
from langgraph.graph import StateGraph, END
from app.config import settings

# Supported Google Gemini Free Tier Models
SUPPORTED_FREE_MODELS = [
    "gemini-1.5-flash",
    "gemini-2.0-flash",
    "gemini-2.5-flash",
    "gemini-1.5-pro"
]
DEFAULT_MODEL = "gemini-1.5-flash"


# --- State Definition ---
class AgentState(TypedDict):
    """The state of our marketing automation graph."""
    incoming_email: str
    sender_name: str
    sender_email: str
    subject: str
    intent: str  # interest, question, unsubscribe, spam
    reply_body: str
    actions_taken: List[str]
    status: str
    instruction: Annotated[str, "optional"]


# --- AI Service Class ---
class AIService:
    def __init__(self):
        self.api_key = (
            settings.gemini_api_key
            or settings.google_api_key
            or os.environ.get("GEMINI_API_KEY", "")
            or os.environ.get("GOOGLE_API_KEY", "")
            or settings.anthropic_api_key
        ).strip()

        # Select supported model
        requested_model = (
            getattr(settings, "gemini_model", None)
            or os.environ.get("GEMINI_MODEL", "")
            or DEFAULT_MODEL
        ).strip().lower()

        if any(requested_model.startswith(m) for m in SUPPORTED_FREE_MODELS):
            self.model_name = requested_model
        else:
            self.model_name = DEFAULT_MODEL

        self.llm = self._init_llm()
        self.graph = self._build_auto_reply_graph()

    def _init_llm(self):
        """Initializes the Google Gemini Chat Model."""
        if not self.api_key:
            print("[AI Service] Notice: No GEMINI_API_KEY provided in .env. Operating in resilient fallback mode.")
            return None

        try:
            from langchain_google_genai import ChatGoogleGenerativeAI
            llm = ChatGoogleGenerativeAI(
                model=self.model_name,
                google_api_key=self.api_key,
                temperature=0.2,
                max_retries=1,
            )
            print(f"[AI Service] Initialized Google Gemini model: {self.model_name}")
            return llm
        except Exception as e:
            print(f"[AI Service] Warning initializing ChatGoogleGenerativeAI: {e}")
            return None

    def _clean_text(self, text) -> str:
        """Strips markdown code blocks and handles non-string AI responses safely."""
        if not text:
            return ""

        if isinstance(text, list):
            text = "".join([t.get("text", "") if isinstance(t, dict) else str(t) for t in text])

        text = str(text).strip()

        if text.startswith("```"):
            text = text.split("\n", 1)[-1] if "\n" in text else text[3:]
            if text.endswith("```"):
                text = text[:-3]
        return text.strip()

    def _build_auto_reply_graph(self):
        """Constructs the LangGraph for auto-replies with single-pass processing."""
        builder = StateGraph(AgentState)

        async def process_email_node(state: AgentState):
            instruction = state.get("instruction", "")
            prompt = f"""Analyze this email from {state['sender_name']}:

Subject: {state['subject']}
Body: {state['incoming_email']}

1. Categorize intent into exactly one: [interest, question, unsubscribe, spam]
2. If 'interest' or 'question', write a concise, warm plain-text reply.
{f"MANDATORY INSTRUCTION: {instruction}" if instruction else ""}

Return ONLY a valid JSON object:
{{
  "intent": "category",
  "reply_body": "your reply text or empty string"
}}"""

            if self.llm:
                try:
                    response = await self.llm.ainvoke([HumanMessage(content=prompt)])
                    content = self._clean_text(response.content)
                    if "{" in content and "}" in content:
                        content = content[content.find("{"):content.rfind("}") + 1]
                    data = json.loads(content)
                    return {
                        "intent": data.get("intent", "spam").lower(),
                        "reply_body": data.get("reply_body", "")
                    }
                except Exception as e:
                    print(f"[AI Service] Gemini invocation notice: {e}. Utilizing smart fallback parsing.")

            # Resilient heuristic classification if Gemini API key suspended / quota / error
            body_lower = (state.get("incoming_email") or "").lower()
            subject_lower = (state.get("subject") or "").lower()
            combined = f"{subject_lower} {body_lower}"

            if any(w in combined for w in ["unsubscribe", "remove me", "stop sending", "opt out", "please leave me alone"]):
                return {
                    "intent": "unsubscribe",
                    "reply_body": f"Hi {state.get('sender_name', 'there')},\n\nYou have been unsubscribed from our mailing list. You won't receive further communications from us.\n\nBest regards."
                }
            elif any(w in combined for w in ["interested", "demo", "pricing", "cost", "schedule", "call", "discuss", "sounds good", "tell me more"]):
                return {
                    "intent": "interest",
                    "reply_body": f"Hi {state.get('sender_name', 'there')},\n\nThank you for your interest! I would be delighted to share more details with you or schedule a brief 10-minute call to discuss your goals.\n\nWhen would be a convenient time for you this week?\n\nBest regards."
                }
            elif "?" in combined or any(w in combined for w in ["how", "what", "when", "where", "can you", "does this", "do you"]):
                return {
                    "intent": "question",
                    "reply_body": f"Hi {state.get('sender_name', 'there')},\n\nThank you for reaching out with your question. I've made note of your query and will follow up shortly with full details.\n\nBest regards."
                }
            else:
                return {"intent": "spam", "reply_body": ""}

        builder.add_node("process", process_email_node)
        builder.set_entry_point("process")
        builder.add_edge("process", END)

        return builder.compile()

    async def generate_email_content(self, prompt: str, leads_context: Optional[List[dict]] = None, personalize: bool = True) -> str:
        """Standard campaign email generation using Google Gemini with dynamic personalization and reliable fallback."""
        lead_summary = ""
        if leads_context and len(leads_context) > 0:
            samples = []
            for l in leads_context[:5]:
                name = l.get("name") or "Lead"
                comp = l.get("company") or ""
                notes = l.get("notes") or ""
                samples.append(f"- Name: {name}{f', Company: {comp}' if comp else ''}{f', Notes: {notes}' if notes else ''}")
            lead_summary = "\nTarget Lead Profiles/Samples:\n" + "\n".join(samples)

        personalization_guidelines = ""
        if personalize:
            personalization_guidelines = (
                "\nMANDATORY PERSONALIZATION VARIABLES:\n"
                "- In the greeting, use the placeholder `{first_name}` or `{name}` (e.g. 'Hi {first_name},' or 'Dear {name},').\n"
                "- When referring to their company or team, use the placeholder `{company}` (e.g. 'I noticed {company} is scaling...').\n"
                "- Craft the message so it reads like a 1-on-1 personalized email, not a mass blast.\n"
            )

        system_instruction = (
            "You are an expert, professional email marketer and conversion copywriter. "
            "Generate high-converting, personalized cold email outreach. "
            f"{personalization_guidelines}"
            "Output ONLY the plain text of the email. Do NOT include Markdown formatting, code blocks, or HTML."
        )

        user_prompt = f"Create a personalized plain-text email based on this request:\n{prompt}{lead_summary}"

        if self.llm:
            try:
                response = await self.llm.ainvoke([
                    SystemMessage(content=system_instruction),
                    HumanMessage(content=user_prompt)
                ])
                content = self._clean_text(response.content)
                if content:
                    return content
            except Exception as e:
                print(f"[AI Service] Gemini generation notice ({self.model_name}): {e}. Using resilient template generator.")

        # Resilient smart fallback content generation with full personalization tags
        clean_prompt = prompt.replace("\n", " ").strip()
        greeting = "Hi {first_name}," if personalize else "Hi there,"
        company_mention = "at {company}" if personalize else ""

        return (
            f"{greeting}\n\n"
            f"I hope you are having a productive week.\n\n"
            f"I am reaching out regarding {clean_prompt if len(clean_prompt) < 120 else clean_prompt[:120] + '...'}. "
            f"We specialize in helping teams {company_mention} streamline their outreach, maximize response rates, and scale efficiently.\n\n"
            f"Would you be open to a quick 5-minute conversation this Thursday or Friday to explore how this could benefit {'{company}' if personalize else 'your team'}?\n\n"
            f"Best regards,\n"
            f"The Team"
        )

    async def generate_follow_up_content(self, original_subject: str, original_body: str) -> str:
        """Generates a warm, context-aware follow-up email when a lead has not replied."""
        if self.llm:
            try:
                response = await self.llm.ainvoke([
                    SystemMessage(content="You are a professional email marketer. Write a concise, polite follow-up to a previous email. Keep it under 4 sentences. Plain text only, no subject line."),
                    HumanMessage(content=f"Original Subject: {original_subject}\nOriginal Body: {original_body}\n\nPlease generate a warm follow-up.")
                ])
                content = self._clean_text(response.content)
                if content:
                    return content
            except Exception as e:
                print(f"[AI Service] Gemini follow-up notice: {e}. Using resilient fallback.")

        return (
            f"Hi,\n\n"
            f"I just wanted to follow up on my previous note regarding '{original_subject}'. "
            f"I understand you are busy, but I'd love to connect for just a few minutes if you have any questions.\n\n"
            f"Looking forward to hearing from you!"
        )

    async def generate_response_suggestions(self, campaign_subject: str, campaign_body: str) -> List[str]:
        """Generates 3 suggestions for how to handle auto-replies based on campaign content."""
        if self.llm:
            try:
                prompt = (
                    f"Based on this email campaign, suggest 3 short, distinct strategies for an AI auto-responder.\n"
                    f"Subject: {campaign_subject}\n"
                    f"Body: {campaign_body}\n"
                    f"Return EXACTLY 3 bullet points, each on a new line, no extra text."
                )
                response = await self.llm.ainvoke([HumanMessage(content=prompt)])
                lines = self._clean_text(response.content).strip().split("\n")
                cleaned = [l.strip("- *123. ").strip() for l in lines if l.strip()]
                if len(cleaned) >= 3:
                    return cleaned[:3]
            except Exception as e:
                print(f"[AI Service] Gemini suggestions notice: {e}.")

        return [
            "Be warm and schedule a quick 10-min intro call",
            "Address pricing or technical questions directly and offer a product demo",
            "Politely confirm unsubscriptions immediately with no further follow-up"
        ]

    async def process_with_graph(self, email_data: Dict) -> Dict:
        """Invokes the LangGraph for a single incoming email."""
        initial_state: AgentState = {
            "incoming_email": email_data.get("body", ""),
            "sender_name": email_data.get("name", "Prospect"),
            "sender_email": email_data.get("email", ""),
            "subject": email_data.get("subject", "No Subject"),
            "intent": "",
            "reply_body": "",
            "actions_taken": [],
            "status": "pending",
            "instruction": email_data.get("instruction", "")
        }

        final_state = await self.graph.ainvoke(initial_state)
        return final_state


ai_service = AIService()
