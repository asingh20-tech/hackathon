from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import List, Optional
import os
import json
import base64
import requests
from dotenv import load_dotenv
import google.generativeai as genai
import whisper
import ssl
import urllib.request

# -------------------------
# ENV
# -------------------------
# Load from .env file in the same directory as this script
from pathlib import Path
env_path = Path(__file__).parent / '.env'
load_dotenv(dotenv_path=env_path)

GEMINI_KEY = os.getenv("GEMINI_API_KEY")
ELEVEN_KEY = os.getenv("ELEVENLABS_API_KEY")
ELEVEN_VOICE = os.getenv("ELEVENLABS_VOICE_ID", "EXAVITQu4vr4xnSDxMaL")

if not GEMINI_KEY:
    raise RuntimeError("GEMINI_API_KEY not set")
if not ELEVEN_KEY:
    raise RuntimeError("ELEVENLABS_API_KEY not set")

# Fix SSL certificate verification on macOS for Whisper model download
try:
    _create_unverified_https_context = ssl._create_unverified_context
except AttributeError:
    pass
else:
    ssl._create_default_https_context = _create_unverified_https_context

# Load Whisper model lazily (on first use)
whisper_model = None

def get_whisper_model():
    global whisper_model
    if whisper_model is None:
        print("Loading Whisper model... (first use only)")
        whisper_model = whisper.load_model("small")  # Better accuracy than 'base'
    return whisper_model

# -------------------------
# APP
# -------------------------
app = FastAPI(
    title="VoxDiff Backend",
    description="Voice-first code editing backend",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# -------------------------
# GEMINI
# -------------------------
genai.configure(api_key=GEMINI_KEY)

model = genai.GenerativeModel(
    model_name="gemini-2.0-flash",
    generation_config={
        "temperature": 0.2,
        "response_mime_type": "application/json",
    },
)

# -------------------------
# MODELS
# -------------------------
class ChatRequest(BaseModel):
    message: str
    selected_code: str
    history: List[dict] = Field(default_factory=list)

class ChatResponse(BaseModel):
    assistant_text: str
    speak_text: str
    modified_code: Optional[str] = None
    audio_base64: Optional[str] = None
    audio_mime: Optional[str] = None

class VoiceRequest(BaseModel):
    audioBase64: str

# -------------------------
# HELPERS
# -------------------------
def safe_parse_json(text: str) -> Optional[dict]:
    try:
        start = text.find("{")
        end = text.rfind("}")
        if start == -1 or end == -1:
            return None
        return json.loads(text[start:end + 1])
    except Exception:
        return None

def eleven_tts(text: str) -> tuple[str, str]:
    """Try ElevenLabs first, fallback to gTTS if no credits"""
    try:
        url = f"https://api.elevenlabs.io/v1/text-to-speech/{ELEVEN_VOICE}"
        headers = {
            "xi-api-key": ELEVEN_KEY,
            "Content-Type": "application/json",
            "Accept": "audio/mpeg",
        }
        payload = {
            "text": text,
            "model_id": "eleven_multilingual_v2",
            "voice_settings": {
                "stability": 0.4,
                "similarity_boost": 0.8,
            },
        }

        r = requests.post(url, headers=headers, json=payload, timeout=30)
        
        if r.status_code == 200:
            return (
                base64.b64encode(r.content).decode("utf-8"),
                "audio/mpeg",
            )
        elif r.status_code == 401:
            print(f"ElevenLabs: {r.json()}")
            # Try free Google TTS fallback
            return google_tts(text)
        else:
            print(f"TTS Error: Status {r.status_code}: {r.text}")
            return google_tts(text)
            
    except Exception as e:
        print(f"TTS Exception: {str(e)}")
        return google_tts(text)

def google_tts(text: str) -> tuple[str, str]:
    """Free text-to-speech using gTTS"""
    try:
        from gtts import gTTS
        import tempfile
        
        # Create speech
        tts = gTTS(text=text, lang='en', slow=False)
        
        # Save to temp file and read
        with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as f:
            tts.save(f.name)
            with open(f.name, 'rb') as audio_file:
                audio_data = audio_file.read()
            os.unlink(f.name)
        
        return (
            base64.b64encode(audio_data).decode("utf-8"),
            "audio/mpeg",
        )
    except Exception as e:
        print(f"gTTS Error: {str(e)}")
        return ("", "audio/mpeg")

def transcribe_audio(audio_base64: str) -> str:
    """Use local Whisper for free speech-to-text"""
    import tempfile
    
    try:
        # Decode base64 audio
        audio_bytes = base64.b64decode(audio_base64)
        
        # Write to temp file (Whisper needs a file path)
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            f.write(audio_bytes)
            temp_path = f.name
        
        # Get model (lazy load on first call)
        model = get_whisper_model()
        
        # Transcribe with Whisper
        result = model.transcribe(temp_path, language="en")
        
        # Clean up
        os.unlink(temp_path)
        
        return result["text"]
    
    except Exception as e:
        raise RuntimeError(f"Whisper transcription failed: {str(e)}")

# -------------------------
# HEALTH
# -------------------------
@app.get("/health")
def health():
    return {"status": "ok"}

# -------------------------
# SPEECH → TEXT
# -------------------------
@app.post("/stt")
def stt(req: VoiceRequest):
    text = transcribe_audio(req.audioBase64)
    return {"text": text}

# -------------------------
# CHAT
# -------------------------
@app.post("/chat", response_model=ChatResponse)
def chat(req: ChatRequest):

    if not req.selected_code.strip():
        audio_b64, mime = eleven_tts("Please select code first.")
        return ChatResponse(
            assistant_text="Please select code first.",
            speak_text="Please select code first.",
            audio_base64=audio_b64,
            audio_mime=mime,
        )

    prompt = f"""
You are VoxDiff.

Return ONLY valid JSON.

Schema:
{{
  "explanation": string,
  "improved_code": string | null
}}

Rules:
- If code must change → rewrite FULL selected code
- If no change → improved_code = null

User request:
{req.message}

Selected code:
{req.selected_code}
"""

    response = model.generate_content(prompt)
    data = safe_parse_json(response.text or "")

    if not data:
        audio_b64, mime = eleven_tts("I could not understand the request.")
        return ChatResponse(
            assistant_text="I could not understand the request.",
            speak_text="I could not understand the request.",
            audio_base64=audio_b64,
            audio_mime=mime,
        )

    explanation = data.get("explanation", "")
    improved = data.get("improved_code")

    audio_b64, mime = eleven_tts(explanation or "Done.")

    if improved is None:
        return ChatResponse(
            assistant_text=explanation or "No changes needed.",
            speak_text=explanation or "No changes needed.",
            audio_base64=audio_b64,
            audio_mime=mime,
        )

    return ChatResponse(
        assistant_text=explanation or "Patch ready.",
        speak_text=explanation or "Patch ready.",
        modified_code=improved.rstrip() + "\n",
        audio_base64=audio_b64,
        audio_mime=mime,
    )
