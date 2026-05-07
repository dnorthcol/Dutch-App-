// Dutch Flashcards — vanilla JS PWA.
// Spaced repetition uses a Leitner-style 5-box model with intervals (in days):
//   1: 0d (always due), 2: 1d, 3: 3d, 4: 7d, 5: 14d
// State is persisted to localStorage keyed per-card (by id).

const STORAGE_KEY = "nlcards.state.v1";
const INTERVALS_DAYS = [0, 1, 3, 7, 14];
const DAY_MS = 24 * 60 * 60 * 1000;

const els = {
  card: document.getElementById("card"),
  prompt: document.getElementById("prompt"),
  answer: document.getElementById("answer"),
  cardSection: document.getElementById("card-section"),
  cardGender: document.getElementById("card-gender"),
  flip: document.getElementById("flip"),
  speak: document.getElementById("speak"),
  restart: document.getElementById("restart"),
  rateActions: document.getElementById("rate-actions"),
  flipActions: document.getElementById("flip-actions"),
  sectionFilter: document.getElementById("section-filter"),
  direction: document.getElementById("direction"),
  mode: document.getElementById("mode"),
  progress: document.getElementById("progress"),
  srsStats: document.getElementById("srs-stats"),
};

let cards = [];
let state = loadState();
let queue = [];
let currentIdx = 0;
let flipped = false;

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { byId: {}, prefs: { section: "*", direction: "nl2en", mode: "srs" } };
}
function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
function ensureCardState(id) {
  if (!state.byId[id]) state.byId[id] = { box: 1, lastReviewedAt: 0 };
  return state.byId[id];
}
function isDue(card, now) {
  const s = ensureCardState(card.id);
  const interval = INTERVALS_DAYS[s.box - 1] * DAY_MS;
  return now - s.lastReviewedAt >= interval;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildQueue() {
  const section = state.prefs.section;
  const filtered = cards.filter((c) => section === "*" || c.section === section);
  if (state.prefs.mode === "shuffle") {
    queue = shuffle(filtered);
  } else {
    const now = Date.now();
    const due = filtered.filter((c) => isDue(c, now));
    // Prioritize lower boxes first (newer/harder cards), then shuffle within
    due.sort((a, b) => ensureCardState(a.id).box - ensureCardState(b.id).box);
    // Light shuffle within same box for variety
    queue = stableShuffleByBucket(due, (c) => ensureCardState(c.id).box);
    if (queue.length === 0) {
      // Nothing due — fall back to all cards in section so user isn't stuck
      queue = shuffle(filtered);
    }
  }
  currentIdx = 0;
}

function stableShuffleByBucket(items, bucketFn) {
  const groups = new Map();
  for (const it of items) {
    const k = bucketFn(it);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(it);
  }
  const sortedKeys = [...groups.keys()].sort((a, b) => a - b);
  return sortedKeys.flatMap((k) => shuffle(groups.get(k)));
}

function currentCard() {
  return queue[currentIdx];
}

function render() {
  const card = currentCard();
  if (!card) {
    els.prompt.textContent = "🎉";
    els.answer.textContent = "All done in this section.";
    els.cardSection.textContent = "";
    els.cardGender.textContent = "";
    els.progress.textContent = `${queue.length} / ${queue.length}`;
    flipped = false;
    els.card.classList.remove("flipped");
    els.flipActions.hidden = true;
    els.rateActions.hidden = true;
    updateSrsStats();
    return;
  }
  const dir = state.prefs.direction;
  const promptText = dir === "nl2en" ? card.dutch : card.english;
  const answerText = dir === "nl2en" ? card.english : card.dutch;
  els.prompt.textContent = promptText;
  els.answer.textContent = answerText;
  els.cardSection.textContent = card.section || "";
  els.cardGender.textContent = card.gender ? `(${card.gender})` : "";
  els.progress.textContent = `${currentIdx + 1} / ${queue.length}`;
  flipped = false;
  els.card.classList.remove("flipped");
  els.flipActions.hidden = false;
  els.rateActions.hidden = true;
  updateSrsStats();
}

function flip() {
  if (!currentCard()) return;
  flipped = !flipped;
  els.card.classList.toggle("flipped", flipped);
  if (flipped) {
    els.flipActions.hidden = true;
    els.rateActions.hidden = false;
  } else {
    els.flipActions.hidden = false;
    els.rateActions.hidden = true;
  }
}

function rate(rating) {
  const card = currentCard();
  if (!card) return;
  const s = ensureCardState(card.id);
  s.lastReviewedAt = Date.now();
  if (rating === "wrong") s.box = 1;
  else if (rating === "hard") s.box = Math.max(1, s.box); // stay
  else if (rating === "good") s.box = Math.min(5, s.box + 1);
  saveState();
  next();
}

function next() {
  currentIdx++;
  if (currentIdx >= queue.length) {
    if (state.prefs.mode === "srs") {
      // After finishing a session, rebuild from due cards
      buildQueue();
    } else {
      currentIdx = queue.length; // show end state
    }
  }
  render();
}

function speakDutch(text) {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "nl-NL";
  u.rate = 0.95;
  window.speechSynthesis.speak(u);
}

function updateSrsStats() {
  const counts = [0, 0, 0, 0, 0];
  for (const id of Object.keys(state.byId)) counts[(state.byId[id].box || 1) - 1]++;
  els.srsStats.textContent = `Box 1: ${counts[0]} · 2: ${counts[1]} · 3: ${counts[2]} · 4: ${counts[3]} · 5: ${counts[4]}`;
}

function populateSectionFilter() {
  const sections = [...new Set(cards.map((c) => c.section))].sort();
  for (const s of sections) {
    const opt = document.createElement("option");
    opt.value = s;
    opt.textContent = s;
    els.sectionFilter.appendChild(opt);
  }
  els.sectionFilter.value = state.prefs.section || "*";
  els.direction.value = state.prefs.direction || "nl2en";
  els.mode.value = state.prefs.mode || "srs";
}

function bindEvents() {
  els.flip.addEventListener("click", flip);
  els.card.addEventListener("click", (e) => {
    if (e.target.closest("button")) return;
    flip();
  });
  els.card.addEventListener("keydown", (e) => {
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      flip();
    }
  });
  els.rateActions.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-rate]");
    if (btn) rate(btn.dataset.rate);
  });
  els.speak.addEventListener("click", (e) => {
    e.stopPropagation();
    const card = currentCard();
    if (!card) return;
    speakDutch(card.dutch);
  });
  els.sectionFilter.addEventListener("change", () => {
    state.prefs.section = els.sectionFilter.value;
    saveState();
    buildQueue();
    render();
  });
  els.direction.addEventListener("change", () => {
    state.prefs.direction = els.direction.value;
    saveState();
    render();
  });
  els.mode.addEventListener("change", () => {
    state.prefs.mode = els.mode.value;
    saveState();
    buildQueue();
    render();
  });
  els.restart.addEventListener("click", () => {
    buildQueue();
    render();
  });

  // Swipe gestures
  let startX = 0, startY = 0, tracking = false;
  els.card.addEventListener("touchstart", (e) => {
    const t = e.changedTouches[0];
    startX = t.clientX; startY = t.clientY; tracking = true;
  }, { passive: true });
  els.card.addEventListener("touchend", (e) => {
    if (!tracking) return;
    tracking = false;
    const t = e.changedTouches[0];
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) {
      // left swipe = wrong, right swipe = good (when flipped)
      if (flipped) {
        rate(dx > 0 ? "good" : "wrong");
      } else {
        flip();
      }
    }
  }, { passive: true });
}

async function init() {
  const res = await fetch("words.json", { cache: "no-cache" });
  const data = await res.json();
  cards = data.cards;
  populateSectionFilter();
  bindEvents();
  buildQueue();
  render();

  if ("serviceWorker" in navigator) {
    try {
      await navigator.serviceWorker.register("sw.js");
    } catch (e) {
      console.warn("SW registration failed:", e);
    }
  }
}

init();
