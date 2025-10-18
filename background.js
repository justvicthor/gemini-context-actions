// background.js — MV3 service worker
// Creates the context menu tree, routes clicks, calls Gemini API, and sends results to the content script.

//const MODEL = "gemini-1.5-flash-latest"; // Fast & capable for editing tasks

const MODEL = "gemini-2.5-flash-lite"; // Updated model as of June 2024

// ---- Menu IDs (stable identifiers) ----
const MID = {
  TRANSLATE: "gca_translate",
  TRANSLATE_EN: "gca_translate_en",
  TRANSLATE_FR: "gca_translate_fr",
  TRANSLATE_DE: "gca_translate_de",
  TRANSLATE_IT: "gca_translate_it",
  TRANSLATE_ES: "gca_translate_es",

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

// ---- Create the context menu structure ----
function createMenus() {
  chrome.contextMenus.removeAll(() => {
    // Translate (first section)
    chrome.contextMenus.create({ id: MID.TRANSLATE, title: "Translate", contexts: ["selection"] });
    chrome.contextMenus.create({ id: MID.TRANSLATE_EN, parentId: MID.TRANSLATE, title: "English", contexts: ["selection"] });
    chrome.contextMenus.create({ id: MID.TRANSLATE_FR, parentId: MID.TRANSLATE, title: "French", contexts: ["selection"] });
    chrome.contextMenus.create({ id: MID.TRANSLATE_DE, parentId: MID.TRANSLATE, title: "German", contexts: ["selection"] });
    chrome.contextMenus.create({ id: MID.TRANSLATE_IT, parentId: MID.TRANSLATE, title: "Italian", contexts: ["selection"] });
    chrome.contextMenus.create({ id: MID.TRANSLATE_ES, parentId: MID.TRANSLATE, title: "Spanish", contexts: ["selection"] });

    // Quick actions
    chrome.contextMenus.create({ id: MID.QUICK, title: "Quick actions", contexts: ["selection"] });
    chrome.contextMenus.create({ id: MID.SUMMARIZE, parentId: MID.QUICK, title: "Summarize", contexts: ["selection"] });
    chrome.contextMenus.create({ id: MID.EXPLAIN, parentId: MID.QUICK, title: "Explain", contexts: ["selection"] });

    // Rewrite
    chrome.contextMenus.create({ id: MID.REWRITE, title: "Rewrite", contexts: ["selection"] });
    chrome.contextMenus.create({ id: MID.PARAPHRASE, parentId: MID.REWRITE, title: "Paraphrase", contexts: ["selection"] });
    chrome.contextMenus.create({ id: MID.IMPROVE, parentId: MID.REWRITE, title: "Improve", contexts: ["selection"] });

    // Change tone (submenu)
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

// ---- Prompt templates ----
function buildInstruction(menuId) {
  switch (menuId) {
    // Translate
    case MID.TRANSLATE_EN: return "Translate the text into English. Output only the translation.";
    case MID.TRANSLATE_FR: return "Translate the text into French. Output only the translation.";
    case MID.TRANSLATE_DE: return "Translate the text into German. Output only the translation.";
    case MID.TRANSLATE_IT: return "Translate the text into Italian. Output only the translation.";
    case MID.TRANSLATE_ES: return "Translate the text into Spanish. Output only the translation.";

    // Quick actions
    case MID.SUMMARIZE: return "Summarize the text into 3–6 crisp bullet points.";
    case MID.EXPLAIN: return "Explain the text in simple, clear language for a non-expert audience.";

    // Rewrite
    case MID.PARAPHRASE: return "Paraphrase to preserve meaning with different wording and better flow.";
    case MID.IMPROVE: return "Rewrite to improve clarity, grammar, and readability. Keep the original meaning.";

    // Tone
    case MID.TONE_ACAD: return "Rewrite in an academic tone: precise, objective, and formal.";
    case MID.TONE_PRO: return "Rewrite in a professional tone: clear, confident, and polite.";
    case MID.TONE_PERS: return "Rewrite in a persuasive tone: compelling and audience-focused.";
    case MID.TONE_CAS: return "Rewrite in a casual tone: friendly, relaxed, and conversational.";
    case MID.TONE_FUN: return "Rewrite in a funny tone: light-hearted, witty, and tasteful.";

    // Length
    case MID.SHORTEN: return "Condense the text significantly while preserving key meaning.";
    case MID.EXPAND: return "Expand the text with helpful detail and examples while keeping it coherent.";

    // Create
    case MID.TAGLINE: return "Create 5 concise, catchy taglines that capture the core message of the text.";
    case MID.SOCIAL_SHORT: return "Write a short social media post (max 60 words) based on the text.";
    case MID.SOCIAL_LONG: return "Write a longer social media post (150–200 words) based on the text.";

    default: return null;
  }
}

function makeUserPrompt(instruction, text) {
  return [
    "You are an excellent editor and translator.",
    instruction,
    "\n\nTEXT:\n\"\"\"",
    text,
    "\"\"\"\n\nReturn only the requested output, without extra commentary."
  ].join("");
}

// ---- Gemini API call ----
async function callGemini(apiKey, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }]
      }
    ]
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${t}`);
  }

  const data = await res.json();
  const candidate = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!candidate) throw new Error("No text returned by Gemini.");
  return candidate;
}

// Send a message to the active tab's content script
async function sendToActiveTab(msg) {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab?.id) {
    await chrome.tabs.sendMessage(tab.id, msg).catch(() => {});
  }
}

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const { menuItemId } = info;
  const instruction = buildInstruction(menuItemId);
  if (!instruction) return;

  const text = (info.selectionText || "").trim();
  if (!text) {
    sendToActiveTab({ type: "gca:error", message: "No text selected." });
    return;
  }

  const requestId = `gca_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  // Ask content script to show a floating panel while we compute
  await sendToActiveTab({
    type: "gca:start",
    requestId,
    actionLabel: chrome.contextMenus.getTitle ? (await chrome.contextMenus.getTitle(menuItemId)) : "Processing…",
    originalText: text
  });

  // Get API key and call Gemini
  const { geminiApiKey } = await chrome.storage.sync.get("geminiApiKey");
  if (!geminiApiKey) {
    await sendToActiveTab({ type: "gca:needKey", requestId });
    return;
  }

  try {
    const prompt = makeUserPrompt(instruction, text);
    const result = await callGemini(geminiApiKey, prompt);
    await sendToActiveTab({ type: "gca:result", requestId, result });
  } catch (err) {
    await sendToActiveTab({ type: "gca:error", requestId, message: err.message || String(err) });
  }
});

// Open options page on request from content script
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "gca:openOptions") {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
  }
});