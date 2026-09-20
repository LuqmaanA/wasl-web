/* Wasl — Continue the Ayah
 * Arabic text and translation from api.alquran.cloud (Uthmani script, Saheeh International).
 */

const API_BASE = "https://api.alquran.cloud/v1";
const TOTAL_AYAHS = 6236;
const TOTAL_SURAHS = 114;
const TOTAL_JUZ = 30;
const SESSION_LENGTH = 5; // verses per practice session
const ENDLESS_LIVES = 3; // lives for endless mode

const PROGRESS_KEY = "wasl_progress_v1";
const SURAH_CACHE_KEY = "wasl_surahs_v1";
const SURAH_CACHE_MAX_AGE = 60 * 24 * 60 * 60 * 1000; // 60 days
const DAILY_HISTORY_DAYS = 14; // how much daily history we keep around

const ALL_JUZ = Array.from({ length: TOTAL_JUZ }, (_, i) => i + 1);

const PRESET_DEFS = [
  { key: "full", title: "Full Quran", sub: "All 30 Juz", juz: ALL_JUZ.slice() },
  { key: "first5", title: "Juz 1–5", sub: "First 5 Juz", juz: [1, 2, 3, 4, 5] },
  { key: "last5", title: "Juz 26–30", sub: "The short surahs", juz: [26, 27, 28, 29, 30] }
];

const PRESET_DEFS_PAGE2 = [
  { key: "first15", title: "Juz 1–15", sub: "First half", juz: Array.from({ length: 15 }, (_, i) => i + 1) },
  { key: "last15", title: "Juz 16–30", sub: "Second half", juz: Array.from({ length: 15 }, (_, i) => i + 16) }
];

/* ================================================================== */
/* Small helpers                                                       */
/* ================================================================== */

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function todayISO(d) {
  const date = d || new Date();
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(dateISO, n) {
  const d = new Date(dateISO + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d;
}

const ARABIC_INDIC_DIGITS = ["٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"];
function toArabicIndic(num) {
  return String(num).split("").map(ch => (ch >= "0" && ch <= "9" ? ARABIC_INDIC_DIGITS[+ch] : ch)).join("");
}

function formatJuzListLabel(juzList) {
  if (!juzList.length) return "none yet";
  if (juzList.length === TOTAL_JUZ) return "Full Quran";
  const sorted = [...juzList].sort((a, b) => a - b);
  // Collapse into contiguous ranges for a tidier label, e.g. "Juz 1–5, 12"
  const parts = [];
  let start = sorted[0], prev = sorted[0];
  for (let i = 1; i <= sorted.length; i++) {
    const cur = sorted[i];
    if (cur === prev + 1) { prev = cur; continue; }
    parts.push(start === prev ? `${start}` : `${start}–${prev}`);
    start = prev = cur;
  }
  return "Juz " + parts.join(", ");
}

/* ================================================================== */
/* Progress persistence                                                */
/* ================================================================== */

function defaultProgress() {
  return {
    streak: 0,
    bestStreak: 0,
    lastPracticeDate: null,
    totalAttempts: 0,
    totalCorrect: 0,
    perJuz: {},
    daily: {},
    lastScope: null,
    theme: "dark",
    showTranslation: true,
    bestEndlessScore: 0,
    direction: "next",
    difficulty: "easy",
    reciter: "ar.alafasy",
    lastSeenNoticeVersion: null
  };
}

function loadProgress() {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    if (!raw) return defaultProgress();
    const parsed = JSON.parse(raw);
    return Object.assign(defaultProgress(), parsed);
  } catch (e) {
    return defaultProgress();
  }
}

function saveProgress() {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
  } catch (e) { /* storage unavailable — quiz still works this session */ }
}

function pruneDaily() {
  const cutoff = todayISO(addDays(todayISO(), -DAILY_HISTORY_DAYS));
  Object.keys(progress.daily).forEach(date => {
    if (date < cutoff) delete progress.daily[date];
  });
}

function touchStreak() {
  const today = todayISO();
  if (progress.lastPracticeDate === today) return;
  const yesterday = todayISO(addDays(today, -1));
  progress.streak = progress.lastPracticeDate === yesterday ? progress.streak + 1 : 1;
  progress.bestStreak = Math.max(progress.bestStreak, progress.streak);
  progress.lastPracticeDate = today;
}

function recordAnswer(juzNum, correct) {
  const today = todayISO();
  const pj = progress.perJuz[juzNum] || (progress.perJuz[juzNum] = { attempts: 0, correct: 0 });
  pj.attempts++; if (correct) pj.correct++;

  const day = progress.daily[today] || (progress.daily[today] = { attempts: 0, correct: 0 });
  day.attempts++; if (correct) day.correct++;

  progress.totalAttempts++;
  if (correct) progress.totalCorrect++;

  pruneDaily();
  saveProgress();
}

function juzStrengthPct(juzNum) {
  const pj = progress.perJuz[juzNum];
  if (!pj || !pj.attempts) return null;
  return Math.round((pj.correct / pj.attempts) * 100);
}

function scopeAveragePct(juzList) {
  let attempts = 0, correct = 0;
  juzList.forEach(n => {
    const pj = progress.perJuz[n];
    if (pj) { attempts += pj.attempts; correct += pj.correct; }
  });
  return attempts ? Math.round((correct / attempts) * 100) : 0;
}

function strengthColor(pct) {
  return pct >= 70 ? "var(--pos)" : pct >= 45 ? "var(--accent)" : "var(--neg)";
}

/* ================================================================== */
/* Quran data fetching (live, from api.alquran.cloud)                  */
/* ================================================================== */

async function fetchSurahSet(surahNum) {
  const res = await fetch(`${API_BASE}/surah/${surahNum}/editions/quran-uthmani,en.sahih`);
  if (!res.ok) throw new Error(`surah fetch failed: HTTP ${res.status}`);
  const data = await res.json();
  if (data.code !== 200) throw new Error(`surah API error: ${data.status || data.code}`);
  const arabicEd = data.data[0];
  const englishEd = data.data[1];
  const surahName = arabicEd.englishName + " (" + arabicEd.name + ")";
  const ayahs = arabicEd.ayahs.map((a, i) => ({
    arabic: a.text,
    english: englishEd.ayahs[i].text,
    numberInSurah: a.numberInSurah,
    globalNumber: a.number,
    surahNumber: surahNum,
    surahName
  }));
  return { surahNumber: surahNum, surahName, ayahs };
}

// The Juz endpoint's exact response shape isn't consistently documented — some
// responses return a flat `ayahs` list (each ayah carrying its own `surah`
// info), others group by `surahs[].ayahs[]`. Handle both.
function extractAyahsWithSurahInfo(dataObj) {
  if (Array.isArray(dataObj.ayahs)) {
    return dataObj.ayahs.map(a => ({
      ...a,
      surahNumber: a.surah ? a.surah.number : dataObj.number,
      surahNameAr: a.surah ? a.surah.name : dataObj.name,
      surahNameEn: a.surah ? a.surah.englishName : dataObj.englishName
    }));
  }
  if (Array.isArray(dataObj.surahs)) {
    const out = [];
    dataObj.surahs.forEach(s => {
      s.ayahs.forEach(a => {
        out.push({ ...a, surahNumber: s.number, surahNameAr: s.name, surahNameEn: s.englishName });
      });
    });
    return out;
  }
  throw new Error("unrecognized juz response shape");
}

async function fetchJuzSet(juzNum) {
  const [arRes, enRes] = await Promise.all([
    fetch(`${API_BASE}/juz/${juzNum}/quran-uthmani`),
    fetch(`${API_BASE}/juz/${juzNum}/en.sahih`)
  ]);
  if (!arRes.ok) throw new Error(`juz (arabic) fetch failed: HTTP ${arRes.status}`);
  if (!enRes.ok) throw new Error(`juz (english) fetch failed: HTTP ${enRes.status}`);
  const arData = await arRes.json();
  const enData = await enRes.json();
  if (arData.code !== 200) throw new Error(`juz (arabic) API error: ${arData.status || arData.code}`);
  if (enData.code !== 200) throw new Error(`juz (english) API error: ${enData.status || enData.code}`);

  const arabicAyahs = extractAyahsWithSurahInfo(arData.data);
  const englishAyahs = extractAyahsWithSurahInfo(enData.data);
  const ayahs = arabicAyahs.map((a, i) => ({
    arabic: a.text,
    english: englishAyahs[i].text,
    numberInSurah: a.numberInSurah,
    globalNumber: a.number,
    surahNumber: a.surahNumber,
    surahName: a.surahNameEn + " (" + a.surahNameAr + ")"
  }));
  return { juzNumber: juzNum, ayahs };
}

async function fetchAyahByGlobalNumber(num) {
  const res = await fetch(`${API_BASE}/ayah/${num}/editions/quran-uthmani,en.sahih`);
  if (!res.ok) throw new Error(`ayah fetch failed: HTTP ${res.status}`);
  const data = await res.json();
  if (data.code !== 200) throw new Error(`ayah API error: ${data.status || data.code}`);
  return { arabic: data.data[0].text, english: data.data[1].text, globalNumber: num };
}

async function fetchAllSurahMeta() {
  try {
    const cached = JSON.parse(localStorage.getItem(SURAH_CACHE_KEY) || "null");
    if (cached && cached.list && cached.list.length === TOTAL_SURAHS && Date.now() - cached.fetchedAt < SURAH_CACHE_MAX_AGE) {
      return cached.list;
    }
  } catch (e) { /* fall through to fetch */ }

  const res = await fetch(`${API_BASE}/surah`);
  if (!res.ok) throw new Error(`surah list fetch failed: HTTP ${res.status}`);
  const data = await res.json();
  if (data.code !== 200) throw new Error(`surah list API error: ${data.status || data.code}`);
  const list = data.data.map(s => ({
    number: s.number, name: s.englishName, arabicName: s.name, ayahCount: s.numberOfAyahs
  }));
  try { localStorage.setItem(SURAH_CACHE_KEY, JSON.stringify({ fetchedAt: Date.now(), list })); } catch (e) { /* ignore */ }
  return list;
}

// Some verses repeat verbatim elsewhere in the Quran — famously Ar-Rahman's
// refrain (31 times) and Al-Inshiqaq's "وأذنت لربها وحقت". Different
// occurrences of the same verse can carry small encoding differences (hamza
// representations, stray marks) that survive a light diacritics-only strip,
// so this reduces text to a bare consonant skeleton: strip all
// diacritics/tatweel, unify letter variants (أ/إ/آ→ا, ي/ى→ي, ة→ه, ؤ→و, ئ→ي),
// then drop anything that isn't a core Arabic letter so only the letter
// sequence itself is compared.
function normalizeForDedup(text) {
  return text
    .replace(/[\u064B-\u0655\u0670\u0640\u06D6-\u06ED]/g, "")
    .replace(/[\u0625\u0623\u0622\u0627]/g, "\u0627")
    .replace(/[\u064A\u0649]/g, "\u064A")
    .replace(/\u0629/g, "\u0647")
    .replace(/\u0624/g, "\u0648")
    .replace(/\u0626/g, "\u064A")
    .replace(/[^\u0621-\u064A]/g, "");
}

// Prefer decoys from the SAME surah as the prompt verse (same style, rhyme,
// theme) so the right answer takes real recall, not just topic-matching.
// Falls back to neighboring surahs, then anywhere in the Quran.
//
// difficulty controls how close (in ayah position within the surah) the
// decoys are to the correct answer, before falling back wider:
//   easy   — no proximity preference at all (original behavior)
//   medium — prefer decoys within 15 ayahs of the correct answer
//   hard   — prefer decoys within 4 ayahs of the correct answer
// Each tier only narrows the *first* pass; if too few unique candidates
// exist nearby (e.g. near the edge of a short surah), it progressively
// widens before ever touching the neighbor-surah/global fallbacks below,
// so difficulty never makes a question outright fail to build.
const PROXIMITY_WINDOWS = {
  easy: [Infinity],
  medium: [15, Infinity],
  hard: [4, 10, Infinity]
};

async function buildDistractors(poolAyahs, excludeGlobalNumbers, excludeTexts, surahNumber, difficulty, anchorNumberInSurah) {
  const usedTexts = new Set(excludeTexts);
  const usedGlobalNumbers = new Set(excludeGlobalNumbers);
  const distractors = [];

  function tryAdd(a) {
    if (distractors.length >= 3) return;
    if (usedGlobalNumbers.has(a.globalNumber)) return;
    const norm = normalizeForDedup(a.arabic);
    if (usedTexts.has(norm)) return;
    distractors.push({ arabic: a.arabic, english: a.english, globalNumber: a.globalNumber });
    usedGlobalNumbers.add(a.globalNumber);
    usedTexts.add(norm);
  }

  const windows = PROXIMITY_WINDOWS[difficulty] || PROXIMITY_WINDOWS.easy;
  for (const w of windows) {
    if (distractors.length >= 3) break;
    const candidates = w === Infinity
      ? poolAyahs
      : poolAyahs.filter(a => Math.abs(a.numberInSurah - anchorNumberInSurah) <= w);
    shuffle(candidates).forEach(tryAdd);
  }

  if (distractors.length < 3) {
    const neighbors = [surahNumber - 1, surahNumber + 1].filter(n => n >= 1 && n <= TOTAL_SURAHS);
    for (const n of neighbors) {
      if (distractors.length >= 3) break;
      try {
        const neighborSet = await fetchSurahSet(n);
        shuffle(neighborSet.ayahs).forEach(tryAdd);
      } catch (e) { /* skip and continue */ }
    }
  }

  let guard = 0;
  while (distractors.length < 3 && guard < 30) {
    guard++;
    const randNum = Math.floor(Math.random() * TOTAL_AYAHS) + 1;
    if (usedGlobalNumbers.has(randNum)) continue;
    try { tryAdd(await fetchAyahByGlobalNumber(randNum)); } catch (e) { /* skip and retry */ }
  }

  return distractors;
}

async function buildQuestion(juzList, direction, difficulty) {
  direction = direction === "previous" ? "previous" : "next";
  let sourceAyahs, juzNum, tries = 0;
  do {
    juzNum = juzList[Math.floor(Math.random() * juzList.length)];
    const juzSet = await fetchJuzSet(juzNum);
    sourceAyahs = juzSet.ayahs;
    tries++;
  } while (sourceAyahs.length < 2 && tries < 5);

  let promptIndex, promptAyah, correctAyah;
  if (direction === "previous") {
    // need at least one ayah before the prompt, so start from index 1
    promptIndex = 1 + Math.floor(Math.random() * (sourceAyahs.length - 1));
    promptAyah = sourceAyahs[promptIndex];
    correctAyah = sourceAyahs[promptIndex - 1];
  } else {
    promptIndex = Math.floor(Math.random() * (sourceAyahs.length - 1));
    promptAyah = sourceAyahs[promptIndex];
    correctAyah = sourceAyahs[promptIndex + 1];
  }

  const decoySurah = await fetchSurahSet(promptAyah.surahNumber);
  const excludeGlobalNumbers = new Set([promptAyah.globalNumber, correctAyah.globalNumber]);
  const excludeTexts = new Set([normalizeForDedup(correctAyah.arabic)]);
  const distractors = await buildDistractors(decoySurah.ayahs, excludeGlobalNumbers, excludeTexts, promptAyah.surahNumber, difficulty, correctAyah.numberInSurah);
  if (distractors.length < 3) throw new Error("distractors");

  const options = shuffle([
    { arabic: correctAyah.arabic, english: correctAyah.english, correct: true },
    ...distractors.map(d => ({ arabic: d.arabic, english: d.english, correct: false }))
  ]);

  // Final safety net: if two options still normalize to the same text, don't
  // show a broken question — the caller retries with a fresh verse.
  const seenTexts = new Set();
  const hasDuplicate = options.some(opt => {
    const norm = normalizeForDedup(opt.arabic);
    if (seenTexts.has(norm)) return true;
    seenTexts.add(norm);
    return false;
  });
  if (hasDuplicate) return buildQuestion(juzList, direction, difficulty);

  return {
    juz: juzNum,
    direction,
    surahName: promptAyah.surahName,
    ref: promptAyah.numberInSurah,
    promptAr: promptAyah.arabic,
    promptEn: promptAyah.english,
    promptGlobalNumber: promptAyah.globalNumber,
    correctRef: correctAyah.numberInSurah,
    correctShort: correctAyah.arabic,
    options
  };
}

/* ================================================================== */
/* App state                                                           */
/* ================================================================== */

const progress = loadProgress();

const state = {
  view: "home",       // home | quiz | summary
  tab: "practice",     // practice | progress | library
  theme: progress.theme === "light" ? "light" : "dark",
  direction: progress.direction === "previous" ? "previous" : "next",
  difficulty: ["easy", "medium", "hard"].includes(progress.difficulty) ? progress.difficulty : "easy",
  reciter: ["ar.alafasy", "ar.husary"].includes(progress.reciter) ? progress.reciter : "ar.alafasy",
  selectedJuz: new Set(),
  libTab: "Juz",
  librarySearch: "",
  surahMeta: null,
  surahMetaLoading: false,
  session: null
};

/* ================================================================== */
/* DOM refs                                                             */
/* ================================================================== */

const appEl = document.getElementById("app");
const views = {
  home: document.getElementById("view-home"),
  quiz: document.getElementById("view-quiz"),
  summary: document.getElementById("view-summary"),
  progress: document.getElementById("view-progress"),
  library: document.getElementById("view-library")
};
const bottomNav = document.getElementById("bottom-nav");

/* ================================================================== */
/* Navigation                                                           */
/* ================================================================== */

function setView(view) {
  state.view = view;
  Object.keys(views).forEach(k => { views[k].hidden = k !== view; });
  bottomNav.hidden = view === "quiz";
  if (view === "home") renderHome();
  if (view === "progress") renderProgress();
  if (view === "library") renderLibrary();
}

function goTab(tab) {
  state.tab = tab;
  setView(tab === "practice" ? "home" : tab);
  syncNavActive();
}

document.getElementById("bottom-nav").addEventListener("click", (e) => {
  const btn = e.target.closest(".nav-tab");
  if (btn) goTab(btn.dataset.tab);
});

function syncNavActive() {
  document.querySelectorAll(".nav-tab").forEach(b => b.classList.toggle("active", b.dataset.tab === state.tab));
}

/* ================================================================== */
/* Theme                                                                */
/* ================================================================== */

function applyTheme() {
  appEl.classList.toggle("theme-light", state.theme === "light");
  appEl.classList.toggle("theme-dark", state.theme !== "light");
  document.querySelector('meta[name="theme-color"]').setAttribute("content", state.theme === "light" ? "#F1F7F2" : "#051F20");
  document.querySelectorAll("#theme-switch .theme-opt").forEach(b => b.classList.toggle("active", b.dataset.theme === state.theme));
}

document.getElementById("theme-switch").addEventListener("click", (e) => {
  const btn = e.target.closest(".theme-opt");
  if (!btn) return;
  state.theme = btn.dataset.theme;
  progress.theme = state.theme;
  saveProgress();
  applyTheme();
});

/* ================================================================== */
/* Direction toggle (ask for the next verse, or the previous one)      */
/* ================================================================== */

function applyDirection() {
  document.querySelectorAll("#direction-switch .theme-opt").forEach(b => b.classList.toggle("active", b.dataset.direction === state.direction));
}

document.getElementById("direction-switch").addEventListener("click", (e) => {
  const btn = e.target.closest(".theme-opt");
  if (!btn) return;
  state.direction = btn.dataset.direction;
  progress.direction = state.direction;
  saveProgress();
  applyDirection();
});

/* ================================================================== */
/* Difficulty toggle (how close the wrong answers are to the right one) */
/* ================================================================== */

function applyDifficulty() {
  document.querySelectorAll("#difficulty-switch .theme-opt").forEach(b => b.classList.toggle("active", b.dataset.difficulty === state.difficulty));
}

document.getElementById("difficulty-switch").addEventListener("click", (e) => {
  const btn = e.target.closest(".theme-opt");
  if (!btn) return;
  state.difficulty = btn.dataset.difficulty;
  progress.difficulty = state.difficulty;
  saveProgress();
  applyDifficulty();
});

/* ================================================================== */
/* Reciter toggle                                                       */
/* ================================================================== */

function applyReciter() {
  document.querySelectorAll("#reciter-switch .theme-opt").forEach(b => b.classList.toggle("active", b.dataset.reciter === state.reciter));
}

document.getElementById("reciter-switch").addEventListener("click", (e) => {
  const btn = e.target.closest(".theme-opt");
  if (!btn) return;
  stopRecitation(); // in-flight/playing audio was for the old reciter
  state.reciter = btn.dataset.reciter;
  progress.reciter = state.reciter;
  saveProgress();
  applyReciter();
});

/* ================================================================== */
/* Translation toggle                                                  */
/* ================================================================== */

function applyTranslationPref() {
  document.getElementById("opt-translation").checked = progress.showTranslation;
  document.getElementById("view-quiz").classList.toggle("hide-translations", !progress.showTranslation);
}

document.getElementById("opt-translation").addEventListener("change", (e) => {
  progress.showTranslation = e.target.checked;
  saveProgress();
  document.getElementById("view-quiz").classList.toggle("hide-translations", !e.target.checked);
});

/* ================================================================== */
/* HOME                                                                 */
/* ================================================================== */

function currentScope() {
  if (state.selectedJuz.size) return Array.from(state.selectedJuz).sort((a, b) => a - b);
  if (progress.lastScope && progress.lastScope.juz && progress.lastScope.juz.length) return progress.lastScope.juz;
  return ALL_JUZ.slice();
}

function weakSpotsJuz() {
  const withData = Object.keys(progress.perJuz)
    .map(Number)
    .filter(n => progress.perJuz[n].attempts > 0)
    .map(n => ({ n, pct: juzStrengthPct(n) }))
    .sort((a, b) => a.pct - b.pct)
    .slice(0, 6)
    .map(x => x.n);
  if (withData.length >= 3) return withData;
  const fallback = [26, 27, 28, 29, 30];
  return Array.from(new Set([...withData, ...fallback])).slice(0, 6);
}

function renderHome() {
  document.getElementById("streak-label").textContent = `${progress.streak} day streak`;

  const scope = currentScope();
  const scopeLabel = formatJuzListLabel(scope);
  const avgPct = scopeAveragePct(scope);
  const titleEl = document.getElementById("today-title");
  titleEl.textContent = scopeLabel;
  const subSpan = el("span", null, avgPct || scope.some(n => progress.perJuz[n]) ? `${avgPct}% average recall` : "No sessions yet");
  titleEl.appendChild(document.createElement("br"));
  titleEl.appendChild(subSpan);

  const ring = document.getElementById("today-ring");
  const circumference = 2 * Math.PI * 34;
  ring.style.strokeDasharray = String(circumference);
  ring.style.strokeDashoffset = String(circumference - circumference * (avgPct / 100));
  document.getElementById("today-pct").textContent = `${avgPct}%`;

  const btn = document.getElementById("btn-continue");
  btn.textContent = state.selectedJuz.size
    ? `Start with ${state.selectedJuz.size} juz`
    : (progress.totalAttempts ? "Continue session" : "Start session");

  // Presets — page 1 (existing four) + page 2 (half-Quran splits), swipeable
  const weak = { key: "weak", title: "Weak spots", sub: "Lowest 6 juz", juz: weakSpotsJuz() };
  const pages = [[...PRESET_DEFS, weak], PRESET_DEFS_PAGE2];

  const sliderEl = document.getElementById("presets-slider");
  sliderEl.innerHTML = "";
  // A tile is highlighted if it matches whatever scope was actually last
  // used. On a fresh install (no session ever started), default to Full
  // Quran highlighted; once any session has run, this reflects real choices
  // — including showing no tile highlighted after a custom Juz pick.
  const activeKey = progress.lastScope ? (progress.lastScope.presetKey || null) : "full";

  pages.forEach((pagePresets, pageIdx) => {
    const page = el("div", "presets-page");
    const grid = el("div", "presets-grid");
    pagePresets.forEach((p) => {
      const card = el("button", "preset-card" + (p.key === activeKey ? " featured" : ""));
      card.type = "button";
      card.appendChild(el("div", "preset-title", p.title));
      card.appendChild(el("div", "preset-sub", p.sub));
      card.addEventListener("click", () => startSession(p.juz, p.key === "weak" ? "Weak spots" : formatJuzListLabel(p.juz), p.key));
      grid.appendChild(card);
    });
    page.appendChild(grid);
    sliderEl.appendChild(page);
  });

  const dotsEl = document.getElementById("presets-dots");
  dotsEl.innerHTML = "";
  pages.forEach((_, i) => {
    const dot = el("div", "presets-dot" + (i === 0 ? " active" : ""));
    dot.addEventListener("click", () => {
      sliderEl.scrollTo({ left: sliderEl.clientWidth * i, behavior: "smooth" });
    });
    dotsEl.appendChild(dot);
  });

  // Juz chips
  const grid = document.getElementById("juz-grid");
  grid.innerHTML = "";
  ALL_JUZ.forEach(n => {
    const on = state.selectedJuz.has(n);
    const chip = el("div", "juz-chip" + (on ? " selected" : ""), String(n));
    chip.addEventListener("click", () => {
      if (on) state.selectedJuz.delete(n); else state.selectedJuz.add(n);
      renderHome();
    });
    grid.appendChild(chip);
  });
  document.getElementById("sel-count").textContent = state.selectedJuz.size ? `${state.selectedJuz.size} selected` : "none yet";
}

document.getElementById("btn-continue").addEventListener("click", () => {
  const scope = currentScope();
  const presetKey = state.selectedJuz.size ? null : ((progress.lastScope && progress.lastScope.presetKey) || null);
  startSession(scope, formatJuzListLabel(scope), presetKey);
});

let presetsScrollTimeout;
document.getElementById("presets-slider").addEventListener("scroll", (e) => {
  clearTimeout(presetsScrollTimeout);
  presetsScrollTimeout = setTimeout(() => {
    const slider = e.target;
    if (!slider.clientWidth) return;
    const idx = Math.round(slider.scrollLeft / slider.clientWidth);
    document.querySelectorAll(".presets-dot").forEach((d, i) => d.classList.toggle("active", i === idx));
  }, 80);
});

/* ================================================================== */
/* Recitation                                                           */
/* ================================================================== */

const RECITATION_BITRATE = 128;
let currentRecitationGlobalNumber = null;

const PLAY_ICON = '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4.5v15l14-7.5z"/></svg>';
const PAUSE_ICON = '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4.5h4.5v15H6zM13.5 4.5H18v15h-4.5z"/></svg>';
const LOADING_ICON = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" class="recite-spinner"><path d="M12 2 a10 10 0 0 1 10 10"/></svg>';

let recitationPending = false; // true while a play() request is in flight — guards against the classic play()/pause() race
let recitationToken = 0; // bumped on every stop, so a slow/late play() request can't resurrect stale state

function recitationUrl(globalNumber) {
  return `https://cdn.islamic.network/quran/audio/${RECITATION_BITRATE}/${state.reciter}/${globalNumber}.mp3`;
}

function stopRecitation() {
  recitationToken++;
  recitationPending = false;
  const audio = document.getElementById("recitation-audio");
  audio.pause();
  audio.currentTime = 0;
  currentRecitationGlobalNumber = null;
  document.querySelectorAll(".recite-btn").forEach(b => {
    b.classList.remove("playing");
    b.innerHTML = PLAY_ICON;
    b.setAttribute("aria-label", "Play recitation of this verse");
  });
}

const RECITATION_MAX_RETRIES = 2; // total of 3 attempts before giving up

function playRecitation(globalNumber, btnEl, attempt, myToken) {
  const audio = document.getElementById("recitation-audio");

  if (attempt === undefined) {
    if (recitationPending) return; // ignore taps while a previous request hasn't resolved yet
    attempt = 0;
    myToken = ++recitationToken;
    recitationPending = true;
    audio.pause();
    currentRecitationGlobalNumber = null;
    document.querySelectorAll(".recite-btn").forEach(b => b.classList.remove("playing"));
  }
  if (myToken !== recitationToken) return; // superseded by a stop/newer request meanwhile

  audio.src = recitationUrl(globalNumber);
  btnEl.innerHTML = LOADING_ICON;
  btnEl.setAttribute("aria-label", "Loading recitation");

  audio.play().then(() => {
    if (myToken !== recitationToken) return;
    recitationPending = false;
    currentRecitationGlobalNumber = globalNumber;
    btnEl.classList.add("playing");
    btnEl.innerHTML = PAUSE_ICON;
    btnEl.setAttribute("aria-label", "Pause recitation");
  }).catch(() => {
    if (myToken !== recitationToken) return;
    if (attempt < RECITATION_MAX_RETRIES) {
      // The CDN occasionally blocks a request for reasons that don't repeat on
      // retry (observed: same file succeeds on a later attempt) — so retry
      // automatically a couple of times before actually giving up.
      setTimeout(() => playRecitation(globalNumber, btnEl, attempt + 1, myToken), 350);
    } else {
      recitationPending = false;
      btnEl.innerHTML = PLAY_ICON;
      btnEl.setAttribute("aria-label", "Play recitation of this verse");
    }
  });
}

document.getElementById("recitation-audio").addEventListener("ended", stopRecitation);

/* ================================================================== */
/* QUIZ                                                                 */
/* ================================================================== */

function startSession(juzList, label, presetKey = null) {
  state.selectedJuz.clear();
  progress.lastScope = { juz: juzList, label, presetKey };
  touchStreak();
  saveProgress();

  state.session = {
    mode: "fixed",
    direction: state.direction,
    difficulty: state.difficulty,
    scopeJuz: juzList,
    scopeLabel: label,
    presetKey,
    qIndex: 0,
    total: SESSION_LENGTH,
    lives: null,
    questions: [],
    picked: null,
    locked: false,
    loading: true,
    error: null,
    correctCount: 0,
    answered: []
  };
  setView("quiz");
  loadQuizQuestion();
}

function startEndlessSession() {
  progress.lastScope = { juz: ALL_JUZ.slice(), label: "Full Quran" };
  touchStreak();
  saveProgress();

  state.session = {
    mode: "endless",
    direction: state.direction,
    difficulty: state.difficulty,
    scopeJuz: ALL_JUZ.slice(),
    scopeLabel: "Endless · Full Quran",
    qIndex: 0,
    total: null,
    lives: ENDLESS_LIVES,
    questions: [],
    picked: null,
    locked: false,
    loading: true,
    error: null,
    correctCount: 0,
    answered: []
  };
  setView("quiz");
  loadQuizQuestion();
}

document.getElementById("btn-endless").addEventListener("click", startEndlessSession);

document.getElementById("endless-info-btn").addEventListener("click", () => {
  document.getElementById("endless-info-modal").hidden = false;
});
document.getElementById("endless-info-close").addEventListener("click", () => {
  document.getElementById("endless-info-modal").hidden = true;
});
document.getElementById("endless-info-modal").addEventListener("click", (e) => {
  if (e.target.id === "endless-info-modal") e.currentTarget.hidden = true;
});

/* ================================================================== */
/* About                                                                */
/* ================================================================== */

const APP_VERSION = "1.0.0";
const APP_CREDIT = "Made by Luqmaan Agherdien"; // edit this line to set your credit text

document.getElementById("about-version").textContent = `Version ${APP_VERSION}`;
document.getElementById("about-credit").textContent = APP_CREDIT;

document.getElementById("brand-about-btn").addEventListener("click", () => {
  document.getElementById("about-modal").hidden = false;
});
document.getElementById("about-close").addEventListener("click", () => {
  document.getElementById("about-modal").hidden = true;
});
document.getElementById("about-modal").addEventListener("click", (e) => {
  if (e.target.id === "about-modal") e.currentTarget.hidden = true;
});

/* ================================================================== */
/* Release notice — shown once per version, edit the text below for    */
/* future updates.                                                     */
/* ================================================================== */

const RELEASE_NOTICE_TEXT = "Please note the recitation feature is experimental and will be refined in future updates.";

if (progress.lastSeenNoticeVersion !== APP_VERSION) {
  document.getElementById("notice-body").textContent = RELEASE_NOTICE_TEXT;
  document.getElementById("notice-modal").hidden = false;
}

document.getElementById("notice-close").addEventListener("click", () => {
  document.getElementById("notice-modal").hidden = true;
  progress.lastSeenNoticeVersion = APP_VERSION;
  saveProgress();
});

document.getElementById("settings-btn").addEventListener("click", () => {
  document.getElementById("settings-modal").hidden = false;
});
document.getElementById("settings-close").addEventListener("click", () => {
  document.getElementById("settings-modal").hidden = true;
});
document.getElementById("settings-modal").addEventListener("click", (e) => {
  if (e.target.id === "settings-modal") e.currentTarget.hidden = true;
});

function showLeaveSessionModal() {
  return new Promise((resolve) => {
    const modal = document.getElementById("leave-modal");
    const cancelBtn = document.getElementById("modal-cancel");
    const confirmBtn = document.getElementById("modal-confirm");

    function cleanup(result) {
      modal.hidden = true;
      cancelBtn.removeEventListener("click", onCancel);
      confirmBtn.removeEventListener("click", onConfirm);
      modal.removeEventListener("click", onBackdrop);
      resolve(result);
    }
    function onCancel() { cleanup(false); }
    function onConfirm() { cleanup(true); }
    function onBackdrop(e) { if (e.target === modal) cleanup(false); }

    cancelBtn.addEventListener("click", onCancel);
    confirmBtn.addEventListener("click", onConfirm);
    modal.addEventListener("click", onBackdrop);
    modal.hidden = false;
  });
}

document.getElementById("quiz-close").addEventListener("click", async () => {
  const s = state.session;
  const inProgress = s && (s.mode === "endless" ? s.lives > 0 : s.qIndex < s.total);
  if (inProgress) {
    const leave = await showLeaveSessionModal();
    if (!leave) return;
  }
  stopRecitation();
  state.session = null;
  goTab("practice");
});

async function loadQuizQuestion() {
  const s = state.session;
  stopRecitation();
  s.loading = true; s.error = null; s.picked = null; s.locked = false;
  renderQuiz();
  try {
    const q = await buildQuestion(s.scopeJuz, s.direction, s.difficulty);
    s.questions[s.qIndex] = q;
    s.loading = false;
  } catch (err) {
    console.error("Wasl: failed to load a new verse —", err);
    s.loading = false;
    s.error = (err && err.message) ? err.message : String(err);
  }
  renderQuiz();
}

function renderQuiz() {
  const s = state.session;
  if (!s) return;

  document.getElementById("quiz-scope").textContent = s.scopeLabel;
  document.getElementById("quiz-counter").textContent = s.mode === "endless"
    ? `Question ${s.qIndex + 1}`
    : `${s.qIndex + 1} / ${s.total}`;

  const dotsEl = document.getElementById("quiz-dots");
  dotsEl.innerHTML = "";
  if (s.mode === "endless") {
    dotsEl.classList.add("lives-row");
    for (let i = 0; i < ENDLESS_LIVES; i++) {
      dotsEl.appendChild(el("div", "life-dot" + (i >= s.lives ? " lost" : "")));
    }
  } else {
    dotsEl.classList.remove("lives-row");
    for (let i = 0; i < s.total; i++) {
      const cls = i < s.qIndex ? "dot done" : (i === s.qIndex ? (s.picked !== null ? "dot done" : "dot current") : "dot");
      dotsEl.appendChild(el("div", cls));
    }
  }

  const card = document.getElementById("quiz-card");
  const whichNext = document.getElementById("which-next");
  const optionsEl = document.getElementById("quiz-options");
  const verdictBlock = document.getElementById("verdict-block");
  card.innerHTML = "";
  optionsEl.innerHTML = "";

  if (s.loading) {
    card.appendChild(el("div", "loading", "Opening to a verse…"));
    whichNext.hidden = true;
    verdictBlock.hidden = true;
    return;
  }

  if (s.error) {
    const err = el("div", "error-msg", `Couldn't reach the Quran text service. (${s.error})`);
    const retry = el("button", "retry-btn", "Try again");
    retry.type = "button";
    retry.addEventListener("click", loadQuizQuestion);
    err.appendChild(document.createElement("br"));
    err.appendChild(retry);
    card.appendChild(err);
    whichNext.hidden = true;
    verdictBlock.hidden = true;
    return;
  }

  const q = s.questions[s.qIndex];
  const answered = s.picked !== null;

  const reciteBtn = el("button", "recite-btn");
  reciteBtn.innerHTML = PLAY_ICON;
  reciteBtn.type = "button";
  reciteBtn.setAttribute("aria-label", "Play recitation of this verse");
  reciteBtn.addEventListener("click", () => {
    if (recitationPending) return;
    const audio = document.getElementById("recitation-audio");
    if (currentRecitationGlobalNumber === q.promptGlobalNumber && !audio.paused) {
      stopRecitation();
    } else {
      playRecitation(q.promptGlobalNumber, reciteBtn);
    }
  });
  card.appendChild(reciteBtn);

  const ref = el("div", "ref" + (answered ? " revealed" : ""), answered ? `${q.surahName} · Ayah ${q.ref}` : "Reference hidden");
  card.appendChild(ref);
  const promptAr = el("div", "prompt-ar", q.promptAr);
  card.appendChild(promptAr);
  card.appendChild(el("div", "prompt-divider"));
  card.appendChild(el("div", "prompt-en", q.promptEn));

  whichNext.textContent = q.direction === "previous" ? "Which verse came before?" : "Which verse comes next?";
  whichNext.hidden = false;

  q.options.forEach((opt, i) => {
    const optEl = el("div", "option");
    if (answered) {
      optEl.classList.add("locked");
      if (opt.correct) optEl.classList.add("correct");
      else if (i === s.picked) optEl.classList.add("wrong");
      else optEl.classList.add("dimmed");
    }
    optEl.appendChild(el("div", "opt-ar", opt.arabic));
    optEl.appendChild(el("div", "opt-en", opt.english));
    if (!answered) optEl.addEventListener("click", () => handleChoice(i));
    optionsEl.appendChild(optEl);
  });

  if (answered) {
    const correctIdx = q.options.findIndex(o => o.correct);
    const gotIt = s.picked === correctIdx;
    const isLast = s.mode === "endless" ? s.lives <= 0 : s.qIndex === s.total - 1;

    const verdictText = document.getElementById("verdict-text");
    verdictText.textContent = gotIt
      ? "Correct — well recalled"
      : (s.mode === "endless" && isLast ? "Out of lives — here's how you did" : "Not this one — the right verse is above");
    verdictText.className = "verdict-text " + (gotIt ? "pos" : "neg");

    document.getElementById("btn-next").textContent = isLast
      ? (s.mode === "endless" ? "See results" : "Finish session")
      : "Next verse";
    verdictBlock.hidden = false;
  } else {
    verdictBlock.hidden = true;
  }
}

function handleChoice(i) {
  const s = state.session;
  if (s.locked) return;
  s.locked = true;
  s.picked = i;

  const q = s.questions[s.qIndex];
  const correct = !!q.options[i].correct;
  s.answered[s.qIndex] = correct;
  if (correct) s.correctCount++;
  else if (s.mode === "endless") s.lives--;

  recordAnswer(q.juz, correct);
  renderQuiz();
}

document.getElementById("btn-next").addEventListener("click", () => {
  const s = state.session;
  const isLast = s.mode === "endless" ? s.lives <= 0 : s.qIndex >= s.total - 1;
  if (isLast) {
    finishSession();
  } else {
    s.qIndex++;
    loadQuizQuestion();
  }
});

function finishSession() {
  stopRecitation();
  setView("summary");
  renderSummary();
}

/* ================================================================== */
/* SUMMARY                                                              */
/* ================================================================== */

function renderSummary() {
  const s = state.session;
  const circumference = 2 * Math.PI * 66;
  const ring = document.getElementById("score-ring");
  const captionEl = document.querySelector("#view-summary .score-caption");
  const statsEl = document.getElementById("summary-stats");
  statsEl.innerHTML = "";

  if (s.mode === "endless") {
    const isNewBest = s.correctCount > progress.bestEndlessScore;
    if (isNewBest) progress.bestEndlessScore = s.correctCount;
    saveProgress();

    ring.style.strokeDasharray = String(circumference);
    ring.style.strokeDashoffset = "0";
    document.getElementById("score-pct").textContent = String(s.correctCount);
    if (captionEl) captionEl.textContent = "verses recalled";

    document.getElementById("summary-title").textContent = isNewBest ? "New best!" : "Nice run";
    document.getElementById("summary-sub").textContent =
      `You correctly recalled ${s.correctCount} verse${s.correctCount === 1 ? "" : "s"} before running out of lives.`;

    [
      { v: String(s.correctCount), k: "Correct" },
      { v: String(progress.bestEndlessScore), k: "Best ever" },
      { v: `${progress.streak}d`, k: "Streak" }
    ].forEach(stat => {
      const tile = el("div", "stat-tile");
      tile.appendChild(el("div", "stat-v", stat.v));
      tile.appendChild(el("div", "stat-k", stat.k));
      statsEl.appendChild(tile);
    });
  } else {
    const pct = Math.round((s.correctCount / s.total) * 100);
    ring.style.strokeDasharray = String(circumference);
    ring.style.strokeDashoffset = String(circumference - circumference * (pct / 100));
    document.getElementById("score-pct").textContent = `${pct}%`;
    if (captionEl) captionEl.textContent = "recalled";

    document.getElementById("summary-title").textContent =
      s.correctCount === s.total ? "Flawless run" : s.correctCount === 0 ? "Worth another pass" : "Steady work";
    document.getElementById("summary-sub").textContent =
      `${s.correctCount} of ${s.total} verses recalled. Missed verses come back tomorrow.`;

    [
      { v: String(s.correctCount), k: "Correct" },
      { v: String(s.total - s.correctCount), k: "Missed" },
      { v: `${progress.streak}d`, k: "Streak" }
    ].forEach(stat => {
      const tile = el("div", "stat-tile");
      tile.appendChild(el("div", "stat-v", stat.v));
      tile.appendChild(el("div", "stat-k", stat.k));
      statsEl.appendChild(tile);
    });
  }

  const listEl = document.getElementById("reviewed-list");
  listEl.innerHTML = "";
  s.questions.forEach((q, i) => {
    const row = el("div", "reviewed-row");
    row.appendChild(el("div", "reviewed-dot")).style.background = s.answered[i] ? "var(--pos)" : "var(--neg)";
    const mid = el("div", "reviewed-mid");
    mid.appendChild(el("div", "reviewed-surah", q.surahName));
    mid.appendChild(el("div", "reviewed-ref", `Ayah ${q.correctRef}`));
    row.appendChild(mid);
    row.appendChild(el("div", "reviewed-ar", q.correctShort));
    listEl.appendChild(row);
  });
}

document.getElementById("btn-again").addEventListener("click", () => {
  const s = state.session;
  if (s.mode === "endless") startEndlessSession();
  else startSession(s.scopeJuz, s.scopeLabel, s.presetKey);
});

document.getElementById("btn-done").addEventListener("click", () => {
  state.session = null;
  goTab("practice");
});

/* ================================================================== */
/* PROGRESS                                                             */
/* ================================================================== */

function renderProgress() {
  document.getElementById("progress-streak").textContent = String(progress.streak);
  document.getElementById("progress-streak-sub").textContent = `day streak · best ${progress.bestStreak}`;

  const weekEl = document.getElementById("week-bars");
  weekEl.innerHTML = "";
  const today = todayISO();
  const days = [];
  for (let i = 6; i >= 0; i--) days.push(todayISO(addDays(today, -i)));
  const counts = days.map(d => (progress.daily[d] ? progress.daily[d].attempts : 0));
  const max = Math.max(1, ...counts);
  days.forEach((d, i) => {
    const label = new Date(d + "T00:00:00").toLocaleDateString(undefined, { weekday: "narrow" });
    const col = el("div", "week-bar-col");
    const barHeight = counts[i] ? Math.max(6, Math.round((counts[i] / max) * 64)) : 3;
    const bar = el("div", "week-bar" + (d === today ? " active" : ""));
    bar.style.height = barHeight + "px";
    col.appendChild(bar);
    col.appendChild(el("div", "week-bar-label", label));
    weekEl.appendChild(col);
  });

  const bigStatsEl = document.getElementById("big-stats");
  bigStatsEl.innerHTML = "";
  const last7Attempts = days.reduce((sum, d) => sum + (progress.daily[d] ? progress.daily[d].attempts : 0), 0);
  const last7Correct = days.reduce((sum, d) => sum + (progress.daily[d] ? progress.daily[d].correct : 0), 0);
  const last7Pct = last7Attempts ? Math.round((last7Correct / last7Attempts) * 100) : 0;
  [
    { v: String(progress.totalAttempts), k: "Verses tested" },
    { v: last7Attempts ? `${last7Pct}%` : "—", k: "Last 7 days" }
  ].forEach(stat => {
    const tile = el("div", "big-stat");
    tile.appendChild(el("div", "stat-v", stat.v));
    tile.appendChild(el("div", "stat-k", stat.k));
    bigStatsEl.appendChild(tile);
  });

  const strengthEl = document.getElementById("strength-list");
  strengthEl.innerHTML = "";
  const rows = Object.keys(progress.perJuz)
    .map(Number)
    .filter(n => progress.perJuz[n].attempts > 0)
    .map(n => ({ n, pct: juzStrengthPct(n) }))
    .sort((a, b) => a.pct - b.pct)
    .slice(0, 8);

  if (!rows.length) {
    strengthEl.appendChild(el("div", "empty-note", "Practice a few sessions to see your strength by juz."));
  } else {
    rows.forEach(r => {
      const wrap = document.createElement("div");
      const head = el("div", "strength-row-head");
      head.appendChild(el("span", null, `Juz ${r.n}`));
      head.appendChild(el("span", "pct", `${r.pct}%`));
      wrap.appendChild(head);
      const track = el("div", "strength-track");
      const fill = el("div", "strength-fill");
      fill.style.width = `${r.pct}%`;
      fill.style.background = strengthColor(r.pct);
      track.appendChild(fill);
      wrap.appendChild(track);
      strengthEl.appendChild(wrap);
    });
  }
}

/* ================================================================== */
/* LIBRARY                                                              */
/* ================================================================== */

function renderLibTabs() {
  const tabsEl = document.getElementById("lib-tabs");
  tabsEl.innerHTML = "";
  ["Juz", "Surah"].forEach(label => {
    const tab = el("button", "lib-tab" + (state.libTab === label ? " active" : ""), label);
    tab.type = "button";
    tab.addEventListener("click", () => { state.libTab = label; renderLibrary(); });
    tabsEl.appendChild(tab);
  });
}

function libRow(numLabel, name, arText, pct) {
  const row = el("div", "lib-row");
  row.appendChild(el("div", "lib-num", numLabel));
  const mid = el("div", "lib-mid");
  const top = el("div", "lib-top-row");
  top.appendChild(el("span", "lib-name", name));
  top.appendChild(el("span", "lib-ar", arText));
  mid.appendChild(top);
  const track = el("div", "lib-track");
  const fill = el("div", "lib-fill");
  fill.style.width = (pct === null ? 0 : pct) + "%";
  if (pct !== null) fill.style.background = strengthColor(pct);
  track.appendChild(fill);
  mid.appendChild(track);
  row.appendChild(mid);
  return row;
}

async function renderLibrary() {
  renderLibTabs();
  const rowsEl = document.getElementById("lib-rows");

  if (state.libTab === "Juz") {
    const search = state.librarySearch.trim().toLowerCase();
    rowsEl.innerHTML = "";
    ALL_JUZ
      .filter(n => !search || String(n).includes(search) || `juz ${n}`.includes(search))
      .forEach(n => {
        rowsEl.appendChild(libRow(String(n), `Juz ${n}`, toArabicIndic(n), juzStrengthPct(n)));
      });
    return;
  }

  // Surah tab
  if (!state.surahMeta) {
    if (!state.surahMetaLoading) {
      state.surahMetaLoading = true;
      rowsEl.innerHTML = "";
      rowsEl.appendChild(el("div", "loading", "Loading surah list…"));
      try {
        state.surahMeta = await fetchAllSurahMeta();
      } catch (e) {
        state.surahMetaLoading = false;
        rowsEl.innerHTML = "";
        const err = el("div", "error-msg", "Couldn't load the surah list.");
        const retry = el("button", "retry-btn", "Try again");
        retry.type = "button";
        retry.addEventListener("click", renderLibrary);
        err.appendChild(document.createElement("br"));
        err.appendChild(retry);
        rowsEl.appendChild(err);
        return;
      }
      state.surahMetaLoading = false;
    } else {
      return; // a fetch is already in flight; it will re-render on completion
    }
  }

  const searchRaw = state.librarySearch.trim();
  const search = searchRaw.toLowerCase();
  rowsEl.innerHTML = "";
  state.surahMeta
    .filter(s => !search || s.name.toLowerCase().includes(search) || String(s.number).includes(search) || s.arabicName.includes(searchRaw))
    .forEach(s => {
      rowsEl.appendChild(libRow(String(s.number), s.name, s.arabicName, null));
    });
}

document.getElementById("lib-search-input").addEventListener("input", (e) => {
  state.librarySearch = e.target.value;
  renderLibrary();
});

/* ================================================================== */
/* Init                                                                 */
/* ================================================================== */

applyTheme();
applyDirection();
applyDifficulty();
applyReciter();
applyTranslationPref();
syncNavActive();
setView("home");
