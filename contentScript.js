// contentScript.js — Injects a floating panel, positions near selection, handles copy/replace/close.

const STATE = {
  panel: null,
  textarea: null,
  header: null,
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
    <textarea id="gca-textarea" placeholder="Working with Gemini…" rows="10"></textarea>
    <div class="gca-footer">Tip: Use right‑click on selected text to run another action.</div>
  `;

  document.documentElement.appendChild(panel);

  // Cache refs
  STATE.panel = panel;
  STATE.textarea = panel.querySelector("#gca-textarea");
  STATE.header = panel.querySelector("#gca-header");

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

  return panel;
}

function makeDraggable(el, handle) {
  let startX = 0, startY = 0, origX = 0, origY = 0, dragging = false;
  handle.style.cursor = "move";
  handle.addEventListener("mousedown", (e) => {
    dragging = true;
    startX = e.clientX; startY = e.clientY;
    const r = el.getBoundingClientRect();
    origX = r.left; origY = r.top;
    e.preventDefault();
  });
  document.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    el.style.left = Math.max(8, origX + dx) + "px";
    el.style.top = Math.max(8, origY + dy) + "px";
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
  panel.style.top = y + "px";
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
  const titleEl = panel.querySelector("#gca-title");
  titleEl.textContent = title || "Gemini Context Actions";
  STATE.textarea.value = "Generating with Gemini…";
}

function showNeedKey() {
  const panel = ensurePanel();
  placePanelNearSelection(panel);
  const titleEl = panel.querySelector("#gca-title");
  titleEl.textContent = "API key required";
  STATE.textarea.value = "No Gemini API key set. Click Settings to open the options page and add your key.";
}

function showError(message) {
  const panel = ensurePanel();
  placePanelNearSelection(panel);
  const titleEl = panel.querySelector("#gca-title");
  titleEl.textContent = "Error";
  STATE.textarea.value = message;
}

function showResult(text) {
  const panel = ensurePanel();
  const titleEl = panel.querySelector("#gca-title");
  titleEl.textContent = "Result";
  STATE.textarea.value = text;
}

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
      if (STATE.requestId === msg.requestId) showResult(msg.result);
      break;
    case "gca:error":
      showError(msg.message || "Unknown error");
      break;
  }
});