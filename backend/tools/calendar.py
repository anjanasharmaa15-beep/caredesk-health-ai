"""
Calendar tool — real Cal.com integration when configured, mock otherwise.
Cal.com docs: https://cal.com/docs/api-reference/v2
"""
import httpx
from datetime import datetime, timedelta, timezone
from backend.config import CAL_ENABLED, CAL_API_KEY, CAL_EVENT_TYPE_ID, CAL_USERNAME


# ── Helpers ──────────────────────────────────────────────────────────────────

CAL_BASE = "https://api.cal.com/v2"
HEADERS = {"Authorization": f"Bearer {CAL_API_KEY}", "cal-api-version": "2024-08-13"}


def _parse_date(date_str: str) -> datetime:
    if date_str == "next_available":
        return datetime.now(timezone.utc) + timedelta(hours=1)
    try:
        return datetime.fromisoformat(date_str).replace(tzinfo=timezone.utc)
    except ValueError:
        return datetime.now(timezone.utc) + timedelta(days=1)


# ── Mock implementations (no Cal.com account needed) ─────────────────────────

def _mock_availability(date_str: str, practice_type: str) -> dict:
    base = _parse_date(date_str)
    slots = []
    for h in [9, 10, 11, 14, 15, 16]:
        slot_time = base.replace(hour=h, minute=0, second=0, microsecond=0)
        slots.append({
            "time": slot_time.strftime("%Y-%m-%d %H:%M"),
            "display": slot_time.strftime("%A, %B %d at %I:%M %p").replace(" 0", " "),
            "available": True,
        })
    return {
        "source": "mock",
        "date_requested": date_str,
        "practice_type": practice_type,
        "slots": slots,
        "note": "Cal.com not configured — showing demo slots.",
    }


def _mock_booking(patient_name: str, patient_email: str, date: str,
                  time: str, reason: str, practice_type: str) -> dict:
    return {
        "source": "mock",
        "status": "confirmed",
        "booking_id": f"MOCK-{datetime.now().strftime('%Y%m%d%H%M%S')}",
        "patient_name": patient_name,
        "date": date,
        "time": time,
        "reason": reason,
        "practice_type": practice_type,
        "confirmation_note": "Demo booking confirmed (Cal.com not connected).",
    }


# ── Real Cal.com implementations ──────────────────────────────────────────────

def _cal_availability(date_str: str, practice_type: str) -> dict:
    start = _parse_date(date_str)
    end = start + timedelta(days=1)

    try:
        resp = httpx.get(
            f"{CAL_BASE}/slots/available",
            headers=HEADERS,
            params={
                "startTime": start.isoformat(),
                "endTime": end.isoformat(),
                "eventTypeId": CAL_EVENT_TYPE_ID,
                "timeZone": "America/Chicago",
            },
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
        raw_slots = data.get("data", {}).get("slots", {})

        slots = []
        for day_slots in raw_slots.values():
            for s in day_slots:
                dt = datetime.fromisoformat(s["time"].replace("Z", "+00:00"))
                slots.append({
                    "time": dt.strftime("%Y-%m-%d %H:%M"),
                    "display": dt.strftime("%A, %B %d at %I:%M %p").replace(" 0", " "),
                    "available": True,
                })

        return {"source": "cal.com", "slots": slots, "practice_type": practice_type}

    except Exception as e:
        return {"error": str(e), "fallback": _mock_availability(date_str, practice_type)}


def _cal_booking(patient_name: str, patient_email: str, date: str,
                 time: str, reason: str, practice_type: str) -> dict:
    start_iso = f"{date}T{time}:00+00:00"
    try:
        resp = httpx.post(
            f"{CAL_BASE}/bookings",
            headers=HEADERS,
            json={
                "eventTypeId": CAL_EVENT_TYPE_ID,
                "start": start_iso,
                "attendee": {
                    "name": patient_name,
                    "email": patient_email or "noemail@caredesk.ai",
                    "timeZone": "America/Chicago",
                    "language": "en",
                },
                "metadata": {"reason": reason, "practice_type": practice_type},
            },
            timeout=10,
        )
        resp.raise_for_status()
        booking = resp.json().get("data", {})
        return {
            "source": "cal.com",
            "status": "confirmed",
            "booking_id": booking.get("uid", "unknown"),
            "patient_name": patient_name,
            "date": date,
            "time": time,
            "reason": reason,
        }
    except Exception as e:
        return {"error": str(e)}


# ── Public API ────────────────────────────────────────────────────────────────

def check_availability(date: str, practice_type: str) -> dict:
    if CAL_ENABLED:
        return _cal_availability(date, practice_type)
    return _mock_availability(date, practice_type)


def book_appointment(patient_name: str, date: str, time: str,
                     reason: str, practice_type: str,
                     patient_email: str = "") -> dict:
    if CAL_ENABLED:
        return _cal_booking(patient_name, patient_email, date, time, reason, practice_type)
    return _mock_booking(patient_name, patient_email, date, time, reason, practice_type)
