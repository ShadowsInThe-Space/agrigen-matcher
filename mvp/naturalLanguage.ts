/**
 * Natural-language retrieval for AgriGen.
 *
 * The same learned embedding model must encode both sides of the comparison:
 *   free-text requirement -> bge-m3 query embedding
 *   official CPVO/UPOV description -> cached bge-m3 catalog embedding
 *
 * Cosine similarity then ranks descriptions in the shared semantic space.
 * This text ranking can be fused with the deterministic trait ranking through
 * reciprocalRankFusion from kernelMath.ts. No generative model invents trait
 * values or makes the final agronomic decision.
 */

import { cosineSimilarity } from './kernelMath.ts'
import { loadTextKernel, type TextKernelData } from './textKernel.ts'

export interface EmbeddingEndpointOptions {
  endpoint?: string
  model?: string
  fetchImpl?: typeof fetch
}

export interface NaturalLanguageRankOptions extends EmbeddingEndpointOptions {
  crop?: string
  limit?: number
  textKernel?: TextKernelData
}

export interface NaturalLanguageMatch {
  name: string
  crop: string
  score: number
  corpusIndex: number
}

function assertEmbedding(vector: unknown, label: string): asserts vector is number[] {
  if (!Array.isArray(vector) || vector.length === 0 || !vector.every(Number.isFinite)) {
    throw new Error(`${label} must be a non-empty finite number vector`)
  }
}

/** Encode one free-form requirement with the same model used for the corpus. */
export async function embedNaturalLanguageQuery(
  query: string,
  options: EmbeddingEndpointOptions = {},
): Promise<number[]> {
  const normalizedQuery = query.trim()
  if (normalizedQuery.length === 0) throw new Error('Natural-language query must not be empty')

  const endpoint = options.endpoint ?? process.env.AGRIGEN_EMBED_URL ?? 'http://127.0.0.1:11500/api/embed'
  const model = options.model ?? process.env.AGRIGEN_EMBED_MODEL ?? 'bge-m3'
  const fetchImpl = options.fetchImpl ?? fetch
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input: [normalizedQuery] }),
  })
  if (!response.ok) throw new Error(`Embedding request failed with HTTP ${response.status}`)

  const payload = await response.json() as { embeddings?: unknown[] }
  const vector = payload.embeddings?.[0]
  assertEmbedding(vector, 'Query embedding')
  return vector
}

/** Rank the official description corpus against an already-created query embedding. */
export function rankNaturalLanguageEmbedding(
  queryEmbedding: number[],
  textKernel: TextKernelData,
  options: Pick<NaturalLanguageRankOptions, 'crop' | 'limit'> = {},
): NaturalLanguageMatch[] {
  assertEmbedding(queryEmbedding, 'Query embedding')
  const catalogDimensions = textKernel.embeddings[0]?.length
  if (catalogDimensions === undefined || queryEmbedding.length !== catalogDimensions) {
    throw new Error(`Query embedding dimension ${queryEmbedding.length} != catalog dimension ${catalogDimensions ?? 0}`)
  }

  const cropFilter = options.crop?.trim().toLowerCase()
  const limit = options.limit ?? 10
  if (!Number.isInteger(limit) || limit <= 0) throw new Error('Natural-language result limit must be a positive integer')

  return textKernel.embeddings
    .map((embedding, corpusIndex) => ({
      name: textKernel.names[corpusIndex]!,
      crop: textKernel.crops[corpusIndex]!,
      score: cosineSimilarity(queryEmbedding, embedding),
      corpusIndex,
    }))
    .filter(match => cropFilter === undefined || match.crop.toLowerCase() === cropFilter)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, limit)
}

/** End-to-end free-text -> bge-m3 -> semantic shortlist. */
export async function rankNaturalLanguageQuery(
  query: string,
  options: NaturalLanguageRankOptions = {},
): Promise<NaturalLanguageMatch[]> {
  const textKernel = options.textKernel ?? loadTextKernel()
  const queryEmbedding = await embedNaturalLanguageQuery(query, options)
  return rankNaturalLanguageEmbedding(queryEmbedding, textKernel, options)
}
