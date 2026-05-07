// Parses Obsidian Dutch notes into JSON files for the PWA.
//   public/vocab.json    ← Dutch Vocabulary.md
//   public/grammar.json  ← Dutch Grammer.md
// Run: node build.mjs

import fs from "node:fs";
import path from "node:path";

const SOURCES = {
  vocab: "/Users/delyanpeyankov/Documents/ObsidianVault/Personal/Dutch/Dutch Vocabulary.md",
  grammar: "/Users/delyanpeyankov/Documents/ObsidianVault/Personal/Dutch/Dutch Grammer.md",
};
const OUT_DIR = path.join(import.meta.dirname, "public");

// ----- shared helpers -------------------------------------------------------

function stripBoldItalic(s) {
  // **text** -> text, *text* -> text. Keep underscore-italic intact for pair regex.
  return s.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*]+)\*/g, "$1");
}

function clean(s) {
  return s
    .replace(/^[\s_*[\]>•·-]+/, "")
    .replace(/[\s_*]+$/, "")
    .replace(/\\([_*[\]])/g, "$1")
    .trim();
}

function dedup(cards) {
  const seen = new Set();
  return cards.filter((c) => {
    const key = `${c.dutch.toLowerCase()}|${c.english.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ----- vocab parser (existing) ---------------------------------------------

const SEPARATORS = [" —> ", " --> ", " → ", " -> ", " — ", " – ", " - "];

const VOCAB_SKIP = [
  /^\s*$/,
  /^#+\s/,
  /^\s*\*\*[^*]+\*\*\s*$/,
  /^\s*_+[^_]*_+\s*$/,
  /^\s*---+\s*$/,
  /^\s*\|[-:|\s]+\|\s*$/,
  /^\s*\(?Opposites/i,
  /^\s*Exceptions/i,
];
const VOCAB_SECTION_HEADER = /^\s*\*\*([^*]+)\*\*\s*:?\s*$/;

function extractGender(dutch) {
  const m = dutch.match(/^(.+?)\s*\((de|het)\)\s*(.*)$/i);
  if (m) {
    const word = (m[1] + " " + m[3]).trim().replace(/\s+/g, " ");
    return { word, gender: m[2].toLowerCase() };
  }
  return { word: dutch, gender: null };
}

function tryParseTableRow(line) {
  if (!line.startsWith("|")) return null;
  const cells = line.split("|").map((c) => c.trim()).filter(Boolean);
  if (cells.length < 2) return null;
  if (cells.every((c) => /^[-:]+$/.test(c))) return null;
  return { dutch: clean(cells[0]), english: clean(cells[1]) };
}

function tryParseLine(line) {
  let s = line.replace(/^\s*[-*]\s+/, "");
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

function parseVocab(md) {
  const lines = md.split("\n");
  const cards = [];
  let section = "General";

  for (const rawLine of lines) {
    const line = rawLine.replace(/ /g, " ");

    const headerMatch = line.match(VOCAB_SECTION_HEADER);
    if (headerMatch) {
      section = clean(headerMatch[1]).replace(/[:.]+$/, "");
      continue;
    }
    if (VOCAB_SKIP.some((re) => re.test(line))) continue;

    const pair = tryParseTableRow(line) || tryParseLine(line);
    if (!pair) continue;
    let { dutch, english } = pair;
    dutch = clean(dutch);
    english = clean(english);
    if (!dutch || !english || dutch.length > 120 || english.length > 120) continue;
    if (/^\*+$/.test(dutch) || /^\*+$/.test(english)) continue;

    const { word, gender } = extractGender(dutch);
    const isPhrase = word.split(/\s+/).length >= 3;

    cards.push({
      dutch: word,
      english,
      gender,
      section,
      type: isPhrase ? "phrase" : "word",
    });
  }

  return dedup(cards).map((c, i) => ({ id: i + 1, ...c }));
}

// ----- grammar parser ------------------------------------------------------

// Matches: "<dutch> _(english)_" anywhere
const PAIR_RE = /^(.+?)\s*_\(([^)]+)\)_\s*$/;

function extractPair(text) {
  const cleaned = stripBoldItalic(text).trim();
  const m = cleaned.match(PAIR_RE);
  if (!m) return null;
  const dutch = clean(m[1].replace(/^[-–—•\s]+/, ""));
  const english = clean(m[2]);
  if (!dutch || !english) return null;
  if (dutch.length > 200 || english.length > 200) return null;
  return { dutch, english };
}

function grammarSectionFromHeading(line) {
  // ## 1) Title    | ## _**3) Pronouns:**_   | ## 14) Title:
  const m = line.match(/^##\s+(.+?)\s*$/);
  if (!m) return null;
  let title = stripBoldItalic(m[1]).replace(/_/g, "").trim();
  title = title.replace(/^[(]?(\d+)[):.]?\s*/, "");   // strip leading "1)" / "1:" etc.
  title = title.replace(/[:.\s]+$/, "");
  return title || null;
}

function parseGrammar(md) {
  const lines = md.split("\n");
  let section = "General";
  const cards = [];

  for (const rawLine of lines) {
    const line = rawLine.replace(/ /g, " ");

    if (line.startsWith("##")) {
      const newSection = grammarSectionFromHeading(line);
      if (newSection) section = newSection;
      continue;
    }
    if (/^#\s/.test(line)) continue; // top-level title
    if (/^\s*$/.test(line)) continue;

    // Bullet list line: extract pair from the bullet text
    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    if (bullet) {
      // also try inner bullets indented (already handled by leading-space match)
      const pair = extractPair(bullet[1]);
      if (pair) cards.push({ ...pair, section });
      continue;
    }

    // Table row: split cells, try each
    if (line.startsWith("|") && !/^\|[-:|\s]+\|/.test(line)) {
      const cells = line.split("|").map((c) => c.trim()).filter(Boolean);
      for (const cell of cells) {
        const pair = extractPair(cell);
        if (pair) cards.push({ ...pair, section });
      }
      continue;
    }

    // Plain paragraph: try direct
    const pair = extractPair(line.trim());
    if (pair) cards.push({ ...pair, section });
  }

  // Filter: drop entries where Dutch is just an article-only fragment or weird
  const cleaned = cards.filter((c) => {
    if (/^[-–—]+$/.test(c.dutch)) return false;
    if (c.dutch.toLowerCase() === c.english.toLowerCase()) return false;
    return true;
  });

  return dedup(cleaned).map((c, i) => ({ id: i + 1, ...c }));
}

// ----- run -----------------------------------------------------------------

function writeJson(file, cards) {
  const payload = { generatedAt: new Date().toISOString(), count: cards.length, cards };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, file), JSON.stringify(payload, null, 2));
}

function summarize(name, cards) {
  const bySection = cards.reduce((acc, c) => ((acc[c.section] = (acc[c.section] || 0) + 1), acc), {});
  console.log(`\n[${name}] ${cards.length} cards`);
  Object.entries(bySection)
    .sort((a, b) => b[1] - a[1])
    .forEach(([s, n]) => console.log(`  ${n.toString().padStart(4)}  ${s}`));
}

const vocabMd = fs.readFileSync(SOURCES.vocab, "utf8");
const grammarMd = fs.readFileSync(SOURCES.grammar, "utf8");

const vocab = parseVocab(vocabMd);
const grammar = parseGrammar(grammarMd);

writeJson("vocab.json", vocab);
writeJson("grammar.json", grammar);

summarize("vocab", vocab);
summarize("grammar", grammar);

console.log("\nFirst 6 grammar cards:");
grammar.slice(0, 6).forEach((c) => console.log(`  [${c.section}] ${c.dutch}  →  ${c.english}`));
