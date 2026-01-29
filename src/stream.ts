import type { Hunk, ParsedDiff, ResolvedReference, StreamToken } from './types'

const REF_START = '[[ref:'
const REF_END = ']]'
const MAX_REF_LENGTH = 200

/**
 * Stream parser for detecting [[ref:...]] patterns with lookahead buffering
 */
export function createStreamParser(): {
  push(chunk: string): StreamToken[]
  flush(): StreamToken[]
} {
  let buffer = ''
  let inRef = false

  function push(chunk: string): StreamToken[] {
    const tokens: StreamToken[] = []
    buffer += chunk

    while (buffer.length > 0) {
      if (!inRef) {
        const refStart = buffer.indexOf(REF_START)
        if (refStart === -1) {
          // No ref start found - emit all but last few chars (in case REF_START spans chunks)
          const safe = Math.max(0, buffer.length - REF_START.length + 1)
          if (safe > 0) {
            tokens.push({ type: 'text', content: buffer.slice(0, safe) })
            buffer = buffer.slice(safe)
          }
          break
        } else {
          // Emit text before ref
          if (refStart > 0) {
            tokens.push({ type: 'text', content: buffer.slice(0, refStart) })
          }
          buffer = buffer.slice(refStart)
          inRef = true
        }
      }

      if (inRef) {
        const refEnd = buffer.indexOf(REF_END)
        if (refEnd !== -1) {
          // Complete ref found
          const refContent = buffer.slice(REF_START.length, refEnd)
          const file = refContent.split(':hunk:')[0]
          tokens.push({ type: 'ref', content: refContent, file })
          buffer = buffer.slice(refEnd + REF_END.length)
          inRef = false
        } else if (buffer.length > MAX_REF_LENGTH) {
          // Ref too long - treat [[ref: as literal text
          tokens.push({ type: 'text', content: REF_START })
          buffer = buffer.slice(REF_START.length)
          inRef = false
        } else {
          // Need more input
          break
        }
      }
    }

    return tokens
  }

  function flush(): StreamToken[] {
    const tokens: StreamToken[] = []
    if (buffer.length > 0) {
      tokens.push({ type: 'text', content: buffer })
      buffer = ''
    }
    inRef = false
    return tokens
  }

  return { push, flush }
}

/**
 * Resolve a reference string to hunks from parsed diff
 * Format: filepath:hunk:N or filepath:hunk:N-M or filepath
 * Optional line range: filepath:hunk:N:L10-25 or filepath:hunk:N:L15
 */
export function resolveReference(p: { ref: string; diff: ParsedDiff }): ResolvedReference {
  const { ref, diff } = p

  // Parse reference format with optional line range
  const hunkMatch = ref.match(/^(.+):hunk:(\d+)(?:-(\d+))?(?::L(\d+)(?:-(\d+))?)?$/)
  const fileOnly = !hunkMatch

  const filePath = fileOnly ? ref : hunkMatch[1]
  const file = diff.get(filePath)

  if (!file) {
    return { status: 'not_found', file: filePath, reason: 'file_not_in_diff' }
  }

  if (fileOnly) {
    return { status: 'resolved', file: filePath, hunks: file.hunks }
  }

  const startHunk = parseInt(hunkMatch[2], 10)
  const endHunk = hunkMatch[3] ? parseInt(hunkMatch[3], 10) : startHunk

  const hunks: Hunk[] = []
  for (let i = startHunk; i <= endHunk; i++) {
    const hunk = file.hunks.find(h => h.index === i)
    if (!hunk) {
      return { status: 'not_found', file: filePath, reason: 'hunk_not_found' }
    }
    hunks.push(hunk)
  }

  // Line range only applies to single-hunk refs
  if (hunkMatch[4] && hunks.length === 1) {
    const lineStart = parseInt(hunkMatch[4], 10)
    const lineEnd = hunkMatch[5] ? parseInt(hunkMatch[5], 10) : lineStart
    // Normalize inverted ranges
    const start = Math.min(lineStart, lineEnd)
    const end = Math.max(lineStart, lineEnd)
    return { status: 'resolved', file: filePath, hunks, lineRange: { start, end } }
  }

  return { status: 'resolved', file: filePath, hunks }
}
