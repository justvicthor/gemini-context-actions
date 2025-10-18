// options.js — stores the API key in chrome.storage.sync and offers a quick test
const keyInput = document.getElementById("key");
const saveBtn = document.getElementById("save");
const testBtn = document.getElementById("test");
const statusEl = document.getElementById("status");

async function load() {
  const { geminiApiKey } = await chrome.storage.sync.get("geminiApiKey");
  if (geminiApiKey) keyInput.value = geminiApiKey;
}

async function save() {
  const k = keyInput.value.trim();
  await chrome.storage.sync.set({ geminiApiKey: k });
  statusEl.textContent = "Saved.";
  statusEl.className = "ok";
}

async function test() {
  const k = keyInput.value.trim();
  if (!k) {
    statusEl.textContent = "Enter an API key first.";
    statusEl.className = "err";
    return;
  }
  statusEl.textContent = "Testing…";
  statusEl.className = "";
  try {
    const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=" + encodeURIComponent(k);
    const body = { contents: [{ role: "user", parts: [{ text: "Say OK" }] }] };
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    if (text.toLowerCase().includes("ok")) {
      statusEl.textContent = "Test successful.";
      statusEl.className = "ok";
    } else {
      statusEl.textContent = "Test completed but response looked unusual.";
      statusEl.className = "hint";
    }
  } catch (e) {
    statusEl.textContent = "Test failed: " + (e.message || e);
    statusEl.className = "err";
  }
}

saveBtn.addEventListener("click", save);
testBtn.addEventListener("click", test);
load();