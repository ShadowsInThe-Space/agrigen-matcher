#!/usr/bin/env node
/**
 * Parser for "Beschreibende Sortenliste Getreide 2026" (Bundessortenamt).
 *
 * Extracts the winter wheat ("Winterweichweizen") 16-column score table
 * ("Sortenübersicht") from data/bsa/bsl_getreide_2026.pdf, pages 114-133,
 * and writes data/bsa/winterweizen.json.
 *
 * Document structure (verified against the PDF text layer):
 *  - Pages 114-124 (even pages): the 16-column score table. Two sections:
 *      "Mit Voraussetzung des landeskulturellen Wertes ... zugelassen" (S. 114-122)
 *      "In einem anderen EU-Land eingetragen"                          (S. 124)
 *  - Odd pages 115-125: quality tables (values like +, o, A, B, 9-10 columns)
 *  - Pages 126-131: "Ergänzende Angaben" (Kenn-Nummer, Züchter, Vermehrungsfläche)
 *  - Page 132: organic farming ("Ökologischer Landbau") score table with a
 *    DIFFERENT schema: 17 value columns (adds "Massebildung in der Jugend" and
 *    "Bodendeckungsgrad", different yield columns). Intentionally NOT extracted
 *    because it does not fit the 16-column schema of this dataset.
 *  - Page 133: organic quality table.
 *  - Sommerweizen starts ~S. 138 and is out of scope for this file.
 *
 * Robustness strategy: pdftotext -layout column widths vary strongly between
 * rows/pages, so rows are NOT parsed at fixed positions. A line is a data row
 * iff its maximal trailing run of whitespace-separated tokens, each exactly
 * "1"-"9" or "-" (missing), has length 16. All other lines (repeated table
 * headers, page numbers, footnotes, quality/supplementary tables) are skipped.
 * On pages 114-133 this rule selects exactly the 165 winter wheat score rows
 * and nothing else (verified: max run lengths elsewhere are 2 (quality tables),
 * <= 4 (supplementary tables), 17 (organic table), 12 (organic quality)).
 *
 * Run: node data/bsa/parse-wheat.ts   (Node >= 22.18, no dependencies)
 */

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PDF_PATH = join(HERE, "bsl_getreide_2026.pdf");
const OUT_PATH = join(HERE, "winterweizen.json");

/** PDF page range that covers the winter wheat tables (1-based, inclusive). */
const FIRST_PAGE = 114;
const LAST_PAGE = 133;

/** Number of value columns of the winter wheat score table. */
const N_COLS = 16;

/**
 * Column order as printed in the table header (verified visually on p. 114):
 * 1 Reife, 2 Ährenschieben, 3 Pflanzenlänge, 4 Neigung zu Lager,
 * 5-11 Anfälligkeit für: Mehltau, Gelbrost, Braunrost, Blattseptoria,
 * Ährenfusarium, Drechslera, Pseudocercosporella (1 = geringe Anfälligkeit),
 * 12-16 Ertragseigenschaften: Bestandesdichte, Kornzahl/Ähre,
 * Tausendkornmasse, Kornertrag Stufe 1, Kornertrag Stufe 2.
 */
const VALUE_FIELDS = [
  "reife",
  "aehrenschieben",
  "pflanzenlaenge",
  "lager",
  "mehltau",
  "gelbrost",
  "braunrost",
  "blattseptoria",
  "aehrenfusarium",
  "drechslera",
  "pseudocercosporella",
  "bestandesdichte",
  "kornzahl_aehre",
  "tausendkornmasse",
  "kornertrag_st1",
  "kornertrag_st2",
] as const;

type ValueField = (typeof VALUE_FIELDS)[number];

interface WheatRow {
  sortenname: string;
  section: string;
  is_new: boolean;
  footnotes: number[];
  reife: number | null;
  aehrenschieben: number | null;
  pflanzenlaenge: number | null;
  lager: number | null;
  mehltau: number | null;
  gelbrost: number | null;
  braunrost: number | null;
  blattseptoria: number | null;
  aehrenfusarium: number | null;
  drechslera: number | null;
  pseudocercosporella: number | null;
  bestandesdichte: number | null;
  kornzahl_aehre: number | null;
  tausendkornmasse: number | null;
  kornertrag_st1: number | null;
  kornertrag_st2: number | null;
}

/** Section sub-headers inside the wheat chapter (line start -> label). */
const SECTION_HEADERS: Array<[RegExp, string]> = [
  [/^Mit Voraussetzung des landeskulturellen Wertes/, "Mit Voraussetzung des landeskulturellen Wertes in Deutschland zugelassen"],
  [/^Ohne Voraussetzung des landeskulturellen Wertes/, "Ohne Voraussetzung des landeskulturellen Wertes zugelassen"],
  [/^In einem anderen EU-Land eingetragen/, "In einem anderen EU-Land eingetragen"],
  [/^Im ökologischen Landbau geprüft/, "Ökologischer Landbau"],
  [/^Erbkomponente/, "Erbkomponente"],
];

const VALUE_TOKEN_RE = /^[1-9-]$/;
const FOOTNOTE_TOKEN_RE = /^(\d+)\)[.,;]?$/;

function pdftotext(first: number, last: number): string {
  return execFileSync(
    "pdftotext",
    ["-layout", "-f", String(first), "-l", String(last), PDF_PATH, "-"],
    { encoding: "utf8", maxBuffer: 128 * 1024 * 1024 },
  );
}

/** Length of the maximal trailing run of single-value tokens ([1-9] or "-"). */
function trailingValueRun(tokens: string[]): number {
  let n = 0;
  for (let i = tokens.length - 1; i >= 0 && VALUE_TOKEN_RE.test(tokens[i]!); i--) n++;
  return n;
}

function parseLine(rawLine: string, section: string): WheatRow | null {
  const tokens = rawLine.trim().split(/\s+/u);
  const run = trailingValueRun(tokens);
  if (run !== N_COLS) return null;

  const valueTokens = tokens.slice(tokens.length - N_COLS);
  const nameTokens = tokens.slice(0, tokens.length - N_COLS);
  if (nameTokens.length === 0) return null;

  // "neu" prefix = newly admitted variety (appears left of the name).
  let isNew = false;
  if (nameTokens[0] === "neu") {
    isNew = true;
    nameTokens.shift();
  }

  // Trailing footnote markers on the name, e.g. "Akasha 1)", "Complice 2), 3)".
  const footnotes: number[] = [];
  while (nameTokens.length > 0) {
    const m = FOOTNOTE_TOKEN_RE.exec(nameTokens[nameTokens.length - 1]!);
    if (!m) break;
    footnotes.unshift(Number(m[1]));
    nameTokens.pop();
  }

  const sortenname = nameTokens.join(" ");
  // Safety net: every variety name in these tables starts with a capital
  // letter; rejects any residual header/footer artefacts.
  if (!/^[A-ZÄÖÜ]/.test(sortenname)) return null;

  const row: WheatRow = { sortenname, section, is_new: isNew, footnotes } as WheatRow;
  VALUE_FIELDS.forEach((field, i) => {
    const t = valueTokens[i]!;
    (row as Record<string, number | null>)[field] = t === "-" ? null : Number(t);
  });
  return row;
}

function parseRange(first: number, last: number) {
  const text = pdftotext(first, last);
  let section = "";
  const rows: WheatRow[] = [];
  /** Name-like lines with a long value run != 16 (expected: organic table, 17). */
  const skippedLongRuns = new Map<number, number>();
  const sectionsSeen = new Set<string>();

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    const header = SECTION_HEADERS.find(([re]) => re.test(line));
    if (header) {
      section = header[1];
      sectionsSeen.add(section);
      continue;
    }

    const row = parseLine(line, section);
    if (row) {
      rows.push(row);
      continue;
    }

    const tokens = line.split(/\s+/u);
    const run = trailingValueRun(tokens);
    if (run >= 10) skippedLongRuns.set(run, (skippedLongRuns.get(run) ?? 0) + 1);
  }
  return { rows, skippedLongRuns, sectionsSeen };
}

/** Serialize the 16 value fields of a row back into a token string. */
function rowValuesAsString(row: WheatRow): string {
  return VALUE_FIELDS.map((f) => String((row as unknown as Record<string, number | null>)[f])).join(" ");
}

/**
 * Mandatory verification (see task): compare three sample rows (Absint,
 * Akzent, Axioma) from the JSON against the raw text of page 114 and against
 * expected literal sequences read manually from the raw page output.
 */
const EXPECTED_SPOT_CHECKS: Record<string, string> = {
  Absint: "6 5 3 3 5 3 5 5 4 4 4 6 4 5 5 5",
  Akzent: "5 5 7 5 3 2 4 5 3 5 3 4 6 6 5 6",
  Axioma: "5 5 4 4 5 2 4 5 3 4 3 6 3 5 4 3",
};

function verify(rows: WheatRow[]): boolean {
  const page114 = pdftotext(114, 114);

  for (const [name, expected] of Object.entries(EXPECTED_SPOT_CHECKS)) {
    const jsonRow = rows.find((r) => r.sortenname === name);
    if (!jsonRow) {
      console.error(`FAIL ${name}: nicht in winterweizen.json gefunden`);
      return false;
    }
    // Independent re-read of the raw page-114 line for this variety.
    const rawLine = page114
      .split("\n")
      .find((l) => new RegExp(`(^|\\s)neu\\s+${name}\\s|(^|\\s)${name}(\\s|$)`).test(l));
    if (!rawLine) {
      console.error(`FAIL ${name}: keine Zeile auf Seite 114 gefunden`);
      return false;
    }
    const rawTokens = rawLine.trim().split(/\s+/u);
    const rawValues = rawTokens.slice(rawTokens.length - N_COLS).join(" ");
    const jsonValues = rowValuesAsString(jsonRow);
    const ok = jsonValues === expected && rawValues === expected;
    console.log(
      `${ok ? "OK  " : "FAIL"} Stichprobe ${name}: json=[${jsonValues}] roh(S.114)=[${rawValues}] erwartet=[${expected}]` +
        ` | section="${jsonRow.section}" is_new=${jsonRow.is_new} footnotes=[${jsonRow.footnotes.join(",")}]`,
    );
    if (!ok) return false;
  }
  return true;
}

function main(): void {
  const { rows, skippedLongRuns, sectionsSeen } = parseRange(FIRST_PAGE, LAST_PAGE);

  if (rows.length === 0) throw new Error("Keine Sortenzeilen gefunden — Parser prüfen.");

  // Duplicate guard: a variety must appear at most once per section.
  const seen = new Set<string>();
  for (const r of rows) {
    const key = `${r.section}::${r.sortenname}`;
    if (seen.has(key)) throw new Error(`Doppelte Zeile: ${key}`);
    seen.add(key);
  }

  writeFileSync(OUT_PATH, JSON.stringify(rows, null, 2) + "\n", "utf8");

  // ---- Report -------------------------------------------------------------
  const perSection = new Map<string, number>();
  for (const r of rows) perSection.set(r.section, (perSection.get(r.section) ?? 0) + 1);

  const rowsWithNull = rows.filter((r) => VALUE_FIELDS.some((f) => (r as unknown as Record<string, number | null>)[f] === null));
  const totalNullCells = rows.reduce(
    (acc, r) => acc + VALUE_FIELDS.filter((f) => (r as unknown as Record<string, number | null>)[f] === null).length,
    0,
  );
  const fullyNullRows = rows.filter((r) => VALUE_FIELDS.every((f) => (r as unknown as Record<string, number | null>)[f] === null)).length;
  const newRows = rows.filter((r) => r.is_new).length;
  const rowsWithFootnotes = rows.filter((r) => r.footnotes.length > 0).length;

  // Alphabetical order sanity check within each section (German collation).
  let orderOk = true;
  for (const [sec] of perSection) {
    const names = rows.filter((r) => r.section === sec).map((r) => r.sortenname);
    for (let i = 1; i < names.length; i++) {
      if (names[i - 1]!.localeCompare(names[i]!, "de") > 0) {
        orderOk = false;
        console.error(`WARNUNG Sortierung in "${sec}": ${names[i - 1]} > ${names[i]}`);
      }
    }
  }

  console.log(`\n winterweizen.json geschrieben: ${OUT_PATH}`);
  console.log(` Sorten gesamt: ${rows.length}`);
  for (const [sec, n] of perSection) console.log(`   - [${n}] ${sec}`);
  console.log(` Abschnitte gesehen (auch leere): ${[...sectionsSeen].join(" | ")}`);
  console.log(` Zeilen mit null-Werten: ${rowsWithNull.length} (${fullyNullRows} davon komplett null), null-Zellen gesamt: ${totalNullCells}/${rows.length * N_COLS}`);
  console.log(` neu zugelassen (is_new): ${newRows}, mit Fußnoten-Marker: ${rowsWithFootnotes}`);
  console.log(` Übersprungene namensähnliche Zeilen mit Wert-Run != 16: ${[...skippedLongRuns].map(([run, n]) => `${n}x Run=${run}`).join(", ") || "keine"} (erwartet: 30x Run=17 = Öko-Notentabelle S. 132 und 8x Run=12 = Öko-Qualitätstabelle S. 133 — abweichendes Schema, bewusst nicht extrahiert)`);
  console.log(` Alphabetische Reihenfolge je Abschnitt: ${orderOk ? "OK" : "WARNUNGEN siehe oben"}`);

  if (!verify(rows)) process.exit(1);
}

main();
