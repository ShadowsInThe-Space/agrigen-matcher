/**
 * Self-contained matrix metrics for the kernel matrix — no numeric
 * dependencies. Rank via Gaussian elimination, eigenvalues via cyclic Jacobi
 * rotation (symmetric matrices only, which kernel matrices always are).
 */

/** Rank of a square matrix by Gaussian elimination with partial pivoting. */
export function matrixRank(matrix: readonly (readonly number[])[], tolerance = 1e-9): number {
  const n = matrix.length
  const work = matrix.map(row => [...row])
  let rank = 0
  for (let column = 0; column < n && rank < n; column++) {
    let pivot = -1
    let best = tolerance
    for (let row = rank; row < n; row++) {
      if (Math.abs(work[row]![column]!) > best) { best = Math.abs(work[row]![column]!); pivot = row }
    }
    if (pivot === -1) continue
    const swap = work[rank]!
    work[rank] = work[pivot]!
    work[pivot] = swap
    const pivotRow = work[rank]!
    for (let row = rank + 1; row < n; row++) {
      const factor = work[row]![column]! / pivotRow[column]!
      for (let inner = column; inner < n; inner++) {
        work[row]![inner] = work[row]![inner]! - factor * pivotRow[inner]!
      }
    }
    rank++
  }
  return rank
}

/** All eigenvalues of a symmetric matrix via cyclic Jacobi rotations. */
export function symmetricEigenvalues(matrix: readonly (readonly number[])[], sweeps = 64): number[] {
  const n = matrix.length
  const a = matrix.map(row => [...row])
  for (let sweep = 0; sweep < sweeps; sweep++) {
    let off = 0
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += a[i]![j]! * a[i]![j]!
    if (off < 1e-24) break
    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(a[p]![q]!) < 1e-15) continue
        const theta = (a[q]![q]! - a[p]![p]!) / (2 * a[p]![q]!)
        const sign = theta >= 0 ? 1 : -1
        const t = sign / (Math.abs(theta) + Math.sqrt(theta * theta + 1))
        const c = 1 / Math.sqrt(t * t + 1)
        const s = t * c
        for (let k = 0; k < n; k++) {
          const akp = a[k]![p]!
          const akq = a[k]![q]!
          a[k]![p] = c * akp - s * akq
          a[k]![q] = s * akp + c * akq
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p]![k]!
          const aqk = a[q]![k]!
          a[p]![k] = c * apk - s * aqk
          a[q]![k] = s * apk + c * aqk
        }
      }
    }
  }
  return Array.from({ length: n }, (_, i) => a[i]![i]!)
}
