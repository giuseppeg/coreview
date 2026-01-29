import type { DiffLine, Hunk, LineRange, ResolvedReference } from './types'

// ANSI escape codes
const RESET = '\x1b[0m'
const DIM = '\x1b[2m'
const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const YELLOW = '\x1b[33m'

const CONTEXT_LINES = 2

/**
 * Parse @@ header to extract line numbers
 */
function parseHunkHeader(p: { header: string }): { oldStart: number; newStart: number } {
  const match = p.header.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
  if (!match) return { oldStart: 0, newStart: 1 }
  return {
    oldStart: parseInt(match[1], 10),
    newStart: parseInt(match[2], 10)
  }
}

/**
 * Count old/new lines in a range of diff lines
 */
function countLines(p: { lines: DiffLine[] }): { oldCount: number; newCount: number } {
  let oldCount = 0
  let newCount = 0
  for (const line of p.lines) {
    if (line.type === 'delete' || line.type === 'context') oldCount++
    if (line.type === 'add' || line.type === 'context') newCount++
  }
  return { oldCount, newCount }
}

/**
 * Build @@ header for a line slice
 */
function buildSliceHeader(p: { hunk: Hunk; sliceStart: number; sliceLines: DiffLine[] }): string {
  const original = parseHunkHeader({ header: p.hunk.header })
  const skipped = countLines({ lines: p.hunk.lines.slice(0, p.sliceStart) })
  const slice = countLines({ lines: p.sliceLines })

  const oldStart = original.oldStart + skipped.oldCount
  const newStart = original.newStart + skipped.newCount

  return `@@ -${oldStart},${slice.oldCount} +${newStart},${slice.newCount} @@`
}

/**
 * Extract a slice of hunk lines with context
 */
function sliceHunkLines(p: { hunk: Hunk; lineRange: LineRange }): { lines: DiffLine[]; sliceStart: number } {
  const { hunk, lineRange } = p
  const total = hunk.lines.length

  // Clamp to bounds (1-indexed input)
  const start = Math.max(1, Math.min(lineRange.start, total))
  const end = Math.max(start, Math.min(lineRange.end, total))

  // Add context lines
  const sliceStart = Math.max(0, start - 1 - CONTEXT_LINES)
  const sliceEnd = Math.min(total, end + CONTEXT_LINES)

  return {
    lines: hunk.lines.slice(sliceStart, sliceEnd),
    sliceStart
  }
}

/**
 * Render diff lines to output
 */
function renderDiffLines(p: { lines: DiffLine[]; raw: boolean }): string[] {
  if (p.raw) {
    return p.lines.map(l => (l.type === 'add' ? '+' : l.type === 'delete' ? '-' : ' ') + l.content)
  }
  return p.lines.map(line => {
    if (line.type === 'add') return `  ${GREEN}+${line.content}${RESET}\n`
    if (line.type === 'delete') return `  ${RED}-${line.content}${RESET}\n`
    return `  ${DIM} ${line.content}${RESET}\n`
  })
}

/**
 * Render hunks with diff coloring to terminal or markdown
 */
export function renderHunks(p: { hunks: Hunk[]; file: string; raw: boolean; lineRange?: LineRange }): string {
  const { hunks, file, raw, lineRange } = p

  // Handle partial hunk (line range on single hunk)
  if (lineRange && hunks.length === 1) {
    const hunk = hunks[0]
    const { lines, sliceStart } = sliceHunkLines({ hunk, lineRange })
    const header = buildSliceHeader({ hunk, sliceStart, sliceLines: lines })

    if (raw) {
      return `\n\`\`\`diff\n--- a/${file}\n+++ b/${file}\n${header}\n${renderDiffLines({ lines, raw }).join('\n')}\n\`\`\`\n`
    }

    const parts: string[] = [`\n  ${DIM}── ${file} ──${RESET}\n`]
    parts.push(`  ${DIM}${header}${RESET}\n`)
    parts.push(...renderDiffLines({ lines, raw }))
    return parts.join('')
  }

  // Full hunk rendering (original behavior)
  if (raw) {
    const lines = [
      `--- a/${file}`,
      `+++ b/${file}`,
      ...hunks.flatMap(h => [
        h.header,
        ...h.lines.map(l => (l.type === 'add' ? '+' : l.type === 'delete' ? '-' : ' ') + l.content)
      ])
    ]
    return `\n\`\`\`diff\n${lines.join('\n')}\n\`\`\`\n`
  }

  const parts: string[] = [`\n  ${DIM}── ${file} ──${RESET}\n`]

  for (const hunk of hunks) {
    parts.push(`  ${DIM}${hunk.header}${RESET}\n`)
    parts.push(...renderDiffLines({ lines: hunk.lines, raw }))
  }

  return parts.join('')
}

/**
 * Render a resolved reference
 */
export function renderReference(p: { resolved: ResolvedReference; raw: boolean }): string {
  const { resolved, raw } = p

  if (resolved.status === 'resolved') {
    return renderHunks({ hunks: resolved.hunks, file: resolved.file, raw, lineRange: resolved.lineRange })
  }

  if (resolved.status === 'not_found') {
    const reason = resolved.reason === 'file_not_in_diff'
      ? 'file not in diff'
      : 'hunk not found'
    return raw
      ? `\n> [warning: ${resolved.file} - ${reason}]\n`
      : `\n  ${YELLOW}[warning: ${resolved.file} - ${reason}]${RESET}\n`
  }

  // malformed - render as plain text
  return `[[ref:${resolved.raw}]]`
}
