const API = "http://localhost:8000";

let sessionId = null;
let practiceType = "dental";
let escalations = [];

// ── Session start ─────────────────────────────────────────────────────────────

async function startChat() {
  const first = document.getElementById("intakeFirst").value.trim();
  const patientType = document.getElementById("intakePatientType").value;
  const reason = document.getElementById("intakeReason").value;

  if (!first || !patientType || !reason) {
    ["intakeFirst", "intakePatientType", "intakeReason"].forEach((id) => {
      const el = document.getElementById(id);
      if (!el.value.trim() && !el.value) el.style.borderColor = "#E24B4A";
      else el.style.borderColor = "";
    });
    return;
  }

  practiceType = document.getElementById("intakePractice").value;
  document.getElementById("practiceType").value = practiceType;

  setLoading(true, "Starting session…");

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
    const data = await res.json();
    sessionId = data.session_id;
    updateBotHeader();
    document.getElementById("intakeModal").style.display = "none";
    addBotMessage(data.reply);
    syncEscalations(data.escalations || []);
  } catch (e) {
    alert("Could not connect to CareDesk backend. Make sure the server is running.");
  } finally {
    setLoading(false);
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
    const data = await res.json();
    removeTyping();
    addBotMessage(data.reply);
    syncEscalations(data.escalations || []);
    showToolBadges(data.tool_calls || []);
  } catch (e) {
    removeTyping();
    addBotMessage("Connection error. Please check that the server is running.");
  } finally {
    document.getElementById("sendBtn").disabled = false;
    document.getElementById("userInput").focus();
  }
}

// ── Summary tab ───────────────────────────────────────────────────────────────

async function generateSummary() {
  const panel = document.getElementById("summaryContent");
  if (!sessionId) {
    panel.innerHTML = emptyState("📋", "Complete a conversation first.");
    return;
  }

  panel.innerHTML = emptyState("⏳", "Generating summary…");

  try {
    const res = await fetch(`${API}/session/${sessionId}/summary`);
    const d = await res.json();

    const escHtml =
      d.escalations.length > 0
        ? d.escalations
            .map(
              (e) =>
                `<div class="summary-flag">⚠️ <strong>${capitalize(e.urgency)} urgency:</strong> ${escHtml_(e.reason)}</div>`
            )
            .join("")
        : `<div style="font-size:13px;color:var(--text-muted);">No escalations this session.</div>`;

    const toolsUsed = [...new Set((d.tool_calls || []).map((t) => t.tool))];

    panel.innerHTML = `
      <div class="summary-header">
        <div>
          <div class="summary-title">Visit Summary</div>
          <div class="summary-sub">Session ${d.session_id || sessionId} · ${new Date(d.created_at).toLocaleString()}</div>
        </div>
      </div>
      <div class="summary-body">
        <div class="summary-section">
          <div class="summary-section-title">Patient details</div>
          <div class="summary-info-row"><span class="summary-info-label">Name</span><span class="summary-info-val">${escHtml_(d.patient_name)}</span></div>
          <div class="summary-info-row"><span class="summary-info-label">Patient type</span><span class="summary-info-val">${capitalize(d.patient_type)}</span></div>
          <div class="summary-info-row"><span class="summary-info-label">Practice</span><span class="summary-info-val">${capitalize(d.practice_type)}</span></div>
          <div class="summary-info-row"><span class="summary-info-label">Reason</span><span class="summary-info-val">${escHtml_(d.reason)}</span></div>
          <div class="summary-info-row"><span class="summary-info-label">Messages</span><span class="summary-info-val">${d.message_count}</span></div>
          <div class="summary-info-row"><span class="summary-info-label">Escalations</span><span class="summary-info-val" style="color:${d.escalations.length > 0 ? "#854F0B" : "inherit"}">${d.escalations.length}</span></div>
        </div>
        ${toolsUsed.length > 0 ? `
        <div class="summary-section">
          <div class="summary-section-title">Agent actions taken</div>
          <div class="summary-topics">${toolsUsed.map((t) => `<span class="topic-tag">${toolLabel(t)}</span>`).join("")}</div>
        </div>` : ""}
        ${d.escalations.length > 0 ? `<div class="summary-section"><div class="summary-section-title">Escalation flags</div>${escHtml}</div>` : ""}
        <button class="handoff-btn" onclick="sendHandoff()">📤 Send summary to clinic</button>
        <button class="handoff-btn secondary" onclick="window.print()">🖨️ Print / save as PDF</button>
      </div>`;
  } catch (e) {
    panel.innerHTML = emptyState("❌", "Could not load summary.");
  }
}

function sendHandoff() {
  const subject = encodeURIComponent(`CareDesk Summary — Session ${sessionId}`);
  const body = encodeURIComponent(`Session ID: ${sessionId}\n\nPlease review the CareDesk session transcript.`);
  window.location.href = `mailto:clinic@example.com?subject=${subject}&body=${body}`;
}

// ── UI helpers ────────────────────────────────────────────────────────────────

const PRACTICES = {
  dental: { name: "Dental Assistant (Cara)", emoji: "🦷" },
  gp: { name: "GP Clinic Assistant (Alex)", emoji: "🩺" },
  physio: { name: "Physiotherapy Assistant (Jordan)", emoji: "🏃" },
  pediatric: { name: "Pediatric Assistant (Sunny)", emoji: "👶" },
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
  row.innerHTML = `
    <div class="msg-icon bot">${emoji}</div>
    <div>
      <div class="bubble bot">${formatText(text)}</div>
      <div class="msg-meta"><span class="disclaimer-tag">General information · Not medical advice</span></div>
    </div>`;
  msgs.appendChild(row);
  msgs.scrollTop = msgs.scrollHeight;
}

function addUserMessage(text) {
  const msgs = document.getElementById("messages");
  const row = document.createElement("div");
  row.className = "msg-row user";
  row.innerHTML = `<div class="msg-icon user">👤</div><div class="bubble user">${escHtml_(text)}</div>`;
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
  const el = document.getElementById("typing");
  if (el) el.remove();
}

function showToolBadges(toolCalls) {
  if (!toolCalls.length) return;
  const msgs = document.getElementById("messages");
  const badge = document.createElement("div");
  badge.className = "tool-badge-row";
  badge.innerHTML = toolCalls
    .map((t) => `<span class="tool-badge">🔧 ${toolLabel(t.tool)}</span>`)
    .join("");
  msgs.appendChild(badge);
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
  list.innerHTML = escalations
    .map(
      (e) => `
    <div class="esc-item">
      <strong>${capitalize(e.urgency)}</strong>: ${escHtml_(e.reason)}
    </div>`
    )
    .join("");
}

function setLoading(on, label = "") {
  const btn = document.getElementById("startBtn");
  if (btn) btn.textContent = on ? label : "Start conversation →";
}

function showTab(tab) {
  document.querySelectorAll(".nav-tab").forEach((t, i) =>
    t.classList.toggle("active", ["chat", "summary", "how"][i] === tab)
  );
  document.getElementById("chatTab").classList.toggle("active", tab === "chat");
  document.getElementById("summaryTab").classList.toggle("active", tab === "summary");
  document.getElementById("howTab").classList.toggle("active", tab === "how");
  if (tab === "summary") generateSummary();
}

function changePractice() {
  practiceType = document.getElementById("practiceType").value;
  updateBotHeader();
}

function sendQuick(text) {
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

function handleKey(e) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

function autoResize(el) {
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 110) + "px";
}

function emptyState(icon, text) {
  return `<div class="summary-generating"><div style="font-size:28px;margin-bottom:10px;">${icon}</div>${text}</div>`;
}

function toolLabel(tool) {
  const labels = {
    get_clinic_info: "Looked up clinic info",
    check_availability: "Checked availability",
    book_appointment: "Booked appointment",
    escalate_to_staff: "Escalated to staff",
    generate_visit_summary: "Generated summary",
  };
  return labels[tool] || tool;
}

function formatText(t) {
  return escHtml_(t)
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br>");
}

function escHtml_(t) {
  return String(t)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
}
