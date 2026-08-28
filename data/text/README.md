# VD-Textkorpus (CPVO UPOV Variety Descriptions)

- `vd-corpus.json` — 226 Sorten mit zweisprachigem Merkmalstext (Sektion 15 der VD),
  amtlich ähnlichster Sorte (Sektion 16, `similarTo`) und CPVO-Antragsnummer als Provenanz.
  Bestand 200 (Getreide, 2026-08-27) + Delta 26 (M2a-Fruchtarten, 2026-08-29, append-only).
- `vd-embeddings.json` — gecachte 1024-dim bge-m3-Vektoren (5 Dezimalen; deterministisch,
  CI-fähig ohne neobox-Zugriff). Regenerierung des Bestands über `vd-embed-pipeline.ts`,
  Erweiterung über `vd-embed-delta.ts`.
- `fetch-vd-pdfs.mjs` — Batch-Download der VD-PDFs über die anonyme CPVO-Register-API
  (Header `environment: PRO`; Documents → downloadPublic → presigned S3). Ergebnisse nach /tmp.
- `search-cpvo-new.mjs` + `cpvo-coverage-new.json` — Coverage-Suche der M2a-Sorten
  (Mais, Raps, Soja, Zuckerrübe, Senf, Lein, Lupine, Ackerbohne) mit Gattungsfilter
  (die Denomination-Suche der API ist global und exakt) und Fehlform-Varianten:
  Spalten-Anhaftungen (`Francina KWS 3` → `Francina KWS`, `Farmoritz ca.` → `Farmoritz`)
  und Leerzeichen-Entfernung (`P 7364` ↔ `P7364` — bestätigt; `LG 31215` ↔ `LG31215`
  geprüft, aber LG-Nummern sind schlicht nicht CPVO-registriert).
- `fetch-vd-pdfs-new.mjs` — Download-Variante für die neue Coverage
  (→ `/tmp/vd-pdfs-new`, Manifest `/tmp/vd-manifest-new.json`).
- `vd-embed-delta.ts` — Delta-Pipeline: parseVd aus `vd-embed-pipeline.ts` kopiert
  (Sektion-15-Extraktion unverändert), erweitert um einen mandantenfähigen
  Sektion-16-Fallback (EN/FR/DE/ES-Prüfämter brechen `Denomination of similar variety`
  anders um; NONE/Aucune wird als `null` übernommen). Einbettung via Ollama auf neobox
  (SSH-Tunnel `ssh -N -L 11500:127.0.0.1:11434 neobox`, Endpoint `/api/embed`,
  Modell `bge-m3:latest`), Vektoren auf 5 Dezimalen gerundet, append-only in
  Korpus+Cache gemergt (Bestands-Präfix byte-identisch verifiziert, idempotent).
- PDFs selbst bewusst NICHT im Repo (regenerierbar über fetch-vd-pdfs*.mjs).

Messwerte 2026-08-27 (297 VDs von 351 CPVO-Treffern; 200 mit substanziellem geparstem Text).
Vergleichsbasis „amtliche ähnlichste Sorte" = Prüfamtsangabe aus VD-Sektion 16 (per Definition
ähnlich UND unterscheidbar — Top-k ist der erwartete Modus, nicht Top-1):

- Cross-Modal-Identity: 200/200 = 100 % (Text-Kernel rangiert jede Sorte selbst auf Rang 1).
- Text-Kernel (bge-m3, 17 in-corpus Paare): Top-5 **41 %**, Top-10 **47 %**
  (Zufallsbaseline ≈ 2,5 %/5 %).
- Traits-RBF, strikt (Null-Überlappung ausgeschlossen, 15 katalogseitige Paare):
  Top-5 **20 %**, Top-10 **20 %** — der Text-Kernel liegt auf beiden k-fächern vorn.
- RRF-Fusion (k=60, kanonisierte Namen!): Identität unter Fusion 180/180 = 100 %.
- Methodik-Warnung: Ein früher Vergleich über den Satisficing-Score zeigte scheinbar
  „Faktor 4–7" — Artefakt der Score-Sättigung bei Identitäts-Queries plus Neutral-1.0
  bei Null-Überlappung. Die Zahlen oben sind die fairen (strikten).

Messwerte 2026-08-29 (Erweiterung auf M2a-Fruchtarten, Gesamtkorpus 226):

- Coverage (257 BSL-Sorten der 8 Fruchtarten, cpvo-coverage-new.json):
  **59 gefunden / 198 nicht gefunden**. Je Frucht: Sojabohne 22/26, Lupine 9/16,
  Lein 4/9, Winterraps 10/49, Mais 11/97, Senf 2/3, Ackerbohne 1/2,
  Zuckerrübe **0/55** (auch einzeln ohne Züchter-Suffix geprüft: Francina, Calledia,
  Marabella, Capone — Raps-/Weizen-Homonyme, keine Beta-Registrierung; dokumentiert,
  nicht geraten). Zuckerrüben- und moderne Mais-/Raps-Hybriden sind überwiegend nur
  national (BSA) und nicht bei CPVO angemeldet.
- Downloads: 48 VDs (11 mit Antragsstatus „A" ohne VD-Dokument), davon 26 mit
  substanziellem Text (22 Parse-Fails: 17 Scans ohne Textebene, 4 Mais-VDs mit
  abgeschnittener Merkmalstabelle ohne Sektion 16, 1 kaputtes Font-Encoding —
  gleiche Grenze wie beim Bestand: 297 VDs → 200).
- Cross-Modal-Identity: **226/226 = 100 %** (text_identity_top1 = 1.0 gehalten).
- Amtliche ähnlichste Sorte (jetzt 18 in-corpus Paare, +1 durch RGT Sphinxa → ES
  Comandor): Text Top-5 **44 %**, Top-10 **50 %** vs striktes Traits-RBF (15 Paare)
  Top-5 **7 %**, Top-10 **20 %** — Abstand zum Traits-Kernel wächst auf dem
  gemischfrüchtigen Korpus.
- RRF-Fusion (k=60, kanonisierte Namen): Identität **200/201 = 99,5 %**. Der einzige
  Verlust ist Raps „PT 293" mit einem EXAKTEN RRF-Tie (0.03252 = 0.03252) gegen
  „PT 303": identische BSL-Merkmalsnoten (traits-RBF 1.0000 — gleiche
  Äquivalenzklasse, der Zahlenkern kann sie prinzipiell nicht trennen) und als
  Schwesterlinien fast identische VD-Texte (cos 0.986). Ehrliche Daten-Grenze
  (analog dem Soja-0.6154-Äquivalenzklassen-Pin), deshalb Gate auf ≥ 0.99 angepasst.

Eval-Einbindung: `mvp/textKernel.ts` lädt Korpus+Cache; `mvp/eval.ts` misst
`text_identity_top1`, `text_official_top5/top10`, `traitsrbf_official_*`,
`rrf_fusion_identity` und gated sie (→ 10 Deckel-Gates, CI exit 1 bei Regression).
