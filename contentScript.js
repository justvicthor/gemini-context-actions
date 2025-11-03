// contentScript.js — Floating panel + highlighting with removable bubbles + persistence

/* ---------- Constants ---------- */

const STORAGE_KEY = "gca_highlights_anchor_v3"; // bump schema version to reset all highlights

/* ---------- State ---------- */

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
  listenersBound: false,
};

/* ---------- Storage ---------- */

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
  try {
    const u = new URL(location.href);
    return u.origin + u.pathname; // stable; ignore ? and #
  } catch {
    return location.origin + location.pathname;
  }
}

/* ---------- Panel lifecycle ---------- */

function inDOM(node) { return !!(node && node.ownerDocument && node.ownerDocument.contains(node)); }

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
    <div class="gca-ask" id="gca-ask" style="display:none;">
      <input id="gca-question" type="text" placeholder="Type your question…" />
      <button id="gca-ask-btn">Ask</button>
    </div>
    <div class="gca-ctxinfo" id="gca-ctxinfo" style="display:none;"></div>
    <textarea id="gca-textarea" placeholder="Working with Gemini…" rows="10"></textarea>
    <div class="gca-footer">Tip: Use right-click on selected text to run another action.</div>
  `;
  document.documentElement.appendChild(panel);

  STATE.panel   = panel;
  STATE.textarea= panel.querySelector("#gca-textarea");
  STATE.header  = panel.querySelector("#gca-header");
  STATE.askbar  = panel.querySelector("#gca-ask");
  STATE.askInput= panel.querySelector("#gca-question");
  STATE.askBtn  = panel.querySelector("#gca-ask-btn");
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
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && STATE.panel && inDOM(STATE.panel)) destroyPanel(); });
    document.addEventListener("click", (e) => {
      const span = e.target.closest(".gca-highlight");
      if (span) span.classList.toggle("gca-h-active");
    });
  }
  return panel;
}

/* ---------- Panel UX ---------- */

function makeDraggable(el, handle) {
  let startX=0,startY=0,origX=0,origY=0,drag=false;
  handle.style.cursor="move";
  handle.addEventListener("mousedown",(e)=>{drag=true;startX=e.clientX;startY=e.clientY;const r=el.getBoundingClientRect();origX=r.left;origY=r.top;e.preventDefault();});
  document.addEventListener("mousemove",(e)=>{if(!drag)return;el.style.left=Math.max(8,origX+e.clientX-startX)+"px";el.style.top=Math.max(8,origY+e.clientY-startY)+"px";});
  document.addEventListener("mouseup",()=>{drag=false;});
}
function placePanelNearSelection(panel){
  const sel=window.getSelection();let x=24,y=24;
  if(sel&&sel.rangeCount){const rect=sel.getRangeAt(0).getBoundingClientRect();if(rect&&rect.width>=0){x=Math.max(8,rect.left+window.scrollX);y=Math.max(8,rect.bottom+window.scrollY+8);}}
  panel.style.left=x+"px";panel.style.top=y+"px";
}
function replaceCurrentSelection(text){const sel=window.getSelection();if(!sel||!sel.rangeCount)return;const r=sel.getRangeAt(0);r.deleteContents();r.insertNode(document.createTextNode(text));}
function showLoading(t){const p=ensurePanel();placePanelNearSelection(p);p.querySelector("#gca-title").textContent=t||"Gemini Context Actions";STATE.textarea.value="Generating with Gemini…";hideAskUI();}
function showNeedKey(){const p=ensurePanel();placePanelNearSelection(p);p.querySelector("#gca-title").textContent="API key required";STATE.textarea.value="No Gemini API key set. Click Settings to open the options page and add your key.";hideAskUI();}
function showError(m){const p=ensurePanel();placePanelNearSelection(p);p.querySelector("#gca-title").textContent="Error";STATE.textarea.value=m;hideAskUI();}
function showResult(t){const p=ensurePanel();p.querySelector("#gca-title").textContent="✦ Ask Gemini";STATE.textarea.value=t;hideAskUI();}

/* ---------- Page text index (exclude our own UI) ---------- */

function makeTextWalkerRoot() {
  const filter = {
    acceptNode(n) {
      const p = n.parentElement;
      if (!p) return NodeFilter.FILTER_REJECT;
      const tag = p.tagName;
      if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT") return NodeFilter.FILTER_REJECT;
      if (p.closest && p.closest("#gca-panel")) return NodeFilter.FILTER_REJECT;
      if (p.classList && p.classList.contains("gca-handle")) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  };
  return document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, filter);
}

function allTextNodes(){
  const w = makeTextWalkerRoot();
  const out = []; let n;
  while ((n = w.nextNode())) out.push(n);
  return out;
}

function buildPageIndex(){
  const nodes=allTextNodes(); let text=""; const seg=[];
  for (const node of nodes) { const s=text.length; text+=node.nodeValue; seg.push({node,start:s,end:text.length}); }
  return { text, segments: seg };
}

/* ---------- Whitespace helpers ---------- */

// \s + NBSP, NNBSP/BOM, narrow/thin/hair spaces, zero-width (ZWSP/ZWJ/ZWNJ), WORD JOINER, SOFT HYPHEN
const WS = /[\s\u00A0\u202F\u2009\u200A\u2002-\u2008\u2000\u2001\u200B-\u200D\uFEFF\u2060\u00AD]/;

function trimPageOffsets(pageText, start, end){
  while(start<end && WS.test(pageText[start])) start++;
  while(end>start && WS.test(pageText[end-1])) end--;
  return {start,end};
}
function getTextWithoutHandles(el){
  const clone=el.cloneNode(true);
  clone.querySelectorAll(".gca-handle").forEach(n=>n.remove());
  return clone.textContent||"";
}
function isWhitespaceOnlyText(el){
  const s=getTextWithoutHandles(el);
  return !s || !s.replace(WS,"");
}
function unwrapSpanKeepContent(span){
  const parent=span.parentNode;
  while(span.firstChild) parent.insertBefore(span.firstChild,span);
  parent.removeChild(span);
}
function normalizeAdjacentWhitespaceHighlights(span){
  const prev=span.previousSibling, next=span.nextSibling;
  [prev,next].forEach(sib=>{
    if(!sib||sib.nodeType!==1) return;
    const el = /** @type {HTMLElement} */(sib);
    if(!el.classList?.contains("gca-highlight")) return;
    if(isWhitespaceOnlyText(el)) unwrapSpanKeepContent(el);
  });
}

/* ---------- Highlighting + persistence ---------- */

function uuid(){ return "h-"+Math.random().toString(36).slice(2,8)+Date.now().toString(36); }

function decorateHighlight(span){
  span.classList.add("gca-highlight");
  if(!span.querySelector(".gca-handle")){
    const btn=document.createElement("button");
    btn.className="gca-handle"; btn.title="Remove highlight";
    btn.setAttribute("aria-label","Remove highlight");
    btn.type="button"; btn.textContent="×"; btn.style.userSelect="none";
    const remove=async(e)=>{e.preventDefault();e.stopPropagation();await unwrapHighlight(span);};
    btn.addEventListener("mousedown",remove,{capture:true});
    btn.addEventListener("click",remove,{capture:true});
    span.appendChild(btn);
  }
}

/**
 * NEW: Wrap first, then persist.
 * This avoids failures when selections end at element boundaries.
 */
async function highlightSelection(color){
  const sel = window.getSelection && window.getSelection();
  if (!sel || !sel.rangeCount || sel.isCollapsed) { try { showError("No text selected to highlight."); } catch {} return; }

  // Avoid inputs/textareas
  const r0 = sel.getRangeAt(0).cloneRange();
  if (r0.commonAncestorContainer && r0.commonAncestorContainer.nodeType === 1) {
    const el = r0.commonAncestorContainer;
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") return;
  }

  // Create wrapper and try to surround; if it throws, extract/insert.
  const id   = uuid();
  const span = document.createElement("span");
  span.className = `gca-highlight gca-h-${color}`;
  span.dataset.gcaId = id;

  try {
    r0.surroundContents(span);
  } catch {
    const frag = r0.extractContents();
    span.appendChild(frag);
    r0.insertNode(span);
  }

  decorateHighlight(span);
  normalizeAdjacentWhitespaceHighlights(span);

  // Reselect the new highlight for better UX
  sel.removeAllRanges();
  const nr = document.createRange();
  nr.selectNodeContents(span);
  sel.addRange(nr);

  // ---- PERSISTENCE (quote + small context) ----
  const quote = getTextWithoutHandles(span).trim();
  const { text: pageText } = buildPageIndex(); // excludes our UI
  let idx = pageText.indexOf(quote);

  // If the exact slice is ambiguous or not found (rare), try a whitespace-normalized search.
  if (idx === -1) {
    const norm = (s) => s.replace(/\s+/g, " ").trim();
    const nQuote = norm(quote);
    const nPage  = norm(pageText);
    const nIdx   = nPage.indexOf(nQuote);
    if (nIdx !== -1) {
      // Map back approximately (good enough because we store prefix/suffix anchors)
      idx = Math.max(0, pageText.indexOf(quote.split(/\s+/)[0]));
    }
  }

  const ctx = 32;
  const prefix = idx !== -1 ? pageText.slice(Math.max(0, idx - ctx), idx) : "";
  const suffix = idx !== -1 ? pageText.slice(idx + quote.length, Math.min(pageText.length, idx + quote.length + ctx)) : "";

  const all = await storage.getAll();
  const key = pageKey();
  const arr = all[key] || [];
  arr.push({ id, color, quote, prefix, suffix, createdAt: Date.now() });
  all[key] = arr;
  await storage.setAll(all);
}

async function unwrapHighlight(span){
  if(!span||!span.parentNode) return;
  const id=span.dataset.gcaId;

  document.querySelectorAll(`[data-gca-id="${CSS.escape(id||"")}"]`).forEach(s=>{
    const after=document.createRange(); after.setStartAfter(s); after.collapse(true);
    s.querySelectorAll(".gca-handle").forEach(n=>n.remove());
    unwrapSpanKeepContent(s);
    const sel=window.getSelection&&window.getSelection(); if(sel){ sel.removeAllRanges(); sel.addRange(after); }
  });

  if(id){
    const all=await storage.getAll(); const key=pageKey();
    all[key] = (all[key]||[]).filter(r=>r.id!==id); await storage.setAll(all);
  }
}

function getHighlightText(span){ const c=span.cloneNode(true); c.querySelectorAll(".gca-handle").forEach(n=>n.remove()); return (c.textContent||"").trim(); }
function collectHighlightedText(){ const arr=[]; document.querySelectorAll(".gca-highlight").forEach(el=>{ const t=getHighlightText(el); if(t) arr.push(t); }); return arr.join("\n\n"); }

/* ---------- Restore ---------- */

function tryRestoreRecord(rec){
  const {text:pageText}=buildPageIndex();
  if(!rec.quote) return false;

  let idx=-1, from=0;
  while((idx=pageText.indexOf(rec.quote,from))!==-1){
    const pre=pageText.slice(Math.max(0,idx-(rec.prefix||"").length),idx);
    const suf=pageText.slice(idx+rec.quote.length,idx+rec.quote.length+(rec.suffix||"").length);
    const preOK=rec.prefix?pre===rec.prefix:true;
    const sufOK=rec.suffix?suf===rec.suffix:true;
    if(preOK && sufOK) break;
    from=idx+1;
  }
  if(idx===-1) idx=pageText.indexOf(rec.quote);
  if(idx===-1) return false;

  let start=idx, end=idx+rec.quote.length;
  ({start,end}=trimPageOffsets(pageText,start,end));
  if(end<=start) return false;

  // Map to DOM range and wrap (this part can safely use offsets post-load)
  const { segments } = buildPageIndex();
  const r=document.createRange(); let a=false,b=false;
  for(const seg of segments){
    if(!a&&start>=seg.start&&start<=seg.end){r.setStart(seg.node,start-seg.start);a=true;}
    if(!b&&end>=seg.start&&end<=seg.end){r.setEnd(seg.node,end-seg.start);b=true;break;}
  }
  if(!(a&&b)) return false;

  const span=document.createElement("span");
  span.className=`gca-highlight gca-h-${rec.color}`; span.dataset.gcaId=rec.id;

  try{ r.surroundContents(span); }
  catch{ const frag=r.extractContents(); span.appendChild(frag); r.insertNode(span); }

  decorateHighlight(span);
  normalizeAdjacentWhitespaceHighlights(span);
  return true;
}

async function restoreHighlightsRobust(){
  const all=await storage.getAll(); const key=pageKey(); const recs=all[key]||[];
  if(!recs.length) return;

  recs.sort((a,b)=>(a.createdAt||0)-(b.createdAt||0));
  const pending=new Map(recs.map(r=>[r.id,r]));

  const attempt=()=>{ for(const [id,rec] of [...pending]){ if(tryRestoreRecord(rec)) pending.delete(id); } return pending.size===0; };

  if(attempt()) return;

  const obs=new MutationObserver(()=>{ if(attempt()) obs.disconnect(); });
  obs.observe(document.documentElement,{childList:true,subtree:true,characterData:true});

  let tries=0; const max=120; const t=setInterval(()=>{ if(attempt()||++tries>=max){ clearInterval(t); obs.disconnect(); } },166);
}

/* ---------- Ask flow ---------- */

function openAskUI(requestId, originalText){
  const panel=ensurePanel(); placePanelNearSelection(panel);
  STATE.requestId=requestId;
  const fallback=(!originalText||!originalText.trim())?collectHighlightedText():"";
  STATE.originalText=(originalText&&originalText.trim())?originalText:fallback;

  panel.querySelector("#gca-title").textContent="Ask a question";
  STATE.textarea.value=""; STATE.askbar.style.display="flex"; STATE.askInput.value=""; STATE.askInput.focus();

  if(STATE.originalText){
    const prev=ellipsize(STATE.originalText,140);
    STATE.ctxInfo.style.display="block"; STATE.ctxInfo.textContent=`Using selection as context (${STATE.originalText.length} chars): ${prev}`;
  } else { STATE.ctxInfo.style.display="none"; STATE.ctxInfo.textContent=""; }
}
function hideAskUI(){ if(STATE.askbar) STATE.askbar.style.display="none"; if(STATE.ctxInfo){ STATE.ctxInfo.style.display="none"; STATE.ctxInfo.textContent=""; } }
function submitAsk(){
  const q=(STATE.askInput?.value||"").trim(); if(!q) return;
  STATE.textarea.value="Asking Gemini…"; STATE.askInput.disabled=true; STATE.askBtn.disabled=true;
  chrome.runtime.sendMessage({ type:"gca:ask:query", requestId:STATE.requestId, question:q, context:STATE.originalText },()=>{
    STATE.askInput.disabled=false; STATE.askBtn.disabled=false;
  });
}

/* ---------- Utils ---------- */
function ellipsize(s,n){ return s && s.length>n ? s.slice(0,n)+"…" : (s||""); }

/* ---------- Messaging ---------- */

chrome.runtime.onMessage.addListener((msg)=>{
  switch(msg?.type){
    case "gca:start": STATE.requestId=msg.requestId; STATE.originalText=msg.originalText; showLoading(msg.actionLabel||"Working…"); break;
    case "gca:needKey": if(STATE.requestId===msg.requestId) showNeedKey(); break;
    case "gca:result": if(!STATE.requestId||STATE.requestId===msg.requestId) showResult(msg.result); break;
    case "gca:error": showError(msg.message||"Unknown error"); break;
    case "gca:ask:open": openAskUI(msg.requestId,msg.originalText); break;
    case "gca:highlight": highlightSelection(msg.color); break;
  }
});

/* ---------- Boot ---------- */

if(document.readyState==="loading"){
  document.addEventListener("DOMContentLoaded", restoreHighlightsRobust, { once:true });
} else {
  restoreHighlightsRobust();
}
window.addEventListener("pageshow", restoreHighlightsRobust, { once:true });
