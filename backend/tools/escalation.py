"""
Escalation tool — logs to session and optionally sends email via Resend.
"""
import httpx
from datetime import datetime
from backend.config import RESEND_ENABLED, RESEND_API_KEY, CLINIC_EMAIL


def escalate_to_staff(
    reason: str,
    urgency: str,
    patient_name: str = "Unknown",
    summary: str = "",
    session_id: str = "",
) -> dict:
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    record = {
        "timestamp": timestamp,
        "session_id": session_id,
        "patient_name": patient_name,
        "urgency": urgency,
        "reason": reason,
        "summary": summary,
    }

    email_sent = False
    if RESEND_ENABLED and urgency in ("high", "emergency"):
        email_sent = _send_resend_email(record)

    return {
        "logged": True,
        "timestamp": timestamp,
        "urgency": urgency,
        "email_sent": email_sent,
        "message": _escalation_message(urgency),
    }


def _escalation_message(urgency: str) -> str:
    msgs = {
        "low": "Your question has been flagged for staff review. They will follow up with you.",
        "medium": "A staff member has been alerted and will contact you shortly.",
        "high": "This has been marked as high priority. A staff member will reach out very soon.",
        "emergency": "If this is a medical emergency, please call 911 or go to your nearest ER immediately.",
    }
    return msgs.get(urgency, "Your request has been escalated to our team.")


def _send_resend_email(record: dict) -> bool:
    subject = f"[CareDesk {record['urgency'].upper()}] Escalation — {record['patient_name']}"
    body = (
        f"Patient: {record['patient_name']}\n"
        f"Urgency: {record['urgency']}\n"
        f"Time: {record['timestamp']}\n"
        f"Reason: {record['reason']}\n\n"
        f"Summary:\n{record['summary']}"
    )
    try:
        resp = httpx.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {RESEND_API_KEY}"},
            json={
                "from": "CareDesk <noreply@caredesk.ai>",
                "to": [CLINIC_EMAIL],
                "subject": subject,
                "text": body,
            },
            timeout=8,
        )
        return resp.status_code == 200
    except Exception:
        return False
