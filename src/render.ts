import type { Hunk, ResolvedReference } from './types'

// ANSI escape codes
const RESET = '\x1b[0m'
const DIM = '\x1b[2m'
const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const YELLOW = '\x1b[33m'

/**
 * Render hunks with diff coloring to terminal or markdown
 */
export function renderHunks(p: { hunks: Hunk[]; file: string; raw: boolean }): string {
  if (p.raw) {
    const lines = [
      `--- a/${p.file}`,
      `+++ b/${p.file}`,
      ...p.hunks.flatMap(h => [
        h.header,
        ...h.lines.map(l => (l.type === 'add' ? '+' : l.type === 'delete' ? '-' : ' ') + l.content)
      ])
    ]
    return `\n\`\`\`diff\n${lines.join('\n')}\n\`\`\`\n`
  }

  const parts: string[] = [`\n  ${DIM}── ${p.file} ──${RESET}\n`]

  for (const hunk of p.hunks) {
    parts.push(`  ${DIM}${hunk.header}${RESET}\n`)
    for (const line of hunk.lines) {
      if (line.type === 'add') {
        parts.push(`  ${GREEN}+${line.content}${RESET}\n`)
      } else if (line.type === 'delete') {
        parts.push(`  ${RED}-${line.content}${RESET}\n`)
      } else {
        parts.push(`  ${DIM} ${line.content}${RESET}\n`)
      }
    }
  }

  return parts.join('')
}

/**
 * Render a resolved reference
 */
export function renderReference(p: { resolved: ResolvedReference; raw: boolean }): string {
  const { resolved, raw } = p

  if (resolved.status === 'resolved') {
    return renderHunks({ hunks: resolved.hunks, file: resolved.file, raw })
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
