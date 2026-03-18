const API = "http://localhost:8000";

let sessionId = null;
let practiceType = "dental";
let escalations = [];

// ── Dark mode ─────────────────────────────────────────────────────────────────

function initTheme() {
  const saved = localStorage.getItem("caredesk-theme") || "light";
  document.documentElement.setAttribute("data-theme", saved);
  document.getElementById("themeBtn").textContent = saved === "dark" ? "☀️" : "🌙";
}

function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme");
  const next = current === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("caredesk-theme", next);
  document.getElementById("themeBtn").textContent = next === "dark" ? "☀️" : "🌙";
}

initTheme();

// ── Session start ─────────────────────────────────────────────────────────────

async function startChat() {
  const first = document.getElementById("intakeFirst").value.trim();
  const patientType = document.getElementById("intakePatientType").value;
  const reason = document.getElementById("intakeReason").value;

  let valid = true;
  ["intakeFirst", "intakePatientType", "intakeReason"].forEach((id) => {
    const el = document.getElementById(id);
    if (!el.value.trim() && !el.value) { el.style.borderColor = "#C94040"; valid = false; }
    else el.style.borderColor = "";
  });
  if (!valid) return;

  practiceType = document.getElementById("intakePractice").value;
  document.getElementById("practiceType").value = practiceType;

  const btn = document.getElementById("startBtn");
  btn.textContent = "Starting session…";
  btn.disabled = true;

  try {
    const res = await fetch(`${API}/session/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        first_name: first,
        last_name: document.getElementById("intakeLast").value.trim(),
        patient_type: patientType,
        practice_type: practiceType,
        reason,
        note: document.getElementById("intakeNote").value.trim(),
      }),
    });
    if (!res.ok) throw new Error(`Server error ${res.status}`);
    const data = await res.json();
    sessionId = data.session_id;
    updateBotHeader();
    document.getElementById("intakeModal").style.display = "none";
    addBotMessage(data.reply);
    syncEscalations(data.escalations || []);
  } catch (e) {
    alert("Could not connect to CareDesk backend. Make sure the server is running on port 8000.");
    btn.textContent = "Begin conversation →";
    btn.disabled = false;
  }
}

// ── Messaging ─────────────────────────────────────────────────────────────────

async function sendMessage() {
  const input = document.getElementById("userInput");
  const text = input.value.trim();
  if (!text || !sessionId) return;

  input.value = "";
  input.style.height = "auto";
  addUserMessage(text);
  addTyping();
  document.getElementById("sendBtn").disabled = true;

  try {
    const res = await fetch(`${API}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, message: text }),
    });
    if (!res.ok) throw new Error(`Server error ${res.status}`);
    const data = await res.json();
    removeTyping();
    addBotMessage(data.reply);
    syncEscalations(data.escalations || []);
    showToolBadges(data.tool_calls || []);
  } catch (e) {
    removeTyping();
    addBotMessage("I'm having trouble connecting. Please check the server is running and try again.");
  } finally {
    document.getElementById("sendBtn").disabled = false;
    document.getElementById("userInput").focus();
  }
}

// ── Summary ───────────────────────────────────────────────────────────────────

async function generateSummary() {
  const panel = document.getElementById("summaryContent");
  if (!sessionId) {
    panel.innerHTML = `<div class="summary-empty"><div class="summary-empty-icon">📋</div>Complete a conversation first, then return here to generate your visit summary.</div>`;
    return;
  }

  panel.innerHTML = `<div class="summary-empty"><div class="summary-empty-icon">⏳</div>Generating summary…</div>`;

  try {
    const res = await fetch(`${API}/session/${sessionId}/summary`);
    const d = await res.json();

    const escHtml = d.escalations.length > 0
      ? d.escalations.map(e => `<div class="summary-flag">⚠️ <strong>${cap(e.urgency)} urgency:</strong> ${esc(e.reason)}</div>`).join("")
      : "";

    const toolsUsed = [...new Set((d.tool_calls || []).map(t => t.tool))];

    panel.innerHTML = `
      <div class="summary-header">
        <div class="summary-title">Visit Summary</div>
        <div class="summary-sub">Session ${sessionId} · ${new Date(d.created_at).toLocaleString()}</div>
      </div>
      <div class="summary-body">
        <div class="summary-section">
          <div class="summary-section-title">Patient details</div>
          <div class="summary-info-row"><span class="summary-info-label">Name</span><span class="summary-info-val">${esc(d.patient_name)}</span></div>
          <div class="summary-info-row"><span class="summary-info-label">Patient type</span><span class="summary-info-val">${cap(d.patient_type)}</span></div>
          <div class="summary-info-row"><span class="summary-info-label">Practice</span><span class="summary-info-val">${cap(d.practice_type)}</span></div>
          <div class="summary-info-row"><span class="summary-info-label">Reason</span><span class="summary-info-val">${esc(d.reason)}</span></div>
          <div class="summary-info-row"><span class="summary-info-label">Messages</span><span class="summary-info-val">${d.message_count}</span></div>
          <div class="summary-info-row"><span class="summary-info-label">Escalations</span><span class="summary-info-val" style="color:${d.escalations.length ? "var(--danger-ink)" : "inherit"}">${d.escalations.length}</span></div>
        </div>
        ${toolsUsed.length ? `<div class="summary-section"><div class="summary-section-title">Agent actions taken</div><div class="summary-topics">${toolsUsed.map(t => `<span class="topic-tag">${toolLabel(t)}</span>`).join("")}</div></div>` : ""}
        ${d.escalations.length ? `<div class="summary-section"><div class="summary-section-title">Escalation flags</div>${escHtml}</div>` : ""}
        <button class="handoff-btn" onclick="sendHandoff()">📤 Send summary to clinic</button>
        <button class="handoff-btn sec" onclick="window.print()">🖨️ Print / save as PDF</button>
      </div>`;
  } catch (e) {
    panel.innerHTML = `<div class="summary-empty"><div class="summary-empty-icon">❌</div>Could not load summary. Please try again.</div>`;
  }
}

function sendHandoff() {
  const subject = encodeURIComponent(`CareDesk Visit Summary — ${sessionId}`);
  const body = encodeURIComponent(`Session ID: ${sessionId}\n\nPlease review the CareDesk session transcript.`);
  window.location.href = `mailto:clinic@example.com?subject=${subject}&body=${body}`;
}

// ── UI helpers ────────────────────────────────────────────────────────────────

const PRACTICES = {
  dental:    { name: "Cara — Dental Assistant",  emoji: "🦷" },
  gp:        { name: "Alex — GP Assistant",       emoji: "🩺" },
  physio:    { name: "Jordan — Physio Assistant", emoji: "🏃" },
  pediatric: { name: "Sunny — Paediatric Assist", emoji: "👶" },
};

function updateBotHeader() {
  const p = PRACTICES[practiceType] || PRACTICES.dental;
  document.getElementById("botName").textContent = p.name;
  document.getElementById("botEmoji").textContent = p.emoji;
}

function addBotMessage(text) {
  const msgs = document.getElementById("messages");
  const row = document.createElement("div");
  row.className = "msg-row bot";
  const emoji = PRACTICES[practiceType]?.emoji || "🤖";

  // Parse slot times from text for clickable chips
  const { html, slots } = parseSlots(formatText(text));

  const slotHtml = slots.length
    ? `<div class="slot-chips">${slots.map(s => `<button class="slot-chip" onclick="bookSlot('${s}')">${s}</button>`).join("")}</div>`
    : "";

  row.innerHTML = `
    <div class="msg-icon bot">${emoji}</div>
    <div>
      <div class="bubble bot">${html}${slotHtml}</div>
      <div class="msg-meta"><span class="disclaimer-tag">General information · Not medical advice</span></div>
    </div>`;
  msgs.appendChild(row);
  msgs.scrollTop = msgs.scrollHeight;
}

function addUserMessage(text) {
  const msgs = document.getElementById("messages");
  const row = document.createElement("div");
  row.className = "msg-row user";
  row.innerHTML = `<div class="msg-icon user">👤</div><div class="bubble user">${esc(text)}</div>`;
  msgs.appendChild(row);
  msgs.scrollTop = msgs.scrollHeight;
}

function addTyping() {
  const msgs = document.getElementById("messages");
  const row = document.createElement("div");
  row.id = "typing";
  row.className = "msg-row bot";
  row.innerHTML = `<div class="msg-icon bot">${PRACTICES[practiceType]?.emoji || "🤖"}</div><div class="bubble bot typing"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span></div>`;
  msgs.appendChild(row);
  msgs.scrollTop = msgs.scrollHeight;
}

function removeTyping() {
  document.getElementById("typing")?.remove();
}

function showToolBadges(toolCalls) {
  if (!toolCalls.length) return;
  const msgs = document.getElementById("messages");
  const row = document.createElement("div");
  row.className = "tool-badge-row";
  row.innerHTML = toolCalls.map(t => `<span class="tool-badge">🔧 ${toolLabel(t.tool)}</span>`).join("");
  msgs.appendChild(row);
  msgs.scrollTop = msgs.scrollHeight;
}

function syncEscalations(newEscs) {
  escalations = newEscs;
  const list = document.getElementById("escalationList");
  const badge = document.getElementById("escCount");
  if (!escalations.length) {
    list.innerHTML = '<div class="esc-empty">No escalations this session.</div>';
    badge.style.display = "none";
    return;
  }
  badge.textContent = escalations.length;
  badge.style.display = "inline-flex";
  list.innerHTML = escalations.map(e => `<div class="esc-item"><strong>${cap(e.urgency)}</strong>: ${esc(e.reason)}</div>`).join("");
}

function bookSlot(time) {
  document.getElementById("userInput").value = `I'd like to book the ${time} slot please.`;
  sendMessage();
}

function sendQuick(text) {
  if (!sessionId) return;
  document.getElementById("userInput").value = text;
  sendMessage();
}

function clearChat() {
  sessionId = null;
  escalations = [];
  document.getElementById("messages").innerHTML = "";
  document.getElementById("escalationList").innerHTML = '<div class="esc-empty">No escalations this session.</div>';
  document.getElementById("escCount").style.display = "none";
  document.getElementById("intakeModal").style.display = "flex";
}

function showTab(tab) {
  const tabs = ["chat", "summary", "how"];
  document.querySelectorAll(".nav-tab").forEach((t, i) => t.classList.toggle("active", tabs[i] === tab));
  document.getElementById("chatTab").classList.toggle("active", tab === "chat");
  document.getElementById("summaryTab").classList.toggle("active", tab === "summary");
  document.getElementById("howTab").classList.toggle("active", tab === "how");
  if (tab === "summary") generateSummary();
}

function changePractice() {
  practiceType = document.getElementById("practiceType").value;
  updateBotHeader();
}

function handleKey(e) {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
}

function autoResize(el) {
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 110) + "px";
}

// ── Text helpers ──────────────────────────────────────────────────────────────

// Parses bot text, extracts time tokens for slot chips, returns { html, slots }
function parseSlots(html) {
  const timeRegex = /\b(\d{1,2}:\d{2}\s*(?:AM|PM))\b/g;
  const slots = [];
  const seen = new Set();
  let match;
  while ((match = timeRegex.exec(html)) !== null) {
    const t = match[1].replace(/\s+/, " ");
    if (!seen.has(t)) { seen.add(t); slots.push(t); }
  }
  return { html, slots };
}

function formatText(t) {
  return esc(t)
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/g, "<em>$1</em>")
    .replace(/\n/g, "<br>");
}

function esc(t) {
  return String(t).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ""; }

function toolLabel(tool) {
  const m = { get_clinic_info:"Looked up clinic info", check_availability:"Checked availability", book_appointment:"Booked appointment", escalate_to_staff:"Escalated to staff", generate_visit_summary:"Generated summary" };
  return m[tool] || tool;
}
