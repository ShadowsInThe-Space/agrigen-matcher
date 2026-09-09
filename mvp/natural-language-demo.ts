/**
 * Live natural-language demo. Requires the bge-m3 Ollama endpoint used for
 * the cached catalog embeddings (default tunnel: http://127.0.0.1:11500).
 *
 * Run:
 *   node mvp/natural-language-demo.ts "standfest, früh, hoher Krankheitsdruck"
 */

import { rankNaturalLanguageQuery } from './naturalLanguage.ts'

const query = process.argv.slice(2).join(' ').trim()
if (!query) {
  console.error('Bitte eine natürlichsprachliche Anforderung angeben.')
  process.exit(1)
}

const crop = process.env.AGRIGEN_CROP
console.log(`Natürliche Anfrage: "${query}"`)
if (crop) console.log(`Fruchtart-Filter: ${crop}`)

const matches = await rankNaturalLanguageQuery(query, { crop, limit: 10 })
console.log('Rang  Sorte                              Fruchtart              Text-Ähnlichkeit')
matches.forEach((match, index) => {
  console.log(
    `${String(index + 1).padEnd(6)}${match.name.padEnd(35).slice(0, 34)}${match.crop.padEnd(23).slice(0, 22)}${match.score.toFixed(4)}`,
  )
})
