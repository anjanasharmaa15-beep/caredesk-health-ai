"""
CareDesk Agent Loop
Runs Claude with tool use until the model returns end_turn.
"""
import anthropic
from backend.config import ANTHROPIC_API_KEY, CLAUDE_MODEL, MAX_TOKENS
from backend.tools.clinic_info import get_clinic_info
from backend.tools.calendar import check_availability, book_appointment
from backend.tools.escalation import escalate_to_staff
from backend.tools.summary import generate_visit_summary

_client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

# ── Tool definitions sent to Claude ──────────────────────────────────────────

TOOLS = [
    {
        "name": "get_clinic_info",
        "description": "Get clinic hours, services, location, insurance info, or FAQs for a practice type.",
        "input_schema": {
            "type": "object",
            "properties": {
                "practice_type": {
                    "type": "string",
                    "enum": ["dental", "gp", "physio", "pediatric"],
                    "description": "The type of clinic",
                },
                "info_type": {
                    "type": "string",
                    "enum": ["hours", "services", "location", "faq", "insurance", "new_patient", "all"],
                    "description": "What kind of information to retrieve",
                },
            },
            "required": ["practice_type"],
        },
    },
    {
        "name": "check_availability",
        "description": "Check available appointment slots for a given date. Use 'next_available' if no specific date given.",
        "input_schema": {
            "type": "object",
            "properties": {
                "date": {
                    "type": "string",
                    "description": "Date as YYYY-MM-DD, or 'next_available'",
                },
                "practice_type": {"type": "string", "enum": ["dental", "gp", "physio", "pediatric"]},
            },
            "required": ["date", "practice_type"],
        },
    },
    {
        "name": "book_appointment",
        "description": "Book an appointment for the patient after confirming details.",
        "input_schema": {
            "type": "object",
            "properties": {
                "patient_name": {"type": "string"},
                "patient_email": {"type": "string", "description": "Patient email, empty string if not provided"},
                "date": {"type": "string", "description": "YYYY-MM-DD"},
                "time": {"type": "string", "description": "HH:MM (24h)"},
                "reason": {"type": "string"},
                "practice_type": {"type": "string", "enum": ["dental", "gp", "physio", "pediatric"]},
            },
            "required": ["patient_name", "date", "time", "reason", "practice_type"],
        },
    },
    {
        "name": "escalate_to_staff",
        "description": "Escalate to clinic staff when: clinical judgment is needed, patient describes emergency symptoms, prescription/diagnosis is requested, or patient expresses distress.",
        "input_schema": {
            "type": "object",
            "properties": {
                "reason": {"type": "string", "description": "Why this is being escalated"},
                "urgency": {
                    "type": "string",
                    "enum": ["low", "medium", "high", "emergency"],
                    "description": "low=staff review later, medium=same day, high=within the hour, emergency=call 911",
                },
                "patient_name": {"type": "string"},
                "summary": {"type": "string", "description": "Brief summary of the patient's concern"},
            },
            "required": ["reason", "urgency"],
        },
    },
    {
        "name": "generate_visit_summary",
        "description": "Generate a structured visit summary. Call this when the patient asks for a summary or says goodbye.",
        "input_schema": {
            "type": "object",
            "properties": {
                "patient_name": {"type": "string"},
                "topics_discussed": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "List of topics covered in this session",
                },
                "outcome": {"type": "string", "description": "What was resolved or the next step"},
            },
            "required": ["patient_name", "topics_discussed", "outcome"],
        },
    },
]


# ── System prompts per practice type ─────────────────────────────────────────

CONCISENESS_RULE = """
STYLE:
- Be warm but concise. Keep replies under 120 words unless showing a list of options.
- Always address the patient by their first name.
- No long preambles — get to the point immediately.
- For returning patients: acknowledge they've been before ("Welcome back, [name]!").
- For new patients: briefly welcome them ("Great to meet you, [name]!").
- For caregivers: address them directly ("Thanks for reaching out on behalf of your patient.")
- When showing appointment slots, list them as plain times (e.g. 9:00 AM, 10:00 AM) so they can be tapped."""

SYSTEM_PROMPTS = {
    "dental": """You are Cara, a warm, professional AI front-desk assistant for a dental practice. You help patients with appointments, procedures, billing, and pre/post-care questions.

You have access to tools to look up real clinic info, check availability, book appointments, escalate concerns, and generate visit summaries. Use them proactively.

RULES:
- Never diagnose or prescribe.
- For severe pain, swelling, difficulty swallowing/breathing → escalate with urgency=high or emergency.
- For clinical questions → say "I'd recommend speaking with the dentist" and offer to book.
- Always use get_clinic_info before stating hours, services, or fees.
- Confirm appointment details before booking.
""" + CONCISENESS_RULE,

    "gp": """You are Alex, a friendly AI front-desk assistant for a general practice clinic. You help with scheduling, registrations, insurance questions, and general health info.

You have tools to look up clinic data, check availability, book appointments, escalate, and summarise visits.

RULES:
- Never diagnose, interpret test results, or suggest medication changes.
- For chest pain, stroke symptoms, difficulty breathing → escalate urgency=emergency immediately.
- Clinical questions → "Your physician is best placed to advise — shall I book an appointment?"
- Always fetch real clinic info via tools rather than guessing.
""" + CONCISENESS_RULE,

    "physio": """You are Jordan, a knowledgeable AI front-desk assistant for a physiotherapy clinic. You help clients with bookings, pre-assessment info, and general guidance.

RULES:
- Never prescribe specific exercises before a physiotherapy assessment.
- Acute injuries (suspected fracture, severe swelling, inability to bear weight) → escalate urgency=high.
- No medication or surgical advice.
- Always use tools for real clinic data.
""" + CONCISENESS_RULE,

    "pediatric": """You are Sunny, a warm, reassuring AI front-desk assistant for a pediatric clinic. You mainly talk with parents and guardians.

RULES:
- Never diagnose children's conditions.
- Infants under 3 months with fever, difficulty breathing, seizures, severe rash → escalate urgency=emergency.
- No medication dosages for children.
- Use simple, jargon-free language.
- Always use tools for clinic hours, vaccine schedules, and FAQs.
""" + CONCISENESS_RULE,
}


# ── Junior Doctor / Clinical Triage system prompt ────────────────────────────

TRIAGE_SYSTEM_PROMPT = """You are a competent junior doctor conducting an initial patient consultation. You are thorough, empathetic, and safety-conscious.

Work through this structured consultation conversationally — do NOT dump all questions at once. Ask 1-2 focused questions at a time and listen carefully before proceeding.

CONSULTATION STRUCTURE (work through these naturally):
1. Chief complaint — confirm what the patient told you
2. History of present illness — onset, duration, character, severity, progression, aggravating/relieving factors
3. Red flags — identify any that must not be missed
4. Relevant system review — targeted questions across relevant organ systems
5. Differential diagnosis — ranked by likelihood; always include serious diagnoses that must not be missed
6. Urgency — emergency / urgent (same day) / semi-urgent (this week) / routine
7. Next step — appropriate level of care (ED, GP today, GP this week, telehealth, self-care)
8. Possible investigations — suggest for clinician review only (do not order or interpret)
9. Safety-net advice — what to watch for, when to seek emergency care

RULES:
- Never claim diagnostic certainty too early — gather enough history first
- Never suggest specific medications, doses, or treatments
- Never replace a licensed doctor — always recommend appropriate professional care
- For chest pain, stroke symptoms (FAST), difficulty breathing, severe bleeding, loss of consciousness → escalate urgency=emergency immediately
- Explain findings clearly in plain language the patient understands
- At the end of the consultation or when the patient asks, call generate_visit_summary with the structured findings
- Always address the patient by their first name
- Be warm but precise — this is a clinical consultation, not a chat"""


# ── Tool dispatcher ───────────────────────────────────────────────────────────

def _dispatch_tool(name: str, inputs: dict, session_id: str = "") -> str:
    import json

    try:
        if name == "get_clinic_info":
            result = get_clinic_info(**inputs)
        elif name == "check_availability":
            result = check_availability(**inputs)
        elif name == "book_appointment":
            result = book_appointment(**inputs)
        elif name == "escalate_to_staff":
            result = escalate_to_staff(**inputs, session_id=session_id)
        elif name == "generate_visit_summary":
            result = generate_visit_summary(**inputs)
        else:
            result = {"error": f"Unknown tool: {name}"}
    except Exception as e:
        result = {"error": str(e)}

    return json.dumps(result)


# ── Agent loop ────────────────────────────────────────────────────────────────

def run_agent(
    messages: list[dict],
    practice_type: str,
    session_id: str = "",
    tool_calls_log: list | None = None,
) -> tuple[str, list[dict]]:
    """
    Run the agent loop until end_turn.
    Returns (final_text_reply, updated_messages).
    tool_calls_log is mutated in-place if provided (for the session to track escalations etc).
    """
    system = SYSTEM_PROMPTS.get(practice_type, SYSTEM_PROMPTS["gp"])
    working_messages = list(messages)  # don't mutate caller's list

    for _ in range(10):  # safety cap on tool iterations
        response = _client.messages.create(
            model=CLAUDE_MODEL,
            max_tokens=MAX_TOKENS,
            system=system,
            tools=TOOLS,
            messages=working_messages,
        )

        if response.stop_reason == "end_turn":
            text = "".join(
                b.text for b in response.content if hasattr(b, "text")
            )
            working_messages.append({"role": "assistant", "content": response.content})
            return text, working_messages

        if response.stop_reason == "tool_use":
            working_messages.append({"role": "assistant", "content": response.content})
            tool_results = []

            for block in response.content:
                if block.type != "tool_use":
                    continue

                result_str = _dispatch_tool(block.name, block.input, session_id)

                if tool_calls_log is not None:
                    tool_calls_log.append({
                        "tool": block.name,
                        "input": block.input,
                        "result": result_str,
                    })

                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": result_str,
                })

            working_messages.append({"role": "user", "content": tool_results})
            continue

        # Unexpected stop reason
        break

    return "I'm sorry, I encountered an issue processing your request. Please try again.", working_messages


# ── Triage agent loop (same mechanics, different system prompt + higher tokens) ─

def run_triage_agent(
    messages: list[dict],
    practice_type: str = "gp",
    session_id: str = "",
    tool_calls_log: list | None = None,
) -> tuple[str, list[dict]]:
    """Junior Doctor consultation agent."""
    working_messages = list(messages)

    # Triage tools — subset focused on clinical flow
    triage_tools = [t for t in TOOLS if t["name"] in (
        "escalate_to_staff", "generate_visit_summary", "book_appointment", "check_availability"
    )]

    for _ in range(10):
        response = _client.messages.create(
            model=CLAUDE_MODEL,
            max_tokens=1536,  # more tokens for clinical reasoning
            system=TRIAGE_SYSTEM_PROMPT,
            tools=triage_tools,
            messages=working_messages,
        )

        if response.stop_reason == "end_turn":
            text = "".join(b.text for b in response.content if hasattr(b, "text"))
            working_messages.append({"role": "assistant", "content": response.content})
            return text, working_messages

        if response.stop_reason == "tool_use":
            working_messages.append({"role": "assistant", "content": response.content})
            tool_results = []

            for block in response.content:
                if block.type != "tool_use":
                    continue
                result_str = _dispatch_tool(block.name, block.input, session_id)
                if tool_calls_log is not None:
                    tool_calls_log.append({"tool": block.name, "input": block.input, "result": result_str})
                tool_results.append({"type": "tool_result", "tool_use_id": block.id, "content": result_str})

            working_messages.append({"role": "user", "content": tool_results})
            continue

        break

    return "I'm sorry, I encountered an issue. Please try again.", working_messages
