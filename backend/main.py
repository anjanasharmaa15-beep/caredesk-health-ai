"""
CareDesk FastAPI server
Run: uvicorn backend.main:app --reload --port 8000
"""
import uuid
import traceback
import logging
from typing import Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

from backend.agent import run_agent, run_triage_agent
from backend import database as db

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="CareDesk API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error("Unhandled exception: %s\n%s", exc, traceback.format_exc())
    return JSONResponse(status_code=500, content={"detail": str(exc), "type": type(exc).__name__})

@app.on_event("startup")
def startup():
    db.init_db()
    logger.info("CareDesk DB initialised")


# ── Schemas ───────────────────────────────────────────────────────────────────

class StartSessionRequest(BaseModel):
    first_name: str
    last_name: Optional[str] = ""
    patient_type: str
    practice_type: str
    reason: str
    note: Optional[str] = ""

class StartTriageRequest(BaseModel):
    first_name: str
    last_name: Optional[str] = ""
    age: str
    sex: str
    chief_complaint: str

class ChatRequest(BaseModel):
    session_id: str
    message: str


# ── Front Desk Routes ─────────────────────────────────────────────────────────

@app.post("/session/start")
def start_session(req: StartSessionRequest):
    session_id = str(uuid.uuid4())[:8]
    patient_name = f"{req.first_name} {req.last_name}".strip()

    patient_type_label = {
        "new":       "a NEW patient (never visited before)",
        "returning": "a RETURNING patient (have visited before)",
        "caregiver": "a CAREGIVER or parent acting on behalf of a patient",
    }.get(req.patient_type, req.patient_type)

    first_msg = (
        f"My name is {patient_name}. I am {patient_type_label}. "
        f"My main reason for contacting you today is: {req.reason}."
        + (f" Additional context: {req.note}." if req.note else "")
        + " Please greet me appropriately and help me."
    )

    db.create_session(session_id, patient_name, req.patient_type, req.practice_type, req.reason, mode="frontdesk")
    db.save_message(session_id, "user", first_msg)

    messages = db.load_messages(session_id)
    tool_log: list = []

    reply, updated = run_agent(
        messages=messages,
        practice_type=req.practice_type,
        session_id=session_id,
        tool_calls_log=tool_log,
    )

    _persist_messages(session_id, messages, updated)
    _persist_tool_calls(session_id, tool_log)
    escalations = db.load_escalations(session_id)

    return {"session_id": session_id, "reply": reply, "practice_type": req.practice_type, "escalations": escalations}


@app.post("/chat")
def chat(req: ChatRequest):
    session = db.get_session(req.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    db.save_message(req.session_id, "user", req.message)
    messages = db.load_messages(req.session_id)
    tool_log: list = []

    runner = run_triage_agent if session["mode"] == "triage" else run_agent

    reply, updated = runner(
        messages=messages,
        practice_type=session["practice_type"],
        session_id=req.session_id,
        tool_calls_log=tool_log,
    )

    _persist_messages(req.session_id, messages, updated)
    _persist_tool_calls(req.session_id, tool_log)
    tool_calls = db.load_tool_calls(req.session_id)
    escalations = db.load_escalations(req.session_id)

    return {"reply": reply, "escalations": escalations, "tool_calls": tool_calls[-3:]}


# ── Triage Routes ─────────────────────────────────────────────────────────────

@app.post("/triage/start")
def start_triage(req: StartTriageRequest):
    session_id = str(uuid.uuid4())[:8]
    patient_name = f"{req.first_name} {req.last_name}".strip()

    first_msg = (
        f"My name is {patient_name}. I am {req.age} years old, biological sex: {req.sex}. "
        f"My main concern today is: {req.chief_complaint}. "
        "Please begin the consultation."
    )

    db.create_session(session_id, patient_name, "patient", "gp", req.chief_complaint, mode="triage")
    db.save_message(session_id, "user", first_msg)

    messages = db.load_messages(session_id)
    tool_log: list = []

    reply, updated = run_triage_agent(
        messages=messages,
        practice_type="gp",
        session_id=session_id,
        tool_calls_log=tool_log,
    )

    _persist_messages(session_id, messages, updated)
    _persist_tool_calls(session_id, tool_log)
    escalations = db.load_escalations(session_id)

    return {"session_id": session_id, "reply": reply, "escalations": escalations}


# ── Summary ───────────────────────────────────────────────────────────────────

@app.get("/session/{session_id}/summary")
def get_summary(session_id: str):
    session = db.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    messages = db.load_messages(session_id)
    tool_calls = db.load_tool_calls(session_id)
    escalations = db.load_escalations(session_id)
    return {
        **session,
        "message_count": sum(1 for m in messages if m["role"] == "user"),
        "escalations": escalations,
        "tool_calls": tool_calls,
    }


@app.get("/health")
def health():
    conn = db._conn()
    count = conn.execute("SELECT COUNT(*) FROM sessions").fetchone()[0]
    conn.close()
    return {"status": "ok", "total_sessions": count}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _persist_messages(session_id: str, before: list, after: list):
    """Save only the new messages added by the agent loop."""
    new_msgs = after[len(before):]
    for m in new_msgs:
        db.save_message(session_id, m["role"], m["content"])


def _persist_tool_calls(session_id: str, tool_log: list):
    for tc in tool_log:
        db.save_tool_call(session_id, tc["tool"], tc.get("input", {}), tc.get("result", ""))
        if tc["tool"] == "escalate_to_staff":
            inp = tc.get("input", {})
            db.save_escalation(
                session_id,
                inp.get("patient_name", ""),
                inp.get("reason", ""),
                inp.get("urgency", "low"),
                inp.get("summary", ""),
            )


# ── Serve frontend ────────────────────────────────────────────────────────────

app.mount("/static", StaticFiles(directory="frontend"), name="static")

@app.get("/")
def serve_frontend():
    return FileResponse("frontend/index.html")
