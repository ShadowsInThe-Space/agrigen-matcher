# BSL 2026 — Multi-Fruchtarten-Parsing: Verifikationsnotizen

Datum: 2026-08-27 · Branch: `feat/bsa-real-data` · Parser: `data/bsa/parse-cereals.ts`
Quelle: `data/bsa/bsl_getreide_2026.pdf` (Beschreibende Sortenliste Getreide 2026, Bundessortenamt)

## Verifikationsprotokoll (je Fruchtart)

Die Reihenfolge der gedrehten Spaltenüberschriften wurde **je Fruchtart zweifach** bestimmt:

1. **Visuell:** Header-Seite mit `pdftoppm -r 100 -png` gerendert und das PNG gelesen
   (Gerste S. 26, Roggen S. 78, Dinkel S. 96, Hafer S. 68).
2. **Koordinatenbasiert:** `pdftotext -bbox` — x-Koordinaten (xMin) der rotierten
   Header-Wörter extrahiert und aufsteigend sortiert. Die Lesereihenfolge des
   `-layout`-Textlayers ist bei rotierten Headern **nicht** verlässlich, die
   Koordinaten schon (Spaltenabstand je Tabelle konstant, z. B. Roggen ~14,8 pt;
   keine Lücke = keine übersehene Spalte).

Zusätzlich wurde die **Token-Anzahl der ersten Datenzeilen** gegen die Header-Liste
abgesichert und je Kapitel der **maximale Wert-Run** (Trailing-Run aus Tokens `[1-9]|-`)
pro Seite bestimmt, um Kollisionen mit Qualitäts-, Ergänzungs- und Öko-Tabellen
auszuschließen (Gerste-Score 19 vs. Qualität 14 vs. Öko 20; Roggen-Score 14 vs.
Öko 15 vs. Sommerroggen 13; Dinkel-Score 13 vs. Qualität ≤ 8; Hafer-Score 17 vs.
Öko 18/19).

Zeilenregel wie im Wheat-Referenzparser: Zeile = Sortenname (+ ggf. Typ-/Präfix-Token)
+ exakt N Tokens `[1-9]|-`; Fußnoten-Marker `1)` → Feld `footnotes`, Präfix `neu` →
`is_new`, `-` → `null`, Abschnitts-Header → `section`. Hard Guards: erwartete
Sortenzahl je Fruchtart, Duplikat-Check, alphabetische Ordnung je Abschnitt (de).

---

## 1. Wintergerste mehrzeilig — `wintergerste.json` (PDF S. 26–30)

**Bildquelle:** `pdftoppm -r 100` S. 26 (`hdr-26-026.png`), visuell gelesen.
**Wichtig:** Im Gegensatz zum Weizen steht bei Gerste **Ährenschieben vor Reife**!

| # | Spalte (Original) | Feld | x-Min (pt) |
|---|---|---|---|
| 1 | Ährenschieben | `aehrenschieben` | 120,7 |
| 2 | Reife | `reife` | 133,4 |
| 3 | Pflanzenlänge | `pflanzenlaenge` | 146,0 |
| 4 | Neigung zu Lager | `lager` | 159,1 |
| 5 | Halmknicken | `halmknicken` | 171,7 |
| 6 | Ährenknicken | `aehrenknicken` | 184,2 |
| 7 | Mehltau | `mehltau` | 197,4 |
| 8 | Netzflecken | `netzflecken` | 209,9 |
| 9 | Rhynchosporium | `rhynchosporium` | 222,7 |
| 10 | Ramularia | `ramularia` | 235,4 |
| 11 | Zwergrost | `zwergrost` | 248,0 |
| 12 | Gelbmosaik BaYMV-1, BaMMV | `gelbmosaik_baymv1` | 261,1 |
| 13 | Gelbmosaik BaYMV-2 | `gelbmosaik_baymv2` | 273,7 |
| 14 | Gerstengelbverzwergung | `gerstengelbverzwergung` | 286,3 |
| 15 | Bestandesdichte | `bestandesdichte` | 299,4 |
| 16 | Kornzahl/Ähre | `kornzahl_aehre` | 312,0 |
| 17 | Tausendkornmasse | `tausendkornmasse` | 324,7 |
| 18 | Kornertrag Stufe 1 | `kornertrag_st1` | 337,5 |
| 19 | Kornertrag Stufe 2 | `kornertrag_st2` | 350,2 |

Token-Check: 1. Datenzeile `neu Agathe 5 5 4 3 3 3 4 4 7 6 6 1 9 9 6 5 6 8 8` = **19 Noten**. ✓
Seiten mit Notentabellen: 26, 28, 30 (S. 27/29 = Qualitätstabellen, max. Run 14;
S. 32–34/40–41 = Ergänzende Angaben, max. Run 4; S. 35/45 leer).

**Stichproben (json = rohtext = erwartung):**
- Erste Sorte: `Agathe` (S. 26, `is_new: true`) — `5 5 4 3 3 3 4 4 7 6 6 1 9 9 6 5 6 8 8`
- Letzte Sorte: `Venezia` (S. 30, Abschnitt EU-Land) — `5 5 6 5 5 4 3 6 7 6 4 1 1 9 4 5 7 6 7`

**Statistik:** 65 Sorten (57 „Mit Voraussetzung … zugelassen“ + 8 „In einem anderen
EU-Land eingetragen“); 16 Zeilen mit null-Werten (0 komplett null), **256/1235 null-Zellen**
(v. a. Sorten ohne deutsche Prüfdaten, die nur Virusresistenzen tragen); `is_new`: 3;
Fußnoten-Marker: 10 (u. a. `1) Hybridsorte`); Sortierung je Abschnitt alphabetisch OK.

### Scope-Entscheidungen Gerste
- **Aufgabenseite „S. 26–41” korrigiert:** Mehrzeilig endet auf S. 30 (letzte Sorte
  Venezia). Ab S. 36 folgt **„Wintergerste – zweizeilig –“** (S. 36/38, 57 weitere
  Sorten, identisches 19-Spalten-Schema) — eigene Gerstenform, separat extrahiert
  als `wintergerste2.json`, siehe **Abschnitt 5**.
- **Öko-Notentabelle S. 42** („Im ökologischen Landbau geprüft”, 20 Spalten mit
  Massebildung/Bodendeckungsgrad): außerhalb des parse-Bereichs, zudem abweichendes
  Schema — bewusst nicht extrahiert (analog S. 132 beim Weizen).
- **Sommergerste S. 46–51:** weicht ab (zweizeilig, nur **16** Notenspalten, kein
  Virusresistenz-Block) → **weggelassen**.

---

## 2. Winterroggen — `winterroggen.json` (PDF S. 78–83, Tabellen auf S. 78+80)

**Bildquelle:** `pdftoppm -r 100` S. 78 (`hdr-78-078.png`), visuell gelesen.
**Typ-Token:** Vor den Noten steht `Hybrid-, Populationssorte` (x = 134,6) mit
Token `P` (Populationssorte) bzw. `H` (Hybridsorte) → Feld **`zuechtyp`**.

| # | Spalte (Original) | Feld | x-Min (pt) |
|---|---|---|---|
| — | Hybrid-, Populationssorte | `zuechtyp` ("P"/"H") | 134,6 |
| 1 | Ährenschieben | `aehrenschieben` | 150,6 |
| 2 | Reife | `reife` | 165,4 |
| 3 | Pflanzenlänge | `pflanzenlaenge` | 180,1 |
| 4 | Neigung zu Lager | `lager` | 195,3 |
| 5 | Halmknicken | `halmknicken` | 210,8 |
| 6 | Mehltau | `mehltau` | 226,0 |
| 7 | Rhynchosporium | `rhynchosporium` | 240,8 |
| 8 | Braunrost | `braunrost` | 255,5 |
| 9 | Mutterkorn \*) | `mutterkorn` | 270,2 |
| 10 | Bestandesdichte | `bestandesdichte` | 285,1 |
| 11 | Kornzahl/Ähre | `kornzahl_aehre` | 300,0 |
| 12 | Tausendkornmasse | `tausendkornmasse` | 314,7 |
| 13 | Kornertrag Stufe 1 | `kornertrag_st1` | 329,5 |
| 14 | Kornertrag Stufe 2 | `kornertrag_st2` | 344,2 |

Token-Check: `Conduct P 5 5 8 7 7 5 5 4 3 5 2 5 1 1` = Typ-Token + **14 Noten**
(Aufgabenschätzung „15 Noten“ war ein Token zu hoch; 14 = Header-Befund). ✓

**Stichproben (json = rohtext = erwartung):**
- Erste Sorte: `Conduct` (S. 78, `zuechtyp: "P"`) — `5 5 8 7 7 5 5 4 3 5 2 5 1 1`
- Letzte Sorte: `SU Torvi` (S. 80, `zuechtyp: "H"`, `footnotes: [1]`, EU-Land) —
  `4 5 4 4 5 - 5 4 4 6 6 6 8 7`

**Statistik:** 35 Sorten (29 Mit-Voraussetzung + 6 EU-Land); `zuechtyp`-Verteilung
P = 7, H = 28; 20 Zeilen mit null-Werten (**12 komplett null** — Hybrid-/Populationssorten
ohne aktuelle Prüfdaten), **176/490 null-Zellen**; `is_new`: 1; Fußnoten-Marker: 12
(`1) Sorte wird ausschließlich mit 10%iger Einmischung einer Populationssorte …`);
Sortierung OK. Abschnitts-Kontextzeile „In Körnernutzung geprüft“ (S. 78/80) ist
kapitelkonstant und fließt nicht ins `section`-Feld.

### Scope-Entscheidungen Roggen
- **Sommerroggen S. 90:** abweichend — **13** Noten, **keine Mutterkorn-Spalte**
  (Spaltenende bei Kornertrag Stufe 2, x-Verlauf lückenlos) → **weggelassen**.
- **Öko-Notentabelle S. 84** (15 Spalten mit Massebildung/Bodendeckungsgrad):
  Run 15 ≠ 14, außerhalb des parse-Bereichs — bewusst nicht extrahiert.

---

## 3. Winterspelz/Winterdinkel — `dinkel.json` (PDF S. 96–98, Tabelle nur S. 96)

**Bildquelle:** `pdftoppm -r 100` S. 96 (`hdr-96-096.png`), visuell gelesen.
**Nomenklatur:** Spelz verwendet **Kern/Vesen** statt Korn/Kornertrag — Feldnamen
folgen exakt der Quelle.

| # | Spalte (Original) | Feld | x-Min (pt) |
|---|---|---|---|
| 1 | Ährenschieben | `aehrenschieben` | 137,6 |
| 2 | Reife | `reife` | 154,6 |
| 3 | Pflanzenlänge | `pflanzenlaenge` | 171,6 |
| 4 | Neigung zu Lager | `lager` | 188,4 |
| 5 | Mehltau | `mehltau` | 205,6 |
| 6 | Blattseptoria | `blattseptoria` | 222,6 |
| 7 | Gelbrost | `gelbrost` | 239,6 |
| 8 | Braunrost | `braunrost` | 256,6 |
| 9 | Bestandesdichte | `bestandesdichte` | 270,3 |
| 10 | Kernzahl/Ähre | `kernzahl_aehre` | 290,6 |
| 11 | Tausendkernmasse | `tausendkernmasse` | 307,6 |
| 12 | Vesenertrag Stufe 1 | `vesenertrag_st1` | 324,7 |
| 13 | Vesenertrag Stufe 2 | `vesenertrag_st2` | 341,7 |

Token-Check: `Albertino 5 5 5 6 7 5 3 7 4 8 5 6 7` = **13 Noten**. ✓
Keine Auswinterungs-, keine Halmknicken-Spalte vorhanden.

**Stichproben (json = rohtext = erwartung):**
- Erste Sorte: `Alarich` (S. 96, komplett null) — `- - - - - - - - - - - - -`
- Letzte Sorte: `Zollernspelz` (S. 96) — `5 6 4 3 4 5 - 4 5 6 6 6 5`

**Statistik:** 29 Sorten, nur ein Abschnitt (Mit Voraussetzung; kein EU-Land-Teil);
13 Zeilen mit null-Werten (**10 komplett null** — viele alte/spelztypische Sorten
ohne vollständige Prüfdaten), **133/377 null-Zellen**; `is_new`: 2 (`Keltenschatz`,
`Limpurger`); Fußnoten-Marker: 0; Mehrtoken-Sortennamen („Bauländer Spelz“,
„Fridemar SZS“, „Späths Albrubin“) bleiben erhalten; Sortierung OK.

---

## 4. Sommerhafer — `hafer.json` (PDF S. 68–71, Tabelle nur S. 68)

**Bildquelle:** `pdftoppm -r 100` S. 68 (`hdr-68-068.png`), visuell gelesen.
**Präfix-Token:** `Spelzenfarbe` (gelb/weiß/schwarz) vor den Noten → Feld
**`spelzenfarbe`** (`g`/`w`/`s`; 2026 kommen nur `g` und `w` vor).
**Besonderheit:** Die Sortenübersicht enthält rechts einen Block unter
Gruppenkopf „Qualität“ — diese Spalten sind Noten (1–9) **derselben Tabelle**
(keine separate Qualitäts-Tabelle wie auf den ungeraden Seiten) und werden
mitextrahiert.

| # | Spalte (Original) | Feld | x-Min (pt) |
|---|---|---|---|
| — | Spelzenfarbe (gelb, weiß, schwarz) | `spelzenfarbe` | 120,8 |
| 1 | Rispenschieben | `rispenschieben` | 141,1 |
| 2 | Reife | `reife` | 153,9 |
| 3 | Reifeverzögerung des Strohs | `reifeverzoegerung_stroh` | 166,6 |
| 4 | Pflanzenlänge | `pflanzenlaenge` | 179,2 |
| 5 | Neigung zu Lager | `lager` | 193,4 |
| 6 | Halmknicken | `halmknicken` | 208,7 |
| 7 | Mehltau | `mehltau` | 222,7 |
| 8 | Bestandesdichte | `bestandesdichte` | 235,5 |
| 9 | Kornzahl/Rispe | `kornzahl_rispe` | 248,2 |
| 10 | Tausendkornmasse | `tausendkornmasse` | 261,0 |
| 11 | Kornertrag Stufe 1 | `kornertrag_st1` | 273,8 |
| 12 | Kornertrag Stufe 2 | `kornertrag_st2` | 286,5 |
| 13 | Sortierung > 2,0 mm | `sortierung_2_0` | 299,3 |
| 14 | Sortierung > 2,5 mm | `sortierung_2_5` | 312,0 |
| 15 | Hektolitergewicht | `hektolitergewicht` | 324,8 |
| 16 | Spelzenanteil | `spelzenanteil` | 337,5 |
| 17 | Anteil nicht entspelzter Körner | `anteil_nicht_entspelzter_koerner` | 347,9 |

Token-Check: `Apollon g 4 5 6 6 4 4 7 4 4 8 5 5 9 9 6 3 2` = Spelzenfarbe + **17 Noten**. ✓

**Stichproben (json = rohtext = erwartung):**
- Erste Sorte: `Apollon` (S. 68, `spelzenfarbe: "g"`) — `4 5 6 6 4 4 7 4 4 8 5 5 9 9 6 3 2`
- Letzte Sorte: `Stephan` (S. 68, `spelzenfarbe: "g"`, EU-Land) —
  `3 4 3 5 6 7 4 5 4 7 4 5 - - - - -`

**Statistik:** 22 Sorten (20 Mit-Voraussetzung + 2 EU-Land: `Erlbek`, `Stephan`);
`spelzenfarbe`: g = 18, w = 4 (s = schwarz kommt 2026 nicht vor); 7 Zeilen mit
null-Werten (0 komplett null), **70/374 null-Zellen** (nulls konzentriert in den
Qualitätsspalten der EU-Sorten); `is_new`: 0; Fußnoten-Marker: 0; Sortierung OK.

### Scope-Entscheidungen Hafer
- **Winterhafer S. 72:** total abweichendes Schema („Im Zweitfruchtanbau geprüft
  (Silonutzung)“, nur 9 Spalten: Rispenschieben, Pflanzenlänge, Lager, Mehltau,
  **Kronenrost**, Bestandesdichte, **Trockenmasseertrag, Trockensubstanzgehalt bei
  Ernte**) → **weggelassen**.
- **Öko-Notentabelle S. 70** (18 Noten durch Massebildung/Bodendeckungsgrad, inkl.
  EU-Abschnitt mit Unterüberschrift „Nackthafer“): Run 18/19 ≠ 17 → automatisch
  übersprungen (im Parser-Report als `10x Run=18, 1x Run=19` ausgewiesen).

---

## 5. Wintergerste zweizeilig — `wintergerste2.json` (PDF S. 36–41, Notentabellen S. 36+38)

**Bildquelle:** `pdftoppm -r 100` S. 36 (`hdr36-036.png`), visuell gelesen.
**Spalten-Schema:** identisch mit mehrzeilig (Abschnitt 1) — **19 Spalten, wieder
Ährenschieben vor Reife**. Doppelt verifiziert: visuell (S. 36) **und** per
`pdftotext -bbox` auf S. 36 **und** S. 38 (identische Header-x-Lagen 120,7–350,2 pt,
Spaltenabstand ~12,6 pt, lückenlos — dieselben 19 Labels wie S. 26). Feld-Schema wie
`wintergerste.json`, zusätzlich **`form: "zweizeilig"`** auf jeder Zeile.

Token-Check: 1. Datenzeile `neu Agostina 5 5 4 5 3 4 5 4 5 5 5 1 9 9 9 2 8 8 8`
= **19 Noten**. ✓
Seiten mit Notentabellen: 36, 38 (S. 37/39 = Qualitätstabellen, max. Run 14 ×30;
S. 40–41 = Ergänzende Angaben — die Aufgaben-Vermutung „Notentabelle S. 40" traf
nicht zu, S. 40 enthält nur Ergänzende Angaben).

**Sonderfall Wert-Asterisk:** `Aretha` trägt in der Spalte „Gelbmosaik BaYMV-1,
BaMMV" den Wert `1*` (Fußnote S. 36: „* keine Resistenz gegen BaMMV") → Note 1
plus `footnotes: ["*"]` (einziger Asterisk-Fall im Kapitel; Parser-Guard erlaubt
höchstens einen Asterisk pro Zeile und verwirft sonst). Ohne erweitertes
Wert-Token-Regex (`[1-9-]\*?`) wäre die Zeile verloren gegangen, weil der
Trailing-Run an `1*` bricht — exakt 57 statt 56 Zeilen.

**Stichproben (json = rohtext = erwartung):**
- Erste Sorte: `Agostina` (S. 36, `is_new: true`) — `5 5 4 5 3 4 5 4 5 5 5 1 9 9 9 2 8 8 8`
- Sonderfall: `Aretha` (S. 36, `footnotes: ["*"]`) — `4 5 4 6 6 4 5 4 3 5 4 1 1 9 8 2 7 7 7`
- Letzte Sorte: `Suez` (S. 38, Abschnitt EU-Land) — `6 6 4 4 4 2 3 5 5 4 4 1 9 9 9 1 6 4 4`

**Statistik:** 57 Sorten (55 „Mit Voraussetzung … zugelassen" + 2 „In einem anderen
EU-Land eingetragen": `LG Campus`, `Suez`); 10 Zeilen mit null-Werten (0 komplett
null), **130/1083 null-Zellen** (Sorten ohne aktuelle Prüfdaten tragen meist nur
den Virusresistenz-Block); `is_new`: 7; Fußnoten-Marker: 1 (`*`); Sortierung je
Abschnitt alphabetisch OK. (Die frühere Schätzung „56 weitere Sorten" aus
Abschnitt 1 war um eins zu niedrig.)

---

## 6. Sommerweichweizen — **nicht extrahiert** (Schema-Abweichung, PDF S. 138–143)

Aufgabe: Prüfung gegen das Winterweizen-Schema (16 Noten, Spaltenfolge aus
`parse-wheat.ts`). **Befund: abweichend → nicht geparsed** (Regel „sauber lieber
als komplett").

Kapitelstruktur: Notentabelle S. 138 + S. 140 oben (nur `Winx`, `Zenon`), Qualität
S. 140 unten/S. 141, Ergänzende Angaben S. 142–143; Öko-Abschnitt ab S. 144
außerhalb des Aufgabenbereichs.

Verifikation wie etabliert — visuell (`pdftoppm -r 100` S. 138, `hdr138-138.png`)
**und** `pdftotext -bbox` (S. 138 **und** S. 140, identisch: 15 Header bei
x = 130,0–329,x pt, Spaltenabstand ~14,5 pt, lückenlos; Wert-Cluster 132–332).
Token-Check erste Datenzeile: `Akvitan 5 5 5 4 5 6 - 5 5 5 5 4 8 5 5` =
**15 Noten** ≠ 16. Drei Schema-Abweichungen gegenüber Winterweizen:

| # | Sommerweichweizen (S. 138) | Winterweizen (S. 114) |
|---|---|---|
| 1 | **Ährenschieben** (x 130) | **Reife** |
| 2 | **Reife** (x 145) | Ährenschieben |
| 6 | Blattseptoria | Blattseptoria |
| 7 | **Drechslera tritici-repentis** (x 216; 2026 komplett `-`) | Ährenfusarium |
| 8 | Gelbrost | Drechslera |
| 9 | Braunrost | **Pseudocercosporella** (fehlt im Sommerweizen!) |
| 10 | Ährenfusarium | Bestandesdichte |
| — | **15 Spalten** | **16 Spalten** |

(a) keine Pseudocercosporella-Spalte (15 ≠ 16 Noten), (b) Ährenschieben vor Reife
(Winterweizen: Reife zuerst), (c) „Drechslera tritici-repentis" (DTR-Blattdürre)
als eigene Spalte zwischen Blattseptoria und Gelbrost — im Winterweizen heißt die
Spalte nur „Drechslera" und steht zwei Positionen später. Eine Übernahme in
`sommerweizen.json` mit dem 16er-Winterweizen-Schema wäre fachlich falsch (Spalten
würden verrutschen); eine Aufnahme ist nur mit eigenem 15-Spalten-Spec sinnvoll.
(Größenordnung für evtl. Nachschärfung: 32 Sorten, nur Abschnitt „Mit
Voraussetzung …", kein EU-Teil; Fußnoten 1) begrannt, 2) Eignung für
Herbstaussaat, 3) Resistenz gegen Orangerote Weizengallmücke.)

---


| Datei | Fruchtart | Sorten | Notenspalten | Erste–Letzte Sorte | null-Zellen |
|---|---|---|---|---|---|
| `wintergerste.json` | Wintergerste mehrzeilig | 65 | 19 | Agathe–Venezia | 256/1235 |
| `wintergerste2.json` | Wintergerste zweizeilig (+ `form`) | 57 | 19 | Agostina–Suez | 130/1083 |
| `winterroggen.json` | Winterroggen (+ `zuechtyp`) | 35 | 14 | Conduct–SU Torvi | 176/490 |
| `dinkel.json` | Winterspelz/Winterdinkel | 29 | 13 | Alarich–Zollernspelz | 133/377 |
| `hafer.json` | Sommerhafer (+ `spelzenfarbe`) | 22 | 17 | Apollon–Stephan | 70/374 |

Nicht extrahiert (Schema-Abweichung, siehe Abschnitte oben): Sommerweichweizen
(S. 138/140, 15 statt 16 Noten — Abschnitt 6), Sommergerste zweizeilig (S. 46),
Sommerroggen (S. 90), Winterhafer/Silonutzung (S. 72), alle Öko-Notentabellen
(S. 42/70/84/132).

Alle Stichproben (json vs. Rohtext der Quellseite vs. manuell gelesene Erwartung)
sowie Zeilenzahl-Guards: **OK** (Ausgabe des Parser-Laufs).

## 7. Winterraps — `winterraps.json` (PDF S. 228–230)

**Verifikation:** visuelle Header-Lesung (S. 228) + bbox-Subset-Check (7 Felder
in korrekter Ordnung); volle 12-Spalten-Folge aus Layout+Datenzeilen-Konsistenz:
buehbeginn, **reifeverzoegerung_stroh** (x≈161, identische Spalte wie Hafer),
reife, pflanzenlaenge, lager, tausendkornmasse, kornertrag, oelertrag,
oelgehalt, rohproteinertrag, rohproteingehalt, glucosinolatgehalt.
Zeilenschema: Name + Linie/Hybride-Token [L|H] + 12 Noten.
**49 Sorten** (Karat … Zidane) · 124/588 null · Stichprobe Karat [H]
`4 5 5 6 3 4 9 9 8 7 4 3` = Rohtext S. 228 ✓

## 8. Ackerbohne — `ackerbohne.json` (PDF S. 270)

**Verifikation:** bbox-Check S. 270 (tanningehalt < reife < lager < ascochyta <
botrytis < rost < tausendkornmasse < kornertrag < rohproteinertrag <
rohproteingehalt) + visuelle Header-Lesung. 12 Spalten; Abschnitt „In
Frühjahrsaussaat geprüft" trägt 2026 KEINE Noten; nur EU-Land-Sektion:
**2 Sorten** (Vishnu, Vision) mit wortgleichem Beschreibungsvektor —
1 Äquivalenzklasse (dokumentierte BSL-Informationsgrenze).

## M2a-Scope-Entscheidungen

Mais (K/S-Reifetokens, Reifegruppen-Untertabellen) und Zuckerrübe sowie
Senf/Lein/Lupine/Sommerraps: als Folgeschritte dokumentiert — Schema-Klärung
je Tabelle nötig; Regel bleibt: sauber lieber als komplett.

## 9. Körnermais — `koernermais.json` (PDF S. 206–219)

**Verifikation:** bbox S. 206 — Reihenfolge weicht vom Layout-Lesestand ab:
buehzeitpunkt_weiblich < pflanzenlaenge < **kaelteempfindlichkeit_jugend** <
lager < bestockung < staengelfaeule < kornertrag < tausendkornmasse <
silo_gesamttrockenmasse < staerkegehalt (10 Noten). Zeilenschema: Name +
"K <n>" + "S <n>" (Körner-/Siloreifezahl) + 10 Noten; Reifegruppen-Abschnitte
→ section. **97 Sorten** (LG 31215 … Bismark) · 353/970 null · Stichprobe
LG 31215 K210 S200 `5 7 4 3 2 3 7 6 6 6` = Rohtext ✓. K/S-Reifezahlen als
Metadaten (eigene Skala, nicht Union-Dim). Silomais-Tabellen nicht extrahiert.

## 11. Zuckerrübe — `zuckerruebe.json` (PDF S. 291–292)

**Verifikation:** bbox S. 291 (Cercospora < Mehltau < Ramularia < Rost <
Rübenfrischmasse < Zucker < Bereinigter Zucker < Zucker < Bereinigter Zucker <
Kalium+Natrium < Aminostickstoff — Gruppenzuordnung Erträge/Gehalte via
visueller Header-Lesung geklärt) + Token-Guard (10 Noten vor "ZR"-Kennung).
**55 Sorten** (BTS Smart 9085 N … ; 15 ohne Noten → Gate) · Stichprobe =
Rohtext ✓ (nach Fußnoten-Orphan-Komma-Fix). Feldnamen:
cercospora, mehltau, ramularia, rost, ruebenfrischmasse,
bereinigter_zucker_ertrag, zuckergehalt, bereinigter_zuckergehalt,
kalium_natrium (cost — niedrig = Qualität), aminostickstoff (cost).

**Identity-Befund 0.1316 (5/38):** Partial-Containment-Ties — Zuckerrüben-
Noten sind hoch standardisiert; ein früherer Kandidat, der die Anfrage-
Projektion exakt enthält (mehr beobachtet, auf den gemeinsamen Noten
identisch), bindet bei (1, 1). 38 einzigartige Vollprofile, aber die
Anfrage-Projektionen kollidieren — BSL-Informationsgrenze, dokumentiert.
