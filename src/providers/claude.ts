import { spawn } from 'node:child_process'
import type { LLMProvider } from '~/types'

/**
 * Claude Code headless mode provider
 */
export function createProvider(p: { systemPrompt: string }): LLMProvider {
  return {
    async *stream(args) {
      const proc = spawn('claude', [
        '-p', args.userPrompt,
        '--model', 'opus',
        '--output-format', 'stream-json',
        '--verbose',
        '--include-partial-messages',
        '--system-prompt', p.systemPrompt
      ], {
        stdio: ['pipe', 'pipe', 'pipe']
      })

      proc.stdin.write(args.input)
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
