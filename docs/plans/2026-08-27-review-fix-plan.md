# Review-Fix-Plan — AgriGen Matcher MVP (KI Biennale, Deadline 31.08.)

## Kontext

Zwei adversariale Gutachten (RKHS-Professor, Architecture-Critic) fanden Findings am frisch
geporteten TypeScript-MVP (`mvp/`). Dieser Plan behebt ALLE Findings komplett. Baseline-Commit:
`2deddd7` auf Branch `fix/review-findings-mvp`.

## Globale Constraints (verbindlich für alle Tasks)

- **GC1:** `mvp/kernelMath.ts` bleibt semantisch unverändert (Port-Treue zum SeedShuffle-Kern).
  Erlaubt sind NUR: Kommentar-/Doku-Korrekturen, Header-Claim-Fix, JSDoc-Bedingungen. Keine
  Verhaltensänderung bestehender Funktionen. Neue Funktionen dürfen ergänzt werden.
- **GC2:** Alles läuft ohne Dependencies mit Node ≥ 22.18 (`node mvp/demo.ts`, kein Build-Schritt,
  kein npm install). Nur node:*
- **GC3:** Keine unbelegten Claims: Zahlen im Code/README müssen im Repo verifizierbar sein.
- **GC4:** Deutschsprachige Demo-Ausgabe (Jury), Code-Kommentare Englisch (Repo-Konvention).
- **GC5:** Jeder Task endet mit lauffähigem `node mvp/demo.ts` und `node mvp/selftest.ts`
  (Exit 0), committet auf dem Fix-Branch.
- **GC6:** Hinge-basiertes Query-Scoring wird als Query-Scoring deklariert (NICHT als Kernel);
  die Katalog-Kernelmatrix bleibt echter RBF-Kernel.

## Task 1: Trust-Chain — kernelMath-Doku, package.json, README

Dateien: `mvp/kernelMath.ts` (nur Doku), `mvp/package.json` (neu), `README.md`.

1. `mvp/kernelMath.ts` Header: "battle-tested by 27 unit tests" ersetzen durch faktisch
   verifizierbare Aussage: Port des SeedShuffle-Kerns, semantisch identisch (renames:
   strain→candidate, Fehlermeldung validateFeatureRanges, Kommentare); Source-Repo-Referenz
   `seedshuffle_aistudio/server/utils/kernelMath.ts` mit Hinweis auf deren Test-Suite
   (`tests/unit/kernelMath.spec.ts`, 39 Tests). KEINE Verhaltensänderung.
2. `dimensionNormalizedRbf` JSDoc präzisieren: RKHS-Kosinus-Identität gilt nur unter
   (a) PSD (garantiert bei FESTER Maske für alle Paare — Gauß-Kernel auf der Projektion) und
   (b) Einheitsdiagonale K(z,z)=1. K(x,x)=1 ALLEIN ist nicht hinreichend (Gegenbeispiel mit
   paarweise verschiedenen Masks: Einheitsdiagonale, min-λ = −0.997). Bei paarweise
   verschiedenen Masks liegt KEIN RKHS vor.
3. Neue exportierte Guard-Funktion `assertFixedScoringMask(candidateMasks)` in kernelMath.ts:
   wirft, wenn Kandidaten-Masks paarweise variieren (Liste von Masks, alle identisch oder
   undefined). Demo/Selbsttest nutzen sie später. (Neue Funktion = kein Bruch von GC1.)
4. `mvp/package.json` (neu): `{"name":"agrigen-matcher-mvp","private":true,"type":"module",
   "engines":{"node":">=22.18"},"scripts":{"demo":"node demo.ts","selftest":"node selftest.ts"}}`
5. `README.md` Rewrite: TS-MVP als primären Einstieg (`npm run demo` im mvp/-Ordner bzw.
   `node mvp/demo.ts`, Node ≥ 22.18, zero deps), Python-Kern mit dokumentiertem venv +
   `core/cli.py` (Entry-Point!), Strukturbaum aktualisiert (core/, mvp/, tests/, CI),
   Zwei-Implementierungs-Story: "Reference-Port (mvp/, diff-identisch zum SeedShuffle-
   Produktivkernel)" vs. "SOLID Python-Rebuild (core/, 130 Tests, CI)" — ausdrücklich NICHT
   als derselbe Rechenkern behaupten (γ-Kalibrationen/Normalisierungen unterscheiden sich).

## Task 2: Scoring-Semantik — Crop-Group-Ertrag, Hinge-Terme, Teilraum-γ

Dateien: `mvp/traits.ts` (Anpassung), `mvp/scoring.ts` (neu).

1. **Crop-Group-Ertragsnormalisierung** (Fix P1, Professoren-Finding): `yield_potential`
   wird pro Fruchtartengruppe min-max-normalisiert statt global. Gruppen-Mapping nach Genus:
   - `cereal`: Triticum, Hordeum, Avena, Secale, Sorghum, Zea
   - `legume`: Glycine, Phaseolus, Vicia
   - `root_tuber`: Solanum, Beta
   - `oilseed`: Helianthus
   Einzelmember-Gruppe → neutral 0.5 (dokumentieren!). Interne Funktion, kein Datenfile-Change;
   Genus→Gruppe als explicit const map `CROP_GROUPS` in traits.ts, mit Test-abdeckbarer Form.
   Kommentar: relative Ertragsposition innerhalb vergleichbarer Erntegut-Klassen
   (Korntrockenmasse vs. Frischmasse sind inkommensurabel).
2. **Trait-Richtungs-Tabelle** (Fix P4): `TRAIT_DIRECTIONS: Record<string,'benefit'|'cost'|'target'>`
   - benefit (mehr ist besser, shortfall bestraft): drought/heat/cold/disease/nitrogen/salinity
     tolerance, yield_potential
   - cost (weniger ist besser, Überschuss bestraft): water_requirement
   - target (zweiseitig): soil_ph_min, soil_ph_max, root_depth?? NEIN — root_depth ist benefit
     (tiefer = besser für Trockenresilienz) → benefit. growing_days: Sonderfall richtungs-
     abhängig von seasonLength (short → cost, long → benefit, medium → target). growing_days
     daher NICHT in die statische Tabelle, sondern dynamisch je Query.
3. **Neues `mvp/scoring.ts`**: exportiert
   - `scoreCandidate(query, candidate, queryMask, gamma, directions): number` — maskierte,
     dimension-normalisierte quadrierte Distanz mit einseitigen Hinge-Termen:
     benefit: (max(0, q_i − x_i))², cost: (max(0, x_i − q_i))², target: (x_i − q_i)²;
     dann score = exp(−γ · mean(term_i)). Nur aktive Query-Dimensionen zählen.
   - `queryGamma(catalogRows, queryMask): number` — Teilraum-γ via
     `medianHeuristicGamma(rows, undefined, queryMask)` (Fix P6).
   - `percentileOf(score, allScores): number` — Anteil der Katalog-Scores strikt unter dem
     Score (0–100, Fix P2). Dokumentieren: Query-Scoring (asymmetrisch, Satisficing), kein
     Kernel in (q,x); Katalog-Kern bleibt RBF (GC6).
4. `traits.ts`: `extractRequirements` erweitert — Rückgabe enthält zusätzlich `directions`
   (abgeleitet: statische Tabelle + growing_days dynamisch: short→cost, long→benefit,
   medium→target; root_depth: rooting 'deep'→benefit, 'shallow'→cost-artig? NEIN: rooting
   shallow heißt "ich brauche flach" → zweiseitig? Entscheidung: root_depth = benefit immer
   (tiefer wurzelt = robuster); rooting 'shallow' setzt target niedrig, bleibt benefit-Richtung).
   Wasser: waterAvailability low/moderate/high → Zielwert via LEVEL-Map, Richtung cost.
5. `buildCatalog` nutzt Crop-Group-Normalisierung für yield. Alle anderen Dimensionen
   unverändert (Rating (v−1)/9, restliches min-max global).

## Task 3: Demo-Rewrite — Rang+Perzentil-Präsentation, PSD-Branch, Wortlaut

Datei: `mvp/demo.ts` (Rewrite auf Task-2-APIs).

1. Scoring-Pfad: pro Szenario Teilraum-γ (`queryGamma`), `scoreCandidate` je Kandidat,
   Perzentil je Kandidat. Katalog-Kernelmatrix (volle Maske, RBF via dimensionNormalizedRbf)
   bleibt als Diagnose-Objekt (Rang, min-λ mit bedingtem PSD-Check: `min-λ >= −1e−10 ?
   'PSD ✓' : 'PSD ✗'` und process.exit(1) bei Verstoß) — Fix M2.
2. Ausgabe je Szenario: Rang, Accession, Sorte, dimensionslose Kernel-Ähnlichkeit (3 Dezimal-
   stellen, NICHT als %), Perzentil ("besser als X % des Katalogs"), aktive Dimensionen + γ.
   Top-K als "praktisch gleichwertige Kandidaten" kennzeichnen, wenn Score-Abstand < 0.01.
   Gap-Zeile ersetzt Perzentillücke statt "%-Punkte".
3. Banner: Zeile 2 kürzen, so dass padEnd-Box nicht bricht (Fix N1). Wortlaut: "kernel-basiert"
   statt "semantisch" nirgends mehr "semantisch"; "Referenz-Port des SeedShuffle-Kernels"
   Formulierung entfernen aus Jury-Output (Claim-Sicherheit), statisch neutral: "AgriGen
   Matcher — kernel-basiertes Sorten-Matching (MVP)".
4. Szenario-Untertitel: Szenario C jetzt ehrlich "Leguminosen-Screening / Low-Input"
   (Erwartung: Leguminosen vorne NACH Fix).
5. Erwartungs-Check im Code-Kommentar dokumentieren (nicht in Ausgabe): Szenario A erwartet
   Bohne/Mais/Sonnenblume-Klasse mit Sorghum NICHT mehr absurd bestraft; C erwartet
   faba/soy/bean vorne.

## Task 4: Selbsttest-Härtung — Goldwerte, Hinge-Invarianten, PSD-Gegenbeispiel

Datei: `mvp/selftest.ts` (Erweiterung; Zahlen aus tatsächlichem Lauf von Task 3).

1. Goldwerte (nach echtem Demo-Lauf in Task 3 eintragen): globaler Katalog-γ auf 1e−3 genau,
   Top-1-Accession je Szenario (3 Checks), PSD min-λ > 0.
2. Neue Invarianten-Checks:
   - Hinge: benefit-Dim — Kandidat ÜBER Ziel → Term 0; Kandidat UNTER Ziel → Term (Δ)².
   - Hinge asymmetrisch: scoreCandidate(q,x) ≠ scoreCandidate(x,q) für benefit-Dim (deklariert).
   - `assertFixedScoringMask`: identische Masks ok, variierende wirft.
   - PSD-Gegenbeispiel aus Gutachten (4 Punkte, 2 Dim, Masks (1,0),(0,1),(1,0),(0,1),
     γ groß): min-λ < 0 → dokumentiert die Grenze variierender Masks als Test.
   - Crop-Group: Rübe (Beta) und Kartoffel (Solanum) yield-normalisiert innerhalb root_tuber;
     Weizen innerhalb cereal — Werte prüfen (z.B. beet=1, potato=0 in deren Gruppe,
     wheat=(9.2−6.0)/(12.5−6.0)).
   - Jacobi: rotierte diag(1,2,3)-Matrix → Eigenwerte {1,2,3} (Fix M4).
3. Exit-Code-Disziplin:_ANY FAIL → exit 1.

## Abgrenzung (NICHT Teil dieses Plans)

PDF-Erstellung, EURISCO-echtdaten, Web-Demo, Python-core-Umbauten, Konsolidierung der Kerne.
