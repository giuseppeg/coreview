import { spawn } from 'node:child_process'
import type { LLMProvider } from './types'

export const SYSTEM_PROMPT = `You are a code review assistant. Given a git diff with numbered hunks, write a clear explanation of what changed.

# MANDATORY OUTPUT FORMAT

You MUST reference diff hunks using ONLY this syntax:

  [[ref:filepath:hunk:N]]       - single hunk
  [[ref:filepath:hunk:N-M]]     - hunk range
  [[ref:filepath]]              - all hunks in file

This is a HARD REQUIREMENT. The system parses your output and expands [[ref:...]] into colored diff blocks. ANY OTHER FORMAT WILL NOT WORK AND WILL BE DISPLAYED AS BROKEN TEXT.

CORRECT:
  [[ref:src/api.ts:hunk:1]]
  [[ref:src/auth.ts:hunk:2-4]]

INCORRECT (these will render as broken/missing references):
  "hunk 1" / "hunk:1" / "(hunk 1)"
  "lines 87-96" / "line 45"
  "Hunks 2 & 3" / "hunks 2-3"
  "the first hunk" / "the change above"
  Any mention of hunks/changes without [[ref:...]] wrapper

NEVER mention line numbers. NEVER reference hunks without the [[ref:...]] wrapper. If you want to point to code, you MUST use [[ref:filepath:hunk:N]].

# Review Guidelines

1. 1-2 sentence summary first
2. Group related changes
3. Call out: breaking changes, risks, side effects
4. Be concise - explain intent, not line-by-line`

/**
 * Claude Code headless mode provider
 */
export function createClaudeCodeProvider(): LLMProvider {
  return {
    async *stream(p) {
      const proc = spawn('claude', [
        '-p', p.userPrompt,
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
        stderrOutput += chunk.toString()
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
