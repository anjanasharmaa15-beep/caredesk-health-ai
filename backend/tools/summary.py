"""
Summary tool — Claude writes the structured visit summary (not a template).
"""
import anthropic
from backend.config import ANTHROPIC_API_KEY, CLAUDE_MODEL

_client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)


def generate_visit_summary(
    patient_name: str,
    topics_discussed: list[str],
    outcome: str,
    escalation_count: int = 0,
    practice_type: str = "",
) -> dict:
    prompt = f"""You are a clinical documentation assistant. Based on the following visit data, write a concise, structured visit summary suitable for a clinic's records.

Patient: {patient_name}
Practice type: {practice_type}
Topics discussed: {', '.join(topics_discussed)}
Outcome: {outcome}
Escalations during session: {escalation_count}

Write the summary in this exact JSON structure:
{{
  "chief_complaint": "one sentence",
  "topics_covered": ["list", "of", "topics"],
  "outcome": "what was resolved or next step",
  "escalation_note": "describe escalation if any, else null",
  "recommended_followup": "what staff should do next",
  "risk_level": "low | medium | high"
}}

Return only valid JSON, no markdown."""

    try:
        response = _client.messages.create(
            model=CLAUDE_MODEL,
            max_tokens=512,
            messages=[{"role": "user", "content": prompt}],
        )
        import json
        text = response.content[0].text.strip()
        return {"status": "generated", "summary": json.loads(text)}
    except Exception as e:
        return {
            "status": "fallback",
            "summary": {
                "chief_complaint": outcome,
                "topics_covered": topics_discussed,
                "outcome": outcome,
                "escalation_note": f"{escalation_count} escalation(s)" if escalation_count else None,
                "recommended_followup": "Staff to review session transcript.",
                "risk_level": "medium" if escalation_count > 0 else "low",
            },
            "error": str(e),
        }
