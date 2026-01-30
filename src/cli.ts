#!/usr/bin/env node

import { execSync } from 'node:child_process'
import * as readline from 'node:readline'
import { parseDiff, enrichDiff, countDiffLines } from './diff'
import { createStreamParser, resolveReference } from './stream'
import { getProvider, SYSTEM_PROMPT } from './llm'
import { renderReference } from './render'
import { parseGitHubPrUrl, fetchPrPatch, parsePatch } from './github'

const MAX_DIFF_LINES = 4000

type DiffSource = { rawDiff: string; commitMessages: string | null; label: string }

async function getDiffSource(p: { target: string | null }): Promise<DiffSource> {
  const prInfo = p.target ? parseGitHubPrUrl(p.target) : null

  if (prInfo) {
    const patch = await fetchPrPatch({ ...prInfo, token: process.env.GITHUB_TOKEN })
    const parsed = parsePatch(patch)
    return {
      rawDiff: parsed.diff,
      commitMessages: parsed.commitMessages.length ? parsed.commitMessages.map(m => `- ${m}`).join('\n') : null,
      label: `${prInfo.org}/${prInfo.repo}#${prInfo.pr}`
    }
  }

  const diffCmd = p.target ? `git diff ${p.target}` : 'git diff HEAD'
  const rawDiff = execSync(diffCmd, { encoding: 'utf-8' })
  let commitMessages: string | null = null
  if (p.target) {
    try {
      const msgs = execSync(`git log --format="- %s" ${p.target}..HEAD`, { encoding: 'utf-8' }).trim()
      commitMessages = msgs || null
    } catch { /* ignore */ }
  }
  return { rawDiff, commitMessages, label: p.target || 'HEAD' }
}

type CliArgs = {
  target: string | null
  paged: boolean
  raw: boolean
  provider: string
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2)
  let paged = false
  let rawFlag = false
  let provider = 'claude'

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--help' || arg === '-h') {
      console.log(`coreview - semantic code review tool

Usage: coreview [options] [target]

Options:
  -p                Paged mode - pause after each code reference
  --raw             Output markdown without colors (auto-enabled when piped)
  --provider <name> LLM provider to use (default: claude)
  -h, --help        Show this help

Target:
  branch name, commit hash, or commit range (e.g., main..HEAD)
  GitHub PR URL (e.g., https://github.com/org/repo/pull/123)
  Omit to review all local changes (staged + unstaged)

Examples:
  coreview                                    # review local changes vs HEAD
  coreview -p main                            # paged review of changes since main
  coreview abc123                             # review changes since commit
  coreview https://github.com/org/repo/pull/1 # review a GitHub PR
  coreview main > r.md                        # export review as markdown

Environment:
  GITHUB_TOKEN  Auth token for private repos`)
      process.exit(0)
    }
    if (arg === '-p') paged = true
    if (arg === '--raw') rawFlag = true
    if (arg === '--provider' && args[i + 1]) {
      provider = args[++i]
    }
  }

  const raw = rawFlag || !process.stdout.isTTY

  if (paged && raw) {
    console.error('Error: paged mode (-p) is not supported with --raw or when piping output')
    process.exit(1)
  }

  const positional = args.filter((a, i) => !a.startsWith('-') && args[i - 1] !== '--provider')
  const target = positional[0] ?? null
  return { target, paged, raw, provider }
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

async function main() {
  const { target, paged, raw, provider } = parseArgs()
  const log = (msg: string) => { if (!raw) console.log(msg) }

  log('\n±coreview\n')

  let source: DiffSource
  try {
    source = await getDiffSource({ target })
  } catch (e) {
    console.error((e as Error).message)
    process.exit(1)
  }

  if (!source.rawDiff.trim()) {
    console.log('No changes to review.')
    process.exit(0)
  }

  log('Parsing the diff...')
  const diff = parseDiff({ raw: source.rawDiff })
  const lineCount = countDiffLines({ diff })

  if (lineCount > MAX_DIFF_LINES) {
    console.error(`Diff too large (${lineCount} lines, max ${MAX_DIFF_LINES}).`)
    console.error('Suggestions:')
    console.error('  - Review commits individually: coreview <commit>')
    console.error('  - Split into smaller PRs')
    process.exit(1)
  }

  const enriched = enrichDiff({ diff })
  const llm = await getProvider({ name: provider })
  const parser = createStreamParser()

  log('Analyzing changes...')
  let started = false
  const reviewHeader = raw ? `# Review of ${source.label}\n\n` : `\nReview of ${source.label}:\n`

  function render(token: { type: 'text' | 'ref'; content: string }): string {
    if (token.type === 'text') return token.content
    return renderReference({ resolved: resolveReference({ ref: token.content, diff }), raw })
  }
  const userPrompt = source.commitMessages
    ? `Commit messages:\n${source.commitMessages}\n\nExplain this diff:`
    : 'Explain this diff:'
  const streamArgs = { systemPrompt: SYSTEM_PROMPT, userPrompt, input: enriched }

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
        if (!started) { started = true; process.stdout.write(reviewHeader) }
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
      if (!started) { started = true; process.stdout.write(reviewHeader) }
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
