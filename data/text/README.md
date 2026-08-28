# VD-Textkorpus (CPVO UPOV Variety Descriptions)

- `vd-corpus.json` — 200 Sorten mit zweisprachigem Merkmalstext (Sektion 15 der VD),
  amtlich ähnlichster Sorte (Sektion 16, `similarTo`) und CPVO-Antragsnummer als Provenanz.
- `vd-embeddings.json` — gecachte 1024-dim bge-m3-Vektoren (5 Dezimalen; deterministisch,
  CI-fähig ohne neobox-Zugriff). Regenerierung über `vd-embed-pipeline.ts`.
- `fetch-vd-pdfs.mjs` — Batch-Download der VD-PDFs über die anonyme CPVO-Register-API
  (Header `environment: PRO`; Documents → downloadPublic → presigned S3). Ergebnisse nach /tmp.
- `vd-embed-pipeline.ts` — Parse → bge-m3-Embeddings (Ollama auf neobox via SSH-Tunnel
  `ssh -N -L 11500:127.0.0.1:11434 neobox`, Endpoint `/api/embed`, Modell `bge-m3:latest`) → Validierung.
- PDFs selbst bewusst NICHT im Repo (regenerierbar über fetch-vd-pdfs.mjs).

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

Eval-Einbindung: `mvp/textKernel.ts` lädt Korpus+Cache; `mvp/eval.ts` misst
`text_identity_top1`, `text_official_top5/top10`, `traitsrbf_official_*`,
`rrf_fusion_identity` und gated sie (→ 10 Deckel-Gates, CI exit 1 bei Regression).
