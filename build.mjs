// Parses Dutch Vocabulary.md from Obsidian into words.json for the PWA.
// Run: node build.mjs

import fs from "node:fs";
import path from "node:path";

const SOURCE = "/Users/delyanpeyankov/Documents/ObsidianVault/Personal/Dutch/Dutch Vocabulary.md";
const OUT = path.join(import.meta.dirname, "public", "words.json");

const SEPARATORS = [" —> ", " --> ", " → ", " -> ", " — ", " – ", " - "];

const SKIP_LINE_PATTERNS = [
  /^\s*$/,
  /^#+\s/,                       // markdown headings
  /^\s*\*\*[^*]+\*\*\s*$/,       // bold-only lines (section headers)
  /^\s*_+[^_]*_+\s*$/,           // italic-only
  /^\s*---+\s*$/,                // hr
  /^\s*\|[-:|\s]+\|\s*$/,        // table separator row
  /^\s*\(?Opposites/i,
  /^\s*Exceptions/i,
];

const SECTION_HEADER_RE = /^\s*\*\*([^*]+)\*\*\s*:?\s*$/;

function clean(s) {
  return s
    .replace(/^[\s_*[\]>•·-]+/, "")
    .replace(/[\s_*]+$/, "")
    .replace(/\\([_*[\]])/g, "$1")
    .trim();
}

function extractGender(dutch) {
  // "raam (het)" -> { word: "raam", gender: "het" }
  const m = dutch.match(/^(.+?)\s*\((de|het)\)\s*(.*)$/i);
  if (m) {
    const word = (m[1] + " " + m[3]).trim().replace(/\s+/g, " ");
    return { word, gender: m[2].toLowerCase() };
  }
  return { word: dutch, gender: null };
}

function tryParseTableRow(line) {
  // |dutch|english| or |dutch (de)|the dutch|
  if (!line.startsWith("|")) return null;
  const cells = line.split("|").map((c) => c.trim()).filter((c, i, a) => !(i === 0 || i === a.length - 1) || c.length > 0);
  // strip leading/trailing empty produced by edge pipes
  const trimmed = cells.filter(Boolean);
  if (trimmed.length < 2) return null;
  // Skip table separator rows like ---|---
  if (trimmed.every((c) => /^[-:]+$/.test(c))) return null;
  return { dutch: clean(trimmed[0]), english: clean(trimmed[1]) };
}

function tryParseLine(line) {
  // Strip leading bullet
  let s = line.replace(/^\s*[-*]\s+/, "");
  // Try each separator longest-first
  for (const sep of SEPARATORS) {
    const idx = s.indexOf(sep);
    if (idx > 0) {
      const left = clean(s.slice(0, idx));
      const right = clean(s.slice(idx + sep.length));
      if (left && right) return { dutch: left, english: right };
    }
  }
  return null;
}

function isUselessPair(dutch, english) {
  if (!dutch || !english) return true;
  if (dutch.length > 120 || english.length > 120) return true;
  // Drop markdown markers leftover
  if (/^\*+$/.test(dutch) || /^\*+$/.test(english)) return true;
  // Drop equation-like things
  if (/^\d+$/.test(dutch) && /^\d+$/.test(english)) return true;
  return false;
}

function parse(md) {
  const lines = md.split("\n");
  const cards = [];
  const seen = new Set();
  let section = "General";

  for (const rawLine of lines) {
    const line = rawLine.replace(/ /g, " "); // nbsp -> space

    // Update section from bold header lines
    const headerMatch = line.match(SECTION_HEADER_RE);
    if (headerMatch) {
      section = clean(headerMatch[1]).replace(/[:.]+$/, "");
      continue;
    }

    if (SKIP_LINE_PATTERNS.some((re) => re.test(line))) continue;

    let pair = tryParseTableRow(line) || tryParseLine(line);
    if (!pair) continue;

    let { dutch, english } = pair;
    dutch = clean(dutch);
    english = clean(english);
    if (isUselessPair(dutch, english)) continue;

    const { word, gender } = extractGender(dutch);

    // Dedup key (case-insensitive on Dutch + English to keep variants from different sections)
    const key = `${word.toLowerCase()}|${english.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const isPhrase = /\s/.test(word) && word.split(/\s+/).length >= 3;

    cards.push({
      id: cards.length + 1,
      dutch: word,
      english,
      gender,
      section,
      type: isPhrase ? "phrase" : "word",
    });
  }

  return cards;
}

const md = fs.readFileSync(SOURCE, "utf8");
const cards = parse(md);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), count: cards.length, cards }, null, 2));

// Stats for stdout
const bySection = cards.reduce((acc, c) => ((acc[c.section] = (acc[c.section] || 0) + 1), acc), {});
const byType = cards.reduce((acc, c) => ((acc[c.type] = (acc[c.type] || 0) + 1), acc), {});
console.log(`Wrote ${cards.length} cards to ${OUT}`);
console.log("By type:", byType);
console.log("Top sections:");
Object.entries(bySection)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 15)
  .forEach(([s, n]) => console.log(`  ${n.toString().padStart(4)}  ${s}`));
console.log("\nFirst 8 cards:");
cards.slice(0, 8).forEach((c) => console.log(`  [${c.section}] ${c.gender ? `(${c.gender}) ` : ""}${c.dutch}  →  ${c.english}`));
