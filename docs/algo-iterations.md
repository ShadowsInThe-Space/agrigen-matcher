# Algo-Iterations-Log — Match-Genauigkeit (Ralph-Loop, 20 Iterationen)

Ziel: messbar höhere Match-Genauigkeit ohne Gelddruck auf die mathematische Redlichkeit
(Satisficing-Semantik bleibt Primat, Kernel bleibt Kernel). Jede Iteration:
Hypothese → Änderung → Messung → Behalten/Revert.

**Messrahmen (`node mvp/eval.ts`, deterministische Seeds, schreibt `mvp/eval-results.json`):**

| Metrik | Bedeutung |
|---|---|
| identity_top1 | Selbst-Retrieval unter Vollmaske (12 Dims) — Abfrage aus Traits einer Accession muss diese auf Rang 1 finden |
| partial_identity_top1_k4 | dasselbe mit 4 zufälligen Dims, 10 Seeds × 12 Accessionen |
| loo_top3_jaccard | Top-3-Stabilität unter Leave-One-Out in 3 Demo-Szenario-Masken |
| noise_flip_rate_eps005 | Top-1-Wechsel unter ±0.05 Query-Rauschen (roh, inkl. Präferenzwechsel unter Gleichstand) |
| noise_regret_rate_eps005 | Bedauerns-Rate: Rauschen führt zu schlechterer Erfüllung der ORIGINAL-Anfrage (Score-Differenz gegen Original-Query) |
| separation_mean_gap | mittlerer Top1−Top2 Abstand (Identity-Queries) |

## Iteration 1 — Eval-Harness + Baseline

**Änderung:** `mvp/eval.ts` ( label-freie Metriken M1–M5, mulberry32-PRNG für
Reproduzierbarkeit, `eval-results.json` als maschinenlesbarer Stand).

**Baseline (Vor-Tiebreaker, Plain-Sort):**
```
identity_top1             1.0000
identity_top3             1.0000
identity_mrr              1.0000
partial_identity_top1_k4  0.9583   ← Schwachstelle: Dominanz-Ties bei Score 1.0
loo_top3_jaccard          1.0000
noise_flip_rate_eps005    0.2486
separation_mean_gap       0.1061
```

**Erkenntnis:** Vollmaske ist perfekt, weil die zweiseitigen Target-Dims (pH, Tage)
Gleichstände brechen. Bei reinen Benefit-Teilräumen dominieren früher indizierte
Kandidaten den Gleichstand (stabile Sortierung) → ~4 % Identitätsverlust.

**Entscheidung:** Behalten (Messinfrastruktur).

## Iteration 2 — Kernel-Tiebreaker (rankCandidates)

**Hypothese:** Bei Score-Gleichstand (mehrere Kandidaten erfüllen die Anfrage
vollständig) soll der profilähnlichste Kandidat gewinnen — nicht der
katalogreihenfolge-erste. Selbst-Similarität ist per Definition 1 (Distanz 0),
also gewinnt Identity-Retrieval jeden Gleichstand.

**Änderung:** `scoring.ts`: `rankCandidates(rows, query, mask, γ, directions)` —
Primärschlüssel Hinge-Score (Satisficing), Sekundärschlüssel
`dimensionNormalizedRbf` auf dem aktiven Teilraum (feste Maske ⇒ PSD ⇒
RKHS-Kosinus, also mathematisch legitim). Satisficing wird NIE von Similarität
überschrieben. `eval.ts` nutzt rankCandidates.

**Messung:**
```
partial_identity_top1_k4  0.9583 → 1.0000  ✓ Ziel erreicht
identity_top1             1.0000 (unverändert)
loo_top3_jaccard          1.0000 (unverändert)
separation_mean_gap       0.1061 (unverändert)
noise_flip_rate_eps005    0.2486 → 0.4806  (siehe Iteration 3: Messartefakt)
```
Demo-Output byte-identisch, selftest 47/47 (+3 neue Tiebreak-Checks → 50).

**Entscheidung:** Behalten — echte Verbesserung, keine Regression.

## Iteration 3 — Ehrlichere Noise-Metrik (Regret-Rate)

**Befund:** Die rohe Flip-Rate verdoppelte sich unter dem Tiebreaker. Ursache:
Gleichstand-Kandidaten (alle Score 1.0) wurden vorher willkürlich, aber
rauschen-immun sortiert; jetzt entscheidet die (rauschen-empfindliche)
Profilähnlichkeit. Flips unter Gleichwertigkeit sind Präferenzwechsel,
keine Qualitätsverluste.

**Änderung:** `eval.ts`: Regret-Rate — ein Flip zählt nur als Verschlechterung,
wenn der unter Rauschen Gewählte die ORIGINAL-Anfrage schlechter erfüllt als
der Baseline-Sieger (beide Scores gegen Original-Query, Toleranz 1e-9).

**Messung:**
```
noise_flip_rate_eps005    0.4806  (48 % Top-1-Wechsel)
noise_regret_rate_eps005  0.0917  ← nur 9.2 % echte Verschlechterung
```

**Erkenntnis:** 81 % der Flips sind Gleichstands-Präferenzwechsel. Das echte
Verbesserungsziel für Iteration 4+ ist die Regret-Rate (Ziel < 0.05).

**Entscheidung:** Behalten (Metrik-Präzisierung; kein Algo-Change).

## Nächste Hypothesen (Iterationen 4–20, Pipeline)

- **It 4:** Feature-Gewichtung nach Varianz (inerte Dims wie disease_resistance
  entzerren) → Wirkung auf regret + separation
- **It 5:** γ-Kalibration der Similarität im Tiebreaker (eigener Teilraum-γ vs.
  Score-γ) → regret unter Rauschen
- **It 6:** Sanfte Target-Map (LEVEL-Ziele weiter vom Extrem) → regret
- **It 7:** Zwei-Stufen-Retrieval (Shortlist nach Score, Re-Rank nach
  Similarität mit kleinem γ) → separation ohne Satisficing-Verlust
- **It 8+:** je nach Messlage; jede Änderung nur bei nachweisbarer
  Metrik-Verbesserung ohne Regression woanders (goldene Regel: identity 1.0,
  LOO 1.0, Demo-Szenario-Erwartungen bleiben erhalten).
