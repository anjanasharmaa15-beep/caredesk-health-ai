![CareDesk Preview](preview.png)

# CareDesk — AI Front-Desk Assistant for Health Practices
A lightweight, browser-based AI chatbot for small health practices built with the Claude API.

## What it does
- Answers patient questions on appointments, billing, and pre-visit prep
- Handles 4 practice types: Dental, GP, Physiotherapy, Pediatric
- Auto-flags clinical or emergency topics for human escalation
- Zero backend — runs entirely in the browser

## How to run it
1. Download `health-assistant-chatbot.html`
2. Open in any browser
3. Paste your Anthropic API key when prompted
4. Select your practice type and start chatting

## Architecture decisions
- **System prompt as config** — each practice type has its own prompt; swapping verticals takes minutes
- **Stateless API calls** — no server needed for the prototype; production path would add a backend proxy to protect the API key
- **Escalation logic** — bot detects clinical/emergency keywords and surfaces a human handoff prompt
- **Conversation history in state** — full context window maintained per session

## Production roadmap (if scaling)
- Backend proxy to secure API key
- Patient auth layer
- Scheduling API integration (Calendly / Jane App)
- Flagged conversation logging for clinical review
- EHR read access for returning patient context

## Built with
- Claude API (claude-sonnet-4)
- Vanilla HTML/CSS/JS — no framework dependencies
