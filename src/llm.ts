import { spawn } from 'node:child_process'
import type { LLMProvider } from './types'

export const SYSTEM_PROMPT = `You are a code review assistant providing a guided walkthrough of changes.

# MANDATORY OUTPUT FORMAT

Reference diff hunks using ONLY this syntax:

  [[ref:filepath:hunk:N]]       - single hunk
  [[ref:filepath:hunk:N-M]]     - hunk range
  [[ref:filepath]]              - all hunks in file

HARD REQUIREMENT: The system expands [[ref:...]] into colored diff blocks. Other formats break.

CORRECT: [[ref:src/api.ts:hunk:1]]
WRONG: "hunk 1", "lines 87-96", "the change above" (these render as broken text)

NEVER mention line numbers. ALWAYS use [[ref:...]] to point to code.

# Critical: Text BEFORE References

ALWAYS write explanatory text BEFORE the [[ref:...]], never after. The output is displayed in blocks that break after each reference, so the user reads your explanation first, then sees the code.

CORRECT:
  This adds input validation for the user ID parameter:
  [[ref:src/api.ts:hunk:1]]

WRONG:
  [[ref:src/api.ts:hunk:1]]
  This adds input validation for the user ID parameter.

# Structure

1. **Opening summary** (2-3 sentences): What is this change about? What problem does it solve or what feature does it add?

2. **Walkthrough**: Guide the user through the changes in LOGICAL order (not file order). Group related changes together. For each logical unit:
   - Brief context explaining what and why
   - Then the [[ref:...]] to show the code

# What to Skip

Do NOT create separate blocks for trivial/obvious changes:
- Import statements (mention them inline if relevant, but don't dedicate a block)
- Type definitions that are self-explanatory
- Minor supporting code that's obvious from context

Focus on substantive logic. If a hunk is just imports or boilerplate, fold it into the explanation of the code that uses it, or skip it entirely.

# Style

- Be concise - explain intent and rationale, not line-by-line narration
- Use bold **headers** to separate logical sections
- Call out breaking changes, risks, or side effects prominently
`

/**
 * Claude Code headless mode provider
 */
export function createClaudeCodeProvider(): LLMProvider {
  return {
    async *stream(p) {
      const proc = spawn('claude', [
        '-p', p.userPrompt,
        '--model', 'opus',
        '--output-format', 'stream-json',
        '--verbose',
        '--include-partial-messages',
        '--system-prompt', p.systemPrompt
      ], {
        stdio: ['pipe', 'pipe', 'pipe']
      })

      proc.stdin.write(p.input)
      proc.stdin.end()

      let stderrOutput = ''
      proc.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString()
        stderrOutput += text
        process.stderr.write(text) // pass through stderr immediately
      })

      let buffer = ''

      for await (const chunk of proc.stdout) {
        buffer += chunk.toString()
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const msg = JSON.parse(line)
            // With --include-partial-messages, streaming tokens come as:
            // { type: 'stream_event', event: { type: 'content_block_delta', delta: { text: '...' } } }
            if (
              msg.type === 'stream_event' &&
              msg.event?.type === 'content_block_delta' &&
              msg.event?.delta?.type === 'text_delta'
            ) {
              yield msg.event.delta.text
            }
          } catch {
            // Skip malformed JSON lines
          }
        }
      }

      // Process remaining buffer
      if (buffer.trim()) {
        try {
          const msg = JSON.parse(buffer)
          if (
            msg.type === 'stream_event' &&
            msg.event?.type === 'content_block_delta' &&
            msg.event?.delta?.type === 'text_delta'
          ) {
            yield msg.event.delta.text
          }
        } catch {
          // Ignore
        }
      }

      await new Promise<void>((resolve, reject) => {
        proc.on('close', code => {
          if (code === 0) resolve()
          else reject(new Error(`claude exited with code ${code}${stderrOutput ? `:\n${stderrOutput}` : ''}`))
        })
      })
    }
  }
}
