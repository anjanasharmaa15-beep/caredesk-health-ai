"""
SQLite session storage for CareDesk.
Replaces the in-memory dict — survives server restarts.
"""
import sqlite3
import json
from pathlib import Path
from datetime import datetime

DB_PATH = Path(__file__).parent.parent / "caredesk.db"


def _conn():
    conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    """Create tables if they don't exist. Called on startup."""
    conn = _conn()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS sessions (
            id          TEXT PRIMARY KEY,
            patient_name TEXT NOT NULL,
            patient_type TEXT,
            practice_type TEXT,
            reason      TEXT,
            mode        TEXT DEFAULT 'frontdesk',
            created_at  TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS messages (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id  TEXT NOT NULL,
            role        TEXT NOT NULL,
            content     TEXT NOT NULL,
            created_at  TEXT NOT NULL,
            FOREIGN KEY (session_id) REFERENCES sessions(id)
        );

        CREATE TABLE IF NOT EXISTS tool_calls (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id  TEXT NOT NULL,
            tool        TEXT NOT NULL,
            input_json  TEXT,
            result_json TEXT,
            created_at  TEXT NOT NULL,
            FOREIGN KEY (session_id) REFERENCES sessions(id)
        );

        CREATE TABLE IF NOT EXISTS escalations (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id  TEXT NOT NULL,
            patient_name TEXT,
            reason      TEXT,
            urgency     TEXT,
            summary     TEXT,
            created_at  TEXT NOT NULL,
            FOREIGN KEY (session_id) REFERENCES sessions(id)
        );
    """)
    conn.commit()
    conn.close()


# ── Session ───────────────────────────────────────────────────────────────────

def create_session(session_id: str, patient_name: str, patient_type: str,
                   practice_type: str, reason: str, mode: str = "frontdesk"):
    conn = _conn()
    conn.execute(
        "INSERT INTO sessions (id, patient_name, patient_type, practice_type, reason, mode, created_at) VALUES (?,?,?,?,?,?,?)",
        (session_id, patient_name, patient_type, practice_type, reason, mode, _now())
    )
    conn.commit()
    conn.close()


def get_session(session_id: str) -> dict | None:
    conn = _conn()
    row = conn.execute("SELECT * FROM sessions WHERE id=?", (session_id,)).fetchone()
    conn.close()
    return dict(row) if row else None


# ── Messages ──────────────────────────────────────────────────────────────────

def save_message(session_id: str, role: str, content):
    """Content can be a string or a list (tool_use / tool_result blocks)."""
    conn = _conn()
    conn.execute(
        "INSERT INTO messages (session_id, role, content, created_at) VALUES (?,?,?,?)",
        (session_id, role, _serialize(content), _now())
    )
    conn.commit()
    conn.close()


def load_messages(session_id: str) -> list[dict]:
    conn = _conn()
    rows = conn.execute(
        "SELECT role, content FROM messages WHERE session_id=? ORDER BY id",
        (session_id,)
    ).fetchall()
    conn.close()
    return [{"role": r["role"], "content": _deserialize(r["content"])} for r in rows]


# ── Tool calls ────────────────────────────────────────────────────────────────

def save_tool_call(session_id: str, tool: str, input_data: dict, result: str):
    conn = _conn()
    conn.execute(
        "INSERT INTO tool_calls (session_id, tool, input_json, result_json, created_at) VALUES (?,?,?,?,?)",
        (session_id, tool, json.dumps(input_data), result, _now())
    )
    conn.commit()
    conn.close()


def load_tool_calls(session_id: str) -> list[dict]:
    conn = _conn()
    rows = conn.execute(
        "SELECT tool, input_json, result_json FROM tool_calls WHERE session_id=? ORDER BY id",
        (session_id,)
    ).fetchall()
    conn.close()
    return [{"tool": r["tool"], "input": json.loads(r["input_json"] or "{}"), "result": r["result_json"]} for r in rows]


# ── Escalations ───────────────────────────────────────────────────────────────

def save_escalation(session_id: str, patient_name: str, reason: str, urgency: str, summary: str):
    conn = _conn()
    conn.execute(
        "INSERT INTO escalations (session_id, patient_name, reason, urgency, summary, created_at) VALUES (?,?,?,?,?,?)",
        (session_id, patient_name, reason, urgency, summary, _now())
    )
    conn.commit()
    conn.close()


def load_escalations(session_id: str) -> list[dict]:
    conn = _conn()
    rows = conn.execute(
        "SELECT patient_name, reason, urgency, summary FROM escalations WHERE session_id=? ORDER BY id",
        (session_id,)
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


# ── Helpers ───────────────────────────────────────────────────────────────────

def _now() -> str:
    return datetime.now().isoformat()


def _serialize(content) -> str:
    if isinstance(content, str):
        return json.dumps({"type": "text", "value": content})
    return json.dumps({"type": "blocks", "value": _blocks_to_json(content)})


def _deserialize(raw: str):
    data = json.loads(raw)
    if data["type"] == "text":
        return data["value"]
    return _json_to_blocks(data["value"])


def _blocks_to_json(blocks) -> list:
    """Convert Anthropic content blocks to serializable dicts."""
    result = []
    for b in blocks:
        if hasattr(b, "type"):
            result.append({"_block_type": b.type, **{k: v for k, v in vars(b).items() if not k.startswith("_")}})
        else:
            result.append(b)
    return result


def _json_to_blocks(blocks: list) -> list:
    """Restore serialized blocks — returns plain dicts (Anthropic SDK accepts these)."""
    return blocks
