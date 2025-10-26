// contentScript.js — Floating panel + inline highlighting with removable bubbles + PERSISTENCE (TextQuote+Context anchors).

const STORAGE_KEY = "gca_highlights_anchor_v1"; // storage schema

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
  listenersBound: false, // doc-level listeners only once
};

/* ---------- Storage helpers ---------- */

const storage = {
  getAll: () =>
    new Promise((resolve) => {
      chrome.storage.local.get(STORAGE_KEY, (res) => resolve(res[STORAGE_KEY] || {}));
    }),
  setAll: (obj) =>
    new Promise((resolve) => {
      chrome.storage.local.set({ [STORAGE_KEY]: obj }, resolve);
    }),
};

function pageKey() {
  // Stable identity: origin + path (ignore ?query and #hash)
  try {
    const u = new URL(location.href);
    return u.origin + u.pathname;
  } catch {
    return location.origin + location.pathname;
  }
}

/* ---------- Panel lifecycle ---------- */

function inDOM(node) {
  return !!(node && node.ownerDocument && node.ownerDocument.contains(node));
}

function destroyPanel() {
  if (STATE.panel && inDOM(STATE.panel)) STATE.panel.remove();
  STATE.panel = STATE.textarea = STATE.header = STATE.askbar = STATE.askInput = STATE.askBtn = STATE.ctxInfo = null;
}

function ensurePanel() {
  if (!inDOM(STATE.panel)) STATE.panel = null;
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

  STATE.panel = panel;
  STATE.textarea = panel.querySelector("#gca-textarea");
  STATE.header = panel.querySelector("#gca-header");
  STATE.askbar = panel.querySelector("#gca-ask");
  STATE.askInput = panel.querySelector("#gca-question");
  STATE.askBtn = panel.querySelector("#gca-ask-btn");
  STATE.ctxInfo = panel.querySelector("#gca-ctxinfo");

  makeDraggable(panel, STATE.header);

  panel.querySelector("#gca-close").addEventListener("click", () => destroyPanel());
  panel.querySelector("#gca-copy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(STATE.textarea?.value || ""); } catch {}
  });
  panel.querySelector("#gca-replace").addEventListener("click", () => replaceCurrentSelection(STATE.textarea?.value || ""));
  panel.querySelector("#gca-settings").addEventListener("click", () => chrome.runtime.sendMessage({ type: "gca:openOptions" }));

  STATE.askBtn.addEventListener("click", submitAsk);
  STATE.askInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); submitAsk(); } });

  if (!STATE.listenersBound) {
    STATE.listenersBound = true;

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && STATE.panel && inDOM(STATE.panel)) destroyPanel();
    });

    // Toggle sticky bubble on click
    document.addEventListener("click", (e) => {
      const span = e.target.closest(".gca-highlight");
      if (span) span.classList.toggle("gca-h-active");
    });
  }

  return panel;
}

/* ---------- Panel UX helpers ---------- */

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

/* ---------- Text index over the whole page (for robust anchors) ---------- */

function allTextNodes(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      const p = n.parentElement;
      if (!p) return NodeFilter.FILTER_REJECT;
      const tag = p.tagName;
      // skip script/style/noscript/hidden UI and our handles
      if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT") return NodeFilter.FILTER_REJECT;
      if (p.classList.contains("gca-handle")) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const out = [];
  let n;
  while ((n = walker.nextNode())) out.push(n);
  return out;
}

function buildPageIndex() {
  const nodes = allTextNodes(document.body);
  let text = "";
  const segments = []; // {node,start,end}
  for (const node of nodes) {
    const start = text.length;
    text += node.nodeValue;
    segments.push({ node, start, end: text.length });
  }
  return { text, segments };
}

function rangeToPageOffsets(range) {
  const { segments } = buildPageIndex();
  let start = -1, end = -1;
  for (const seg of segments) {
    if (seg.node === range.startContainer) start = seg.start + range.startOffset;
    if (seg.node === range.endContainer)   end   = seg.start + range.endOffset;
  }
  return { start, end };
}

function pageOffsetsToRange(start, end) {
  const { segments } = buildPageIndex();
  const r = document.createRange();
  let setStart = false, setEnd = false;
  for (const seg of segments) {
    if (!setStart && start >= seg.start && start <= seg.end) {
      r.setStart(seg.node, start - seg.start);
      setStart = true;
    }
    if (!setEnd && end >= seg.start && end <= seg.end) {
      r.setEnd(seg.node, end - seg.start);
      setEnd = true;
      break;
    }
  }
  return (setStart && setEnd) ? r : null;
}

/* ---------- Highlighting (with persistence) ---------- */

function uuid() {
  return "h-" + Math.random().toString(36).slice(2, 8) + Date.now().toString(36);
}

function decorateHighlight(span) {
  span.classList.add("gca-highlight");

  if (!span.querySelector(".gca-handle")) {
    const btn = document.createElement("button");
    btn.className = "gca-handle";
    btn.title = "Remove highlight";
    btn.setAttribute("aria-label", "Remove highlight");
    btn.type = "button";
    btn.textContent = "×";
    btn.style.userSelect = "none";

    const remove = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await unwrapHighlight(span); // also deletes from storage
    };
    btn.addEventListener("mousedown", remove, { capture: true });
    btn.addEventListener("click", remove, { capture: true });

    span.appendChild(btn);
  }
}

async function highlightSelection(color) {
  const sel = window.getSelection && window.getSelection();
  if (!sel || !sel.rangeCount || sel.isCollapsed) {
    try { showError("No text selected to highlight."); } catch {}
    return;
  }
  const range = sel.getRangeAt(0);
  // Avoid inputs/textareas
  if (range.commonAncestorContainer && range.commonAncestorContainer.nodeType === 1) {
    const el = range.commonAncestorContainer;
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") return;
  }

  // Build page-level offsets and context (TextQuote + prefix/suffix)
  const { text: pageText } = buildPageIndex();
  const { start, end } = rangeToPageOffsets(range);
  if (start < 0 || end < 0) return;

  const quote = pageText.slice(start, end);
  const ctxLen = 32;
  const prefix = pageText.slice(Math.max(0, start - ctxLen), start);
  const suffix = pageText.slice(end, Math.min(pageText.length, end + ctxLen));
  const id = uuid();

  // Wrap selection
  const wrapper = document.createElement("span");
  wrapper.className = `gca-highlight gca-h-${color}`;
  wrapper.dataset.gcaId = id;
  try { range.surroundContents(wrapper); }
  catch { const frag = range.extractContents(); wrapper.appendChild(frag); range.insertNode(wrapper); }
  decorateHighlight(wrapper);

  // Reselect new highlight
  sel.removeAllRanges();
  const newRange = document.createRange();
  newRange.selectNodeContents(wrapper);
  sel.addRange(newRange);

  // Persist
  const all = await storage.getAll();
  const key = pageKey();
  const arr = all[key] || [];
  arr.push({ id, color, quote, prefix, suffix, createdAt: Date.now() });
  all[key] = arr;
  await storage.setAll(all);
}

async function unwrapHighlight(span) {
  if (!span || !span.parentNode) return;
  const id = span.dataset.gcaId;

  // Place caret after removed span
  const after = document.createRange();
  after.setStartAfter(span);
  after.collapse(true);

  // Remove handle; unwrap
  span.querySelectorAll(".gca-handle").forEach((n) => n.remove());
  const parent = span.parentNode;
  while (span.firstChild) parent.insertBefore(span.firstChild, span);
  parent.removeChild(span);

  // Restore caret
  const sel = window.getSelection && window.getSelection();
  if (sel) { sel.removeAllRanges(); sel.addRange(after); }

  // Delete from storage
  if (id) {
    const all = await storage.getAll();
    const key = pageKey();
    all[key] = (all[key] || []).filter((r) => r.id !== id);
    await storage.setAll(all);
  }
}

function getHighlightText(span) {
  const clone = span.cloneNode(true);
  clone.querySelectorAll(".gca-handle").forEach((n) => n.remove());
  return (clone.textContent || "").trim();
}

function collectHighlightedText() {
  const chunks = [];
  document.querySelectorAll(".gca-highlight").forEach((el) => {
    const t = getHighlightText(el);
    if (t) chunks.push(t);
  });
  return chunks.join("\n\n");
}

/* ---------- Restore saved highlights (robust search) ---------- */

function tryRestoreRecord(rec) {
  // Search the page text for the rec.quote, preferring occurrences that match prefix/suffix
  const { text: pageText } = buildPageIndex();
  const quote = rec.quote || "";
  if (!quote) return false;

  let idx = -1;
  // Prefer exact prefix/suffix match
  let from = 0;
  const tryMatch = () => {
    idx = pageText.indexOf(quote, from);
    return idx !== -1;
  };

  while (tryMatch()) {
    const pre = pageText.slice(Math.max(0, idx - rec.prefix.length), idx);
    const suf = pageText.slice(idx + quote.length, idx + quote.length + rec.suffix.length);
    const preOK = rec.prefix ? pre === rec.prefix : true;
    const sufOK = rec.suffix ? suf === rec.suffix : true;
    if (preOK && sufOK) break; // good match
    from = idx + 1; // keep searching
  }

  // Fallback: first occurrence
  if (idx === -1) idx = pageText.indexOf(quote);
  if (idx === -1) return false;

  const start = idx;
  const end = idx + quote.length;
  const r = pageOffsetsToRange(start, end);
  if (!r) return false;

  const wrapper = document.createElement("span");
  wrapper.className = `gca-highlight gca-h-${rec.color}`;
  wrapper.dataset.gcaId = rec.id;

  try { r.surroundContents(wrapper); }
  catch { const frag = r.extractContents(); wrapper.appendChild(frag); r.insertNode(wrapper); }

  decorateHighlight(wrapper);
  return true;
}

async function restoreHighlightsRobust() {
  const all = await storage.getAll();
  const key = pageKey();
  const recs = all[key] || [];
  if (!recs.length) return;

  // oldest → newest (reduces nested-range conflicts)
  recs.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

  const pending = new Map(recs.map(r => [r.id, r]));
  const attempt = () => {
    for (const [id, rec] of [...pending]) {
      if (tryRestoreRecord(rec)) pending.delete(id);
    }
    return pending.size === 0;
  };

  // 1) Try immediately
  if (attempt()) return;

  // 2) Retry while the DOM changes (SPA/lazy content) + a short timer loop (~20s)
  const observer = new MutationObserver(() => { if (attempt()) observer.disconnect(); });
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });

  let tries = 0;
  const maxTries = 120; // ~20s @166ms
  const timer = setInterval(() => {
    if (attempt() || ++tries >= maxTries) { clearInterval(timer); observer.disconnect(); }
  }, 166);
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
  if (STATE.ctxInfo) { STATE.ctxInfo.style.display = "none"; STATE.ctxInfo.textContent = ""; }
}

function submitAsk() {
  const q = (STATE.askInput?.value || "").trim();
  if (!q) return;

  STATE.textarea.value = "Asking Gemini…";
  STATE.askInput.disabled = true;
  STATE.askBtn.disabled = true;

  chrome.runtime.sendMessage({
    type: "gca:ask:query",
    requestId: STATE.requestId,
    question: q,
    context: STATE.originalText, // selection or all highlights
  }, () => {
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

/* ---------- Boot: restore saved highlights ---------- */

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", restoreHighlightsRobust, { once: true });
} else {
  restoreHighlightsRobust();
}
window.addEventListener("pageshow", restoreHighlightsRobust, { once: true });
