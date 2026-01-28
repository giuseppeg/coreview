#!/usr/bin/env node

import { execSync } from 'node:child_process'
import * as readline from 'node:readline'
import { parseDiff, enrichDiff, countDiffLines } from './diff'
import { createStreamParser, resolveReference } from './stream'
import { createClaudeCodeProvider, SYSTEM_PROMPT } from './llm'
import { renderReference } from './render'

const MAX_DIFF_LINES = 4000

type CliArgs = {
  target: string | null
  paged: boolean
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2)
  let paged = false

  for (const arg of args) {
    if (arg === '--help' || arg === '-h') {
      console.log(`coreview - semantic code review tool

Usage: coreview [options] [target]

Options:
  -p          Paged mode - pause after each code reference
  -h, --help  Show this help

Target:
  branch name, commit hash, or commit range (e.g., main..HEAD)
  Omit to review all local changes (staged + unstaged)

Examples:
  coreview              # review local changes vs HEAD
  coreview -p main      # paged review of changes since main
  coreview abc123       # review changes since commit
  coreview main..HEAD   # explicit range`)
      process.exit(0)
    }
    if (arg === '-p') {
      paged = true
    }
  }

  const target = args.find(a => !a.startsWith('-')) ?? null
  return { target, paged }
}

function waitForEnter(p: { files: string[] }): Promise<void> {
  return new Promise(resolve => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    })
    const fileList = p.files.length ? `\x1b[2m[ ${p.files.join(' | ')} ]\x1b[0m\n` : ''
    process.stdout.write(`\n${fileList}\x1b[2m[ENTER to continue]\x1b[0m`)
    rl.once('line', () => {
      rl.close()
      // Move cursor up and clear lines to remove prompt
      const lines = p.files.length ? 2 : 1
      process.stdout.write(`\x1b[${lines}A\x1b[J`)
      resolve()
    })
  })
}

function getDiffCommand(target: string | null): string {
  return target ? `git diff ${target}` : 'git diff HEAD'
}

async function main() {
  const { target, paged } = parseArgs()
  const diffCmd = getDiffCommand(target)
  console.log('\n±coreview\n');

  // Get raw diff
  let rawDiff: string
  try {
    rawDiff = execSync(diffCmd, { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 })
  } catch (e) {
    console.error(`Failed to get diff: ${diffCmd}`)
    process.exit(1)
  }

  if (!rawDiff.trim()) {
    console.log('No changes to review.')
    process.exit(0)
  }

  console.log("Parsing the diff...");
  // Parse and validate diff
  const diff = parseDiff({ raw: rawDiff })
  const lineCount = countDiffLines({ diff })

  if (lineCount > MAX_DIFF_LINES) {
    console.error(`Diff too large (${lineCount} lines, max ${MAX_DIFF_LINES}).`)
    console.error('Suggestions:')
    console.error('  - Review commits individually: coreview <commit>')
    console.error('  - Split into smaller PRs')
    process.exit(1)
  }

  // Enrich diff for LLM
  const enriched = enrichDiff({ diff })

  // Create LLM provider and stream parser
  const llm = createClaudeCodeProvider()
  const parser = createStreamParser()

  console.log("Analyzing changes...");
  let started = false

  function render(token: { type: 'text' | 'ref'; content: string }): string {
    if (token.type === 'text') return token.content
    return renderReference({ resolved: resolveReference({ ref: token.content, diff }) })
  }

  const streamArgs = { systemPrompt: SYSTEM_PROMPT, userPrompt: 'Explain this diff:', input: enriched }

  if (paged) {
    // Paged mode: stream into blocks, pause at ref boundaries
    // - Background task consumes LLM stream, splits into blocks at each [[ref:...]]
    // - Foreground loop prints blocks incrementally, waits for ENTER between them
    // - This avoids Anthropic timeout: LLM streams continuously into memory

    type Block = { content: string; files: Set<string> }
    const blocks: Block[] = [{ content: '', files: new Set() }]
    let done = false

    // Background: consume stream, chunk into blocks
    // Split when non-whitespace text appears after a ref (contiguous refs stay together)
    let sawRef = false
    const build = (async () => {
      for await (const chunk of llm.stream(streamArgs)) {
        if (!started) { started = true; console.log("\nReview:\n") }
        for (const token of parser.push(chunk)) {
          if (token.type === 'ref') {
            sawRef = true
            blocks[blocks.length - 1].files.add(token.file)
          } else if (sawRef && token.content.trim()) {
            blocks.push({ content: '', files: new Set() })
            sawRef = false
          }
          blocks[blocks.length - 1].content += render(token)
        }
      }
      for (const token of parser.flush()) blocks[blocks.length - 1].content += render(token)
      done = true
    })()

    // Foreground: print blocks as they fill, pause between them
    let i = 0, c = 0  // i = current block index, c = chars printed from current block
    while (!done || i < blocks.length) {
      const b = blocks[i] ?? { content: '', files: new Set() }
      if (c < b.content.length) { process.stdout.write(b.content.slice(c)); c = b.content.length }
      if (i < blocks.length - 1) {
        await waitForEnter({ files: [...blocks[i].files] })
        process.stdout.write('\x1b[2m' + '─'.repeat(60) + '\x1b[0m\n\n')
        i++; c = 0
      }
      else if (done) break
      else await new Promise(r => setTimeout(r, 16))
    }
    await build
  } else {
    for await (const chunk of llm.stream(streamArgs)) {
      if (!started) { started = true; console.log("\nReview:\n") }
      for (const token of parser.push(chunk)) process.stdout.write(render(token))
    }
    for (const token of parser.flush()) process.stdout.write(render(token))
  }

  console.log('\n')
}

main().catch(e => {
  console.error(e.message)
  process.exit(1)
})
