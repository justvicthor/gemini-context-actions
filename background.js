// background.js — MV3 service worker

const MODEL = "gemini-2.5-flash-lite";     // ← change if you prefer another model
const API_BASE = "https://generativelanguage.googleapis.com/v1";

// ---- Menu IDs ----
const MID = {
  ASK: "gca_ask",

  TRANSLATE: "gca_translate",
  TRANSLATE_EN: "gca_translate_en",
  TRANSLATE_FR: "gca_translate_fr",
  TRANSLATE_DE: "gca_translate_de",
  TRANSLATE_IT: "gca_translate_it",
  TRANSLATE_ES: "gca_translate_es",

  HIGHLIGHT: "gca_highlight",
  HL_YELLOW: "gca_highlight_yellow",
  HL_ORANGE: "gca_highlight_orange",
  HL_RED:    "gca_highlight_red",
  HL_GREEN:  "gca_highlight_green",
  HL_CYAN:   "gca_highlight_cyan",
  HL_PURPLE: "gca_highlight_purple",

  QUICK: "gca_quick",
  SUMMARIZE: "gca_summarize",
  EXPLAIN: "gca_explain",

  REWRITE: "gca_rewrite",
  PARAPHRASE: "gca_paraphrase",
  IMPROVE: "gca_improve",
  TONE: "gca_tone",
  TONE_ACAD: "gca_tone_academic",
  TONE_PRO: "gca_tone_professional",
  TONE_PERS: "gca_tone_persuasive",
  TONE_CAS: "gca_tone_casual",
  TONE_FUN: "gca_tone_funny",

  LENGTH: "gca_length",
  SHORTEN: "gca_shorten",
  EXPAND: "gca_expand",

  CREATE: "gca_create",
  TAGLINE: "gca_tagline",
  SOCIAL: "gca_social",
  SOCIAL_SHORT: "gca_social_short",
  SOCIAL_LONG: "gca_social_long",
};

async function getLiveSelection(tabId) {
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => (window.getSelection ? String(window.getSelection()) : "")
    });
    return (result || "").trim();
  } catch {
    return "";
  }
}


function createMenus() {
  chrome.contextMenus.removeAll(() => {
    // Ask a question
    chrome.contextMenus.create({ id: MID.ASK, title: "Ask a question", contexts: ["selection"] });

    // Translate
    chrome.contextMenus.create({ id: MID.TRANSLATE, title: "Translate", contexts: ["selection"] });
    chrome.contextMenus.create({ id: MID.TRANSLATE_EN, parentId: MID.TRANSLATE, title: "English", contexts: ["selection"] });
    chrome.contextMenus.create({ id: MID.TRANSLATE_FR, parentId: MID.TRANSLATE, title: "French", contexts: ["selection"] });
    chrome.contextMenus.create({ id: MID.TRANSLATE_DE, parentId: MID.TRANSLATE, title: "German", contexts: ["selection"] });
    chrome.contextMenus.create({ id: MID.TRANSLATE_IT, parentId: MID.TRANSLATE, title: "Italian", contexts: ["selection"] });
    chrome.contextMenus.create({ id: MID.TRANSLATE_ES, parentId: MID.TRANSLATE, title: "Spanish", contexts: ["selection"] });

    // Highlight
    chrome.contextMenus.create({ id: MID.HIGHLIGHT, title: "Highlight", contexts: ["selection"] });
    chrome.contextMenus.create({ id: MID.HL_YELLOW, parentId: MID.HIGHLIGHT, title: "Yellow", contexts: ["selection"] });
    chrome.contextMenus.create({ id: MID.HL_ORANGE, parentId: MID.HIGHLIGHT, title: "Orange", contexts: ["selection"] });
    chrome.contextMenus.create({ id: MID.HL_RED,    parentId: MID.HIGHLIGHT, title: "Red",    contexts: ["selection"] });
    chrome.contextMenus.create({ id: MID.HL_GREEN,  parentId: MID.HIGHLIGHT, title: "Green",  contexts: ["selection"] });
    chrome.contextMenus.create({ id: MID.HL_CYAN,   parentId: MID.HIGHLIGHT, title: "Cyan",   contexts: ["selection"] });
    chrome.contextMenus.create({ id: MID.HL_PURPLE, parentId: MID.HIGHLIGHT, title: "Purple", contexts: ["selection"] });

    // Quick actions
    chrome.contextMenus.create({ id: MID.QUICK, title: "Quick actions", contexts: ["selection"] });
    chrome.contextMenus.create({ id: MID.SUMMARIZE, parentId: MID.QUICK, title: "Summarize", contexts: ["selection"] });
    chrome.contextMenus.create({ id: MID.EXPLAIN, parentId: MID.QUICK, title: "Explain", contexts: ["selection"] });

    // Rewrite
    chrome.contextMenus.create({ id: MID.REWRITE, title: "Rewrite", contexts: ["selection"] });
    chrome.contextMenus.create({ id: MID.PARAPHRASE, parentId: MID.REWRITE, title: "Paraphrase", contexts: ["selection"] });
    chrome.contextMenus.create({ id: MID.IMPROVE, parentId: MID.REWRITE, title: "Improve", contexts: ["selection"] });

    // Change tone
    chrome.contextMenus.create({ id: MID.TONE, parentId: MID.REWRITE, title: "Change tone", contexts: ["selection"] });
    chrome.contextMenus.create({ id: MID.TONE_ACAD, parentId: MID.TONE, title: "Academic", contexts: ["selection"] });
    chrome.contextMenus.create({ id: MID.TONE_PRO, parentId: MID.TONE, title: "Professional", contexts: ["selection"] });
    chrome.contextMenus.create({ id: MID.TONE_PERS, parentId: MID.TONE, title: "Persuasive", contexts: ["selection"] });
    chrome.contextMenus.create({ id: MID.TONE_CAS, parentId: MID.TONE, title: "Casual", contexts: ["selection"] });
    chrome.contextMenus.create({ id: MID.TONE_FUN, parentId: MID.TONE, title: "Funny", contexts: ["selection"] });

    // Change length
    chrome.contextMenus.create({ id: MID.LENGTH, title: "Change length", contexts: ["selection"] });
    chrome.contextMenus.create({ id: MID.SHORTEN, parentId: MID.LENGTH, title: "Shorten", contexts: ["selection"] });
    chrome.contextMenus.create({ id: MID.EXPAND, parentId: MID.LENGTH, title: "Expand", contexts: ["selection"] });

    // Create
    chrome.contextMenus.create({ id: MID.CREATE, title: "Create", contexts: ["selection"] });
    chrome.contextMenus.create({ id: MID.TAGLINE, parentId: MID.CREATE, title: "Tagline", contexts: ["selection"] });
    chrome.contextMenus.create({ id: MID.SOCIAL, parentId: MID.CREATE, title: "Social media", contexts: ["selection"] });
    chrome.contextMenus.create({ id: MID.SOCIAL_SHORT, parentId: MID.SOCIAL, title: "Short post", contexts: ["selection"] });
    chrome.contextMenus.create({ id: MID.SOCIAL_LONG, parentId: MID.SOCIAL, title: "Long post", contexts: ["selection"] });
  });
}
chrome.runtime.onInstalled.addListener(createMenus);
chrome.runtime.onStartup.addListener(createMenus);

// ---- Templates ----
function buildInstruction(menuId) {
  switch (menuId) {
    case MID.TRANSLATE_EN: return "Translate the text into English. Output only the translation.";
    case MID.TRANSLATE_FR: return "Translate the text into French. Output only the translation.";
    case MID.TRANSLATE_DE: return "Translate the text into German. Output only the translation.";
    case MID.TRANSLATE_IT: return "Translate the text into Italian. Output only the translation.";
    case MID.TRANSLATE_ES: return "Translate the text into Spanish. Output only the translation.";

    case MID.SUMMARIZE: return "Summarize the text into 3–6 crisp bullet points.";
    case MID.EXPLAIN:   return "Explain the text in simple, clear language for a non-expert audience.";

    case MID.PARAPHRASE: return "Paraphrase to preserve meaning with different wording and better flow.";
    case MID.IMPROVE:    return "Rewrite to improve clarity, grammar, and readability. Keep the original meaning.";

    case MID.TONE_ACAD: return "Rewrite in an academic tone: precise, objective, and formal.";
    case MID.TONE_PRO:  return "Rewrite in a professional tone: clear, confident, and polite.";
    case MID.TONE_PERS: return "Rewrite in a persuasive tone: compelling and audience-focused.";
    case MID.TONE_CAS:  return "Rewrite in a casual tone: friendly, relaxed, and conversational.";
    case MID.TONE_FUN:  return "Rewrite in a funny tone: light-hearted, witty, and tasteful.";

    case MID.SHORTEN: return "Condense the text significantly while preserving key meaning.";
    case MID.EXPAND:  return "Expand the text with helpful detail and examples while keeping it coherent.";

    case MID.TAGLINE:      return "Create 5 concise, catchy taglines that capture the core message of the text.";
    case MID.SOCIAL_SHORT: return "Write a short social media post (max 60 words) based on the text.";
    case MID.SOCIAL_LONG:  return "Write a longer social media post (150–200 words) based on the text.";

    default: return null;
  }
}

function makeUserPrompt(instruction, text) {
  return [
    "You are an excellent editor and translator.",
    instruction,
    "\n\nTEXT:\n\"\"\"", text, "\"\"\"\n\nReturn only the requested output."
  ].join("");
}

// Use model knowledge, but explicitly grant access to the selection (CONTEXT)
function makeAskPrompt(question, contextText) {
  const ctx = (contextText || "").trim();
  const q = (question || "").trim();

  if (ctx) {
    return [
      "You are a helpful expert. You DO have access to the user's selected text; it is provided below as CONTEXT.",
      "Use CONTEXT when relevant, and you may also use your general knowledge.",
      "If the question asks what the user selected (e.g., 'what text did I select', 'what's in the selection', 'quote the selection'),",
      "then answer directly by quoting or summarizing the CONTEXT as appropriate.",
      "Be concise (1-4 sentences).",
      "",
      "CONTEXT:",
      `"""`,
      ctx,
      `"""`,
      "",
      "QUESTION:",
      `"""`,
      q,
      `"""`,
      "",
      "Answer:"
    ].join("\n");
  }

  // No context captured
  return [
    "You are a helpful expert. Answer clearly and concisely using your general knowledge.",
    "Be concise (1-4 sentences).",
    "",
    "QUESTION:",
    `"""`,
    q,
    `"""`,
    "",
    "Answer:"
  ].join("\n");
}


// ---- Gemini call ----
async function callGemini(apiKey, prompt) {
  const url = `${API_BASE}/models/${MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = { contents: [{ role: "user", parts: [{ text: prompt }]}] };

  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${t}`);
  }
  const data = await res.json();
  const out = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!out) throw new Error("No text returned by Gemini.");
  return out;
}

// ---- Menu clicks ----
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const { menuItemId } = info;

  // Highlight flow -> No Gemini call involved: just message the content script to do the DOM work.
  if (
  menuItemId === MID.HL_YELLOW || menuItemId === MID.HL_ORANGE || menuItemId === MID.HL_RED ||
  menuItemId === MID.HL_GREEN  || menuItemId === MID.HL_CYAN   || menuItemId === MID.HL_PURPLE
) {
  const color =
    menuItemId === MID.HL_YELLOW ? "yellow" :
    menuItemId === MID.HL_ORANGE ? "orange" :
    menuItemId === MID.HL_RED    ? "red"    :
    menuItemId === MID.HL_GREEN  ? "green"  :
    menuItemId === MID.HL_CYAN   ? "cyan"   : "purple";
  if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: "gca:highlight", color });
  return;
}

  //NEW: open the ask UI in the content script
  if (menuItemId === MID.ASK) {
    const selection = (info.selectionText || "").trim();
    const requestId = `gca_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
    chrome.tabs.sendMessage(tab.id, { type: "gca:ask:open", requestId, originalText: selection });
    return;
  }

  // Existing flows
  const instruction = buildInstruction(menuItemId);
  if (!instruction) return;

  const text = (info.selectionText || "").trim();
  if (!text) {
    chrome.tabs.sendMessage(tab.id, { type: "gca:error", message: "No text selected." });
    return;
  }

  const requestId = `gca_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
  chrome.tabs.sendMessage(tab.id, { type: "gca:start", requestId, actionLabel: "Working…", originalText: text });

  const { geminiApiKey } = await chrome.storage.sync.get("geminiApiKey");
  if (!geminiApiKey) { chrome.tabs.sendMessage(tab.id, { type: "gca:needKey", requestId }); return; }

  try {
    const prompt = makeUserPrompt(instruction, text);
    const result = await callGemini(geminiApiKey, prompt);
    chrome.tabs.sendMessage(tab.id, { type: "gca:result", requestId, result });
  } catch (err) {
    chrome.tabs.sendMessage(tab.id, { type: "gca:error", requestId, message: err.message || String(err) });
  }
});

// ---- Messages from content script (ask flow + options) ----
chrome.runtime.onMessage.addListener(async (msg, sender, sendResponse) => {
  if (msg?.type === "gca:ask:query") {
    const tabId = sender.tab?.id;
    const { geminiApiKey } = await chrome.storage.sync.get("geminiApiKey");
    if (!geminiApiKey) {
      if (tabId) chrome.tabs.sendMessage(tabId, { type: "gca:needKey", requestId: msg.requestId });
      sendResponse({ ok: false });
      return true;
    }
    try {
      const prompt = makeAskPrompt(msg.question, msg.context || "");
      const result = await callGemini(geminiApiKey, prompt);
      if (tabId) chrome.tabs.sendMessage(tabId, { type: "gca:result", requestId: msg.requestId, result });
      sendResponse({ ok: true });
    } catch (e) {
      if (tabId) chrome.tabs.sendMessage(tabId, { type: "gca:error", requestId: msg.requestId, message: e.message || String(e) });
      sendResponse({ ok: false });
    }
    return true; // keep port open for async
  }

  if (msg?.type === "gca:openOptions") {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
  }
});
