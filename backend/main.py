from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import List, Optional
import os
import json
from dotenv import load_dotenv
import google.generativeai as genai

# -------------------------
# App Setup
# -------------------------

load_dotenv()

app = FastAPI(
    title="VoxDiff Backend",
    description="Voice-first conversational orchestration backend",
    version="0.3.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# -------------------------
# Gemini Setup
# -------------------------

GEMINI_KEY = os.getenv("GEMINI_API_KEY")
if not GEMINI_KEY:
    raise RuntimeError("GEMINI_API_KEY not set")

genai.configure(api_key=GEMINI_KEY)

model = genai.GenerativeModel(
    model_name="gemini-2.0-flash",
    generation_config={
        "temperature": 0.2,
        "response_mime_type": "application/json",
    },
)

# -------------------------
# Models
# -------------------------

class ChatRequest(BaseModel):
    message: str
    selected_code: Optional[str] = None
    history: List[dict] = Field(default_factory=list)


class ProposedPatch(BaseModel):
    type: str
    new_code: str


class ChatResponse(BaseModel):
    assistant_text: str
    speak_text: str
    needs_clarification: bool
    clarifying_question: Optional[str] = None
    proposed_patch: Optional[ProposedPatch] = None
    apply_label: Optional[str] = None

# -------------------------
# Helpers
# -------------------------

def safe_parse_json(text: str) -> dict | None:
    """
    Best-effort JSON extraction.
    Never throws.
    """
    try:
        text = text.strip()

        if text.startswith("```"):
            text = text.split("\n", 1)[1]
            text = text.rsplit("```", 1)[0]

        start = text.find("{")
        end = text.rfind("}")
        if start == -1 or end == -1:
            return None

        return json.loads(text[start:end + 1])
    except Exception:
        return None

# -------------------------
# Health
# -------------------------

@app.get("/health")
def health():
    return {"status": "ok"}

# -------------------------
# Chat Endpoint
# -------------------------

@app.post("/chat", response_model=ChatResponse)
def chat(request: ChatRequest):

    if not request.selected_code or not request.selected_code.strip():
        return ChatResponse(
            assistant_text="Please select some code in the editor so I can help you.",
            speak_text="Please select some code in the editor so I can help you.",
            needs_clarification=True,
            clarifying_question="Select code to continue.",
        )

    prompt = f"""
You are VoxDiff, a strict JSON API.

Respond ONLY with valid JSON.
Do NOT include explanations outside JSON.

Schema:
{{
  "explanation": string,
  "improved_code": string | null
}}

Rules:
- If code must change → return FULL rewritten code
- If no change → improved_code = null

User request:
{request.message}

Selected code:
{request.selected_code}
"""

    try:
        response = model.generate_content(prompt)
        text = response.text or ""

        data = safe_parse_json(text)

        # ❗ Fallback if Gemini ignores instructions
        if not data:
            return ChatResponse(
                assistant_text=text.strip() or "I could not parse the response.",
                speak_text=text.strip() or "I could not parse the response.",
                needs_clarification=False,
            )

        explanation = data.get("explanation", "").strip()
        improved_code = data.get("improved_code")

        if improved_code is None:
            return ChatResponse(
                assistant_text=explanation or "Code is already clean.",
                speak_text=explanation or "Code is already clean.",
                needs_clarification=False,
            )

        return ChatResponse(
            assistant_text=explanation or "Code updated.",
            speak_text=explanation or "Code updated.",
            needs_clarification=False,
            proposed_patch=ProposedPatch(
                type="replace_selection",
                new_code=improved_code.rstrip() + "\n",
            ),
            apply_label="Apply patch",
        )

    except Exception as e:
        return ChatResponse(
            assistant_text=f"Backend error: {str(e)}",
            speak_text="There was a backend error.",
            needs_clarification=False,
        )
