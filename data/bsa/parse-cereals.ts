#!/usr/bin/env node
/**
 * Multi-cereal parser for "Beschreibende Sortenliste Getreide 2026" (Bundessortenamt).
 *
 * Extracts the "Sortenübersicht" score tables (NOT the quality/"Qualität" or
 * supplementary/"Ergänzende Angaben" tables) of four crops from
 * data/bsa/bsl_getreide_2026.pdf:
 *
 *   wintergerste.json  Wintergerste, mehrzeilig   PDF S. 26-30  (19 Notenspalten)
 *   winterroggen.json  Winterroggen               PDF S. 78-83  (Typ P/H + 14 Notenspalten)
 *   dinkel.json        Winterspelz/Winterdinkel   PDF S. 96-98  (13 Notenspalten)
 *   hafer.json         Sommerhafer                PDF S. 68-71  (Spelzenfarbe + 17 Notenspalten)
 *
 * Column orders below were verified per crop against a rendered image of the
 * respective header page (pdftoppm -r 100, PNG read visually: hdr-26/78/96/68)
 * AND against the exact word x-coordinates of the rotated headers in the PDF
 * text layer (pdftotext -bbox, sorted by xMin). The reading order of the plain
 * pdftotext -layout output is NOT reliable for rotated headers. See
 * data/bsa/PARSE-NOTES.md for the full verification protocol and spot checks.
 *
 * Scope decisions (details in PARSE-NOTES.md):
 *  - Wintergerste: only the MEHRZEILIG table (S. 26-30, ends with "Venezia").
 *    Page 36 starts "Wintergerste - zweizeilig -" (identical 19-column schema,
 *    56 further varieties) which is a different barley form and was NOT
 *    extracted; the Öko-Notentabelle (S. 42, 20 columns) is out of range.
 *  - Sommergerste (S. 46 ff.) is zweizeilig with only 16 score columns (no
 *    virus-resistance block) -> different schema, intentionally omitted.
 *  - Sommerroggen (S. 90) lacks "Mutterkorn" (13 instead of 14 score columns)
 *    -> different schema, intentionally omitted.
 *  - Winterhafer (S. 72, Silonutzung: Kronenrost/Trockenmasseertrag/...)
 *    -> completely different schema, intentionally omitted.
 *  - Organic-farming tables ("Im ökologischen Landbau geprüft", S. 70 Hafer /
 *    S. 84 Roggen / S. 42 Gerste) use different schemas (extra columns
 *    "Massebildung"/"Bodendeckungsgrad") and are auto-skipped by the row rule
 *    (their trailing value-run length differs) — they are reported, not parsed.
 *
 * Row rule (same robustness strategy as parse-wheat.ts): a line is a data row
 * iff its maximal trailing run of tokens, each exactly "1"-"9" or "-", equals
 * the crop's score-column count; for rye the token before that run must be
 * P|H (Hybrid-/Populationssorte), for oat g|w|s (Spelzenfarbe). Everything
 * else (repeated headers, footnotes, quality/supplementary tables) is skipped.
 *
 * Run: node data/bsa/parse-cereals.ts   (Node >= 22.18, no dependencies)
 */

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PDF_PATH = join(HERE, "bsl_getreide_2026.pdf");

type Cell = number | null | string;

interface CerealRow {
  sortenname: string;
  section: string;
  is_new: boolean;
  footnotes: number[];
  [field: string]: Cell | boolean | number[];
}

interface CropSpec {
  /** Output file base name (data/bsa/<out>.json). */
  out: string;
  label: string;
  firstPage: number;
  lastPage: number;
  /** Score fields in exact left-to-right header order (verified per crop). */
  fields: readonly string[];
  /** roggen: token P|H between name and scores -> field zuechtyp. */
  typeTokenField?: "zuechtyp";
  /** hafer: token g|w|s between name and scores -> field spelzenfarbe. */
  prefixTokenField?: "spelzenfarbe";
  /** Hard ground truth (counted independently in the raw page text). */
  expectedRows: number;
  /** First/last-variety spot checks against the raw source page. */
  spotChecks: ReadonlyArray<{
    name: string;
    page: number;
    values: string;
    zuechtyp?: string | null;
    spelzenfarbe?: string | null;
    is_new?: boolean;
    footnotes?: number[];
    section?: string;
  }>;
}

/** Section sub-headers shared by the cereal chapters. */
const SECTION_HEADERS: Array<[RegExp, string]> = [
  [/^Mit Voraussetzung des landeskulturellen Wertes/, "Mit Voraussetzung des landeskulturellen Wertes in Deutschland zugelassen"],
  [/^Ohne Voraussetzung des landeskulturellen Wertes/, "Ohne Voraussetzung des landeskulturellen Wertes zugelassen"],
  [/^In einem anderen EU-Land eingetragen/, "In einem anderen EU-Land eingetragen"],
  [/^Im ökologischen Landbau geprüft/, "Ökologischer Landbau"],
];

// ---------------------------------------------------------------------------
// Crop specs — column order as printed in the rotated table header,
// left to right, each verified on the cited header page.
// ---------------------------------------------------------------------------

const WINTERGERSTE: CropSpec = {
  out: "wintergerste",
  label: "Wintergerste, mehrzeilig (S. 26-30; Header verifiziert auf S. 26)",
  firstPage: 26,
  lastPage: 30,
  fields: [
    "aehrenschieben",          // 1  Ährenschieben
    "reife",                   // 2  Reife
    "pflanzenlaenge",          // 3  Pflanzenlänge
    "lager",                   // 4  Neigung zu Lager
    "halmknicken",             // 5  Halmknicken
    "aehrenknicken",           // 6  Ährenknicken
    "mehltau",                 // 7  Mehltau
    "netzflecken",             // 8  Netzflecken
    "rhynchosporium",          // 9  Rhynchosporium
    "ramularia",               // 10 Ramularia
    "zwergrost",               // 11 Zwergrost
    "gelbmosaik_baymv1",       // 12 Gelbmosaik BaYMV-1, BaMMV (Virusresistenz)
    "gelbmosaik_baymv2",       // 13 Gelbmosaik BaYMV-2          (Virusresistenz)
    "gerstengelbverzwergung",  // 14 Gerstengelbverzwergung      (Virusresistenz)
    "bestandesdichte",         // 15 Bestandesdichte
    "kornzahl_aehre",          // 16 Kornzahl/Ähre
    "tausendkornmasse",        // 17 Tausendkornmasse
    "kornertrag_st1",          // 18 Kornertrag Stufe 1
    "kornertrag_st2",          // 19 Kornertrag Stufe 2
  ],
  expectedRows: 65,
  spotChecks: [
    { name: "Agathe", page: 26, is_new: true, values: "5 5 4 3 3 3 4 4 7 6 6 1 9 9 6 5 6 8 8", section: "Mit Voraussetzung des landeskulturellen Wertes in Deutschland zugelassen" },
    { name: "Venezia", page: 30, values: "5 5 6 5 5 4 3 6 7 6 4 1 1 9 4 5 7 6 7", section: "In einem anderen EU-Land eingetragen" },
  ],
};

const WINTERROGGEN: CropSpec = {
  out: "winterroggen",
  label: "Winterroggen (S. 78-83, Notentabellen auf S. 78+80; Header verifiziert auf S. 78)",
  firstPage: 78,
  lastPage: 83,
  typeTokenField: "zuechtyp",
  fields: [
    "aehrenschieben",     // 1  Ährenschieben
    "reife",              // 2  Reife
    "pflanzenlaenge",     // 3  Pflanzenlänge
    "lager",              // 4  Neigung zu Lager
    "halmknicken",        // 5  Halmknicken
    "mehltau",            // 6  Mehltau
    "rhynchosporium",     // 7  Rhynchosporium
    "braunrost",          // 8  Braunrost
    "mutterkorn",         // 9  Mutterkorn *)
    "bestandesdichte",    // 10 Bestandesdichte
    "kornzahl_aehre",     // 11 Kornzahl/Ähre
    "tausendkornmasse",   // 12 Tausendkornmasse
    "kornertrag_st1",     // 13 Kornertrag Stufe 1
    "kornertrag_st2",     // 14 Kornertrag Stufe 2
  ],
  expectedRows: 35,
  spotChecks: [
    { name: "Conduct", page: 78, zuechtyp: "P", values: "5 5 8 7 7 5 5 4 3 5 2 5 1 1", section: "Mit Voraussetzung des landeskulturellen Wertes in Deutschland zugelassen" },
    { name: "SU Torvi", page: 80, zuechtyp: "H", footnotes: [1], values: "4 5 4 4 5 - 5 4 4 6 6 6 8 7", section: "In einem anderen EU-Land eingetragen" },
  ],
};

const DINKEL: CropSpec = {
  out: "dinkel",
  label: "Winterspelz/Winterdinkel (S. 96-98, Notentabelle nur auf S. 96; Header auf S. 96 verifiziert)",
  firstPage: 96,
  lastPage: 98,
  fields: [
    "aehrenschieben",     // 1  Ährenschieben
    "reife",              // 2  Reife
    "pflanzenlaenge",     // 3  Pflanzenlänge
    "lager",              // 4  Neigung zu Lager
    "mehltau",            // 5  Mehltau
    "blattseptoria",      // 6  Blattseptoria
    "gelbrost",           // 7  Gelbrost
    "braunrost",          // 8  Braunrost
    "bestandesdichte",    // 9  Bestandesdichte
    "kernzahl_aehre",     // 10 Kernzahl/Ähre     (Spelz: "Kern", nicht "Korn")
    "tausendkernmasse",   // 11 Tausendkernmasse  (Spelz-Nomenklatur)
    "vesenertrag_st1",    // 12 Vesenertrag Stufe 1 (Vesen = entspelzte Körner)
    "vesenertrag_st2",    // 13 Vesenertrag Stufe 2
  ],
  expectedRows: 29,
  spotChecks: [
    { name: "Alarich", page: 96, values: "- - - - - - - - - - - - -", section: "Mit Voraussetzung des landeskulturellen Wertes in Deutschland zugelassen" },
    { name: "Zollernspelz", page: 96, values: "5 6 4 3 4 5 - 4 5 6 6 6 5", section: "Mit Voraussetzung des landeskulturellen Wertes in Deutschland zugelassen" },
  ],
};

const HAFER: CropSpec = {
  out: "hafer",
  label: "Sommerhafer (S. 68-71, Notentabelle nur auf S. 68; Header auf S. 68 verifiziert)",
  firstPage: 68,
  lastPage: 71,
  prefixTokenField: "spelzenfarbe",
  fields: [
    "rispenschieben",                 // 1  Rispenschieben
    "reife",                          // 2  Reife
    "reifeverzoegerung_stroh",        // 3  Reifeverzögerung des Strohs
    "pflanzenlaenge",                 // 4  Pflanzenlänge
    "lager",                          // 5  Neigung zu Lager
    "halmknicken",                    // 6  Halmknicken
    "mehltau",                        // 7  Mehltau
    "bestandesdichte",                // 8  Bestandesdichte
    "kornzahl_rispe",                 // 9  Kornzahl/Rispe
    "tausendkornmasse",               // 10 Tausendkornmasse
    "kornertrag_st1",                 // 11 Kornertrag Stufe 1
    "kornertrag_st2",                 // 12 Kornertrag Stufe 2
    "sortierung_2_0",                 // 13 Sortierung > 2,0 mm   (Qualitätsblock)
    "sortierung_2_5",                 // 14 Sortierung > 2,5 mm   (Qualitätsblock)
    "hektolitergewicht",              // 15 Hektolitergewicht     (Qualitätsblock)
    "spelzenanteil",                  // 16 Spelzenanteil         (Qualitätsblock)
    "anteil_nicht_entspelzter_koerner", // 17 Anteil nicht entspelzter Körner
  ],
  expectedRows: 22,
  spotChecks: [
    { name: "Apollon", page: 68, spelzenfarbe: "g", values: "4 5 6 6 4 4 7 4 4 8 5 5 9 9 6 3 2", section: "Mit Voraussetzung des landeskulturellen Wertes in Deutschland zugelassen" },
    { name: "Stephan", page: 68, spelzenfarbe: "g", values: "3 4 3 5 6 7 4 5 4 7 4 5 - - - - -", section: "In einem anderen EU-Land eingetragen" },
  ],
};

const CROPS = [WINTERGERSTE, WINTERROGGEN, DINKEL, HAFER];

// ---------------------------------------------------------------------------
// Parser engine (mirrors parse-wheat.ts)
// ---------------------------------------------------------------------------

const VALUE_TOKEN_RE = /^[1-9-]$/;
const FOOTNOTE_TOKEN_RE = /^(\d+)\)[.,;]?$/;
const RYE_TYPE_RE = /^[PH]$/;
const OAT_COLOR_RE = /^[gws]$/;

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

function parseLine(rawLine: string, section: string, spec: CropSpec): CerealRow | null {
  const tokens = rawLine.trim().split(/\s+/u);
  const n = spec.fields.length;
  const run = trailingValueRun(tokens);
  if (run !== n) return null;

  const valueTokens = tokens.slice(tokens.length - n);
  let nameTokens = tokens.slice(0, tokens.length - n);
  if (nameTokens.length === 0) return null;

  // roggen: type token (P = Populationssorte, H = Hybridsorte) left of the scores.
  let zuechtyp: string | null = null;
  if (spec.typeTokenField) {
    const t = nameTokens[nameTokens.length - 1]!;
    if (!RYE_TYPE_RE.test(t)) return null;
    zuechtyp = t;
    nameTokens.pop();
  }

  // hafer: Spelzenfarbe token (g = gelb, w = weiß, s = schwarz) left of the scores.
  let spelzenfarbe: string | null = null;
  if (spec.prefixTokenField) {
    const t = nameTokens[nameTokens.length - 1]!;
    if (!OAT_COLOR_RE.test(t)) return null;
    spelzenfarbe = t;
    nameTokens.pop();
  }

  if (nameTokens.length === 0) return null;

  // "neu" prefix = newly admitted variety (left of the name).
  let isNew = false;
  if (nameTokens[0] === "neu") {
    isNew = true;
    nameTokens.shift();
  }

  // Trailing footnote markers on the name, e.g. "SU Torvi 1)".
  const footnotes: number[] = [];
  while (nameTokens.length > 0) {
    const m = FOOTNOTE_TOKEN_RE.exec(nameTokens[nameTokens.length - 1]!);
    if (!m) break;
    footnotes.unshift(Number(m[1]));
    nameTokens.pop();
  }

  const sortenname = nameTokens.join(" ");
  // Safety net: variety names start with a capital letter.
  if (!/^[A-ZÄÖÜ]/.test(sortenname) || nameTokens.length === 0) return null;

  const row: CerealRow = { sortenname, section, is_new: isNew, footnotes };
  if (spec.typeTokenField) row[spec.typeTokenField] = zuechtyp;
  if (spec.prefixTokenField) row[spec.prefixTokenField] = spelzenfarbe;
  spec.fields.forEach((field, i) => {
    const t = valueTokens[i]!;
    row[field] = t === "-" ? null : Number(t);
  });
  return row;
}

function parseCrop(spec: CropSpec) {
  const text = pdftotext(spec.firstPage, spec.lastPage);
  let section = "";
  const rows: CerealRow[] = [];
  /** Long value runs != n on name-like lines (organic tables etc.), for the report. */
  const skippedLongRuns = new Map<number, number>();

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    const header = SECTION_HEADERS.find(([re]) => re.test(line));
    if (header) {
      section = header[1];
      continue;
    }

    const row = parseLine(line, section, spec);
    if (row) {
      rows.push(row);
      continue;
    }

    const tokens = line.split(/\s+/u);
    const run = trailingValueRun(tokens);
    if (run >= 10) skippedLongRuns.set(run, (skippedLongRuns.get(run) ?? 0) + 1);
  }
  return { rows, skippedLongRuns };
}

/** Serialize the score fields of a row back into a token string. */
function rowValuesAsString(row: CerealRow, spec: CropSpec): string {
  return spec.fields.map((f) => (row[f] === null ? "-" : String(row[f]))).join(" ");
}

/** Mandatory verification: compare spot-check rows against the raw source page. */
function verify(spec: CropSpec, rows: CerealRow[]): boolean {
  const pageCache = new Map<number, string>();
  const page = (p: number) => {
    if (!pageCache.has(p)) pageCache.set(p, pdftotext(p, p));
    return pageCache.get(p)!;
  };

  let ok = true;
  for (const check of spec.spotChecks) {
    const jsonRow = rows.find((r) => r.sortenname === check.name);
    if (!jsonRow) {
      console.error(`   FAIL ${check.name}: nicht in ${spec.out}.json gefunden`);
      ok = false;
      continue;
    }
    // Independent re-read of the raw line on the source page.
    const rawLine = page(check.page)
      .split("\n")
      .find((l) => new RegExp(`(^|\\s)${check.name}(\\s|$)`).test(l));
    if (!rawLine) {
      console.error(`   FAIL ${check.name}: keine Zeile auf Seite ${check.page} gefunden`);
      ok = false;
      continue;
    }
    const rawTokens = rawLine.trim().split(/\s+/u);
    const rawValues = rawTokens.slice(rawTokens.length - spec.fields.length).join(" ");
    const jsonValues = rowValuesAsString(jsonRow, spec);
    const valuesOk = jsonValues === check.values && rawValues === check.values;
    const metaOk =
      (check.is_new === undefined || jsonRow.is_new === check.is_new) &&
      (check.footnotes === undefined || JSON.stringify(jsonRow.footnotes) === JSON.stringify(check.footnotes)) &&
      (check.zuechtyp === undefined || jsonRow.zuechtyp === check.zuechtyp) &&
      (check.spelzenfarbe === undefined || jsonRow.spelzenfarbe === check.spelzenfarbe) &&
      (check.section === undefined || jsonRow.section === check.section);
    console.log(
      `   ${valuesOk && metaOk ? "OK  " : "FAIL"} Stichprobe ${check.name} (S.${check.page}): json=[${jsonValues}] roh=[${rawValues}] erwartet=[${check.values}]` +
        ` | section="${jsonRow.section}" is_new=${jsonRow.is_new} footnotes=[${jsonRow.footnotes.join(",")}]` +
        (spec.typeTokenField ? ` zuechtyp=${jsonRow.zuechtyp}` : "") +
        (spec.prefixTokenField ? ` spelzenfarbe=${jsonRow.spelzenfarbe}` : ""),
    );
    if (!valuesOk || !metaOk) ok = false;
  }
  return ok;
}

function runCrop(spec: CropSpec): boolean {
  const { rows, skippedLongRuns } = parseCrop(spec);

  if (rows.length !== spec.expectedRows) {
    console.error(`   FEHLER: ${rows.length} Zeilen gefunden, erwartet ${spec.expectedRows}.`);
    return false;
  }

  // Duplicate guard: a variety must appear at most once per section.
  const seen = new Set<string>();
  for (const r of rows) {
    const key = `${r.section}::${r.sortenname}`;
    if (seen.has(key)) {
      console.error(`   FEHLER doppelte Zeile: ${key}`);
      return false;
    }
    seen.add(key);
  }

  writeFileSync(join(HERE, `${spec.out}.json`), JSON.stringify(rows, null, 2) + "\n", "utf8");

  // ---- Report -------------------------------------------------------------
  const perSection = new Map<string, number>();
  for (const r of rows) perSection.set(r.section, (perSection.get(r.section) ?? 0) + 1);

  const rowsWithNull = rows.filter((r) => spec.fields.some((f) => r[f] === null));
  const totalNullCells = rows.reduce(
    (acc, r) => acc + spec.fields.filter((f) => r[f] === null).length, 0);
  const fullyNullRows = rows.filter((r) => spec.fields.every((f) => r[f] === null)).length;
  const newRows = rows.filter((r) => r.is_new).length;
  const rowsWithFootnotes = rows.filter((r) => r.footnotes.length > 0).length;

  let orderOk = true;
  for (const [sec] of perSection) {
    const names = rows.filter((r) => r.section === sec).map((r) => r.sortenname);
    for (let i = 1; i < names.length; i++) {
      if (names[i - 1]!.localeCompare(names[i]!, "de") > 0) {
        orderOk = false;
        console.error(`   WARNUNG Sortierung in "${sec}": ${names[i - 1]} > ${names[i]}`);
      }
    }
  }

  const first = rows[0]!;
  const last = rows[rows.length - 1]!;
  console.log(`\n=== ${spec.label} ===`);
  console.log(` ${spec.out}.json: ${rows.length} Sorten, ${spec.fields.length} Notenspalten` +
    (spec.typeTokenField ? " + zuechtyp" : "") + (spec.prefixTokenField ? " + spelzenfarbe" : ""));
  for (const [sec, cnt] of perSection) console.log(`   - [${cnt}] ${sec}`);
  console.log(` Erste Sorte: ${first.sortenname} | Letzte: ${last.sortenname}` +
    (spec.typeTokenField ? ` (zuechtyp Verteilung: P=${rows.filter((r) => r.zuechtyp === "P").length}, H=${rows.filter((r) => r.zuechtyp === "H").length})` : ""));
  console.log(` Zeilen mit null-Werten: ${rowsWithNull.length} (${fullyNullRows} komplett null), null-Zellen: ${totalNullCells}/${rows.length * spec.fields.length}`);
  console.log(` neu zugelassen (is_new): ${newRows}, mit Fußnoten-Marker: ${rowsWithFootnotes}`);
  console.log(` Übersprungene Zeilen mit Wert-Run >= 10 und != ${spec.fields.length}: ${[...skippedLongRuns].map(([run, n]) => `${n}x Run=${run}`).join(", ") || "keine"}`);
  console.log(` Alphabetische Reihenfolge je Abschnitt: ${orderOk ? "OK" : "WARNUNGEN"}`);

  return verify(spec, rows);
}

function main(): void {
  let allOk = true;
  for (const spec of CROPS) allOk = runCrop(spec) && allOk;
  if (!allOk) {
    console.error("\nVerifikation FEHLGESCHLAGEN — Ausgaben verwerfen!");
    process.exit(1);
  }
  console.log("\nAlle Stichproben und Zeilenzahlen- Guards OK.");
}

main();
