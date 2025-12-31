VoxDiff 🎙️🧠

Voice-First Coding Assistant for VS Code

VoxDiff is a voice-driven Visual Studio Code extension that lets developers talk to their code.
You speak what you want to change, VoxDiff understands your intent, updates the code automatically, and replies back with a natural AI voice.

This repository contains the local backend version, designed for fast iteration, reliable Whisper speech recognition, and hackathon demos.

✨ Features

🎤 Speech-to-Text using Whisper (local, offline-capable)

🧠 Code understanding & patch generation using Google Gemini

🔊 Natural voice responses using ElevenLabs

✍️ Automatic code edits (no confirmation click required)

♻️ Undo support

💬 Persistent chat history inside VS Code

⚡ Low-latency, voice-first interaction

🧱 Architecture (Local Backend)
VS Code Extension
    ↓
FastAPI Backend (LOCAL)
    ├─ Whisper (STT)
    ├─ Google Gemini (Code reasoning)
    └─ ElevenLabs (TTS)


⚠️ The backend runs locally by design.
Whisper models are large and require low-latency access, which makes local execution the most reliable option for demos and hackathons.

📦 Requirements
System

macOS / Linux (recommended)

Python 3.9+

Node.js 18+

VS Code 1.85+

API Keys

You will need:

Google Gemini API Key

ElevenLabs API Key

🔐 Environment Variables

Create a .env file inside the backend/ folder:

GEMINI_API_KEY=your_gemini_api_key
ELEVENLABS_API_KEY=your_elevenlabs_api_key
ELEVENLABS_VOICE_ID=EXAVITQu4vr4xnSDxMaL


.env is intentionally not committed to Git.

🚀 Running the Backend (Local)
cd backend
python -m venv .venv
source .venv/bin/activate

pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000


Verify backend is running:

http://localhost:8000/health


Expected response:

{ "status": "ok" }

🧩 Running the VS Code Extension

Open the extension/ folder in VS Code

Press F5 (Run Extension)

A new VS Code window opens (Extension Development Host)

Open any code file

Select some code

Run command:

VoxDiff: Open Panel

🎙️ How to Use VoxDiff

Select code in the editor

Click the 🎤 microphone button

Speak naturally:

“Add a null check here”
“Refactor this into a function”
“Optimize this loop”

VoxDiff:

Transcribes your voice

Understands intent

Applies the code change automatically

Speaks back what it did

No typing required.

♻️ Undo Changes

Use the Undo button inside the VoxDiff panel
or simply press:

Cmd + Z / Ctrl + Z

🧠 Why Local Backend?

We intentionally chose a local backend because:

Whisper models are large and slow to cold-start

Local inference gives instant transcription

No GPU or serverless limits

Perfect for hackathons and live demos

For production, the backend can be moved to a GPU VM.

🔒 Security Notes

API keys are loaded from .env

No code is stored or logged remotely

Audio never leaves your machine except for ElevenLabs TTS requests

🛣️ Roadmap

Continuous voice conversation (no button press)

Streaming audio responses

Multi-file refactors

Voice-only coding sessions

Team-shared voice edits

🏁 Final Note

VoxDiff is not about replacing coding —
it’s about changing how we communicate with code.

With voice as the interface and AI as the collaborator, coding becomes a conversation
