from fastapi.middleware.cors import CORSMiddleware
from fastapi import FastAPI
from pydantic import BaseModel
from typing import List, Optional

app = FastAPI(
    title="VoxDiff Backend",
    description="Voice-first conversational orchestration backend",
    version="0.1.0",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # allow all for local dev
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# -------------------------
# Request / Response Models
# -------------------------

class ChatRequest(BaseModel):
    message: str
    selected_code: Optional[str] = None
    history: Optional[List[dict]] = []


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
    This is the core orchestration endpoint.

    For now:
    - It does NOT call Gemini
    - It does NOT modify code
    - It returns a structured, hardcoded response

    Later:
    - This is where you add reasoning, planning, and delegation
    """

    # If no code is selected, ask user to select code
    if not request.selected_code or request.selected_code.strip() == "":
        return ChatResponse(
            assistant_text="Please select some code in the editor so I can help you.",
            speak_text="Please select some code in the editor so I can help you.",
            needs_clarification=True,
            clarifying_question="Can you select the code you want to work on?",
            proposed_patch=None,
            apply_label=None,
        )

    # Very simple placeholder logic
    # (Later this becomes Gemini-driven reasoning)
    return ChatResponse(
        assistant_text=(
            "I can help refactor this code. "
            "Tell me what you want to do, for example: "
            "'add error handling' or 'improve readability'."
        ),
        speak_text=(
            "I can help refactor this code. "
            "Tell me what you want to do."
        ),
        needs_clarification=True,
        clarifying_question="What would you like me to change in this code?",
        proposed_patch=None,
        apply_label=None,
    )
