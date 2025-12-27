from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
import os
from dotenv import load_dotenv
import google.generativeai as genai
from pydantic import Field

# -------------------------
# App Setup
# -------------------------

load_dotenv()

app = FastAPI(
    title="VoxDiff Backend",
    description="Voice-first conversational orchestration backend",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # OK for local dev
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# -------------------------
# Gemini Setup (FREE)
# -------------------------

genai.configure(api_key=os.getenv("GEMINI_API_KEY"))

model = genai.GenerativeModel("gemini-2.0-flash")

for m in genai.list_models():
    print(m.name)


# -------------------------
# Request / Response Models
# -------------------------

class ChatRequest(BaseModel):
    message: str
    selected_code: Optional[str] = None
    history: List[dict] = Field(default_factory=list)


class ProposedPatch(BaseModel):
    type: str  # e.g. "replace_selection"
    new_code: str


class ChatResponse(BaseModel):
    assistant_text: str
    speak_text: str
    needs_clarification: bool
    clarifying_question: Optional[str] = None
    proposed_patch: Optional[ProposedPatch] = None
    apply_label: Optional[str] = None


# -------------------------
# Health Check
# -------------------------

@app.get("/health")
def health():
    return {"status": "ok"}


# -------------------------
# Chat Endpoint (CORE)
# -------------------------

@app.post("/chat", response_model=ChatResponse)
def chat(request: ChatRequest):
    """
    Core orchestration endpoint.
    Uses Gemini (free) to reason over selected code.
    """

    # No code selected
    if not request.selected_code or request.selected_code.strip() == "":
        return ChatResponse(
            assistant_text="Please select some code in the editor so I can help you.",
            speak_text="Please select some code in the editor so I can help you.",
            needs_clarification=True,
            clarifying_question="Can you select the code you want to work on?",
            proposed_patch=None,
            apply_label=None,
        )

    prompt = f"""
You are an expert software engineer.

User request:
{request.message}

Selected code:
{request.selected_code}

Respond clearly and helpfully.
If refactoring makes sense, show improved code.
"""

    try:
        response = model.generate_content(prompt)
        text = response.text.strip()

        return ChatResponse(
            assistant_text=text,
            speak_text=text,
            needs_clarification=False,
            clarifying_question=None,
            proposed_patch=None,
            apply_label=None,
        )

    except Exception as e:
        return ChatResponse(
            assistant_text=f"Error from AI model: {str(e)}",
            speak_text="There was an error contacting the AI model.",
            needs_clarification=False,
            clarifying_question=None,
            proposed_patch=None,
            apply_label=None,
        )
    

