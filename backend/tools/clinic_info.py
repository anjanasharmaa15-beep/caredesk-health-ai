import json
from pathlib import Path

_DATA = json.loads((Path(__file__).parent.parent.parent / "data" / "clinics.json").read_text(encoding="utf-8"))


def get_clinic_info(practice_type: str, info_type: str = "all") -> dict:
    """Return clinic information for the given practice type and info category."""
    clinic = _DATA.get(practice_type)
    if not clinic:
        return {"error": f"Unknown practice type: {practice_type}"}

    if info_type == "hours":
        return {"hours": clinic["hours"], "name": clinic["name"]}
    if info_type == "services":
        return {"services": clinic["services"], "name": clinic["name"]}
    if info_type == "location":
        return {"location": clinic["location"], "phone": clinic["phone"], "email": clinic["email"]}
    if info_type == "faq":
        return {"faq": clinic["faq"], "name": clinic["name"]}
    if info_type == "insurance":
        return {"insurance": clinic["insurance"]}
    if info_type == "new_patient":
        return {"new_patient": clinic["new_patient"]}

    # "all" — return everything
    return clinic
