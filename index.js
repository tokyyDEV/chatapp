// ═══════════════════════════════════════════
//  app.js – OpenChat
//  Firebase v12 moduláris API
// ═══════════════════════════════════════════

import { initializeApp }                        from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
import { getAnalytics }                         from "https://www.gstatic.com/firebasejs/12.15.0/firebase-analytics.js";
import {
  getDatabase, ref, push, onChildAdded,
  onValue, set, remove, onDisconnect, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-database.js";

// ── Config ────────────────────────────────
const firebaseConfig = {
  apiKey:            "AIzaSyAmQZv0sk3l0CFZHC4P_-b43ByY_VlHTYM",
  authDomain:        "chat-beni-aef24.firebaseapp.com",
  databaseURL:       "https://chat-beni-aef24-default-rtdb.europe-west1.firebasedatabase.app",
  projectId:         "chat-beni-aef24",
  storageBucket:     "chat-beni-aef24.firebasestorage.app",
  messagingSenderId: "215126060432",
  appId:             "1:215126060432:web:5a1a365f9c6c912d721715",
  measurementId:     "G-Q1H7N93SJ3"
};

const app       = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const db        = getDatabase(app);

const messagesRef = ref(db, "messages");
const onlineRef   = ref(db, "online");
const typingRef   = ref(db, "typing");

// ── State ─────────────────────────────────
let myName  = "";
let myId    = Math.random().toString(36).slice(2, 10);
let myColor = "";
let typingTimer  = null;
let isTyping     = false;
let listenersOn  = false;

const COLORS = [
  "#00e5a0","#00b8ff","#ff6b6b","#ffd93d",
  "#c77dff","#ff9f43","#48dbfb","#ff6b81",
  "#a29bfe","#55efc4","#fd79a8","#fdcb6e",
];

function nameToColor(name) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  return COLORS[h % COLORS.length];
}
function initials(name) { return name.slice(0, 2).toUpperCase(); }
function formatTime(ts) {
  return new Date(ts).toLocaleTimeString("hu-HU", { hour:"2-digit", minute:"2-digit" });
}
function escHtml(s) {
  return s.replace(/&/g,"&amp;").replace(/</g,"&lt;")
          .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

// ── DOM refs ──────────────────────────────
const joinScreen   = document.getElementById("join-screen");
const chatScreen   = document.getElementById("chat-screen");
const nameInput    = document.getElementById("name-input");
const joinBtn      = document.getElementById("join-btn");
const msgInput     = document.getElementById("msg-input");
const sendBtn      = document.getElementById("send-btn");
const messagesEl   = document.getElementById("messages");
const typingBarEl  = document.getElementById("typing-bar");
const onlineCountEl= document.getElementById("online-count");

// ── Join ──────────────────────────────────
nameInput.focus();
nameInput.addEventListener("keydown", e => { if (e.key === "Enter") joinChat(); });
joinBtn.addEventListener("click", joinChat);

function joinChat() {
  const raw = nameInput.value.trim().replace(/\s+/g, "_");
  if (!raw) { nameInput.focus(); return; }
  myName  = raw.slice(0, 20);
  myColor = nameToColor(myName);

  joinScreen.classList.add("hidden");
  chatScreen.classList.remove("hidden");
  msgInput.focus();

  // Presence
  const myPresenceRef = ref(db, `online/${myId}`);
  set(myPresenceRef, { name: myName, ts: Date.now() });
  onDisconnect(myPresenceRef).remove();

  const myTypingRef = ref(db, `typing/${myId}`);
  onDisconnect(myTypingRef).remove();

  pushSystem(`${myName} csatlakozott`);

  if (!listenersOn) {
    listenersOn = true;
    startListeners();
  }
}

// ── Logout ────────────────────────────────
document.getElementById("logout-btn").addEventListener("click", () => {
  pushSystem(`${myName} kilépett`);
  remove(ref(db, `online/${myId}`));
  remove(ref(db, `typing/${myId}`));
  chatScreen.classList.add("hidden");
  joinScreen.classList.remove("hidden");
  nameInput.value = "";
  myName = "";
  messagesEl.innerHTML = "";
  nameInput.focus();
});

// ── Listeners ─────────────────────────────
function startListeners() {
  // Üzenetek (utolsó 80)
  import("https://www.gstatic.com/firebasejs/12.15.0/firebase-database.js")
    .then(({ query, limitToLast }) => {
      const recentQ = query(messagesRef, limitToLast(80));
      onChildAdded(recentQ, snap => renderMessage(snap.val()));
    });

  // Online szám
  onValue(onlineRef, snap => {
    const n = snap.size ?? snap.numChildren?.() ?? 0;
    onlineCountEl.textContent = n === 1 ? "1 online" : `${n} online`;
  });

  // Typing
  onValue(typingRef, snap => {
    const names = [];
    snap.forEach(child => {
      if (child.key !== myId) names.push(child.val().name);
    });
    if (names.length === 0)       typingBarEl.textContent = "";
    else if (names.length === 1)  typingBarEl.textContent = `${names[0]} ír...`;
    else                          typingBarEl.textContent = `${names.slice(0,3).join(", ")} írnak...`;
  });
}

// ── Render ────────────────────────────────
function renderMessage(data) {
  if (!data) return;

  if (data.type === "system") {
    const el = document.createElement("div");
    el.className = "msg-system";
    el.textContent = data.text;
    messagesEl.appendChild(el);
    scrollBottom();
    return;
  }

  const isOwn = data.authorId === myId;
  const color  = data.color || nameToColor(data.author);

  const el = document.createElement("div");
  el.className = "msg" + (isOwn ? " own" : "");
  el.innerHTML = `
    <div class="msg-avatar" style="background:${color}22;color:${color}">
      ${initials(data.author)}
    </div>
    <div class="msg-body">
      <div class="msg-meta">
        <span class="msg-name ${isOwn ? "own-name" : ""}"
              style="${isOwn ? "" : `color:${color}`}">
          ${escHtml(data.author)}
        </span>
        <span class="msg-time">${formatTime(data.ts)}</span>
      </div>
      <div class="msg-text">${escHtml(data.text)}</div>
    </div>`;
  messagesEl.appendChild(el);
  scrollBottom();
}

function scrollBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// ── Send ──────────────────────────────────
msgInput.addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});
sendBtn.addEventListener("click", sendMessage);

function sendMessage() {
  if (!myName) return;
  const text = msgInput.value.trim();
  if (!text) return;
  msgInput.value = "";
  clearTyping();
  push(messagesRef, {
    type:     "msg",
    author:   myName,
    authorId: myId,
    color:    myColor,
    text,
    ts:       Date.now(),
  });
}

function pushSystem(text) {
  push(messagesRef, { type: "system", text, ts: Date.now() });
}

// ── Typing ────────────────────────────────
msgInput.addEventListener("input", () => {
  if (!myName) return;
  if (!isTyping) {
    isTyping = true;
    set(ref(db, `typing/${myId}`), { name: myName });
  }
  clearTimeout(typingTimer);
  typingTimer = setTimeout(clearTyping, 2500);
});

function clearTyping() {
  isTyping = false;
  clearTimeout(typingTimer);
  remove(ref(db, `typing/${myId}`));
}