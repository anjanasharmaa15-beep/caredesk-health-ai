import os
from dotenv import load_dotenv

load_dotenv(override=True)

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
CAL_API_KEY = os.getenv("CAL_API_KEY", "")
CAL_EVENT_TYPE_ID = int(os.getenv("CAL_EVENT_TYPE_ID", "0"))
CAL_USERNAME = os.getenv("CAL_USERNAME", "")
RESEND_API_KEY = os.getenv("RESEND_API_KEY", "")
CLINIC_EMAIL = os.getenv("CLINIC_EMAIL", "clinic@example.com")
CLINIC_TIMEZONE = os.getenv("CLINIC_TIMEZONE", "Europe/London")

CLAUDE_MODEL = "claude-sonnet-4-6"
MAX_TOKENS = 1024

# Cal.com is active only if all three vars are set
CAL_ENABLED = bool(CAL_API_KEY and CAL_EVENT_TYPE_ID and CAL_USERNAME)
RESEND_ENABLED = bool(RESEND_API_KEY)
