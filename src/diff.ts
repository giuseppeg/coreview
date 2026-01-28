import type { DiffFile, DiffLine, Hunk, ParsedDiff } from './types'

/**
 * Parse git diff output into structured hunks
 */
export function parseDiff(p: { raw: string }): ParsedDiff {
  const result: ParsedDiff = new Map()
  const lines = p.raw.split('\n')
  let currentFile: DiffFile | null = null
  let currentHunk: Hunk | null = null
  let hunkIndex = 0

  for (const line of lines) {
    // New file header: diff --git a/path b/path
    if (line.startsWith('diff --git ')) {
      if (currentFile) result.set(currentFile.path, currentFile)
      const match = line.match(/diff --git a\/.+ b\/(.+)/)
      currentFile = { path: match?.[1] ?? 'unknown', hunks: [] }
      currentHunk = null
      hunkIndex = 0
      continue
    }

    // Hunk header: @@ -10,5 +10,8 @@ optional context
    if (line.startsWith('@@') && currentFile) {
      if (currentHunk) currentFile.hunks.push(currentHunk)
      hunkIndex++
      currentHunk = { index: hunkIndex, header: line, lines: [] }
      continue
    }

    // Diff lines
    if (currentHunk) {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        currentHunk.lines.push({ type: 'add', content: line.slice(1) })
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        currentHunk.lines.push({ type: 'delete', content: line.slice(1) })
      } else if (line.startsWith(' ') || line === '') {
        currentHunk.lines.push({ type: 'context', content: line.slice(1) })
      }
    }
  }

  // Push final file/hunk
  if (currentHunk && currentFile) currentFile.hunks.push(currentHunk)
  if (currentFile) result.set(currentFile.path, currentFile)

  return result
}

/**
 * Enrich diff with [hunk:N] markers for LLM consumption
 */
export function enrichDiff(p: { diff: ParsedDiff }): string {
  const parts: string[] = []

  for (const [path, file] of p.diff) {
    parts.push(`── ${path} ──\n`)
    for (const hunk of file.hunks) {
      parts.push(`[hunk:${hunk.index}] ${hunk.header}`)
      for (const line of hunk.lines) {
        const prefix = line.type === 'add' ? '+' : line.type === 'delete' ? '-' : ' '
        parts.push(prefix + line.content)
      }
      parts.push('')
    }
  }

  return parts.join('\n')
}

/**
 * Count total lines in diff for size check
 */
export function countDiffLines(p: { diff: ParsedDiff }): number {
  let count = 0
  for (const file of p.diff.values()) {
    for (const hunk of file.hunks) {
      count += hunk.lines.length
    }
  }
  return count
}
