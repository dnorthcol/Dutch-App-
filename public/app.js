// Dutch Flashcards — vanilla JS PWA. Two modules (vocab, grammar) with
// independent SRS state, section filter, direction, and mode.
//
// Spaced repetition: Leitner-style 5 boxes, intervals (days): 0, 1, 3, 7, 14.

const STORAGE_KEY = "nlcards.state.v2";
const INTERVALS_DAYS = [0, 1, 3, 7, 14];
const DAY_MS = 24 * 60 * 60 * 1000;

const MODULES = [
  { id: "vocab",   url: "vocab.json"   },
  { id: "grammar", url: "grammar.json" },
];

const els = {
  card: document.getElementById("card"),
  prompt: document.getElementById("prompt"),
  answer: document.getElementById("answer"),
  cardSection: document.getElementById("card-section"),
  cardGender: document.getElementById("card-gender"),
  flip: document.getElementById("flip"),
  next: document.getElementById("next"),
  speak: document.getElementById("speak"),
  restart: document.getElementById("restart"),
  rateActions: document.getElementById("rate-actions"),
  flipActions: document.getElementById("flip-actions"),
  sectionFilter: document.getElementById("section-filter"),
  direction: document.getElementById("direction"),
  mode: document.getElementById("mode"),
  progress: document.getElementById("progress"),
  srsStats: document.getElementById("srs-stats"),
  tabs: document.querySelectorAll(".tab"),
};

const data = { vocab: [], grammar: [] };
let state = loadState();
let queue = [];
let currentIdx = 0;
let flipped = false;

function defaultPrefs() {
  return { section: "*", direction: "nl2en", mode: "srs" };
}
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      // Backfill any missing module
      for (const m of MODULES) {
        if (!s.modules[m.id]) s.modules[m.id] = { byId: {}, prefs: defaultPrefs() };
      }
      return s;
    }
  } catch {}
  return {
    currentModule: "vocab",
    modules: Object.fromEntries(MODULES.map((m) => [m.id, { byId: {}, prefs: defaultPrefs() }])),
  };
}
function saveState() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
function moduleState() { return state.modules[state.currentModule]; }
function moduleCards() { return data[state.currentModule] || []; }
function ensureCardState(id) {
  const m = moduleState();
  if (!m.byId[id]) m.byId[id] = { box: 1, lastReviewedAt: 0 };
  return m.byId[id];
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
function stableShuffleByBucket(items, bucketFn) {
  const groups = new Map();
  for (const it of items) {
    const k = bucketFn(it);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(it);
  }
  return [...groups.keys()].sort((a, b) => a - b).flatMap((k) => shuffle(groups.get(k)));
}

function buildQueue() {
  const prefs = moduleState().prefs;
  const cards = moduleCards();
  const filtered = cards.filter((c) => prefs.section === "*" || c.section === prefs.section);

  if (prefs.mode === "shuffle") {
    queue = shuffle(filtered);
  } else {
    const now = Date.now();
    const due = filtered.filter((c) => isDue(c, now));
    queue = stableShuffleByBucket(due, (c) => ensureCardState(c.id).box);
    if (queue.length === 0) queue = shuffle(filtered); // fallback so user isn't stuck
  }
  currentIdx = 0;
}

function currentCard() { return queue[currentIdx]; }

function render() {
  const card = currentCard();
  if (!card) {
    els.prompt.textContent = "🎉";
    els.answer.textContent = "Empty deck.";
    els.cardSection.textContent = "";
    els.cardGender.textContent = "";
    els.progress.textContent = "0 / 0";
    flipped = false;
    els.card.classList.remove("flipped");
    els.flipActions.hidden = true;
    els.rateActions.hidden = true;
    updateSrsStats();
    return;
  }
  const dir = moduleState().prefs.direction;
  els.prompt.textContent = dir === "nl2en" ? card.dutch : card.english;
  els.answer.textContent = dir === "nl2en" ? card.english : card.dutch;
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
  els.flipActions.hidden = flipped;
  els.rateActions.hidden = !flipped;
}

function rate(rating) {
  const card = currentCard();
  if (!card) return;
  const s = ensureCardState(card.id);
  s.lastReviewedAt = Date.now();
  if (rating === "wrong") s.box = 1;
  else if (rating === "hard") s.box = Math.max(1, s.box);
  else if (rating === "good") s.box = Math.min(5, s.box + 1);
  saveState();
  next();
}

function next() {
  currentIdx++;
  if (currentIdx >= queue.length) {
    if (moduleState().prefs.mode === "srs") buildQueue();
    else currentIdx = queue.length;
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
  const byId = moduleState().byId;
  for (const id of Object.keys(byId)) counts[(byId[id].box || 1) - 1]++;
  els.srsStats.textContent = `Box 1: ${counts[0]} · 2: ${counts[1]} · 3: ${counts[2]} · 4: ${counts[3]} · 5: ${counts[4]}`;
}

function populateSectionFilter() {
  const cards = moduleCards();
  const sections = [...new Set(cards.map((c) => c.section))].sort();
  els.sectionFilter.innerHTML = '<option value="*">All</option>';
  for (const s of sections) {
    const opt = document.createElement("option");
    opt.value = s;
    opt.textContent = s;
    els.sectionFilter.appendChild(opt);
  }
  const prefs = moduleState().prefs;
  els.sectionFilter.value = sections.includes(prefs.section) || prefs.section === "*" ? prefs.section : "*";
  els.direction.value = prefs.direction;
  els.mode.value = prefs.mode;
}

function syncTabs() {
  els.tabs.forEach((t) => {
    const active = t.dataset.module === state.currentModule;
    t.setAttribute("aria-selected", active ? "true" : "false");
  });
}

function switchModule(id) {
  if (!data[id] || state.currentModule === id) return;
  state.currentModule = id;
  saveState();
  syncTabs();
  populateSectionFilter();
  buildQueue();
  render();
}

function bindEvents() {
  els.flip.addEventListener("click", flip);
  els.next.addEventListener("click", (e) => { e.stopPropagation(); next(); });
  els.card.addEventListener("click", (e) => {
    if (e.target.closest("button")) return;
    flip();
  });
  els.card.addEventListener("keydown", (e) => {
    if (e.key === " " || e.key === "Enter") { e.preventDefault(); flip(); }
    if (e.key === "ArrowRight") { e.preventDefault(); next(); }
  });
  els.rateActions.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-rate]");
    if (btn) rate(btn.dataset.rate);
  });
  els.speak.addEventListener("click", (e) => {
    e.stopPropagation();
    const card = currentCard();
    if (card) speakDutch(card.dutch);
  });

  els.sectionFilter.addEventListener("change", () => {
    moduleState().prefs.section = els.sectionFilter.value;
    saveState(); buildQueue(); render();
  });
  els.direction.addEventListener("change", () => {
    moduleState().prefs.direction = els.direction.value;
    saveState(); render();
  });
  els.mode.addEventListener("change", () => {
    moduleState().prefs.mode = els.mode.value;
    saveState(); buildQueue(); render();
  });
  els.restart.addEventListener("click", () => { buildQueue(); render(); });

  els.tabs.forEach((t) => t.addEventListener("click", () => switchModule(t.dataset.module)));

  // Swipe gestures on the card
  let startX = 0, startY = 0, tracking = false;
  els.card.addEventListener("touchstart", (e) => {
    const t = e.changedTouches[0]; startX = t.clientX; startY = t.clientY; tracking = true;
  }, { passive: true });
  els.card.addEventListener("touchend", (e) => {
    if (!tracking) return;
    tracking = false;
    const t = e.changedTouches[0];
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) {
      if (flipped) rate(dx > 0 ? "good" : "wrong");
      else if (dx < 0) next(); // swipe-left on front = skip
      else flip();
    }
  }, { passive: true });
}

async function loadData() {
  const results = await Promise.all(
    MODULES.map((m) => fetch(m.url, { cache: "no-cache" }).then((r) => r.json()).then((j) => [m.id, j.cards]))
  );
  for (const [id, cards] of results) data[id] = cards;
}

async function init() {
  await loadData();
  syncTabs();
  populateSectionFilter();
  bindEvents();
  buildQueue();
  render();

  if ("serviceWorker" in navigator) {
    try { await navigator.serviceWorker.register("sw.js"); }
    catch (e) { console.warn("SW registration failed:", e); }
  }
}

init();
