// contentScript.js — Injects a floating panel, positions near selection, handles ask/copy/replace/close, and highlighting.

const STATE = {
  panel: null,
  textarea: null,
  header: null,
  askbar: null,
  askInput: null,
  askBtn: null,
  ctxInfo: null,
  requestId: null,
  originalText: null,
};

function ensurePanel() {
  if (STATE.panel) return STATE.panel;

  const panel = document.createElement("div");
  panel.id = "gca-panel";
  panel.innerHTML = `
    <div class="gca-header" id="gca-header">
      <span id="gca-title">Gemini Context Actions</span>
      <div class="gca-spacer"></div>
      <button id="gca-copy" title="Copy">Copy</button>
      <button id="gca-replace" title="Replace selection">Replace</button>
      <button id="gca-settings" title="Settings">Settings</button>
      <button id="gca-close" title="Close">✕</button>
    </div>

    <!-- Ask bar (hidden by default) -->
    <div class="gca-ask" id="gca-ask" style="display:none;">
      <input id="gca-question" type="text" placeholder="Type your question…" />
      <button id="gca-ask-btn">Ask</button>
    </div>

    <!-- Tiny context preview (hidden by default) -->
    <div class="gca-ctxinfo" id="gca-ctxinfo" style="display:none;"></div>

    <textarea id="gca-textarea" placeholder="Working with Gemini…" rows="10"></textarea>
    <div class="gca-footer">Tip: Use right-click on selected text to run another action.</div>
  `;

  document.documentElement.appendChild(panel);

  // Cache refs
  STATE.panel = panel;
  STATE.textarea = panel.querySelector("#gca-textarea");
  STATE.header = panel.querySelector("#gca-header");
  STATE.askbar = panel.querySelector("#gca-ask");
  STATE.askInput = panel.querySelector("#gca-question");
  STATE.askBtn = panel.querySelector("#gca-ask-btn");
  STATE.ctxInfo = panel.querySelector("#gca-ctxinfo");

  // Dragging
  makeDraggable(panel, STATE.header);

  // Buttons
  panel.querySelector("#gca-close").addEventListener("click", () => panel.remove());
  panel.querySelector("#gca-copy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(STATE.textarea.value || ""); } catch {}
  });
  panel.querySelector("#gca-replace").addEventListener("click", () => replaceCurrentSelection(STATE.textarea.value || ""));
  panel.querySelector("#gca-settings").addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "gca:openOptions" });
  });

  // Ask handlers
  STATE.askBtn.addEventListener("click", submitAsk);
  STATE.askInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submitAsk();
    }
  });

  // Close on Escape
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && STATE.panel && document.body.contains(STATE.panel)) {
      STATE.panel.remove();
    }
  });

  return panel;
}

function makeDraggable(el, handle) {
  let startX = 0, startY = 0, origX = 0, origY = 0, dragging = false;
  handle.style.cursor = "move";
  handle.addEventListener("mousedown", (e) => {
    dragging = true;
    startX = e.clientX; startY = e.clientY;
    const r = el.getBoundingClientRect(); origX = r.left; origY = r.top;
    e.preventDefault();
  });
  document.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX, dy = e.clientY - startY;
    el.style.left = Math.max(8, origX + dx) + "px";
    el.style.top  = Math.max(8, origY + dy) + "px";
  });
  document.addEventListener("mouseup", () => dragging = false);
}

function placePanelNearSelection(panel) {
  const sel = window.getSelection();
  let x = 24, y = 24;
  if (sel && sel.rangeCount) {
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    if (rect && rect.width >= 0) {
      x = Math.max(8, rect.left + window.scrollX);
      y = Math.max(8, rect.bottom + window.scrollY + 8);
    }
  }
  panel.style.left = x + "px";
  panel.style.top  = y + "px";
}

function replaceCurrentSelection(text) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  range.deleteContents();
  range.insertNode(document.createTextNode(text));
}

function showLoading(title) {
  const panel = ensurePanel();
  placePanelNearSelection(panel);
  panel.querySelector("#gca-title").textContent = title || "Gemini Context Actions";
  STATE.textarea.value = "Generating with Gemini…";
  hideAskUI();
}

function showNeedKey() {
  const panel = ensurePanel();
  placePanelNearSelection(panel);
  panel.querySelector("#gca-title").textContent = "API key required";
  STATE.textarea.value = "No Gemini API key set. Click Settings to open the options page and add your key.";
  hideAskUI();
}

function showError(message) {
  const panel = ensurePanel();
  placePanelNearSelection(panel);
  panel.querySelector("#gca-title").textContent = "Error";
  STATE.textarea.value = message;
  hideAskUI();
}

function showResult(text) {
  const panel = ensurePanel();
  panel.querySelector("#gca-title").textContent = "✦ Ask Gemini";
  STATE.textarea.value = text;
  hideAskUI();
}

/* ---------- Highlighting ---------- */

function highlightSelection(color) {
  const sel = window.getSelection && window.getSelection();
  if (!sel || !sel.rangeCount || sel.isCollapsed) {
    // Optionally surface a subtle hint via the panel if present
    try {
      showError("No text selected to highlight.");
    } catch {}
    return;
  }
  const range = sel.getRangeAt(0);
  // Avoid inputs/textareas
  if (range.commonAncestorContainer && range.commonAncestorContainer.nodeType === 1) {
    const el = range.commonAncestorContainer;
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") return;
  }

  const wrapper = document.createElement("span");
  wrapper.className = `gca-highlight gca-h-${color}`;
  // Try surroundContents; if it fails (DOMException), fallback to extract/insert
  try {
    range.surroundContents(wrapper);
  } catch {
    const frag = range.extractContents();
    wrapper.appendChild(frag);
    range.insertNode(wrapper);
  }
  // Keep selection visible on the new highlight for quick re-actions
  sel.removeAllRanges();
  const newRange = document.createRange();
  newRange.selectNodeContents(wrapper);
  sel.addRange(newRange);
}

function collectHighlightedText() {
  const chunks = [];
  document.querySelectorAll(".gca-highlight").forEach((el) => {
    const t = (el.textContent || "").trim();
    if (t) chunks.push(t);
  });
  return chunks.join("\n\n");
}

/* ---------- Ask flow UI ---------- */

function openAskUI(requestId, originalText) {
  const panel = ensurePanel();
  placePanelNearSelection(panel);
  STATE.requestId = requestId;

  // If no selection text was passed, fall back to all highlighted text on the page
  const fallbackCtx = (!originalText || !originalText.trim()) ? collectHighlightedText() : "";
  STATE.originalText = (originalText && originalText.trim()) ? originalText : fallbackCtx;

  panel.querySelector("#gca-title").textContent = "Ask a question";
  STATE.textarea.value = "";
  STATE.askbar.style.display = "flex";
  STATE.askInput.value = "";
  STATE.askInput.focus();

  // Show captured context (preview + length)
  if (STATE.originalText) {
    const preview = ellipsize(STATE.originalText, 140);
    STATE.ctxInfo.style.display = "block";
    STATE.ctxInfo.textContent = `Using selection as context (${STATE.originalText.length} chars): ${preview}`;
  } else {
    STATE.ctxInfo.style.display = "none";
    STATE.ctxInfo.textContent = "";
  }
}

function hideAskUI() {
  if (STATE.askbar) STATE.askbar.style.display = "none";
  if (STATE.ctxInfo) {
    STATE.ctxInfo.style.display = "none";
    STATE.ctxInfo.textContent = "";
  }
}

function submitAsk() {
  const q = (STATE.askInput?.value || "").trim();
  if (!q) return;

  STATE.textarea.value = "Asking Gemini…";

  // Disable while sending to avoid double submits
  STATE.askInput.disabled = true;
  STATE.askBtn.disabled = true;

  chrome.runtime.sendMessage({
    type: "gca:ask:query",
    requestId: STATE.requestId,
    question: q,
    context: STATE.originalText,    // <- selection or all highlights
  }, () => {
    // Re-enable (result/error will come as a separate message)
    STATE.askInput.disabled = false;
    STATE.askBtn.disabled = false;
  });
}

/* ---------- Utils ---------- */

function ellipsize(text, maxLen) {
  if (!text) return "";
  return text.length > maxLen ? text.slice(0, maxLen) + "…" : text;
}

/* ---------- Messaging ---------- */

chrome.runtime.onMessage.addListener((msg) => {
  switch (msg?.type) {
    case "gca:start":
      STATE.requestId = msg.requestId;
      STATE.originalText = msg.originalText;
      showLoading(msg.actionLabel || "Working…");
      break;

    case "gca:needKey":
      if (STATE.requestId === msg.requestId) showNeedKey();
      break;

    case "gca:result":
      if (!STATE.requestId || STATE.requestId === msg.requestId) showResult(msg.result);
      break;

    case "gca:error":
      showError(msg.message || "Unknown error");
      break;

    case "gca:ask:open":
      openAskUI(msg.requestId, msg.originalText);
      break;

    case "gca:highlight":
      highlightSelection(msg.color);
      break;
  }
});
