"""
CareDesk FastAPI server
Run: uvicorn backend.main:app --reload --port 8000
"""
import uuid
from datetime import datetime
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel

from backend.agent import run_agent

app = FastAPI(title="CareDesk API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── In-memory session store (swap for Redis/DB in production) ─────────────────

sessions: dict[str, dict] = {}


# ── Schemas ───────────────────────────────────────────────────────────────────

class StartSessionRequest(BaseModel):
    first_name: str
    last_name: Optional[str] = ""
    patient_type: str  # new | returning | caregiver
    practice_type: str  # dental | gp | physio | pediatric
    reason: str
    note: Optional[str] = ""


class ChatRequest(BaseModel):
    session_id: str
    message: str


class SummaryRequest(BaseModel):
    session_id: str


# ── Routes ────────────────────────────────────────────────────────────────────

@app.post("/session/start")
def start_session(req: StartSessionRequest):
    session_id = str(uuid.uuid4())[:8]
    patient_name = f"{req.first_name} {req.last_name}".strip()

    # First user message pre-populated from intake form
    first_user_msg = (
        f"My name is {patient_name}. I am a {req.patient_type} patient. "
        f"My main reason for contacting you today is: {req.reason}."
        + (f" Additional context: {req.note}." if req.note else "")
        + " Please greet me and help me."
    )

    sessions[session_id] = {
        "session_id": session_id,
        "patient_name": patient_name,
        "patient_type": req.patient_type,
        "practice_type": req.practice_type,
        "reason": req.reason,
        "messages": [{"role": "user", "content": first_user_msg}],
        "tool_calls": [],
        "escalations": [],
        "created_at": datetime.now().isoformat(),
    }

    # Run agent for the greeting
    reply, updated_messages = run_agent(
        messages=sessions[session_id]["messages"],
        practice_type=req.practice_type,
        session_id=session_id,
        tool_calls_log=sessions[session_id]["tool_calls"],
    )
    sessions[session_id]["messages"] = updated_messages
    _sync_escalations(session_id)

    return {
        "session_id": session_id,
        "reply": reply,
        "practice_type": req.practice_type,
        "escalations": sessions[session_id]["escalations"],
    }


@app.post("/chat")
def chat(req: ChatRequest):
    session = sessions.get(req.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    session["messages"].append({"role": "user", "content": req.message})

    reply, updated_messages = run_agent(
        messages=session["messages"],
        practice_type=session["practice_type"],
        session_id=req.session_id,
        tool_calls_log=session["tool_calls"],
    )
    session["messages"] = updated_messages
    _sync_escalations(req.session_id)

    return {
        "reply": reply,
        "escalations": session["escalations"],
        "tool_calls": session["tool_calls"][-3:],  # last 3 for UI display
    }


@app.get("/session/{session_id}/summary")
def get_summary(session_id: str):
    session = sessions.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return {
        "patient_name": session["patient_name"],
        "patient_type": session["patient_type"],
        "practice_type": session["practice_type"],
        "reason": session["reason"],
        "message_count": sum(1 for m in session["messages"] if m["role"] == "user"),
        "escalations": session["escalations"],
        "tool_calls": session["tool_calls"],
        "created_at": session["created_at"],
    }


@app.get("/health")
def health():
    return {"status": "ok", "sessions": len(sessions)}


# ── Helper ────────────────────────────────────────────────────────────────────

def _sync_escalations(session_id: str):
    """Extract escalation tool calls into the session's escalation list."""
    session = sessions[session_id]
    esc_calls = [
        tc for tc in session["tool_calls"]
        if tc["tool"] == "escalate_to_staff"
    ]
    session["escalations"] = [
        {
            "reason": tc["input"].get("reason", ""),
            "urgency": tc["input"].get("urgency", "low"),
            "patient_name": tc["input"].get("patient_name", session["patient_name"]),
            "summary": tc["input"].get("summary", ""),
        }
        for tc in esc_calls
    ]


# ── Serve frontend ────────────────────────────────────────────────────────────

app.mount("/static", StaticFiles(directory="frontend"), name="static")

@app.get("/")
def serve_frontend():
    return FileResponse("frontend/index.html")
