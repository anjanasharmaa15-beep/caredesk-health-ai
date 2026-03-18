// Empty string = relative URLs, works both locally and in production
const API = "";

// ── State ─────────────────────────────────────────────────────────────────────
let sessionId        = null;
let practiceType     = "dental";
let escalations      = [];
let disclaimerShown  = false;

let triageSessionId        = null;
let triageEscalations      = [];
let triageDisclaimerShown  = false;
let triageStep             = 0;

let lastActiveMode   = "frontdesk"; // "frontdesk" | "triage"
let _confirmCallback = null;

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

// ── Front Desk session start ──────────────────────────────────────────────────
async function startChat() {
  const first       = document.getElementById("intakeFirst").value.trim();
  const patientType = document.getElementById("intakePatientType").value;
  const reason      = document.getElementById("intakeReason").value;

  let valid = true;
  ["intakeFirst", "intakePatientType", "intakeReason"].forEach(id => {
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
  document.getElementById("intakeError").style.display = "none";

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
    lastActiveMode = "frontdesk";
    disclaimerShown = false;
    updateBotHeader();
    document.getElementById("intakeModal").style.display = "none";
    addBotMessage(data.reply);
    syncEscalations(data.escalations || []);
  } catch (e) {
    btn.textContent = "Begin conversation →";
    btn.disabled = false;
    document.getElementById("intakeError").style.display = "block";
  }
}

// ── Front Desk messaging ──────────────────────────────────────────────────────
async function sendMessage() {
  const input = document.getElementById("userInput");
  const text = input.value.trim();
  if (!text || !sessionId) return;

  input.value = "";
  input.style.height = "auto";
  addUserMessage(text);
  addTyping();
  document.getElementById("sendBtn").disabled = true;
  document.getElementById("messages").querySelector(".system-error")?.remove();

  try {
    const res = await fetch(`${API}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, message: text }),
    });
    if (!res.ok) throw new Error(`Server error ${res.status}`);
    const data = await res.json();
    removeTyping();
    lastActiveMode = "frontdesk";
    addBotMessage(data.reply);
    syncEscalations(data.escalations || []);
    showToolBadges(data.tool_calls || []);
  } catch (e) {
    removeTyping();
    input.value = text; // restore so user can retry
    autoResize(input);
    addSystemError(document.getElementById("messages"), sendMessage);
  } finally {
    document.getElementById("sendBtn").disabled = false;
    document.getElementById("userInput").focus();
  }
}

// ── Clinical Triage session start ─────────────────────────────────────────────
async function startTriage() {
  const first     = document.getElementById("triageFirst").value.trim();
  const age       = document.getElementById("triageAge").value.trim();
  const sex       = document.getElementById("triageSex").value;
  const complaint = document.getElementById("triageComplaint").value.trim();

  let valid = true;
  ["triageFirst", "triageAge", "triageSex", "triageComplaint"].forEach(id => {
    const el = document.getElementById(id);
    if (!el.value.trim()) { el.style.borderColor = "#C94040"; valid = false; }
    else el.style.borderColor = "";
  });
  if (!valid) return;

  const btn = document.getElementById("triageStartBtn");
  btn.textContent = "Starting assessment…";
  btn.disabled = true;
  document.getElementById("triageError").style.display = "none";

  try {
    const res = await fetch(`${API}/triage/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        first_name: first,
        last_name: document.getElementById("triageLast").value.trim(),
        age,
        sex,
        chief_complaint: complaint,
      }),
    });
    if (!res.ok) throw new Error(`Server error ${res.status}`);
    const data = await res.json();
    triageSessionId = data.session_id;
    lastActiveMode = "triage";
    triageDisclaimerShown = false;
    triageStep = 0;
    document.getElementById("triageModal").style.display = "none";
    document.getElementById("triageProgressArea").style.display = "flex";
    addTriageMessage(data.reply, true);
    syncTriageEscalations(data.escalations || []);
  } catch (e) {
    btn.textContent = "Begin clinical assessment →";
    btn.disabled = false;
    document.getElementById("triageError").style.display = "block";
  }
}

// ── Clinical Triage messaging ─────────────────────────────────────────────────
async function sendTriageMessage() {
  const input = document.getElementById("triageInput");
  const text = input.value.trim();
  if (!text || !triageSessionId) return;

  input.value = "";
  input.style.height = "auto";
  addTriageMessage(text, false);
  addTriageTyping();
  document.getElementById("triageSendBtn").disabled = true;
  document.getElementById("triageMessages").querySelector(".system-error")?.remove();

  try {
    const res = await fetch(`${API}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: triageSessionId, message: text }),
    });
    if (!res.ok) throw new Error(`Server error ${res.status}`);
    const data = await res.json();
    removeTriageTyping();
    lastActiveMode = "triage";
    addTriageMessage(data.reply, true);
    syncTriageEscalations(data.escalations || []);
  } catch (e) {
    removeTriageTyping();
    input.value = text; // restore so user can retry
    autoResize(input);
    addSystemError(document.getElementById("triageMessages"), sendTriageMessage);
  } finally {
    document.getElementById("triageSendBtn").disabled = false;
    document.getElementById("triageInput").focus();
  }
}

// ── Visit Summary ─────────────────────────────────────────────────────────────
async function generateSummary() {
  const panel = document.getElementById("summaryContent");
  const sid = lastActiveMode === "triage" ? triageSessionId : sessionId;

  if (!sid) {
    panel.innerHTML = `<div class="summary-empty"><div class="summary-empty-icon">📋</div>Complete a conversation first, then open this panel.</div>`;
    return;
  }

  panel.innerHTML = `<div class="summary-empty"><div class="summary-empty-icon">⏳</div>Generating summary…</div>`;

  try {
    const res = await fetch(`${API}/session/${sid}/summary`);
    const d = await res.json();

    const escHtml = d.escalations.length
      ? d.escalations.map(e => `<div class="summary-flag">⚠️ <strong>${cap(e.urgency)} urgency:</strong> ${esc(e.reason)}</div>`).join("")
      : "";
    const toolsUsed = [...new Set((d.tool_calls || []).map(t => t.tool))];
    const modeLabel = lastActiveMode === "triage" ? "Clinical Triage" : "Front Desk";

    panel.innerHTML = `
      <div class="summary-header">
        <div class="summary-title">Visit Summary</div>
        <div class="summary-sub">${modeLabel} · ${new Date(d.created_at).toLocaleString()}</div>
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
  const sid = lastActiveMode === "triage" ? triageSessionId : sessionId;
  const subject = encodeURIComponent(`CareDesk Visit Summary — ${sid}`);
  const body    = encodeURIComponent(`Session ID: ${sid}\n\nPlease review the CareDesk session transcript.`);
  window.location.href = `mailto:clinic@example.com?subject=${subject}&body=${body}`;
}

// ── Bot message helpers ───────────────────────────────────────────────────────
const PRACTICES = {
  dental:    { name: "Cara — Dental Assistant",  emoji: "🦷" },
  gp:        { name: "Alex — GP Assistant",       emoji: "🩺" },
  physio:    { name: "Jordan — Physio Assistant", emoji: "🏃" },
  pediatric: { name: "Sunny — Paediatric Assist", emoji: "👶" },
};

function updateBotHeader() {
  const p = PRACTICES[practiceType] || PRACTICES.dental;
  document.getElementById("botName").textContent  = p.name;
  document.getElementById("botEmoji").textContent = p.emoji;
}

function addBotMessage(text) {
  const msgs = document.getElementById("messages");
  const row  = document.createElement("div");
  row.className = "msg-row bot";
  const emoji = PRACTICES[practiceType]?.emoji || "🤖";
  const { html, slots } = parseSlots(formatText(text));
  const slotHtml = slots.length
    ? `<div class="slot-chips">${slots.map(s => `<button class="slot-chip" onclick="bookSlot('${s}')">${s}</button>`).join("")}</div>`
    : "";
  const disclaimerHtml = disclaimerShown ? ""
    : `<div class="msg-meta"><span class="disclaimer-tag">General information · Not medical advice</span></div>`;
  disclaimerShown = true;

  row.innerHTML = `
    <div class="msg-icon bot">${emoji}</div>
    <div>
      <div class="bubble bot">${html}${slotHtml}</div>
      ${disclaimerHtml}
      <div class="msg-timestamp">${formatTime()}</div>
    </div>`;
  msgs.appendChild(row);
  msgs.scrollTop = msgs.scrollHeight;
}

function addUserMessage(text) {
  const msgs = document.getElementById("messages");
  const row  = document.createElement("div");
  row.className = "msg-row user";
  row.innerHTML = `
    <div class="msg-icon user">👤</div>
    <div>
      <div class="bubble user">${esc(text)}</div>
      <div class="msg-timestamp" style="text-align:right">${formatTime()}</div>
    </div>`;
  msgs.appendChild(row);
  msgs.scrollTop = msgs.scrollHeight;
}

function addTyping() {
  const msgs = document.getElementById("messages");
  const row  = document.createElement("div");
  row.id = "typing";
  row.className = "msg-row bot";
  row.innerHTML = `<div class="msg-icon bot">${PRACTICES[practiceType]?.emoji || "🤖"}</div><div class="bubble bot typing"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span></div>`;
  msgs.appendChild(row);
  msgs.scrollTop = msgs.scrollHeight;
}
function removeTyping() { document.getElementById("typing")?.remove(); }

function showToolBadges(toolCalls) {
  if (!toolCalls.length) return;
  const msgs = document.getElementById("messages");
  const row  = document.createElement("div");
  row.className = "tool-badge-row";
  row.innerHTML = toolCalls.map(t => `<span class="tool-badge">🔧 ${toolLabel(t.tool)}</span>`).join("");
  msgs.appendChild(row);
  msgs.scrollTop = msgs.scrollHeight;
}

function syncEscalations(newEscs) {
  escalations = newEscs;
  const list  = document.getElementById("escalationList");
  const badge = document.getElementById("escCount");
  if (!escalations.length) {
    list.innerHTML    = '<div class="esc-empty">No escalations this session.</div>';
    badge.style.display = "none";
    return;
  }
  badge.textContent   = escalations.length;
  badge.style.display = "inline-flex";
  list.innerHTML = escalations.map(e => `<div class="esc-item"><strong>${cap(e.urgency)}</strong>: ${esc(e.reason)}</div>`).join("");
}

// ── Triage message helpers ────────────────────────────────────────────────────
function addTriageMessage(text, isBot) {
  const msgs = document.getElementById("triageMessages");
  const row  = document.createElement("div");

  if (isBot) {
    triageStep = Math.min(triageStep + 1, 9);
    updateTriageProgress();
    const disclaimerHtml = triageDisclaimerShown ? ""
      : `<div class="msg-meta"><span class="disclaimer-tag">Clinical consultation · Not a substitute for professional care</span></div>`;
    triageDisclaimerShown = true;
    row.className = "msg-row bot";
    row.innerHTML = `
      <div class="msg-icon bot" style="background:var(--gold-soft);border-color:var(--danger-border);">🩺</div>
      <div>
        <div class="bubble bot">${formatText(text)}</div>
        ${disclaimerHtml}
        <div class="msg-timestamp">${formatTime()}</div>
      </div>`;
  } else {
    row.className = "msg-row user";
    row.innerHTML = `
      <div class="msg-icon user">👤</div>
      <div>
        <div class="bubble user">${esc(text)}</div>
        <div class="msg-timestamp" style="text-align:right">${formatTime()}</div>
      </div>`;
  }
  msgs.appendChild(row);
  msgs.scrollTop = msgs.scrollHeight;
}

function updateTriageProgress() {
  const bar   = document.getElementById("triageProgressBar");
  const label = document.getElementById("triageProgressLabel");
  if (!bar) return;
  const stepNames = ["Greeting", "Chief complaint", "History", "Red flags", "System review", "Differential", "Urgency", "Next steps", "Safety net"];
  label.textContent = triageStep >= 9
    ? "Assessment complete"
    : `Step ${triageStep} of 9 — ${stepNames[triageStep - 1] || ""}`;
  bar.querySelectorAll(".step-dot").forEach((dot, i) => {
    dot.classList.remove("done", "active");
    if (i < triageStep)          dot.classList.add("done");
    else if (i === triageStep - 1) dot.classList.add("active");
  });
}

function addTriageTyping() {
  const msgs = document.getElementById("triageMessages");
  const row  = document.createElement("div");
  row.id = "triageTyping";
  row.className = "msg-row bot";
  row.innerHTML = `<div class="msg-icon bot" style="background:var(--gold-soft);border-color:var(--danger-border);">🩺</div><div class="bubble bot typing"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span></div>`;
  msgs.appendChild(row);
  msgs.scrollTop = msgs.scrollHeight;
}
function removeTriageTyping() { document.getElementById("triageTyping")?.remove(); }

function syncTriageEscalations(newEscs) {
  triageEscalations = newEscs;
  const list  = document.getElementById("triageEscalationList");
  const badge = document.getElementById("triageEscCount");
  if (!triageEscalations.length) {
    list.innerHTML      = '<div class="esc-empty">No escalations this session.</div>';
    badge.style.display = "none";
    return;
  }
  badge.textContent   = triageEscalations.length;
  badge.style.display = "inline-flex";
  list.innerHTML = triageEscalations.map(e =>
    `<div class="esc-item"><strong>${cap(e.urgency)}</strong>: ${esc(e.reason)}</div>`
  ).join("");
}

// ── System error (distinct from bot messages) ─────────────────────────────────
function addSystemError(messagesEl, retryFn) {
  messagesEl.querySelector(".system-error")?.remove();
  const div = document.createElement("div");
  div.className = "system-error";
  if (retryFn) {
    div.innerHTML = `<span>⚠️ Connection issue — your message was not sent.</span><button class="retry-btn">↩ Retry</button>`;
    div.querySelector(".retry-btn").addEventListener("click", () => { div.remove(); retryFn(); });
  } else {
    div.innerHTML = `<span>⚠️ Could not connect to backend. Make sure the server is running.</span>`;
  }
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// ── Slot booking ──────────────────────────────────────────────────────────────
function bookSlot(time) {
  document.getElementById("userInput").value = `I'd like to book the ${time} slot please.`;
  sendMessage();
}
function sendQuick(text) {
  if (!sessionId) return;
  document.getElementById("userInput").value = text;
  sendMessage();
}

// ── New session (with confirmation) ──────────────────────────────────────────
function clearChat() {
  if (!sessionId) return;
  confirmReset(
    "Start a new session?",
    "Your current conversation will end. This cannot be undone.",
    "End session",
    () => {
      sessionId = null;
      disclaimerShown = false;
      escalations = [];
      document.getElementById("messages").innerHTML = "";
      document.getElementById("escalationList").innerHTML = '<div class="esc-empty">No escalations this session.</div>';
      document.getElementById("escCount").style.display = "none";
      document.getElementById("intakeModal").style.display = "flex";
    }
  );
}

function clearTriage() {
  if (!triageSessionId) {
    document.getElementById("triageModal").style.display = "flex";
    return;
  }
  confirmReset(
    "Start a new triage session?",
    "Your consultation history will be cleared. This cannot be undone.",
    "End consultation",
    () => {
      triageSessionId = null;
      triageDisclaimerShown = false;
      triageEscalations = [];
      triageStep = 0;
      document.getElementById("triageMessages").innerHTML = "";
      document.getElementById("triageEscalationList").innerHTML = '<div class="esc-empty">No escalations this session.</div>';
      document.getElementById("triageEscCount").style.display = "none";
      document.getElementById("triageProgressArea").style.display = "none";
      const btn = document.getElementById("triageStartBtn");
      btn.textContent = "Begin clinical assessment →";
      btn.disabled = false;
      document.getElementById("triageModal").style.display = "flex";
    }
  );
}

// ── Tab navigation (2 tabs) ───────────────────────────────────────────────────
function showTab(tab) {
  ["chat", "triage"].forEach(t => {
    const btn = document.getElementById(`tab-${t}`);
    if (btn) btn.classList.toggle("active", t === tab);
  });
  ["chatTab", "triageTab"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle("active", id === `${tab}Tab`);
  });
  if (tab === "triage" && !triageSessionId) {
    document.getElementById("triageModal").style.display = "flex";
  }
}

// ── Drawers ───────────────────────────────────────────────────────────────────
function openDrawer(id) {
  closeAllDrawers();
  document.getElementById("drawerOverlay").classList.add("open");
  document.getElementById(id).classList.add("open");
  if (id === "summaryDrawer") generateSummary();
}
function closeDrawer(id) {
  document.getElementById(id).classList.remove("open");
  document.getElementById("drawerOverlay").classList.remove("open");
}
function closeAllDrawers() {
  document.querySelectorAll(".drawer").forEach(d => d.classList.remove("open"));
  document.getElementById("drawerOverlay").classList.remove("open");
}

// ── Confirmation modal ────────────────────────────────────────────────────────
function confirmReset(title, body, okLabel, onConfirm) {
  document.getElementById("confirmTitle").textContent  = title;
  document.getElementById("confirmBody").textContent   = body;
  document.getElementById("confirmOkBtn").textContent  = okLabel;
  _confirmCallback = onConfirm;
  document.getElementById("confirmOverlay").classList.add("open");
}
function closeConfirm() {
  document.getElementById("confirmOverlay").classList.remove("open");
  _confirmCallback = null;
}
function doConfirm() {
  const fn = _confirmCallback;
  closeConfirm();
  if (fn) fn();
}

// ── Controls ──────────────────────────────────────────────────────────────────
function changePractice() {
  practiceType = document.getElementById("practiceType").value;
  updateBotHeader();
}
function handleKey(e)       { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }
function handleTriageKey(e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendTriageMessage(); } }
function autoResize(el) {
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 110) + "px";
}

// ── Text & time helpers ───────────────────────────────────────────────────────
function formatTime() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function parseSlots(html) {
  const timeRegex = /\b(\d{1,2}:\d{2}\s*(?:AM|PM))\b/g;
  const slots = [];
  const seen  = new Set();
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
