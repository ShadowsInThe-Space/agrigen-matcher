# TODO — getrackte Nacharbeiten

Nacharbeit aus dem Final-Review 2026-08-27 (code-excellence + Architektur,
APPROVE / APPROVE-WITH-CONDITIONS). Bewusst getrackt statt vor der Deadline
(31.08.) refactored.

## Resolve traits⇄scoring ESM cycle (extract shared trait vocabulary module)

**Due: 2026-09-10** — from final architecture review condition C2.

- `mvp/traits.ts` importiert `TRAIT_DIRECTIONS`/`TraitDirection` aus
  `mvp/scoring.ts`, während `scoring.ts` seinerseits `TRAIT_NAMES` aus
  `traits.ts` importiert — ein echter ESM-Import-Zyklus.
- Heute harmlos, weil alle wechselseitigen Zugriffe erst zur Call-Time in
  Funktionskörpern erfolgen. Aber TDZ-Falle bei künftigen Top-Level-Nutzungen:
  ein `const N = TRAIT_NAMES.length` auf der Gegenseite crasht abhängig vom
  Entry-Point; der Zyklus blockiert zudem sauberes Bundling/Tree-Shaking und
  jedes Architecture-Lint.
- Fix-Skizze: gemeinsames `mvp/traitSpace.ts` mit `TRAIT_NAMES`,
  `CROP_GROUPS`, `TRAIT_DIRECTIONS` (und Typ `TraitDirection`); `traits.ts`
  und `scoring.ts` importieren nur noch von dort; Re-Exports für
  Kompatibilität. Validierung: `node mvp/selftest.ts` = 47/47 PASS und
  byte-identischer Demo-Output (`diff` gegen vorher).

## M2 — JSON-Schema-Validierung zur Laufzeit (deferred, post-Deadline)

`buildCatalog()` in `mvp/traits.ts` prüft nur Array + non-empty. Numerische
Strings (`"drought_tolerance": "7"`) werden in `rating()` still koerziert,
fehlende `genus`/`species` erzeugen Pseudo-Labels. Minimal-Fix: je Trait
`typeof === 'number'` und `genus`/`species` als String asserten — oder
`validateFeatureRanges` direkt am Ende von `buildCatalog` aufrufen.

## M4 — loadCatalog-Duplikat (deferred, post-Deadline)

`loadCatalog()` + `DATA_PATH` (je 6 Zeilen inkl. `import.meta.url`-Auflösung)
sind identisch in `mvp/demo.ts` und `mvp/selftest.ts` dupliziert — Drift-Risiko
bei Datei-Rename. Fix: gemeinsames `mvp/catalog.ts` extrahieren; bewusst erst
nach der Biennale (Selftest repliziert Demo-Semantik sonst absichtlich nicht).
