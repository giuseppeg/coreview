#!/usr/bin/env node

import { execSync } from 'node:child_process'
import { parseDiff, enrichDiff, countDiffLines } from './diff'
import { createStreamParser, resolveReference } from './stream'
import { createClaudeCodeProvider, SYSTEM_PROMPT } from './llm'
import { renderReference } from './render'

const MAX_DIFF_LINES = 4000

function parseArgs(): string | null {
  const args = process.argv.slice(2)

  for (const arg of args) {
    if (arg === '--help' || arg === '-h') {
      console.log(`coreview - semantic code review tool

Usage: coreview [target]

Target:
  branch name, commit hash, or commit range (e.g., main..HEAD)
  Omit to review all local changes (staged + unstaged)

Examples:
  coreview              # review local changes vs HEAD
  coreview main         # review changes since main
  coreview abc123       # review changes since commit
  coreview main..HEAD   # explicit range`)
      process.exit(0)
    }
  }

  return args.find(a => !a.startsWith('-')) ?? null
}

function getDiffCommand(target: string | null): string {
  return target ? `git diff ${target}` : 'git diff HEAD'
}

async function main() {
  const target = parseArgs()
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
  let started = false;

  // Stream response and expand references
  for await (const chunk of llm.stream({
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: 'Explain this diff:',
    input: enriched
  })) {
    if (!started) {
      started = true;
      console.log("\nReview:\n")
    }
    const tokens = parser.push(chunk)
    for (const token of tokens) {
      if (token.type === 'text') {
        process.stdout.write(token.content)
      } else {
        const resolved = resolveReference({ ref: token.content, diff })
        process.stdout.write(renderReference({ resolved }))
      }
    }
  }

  // Flush remaining
  for (const token of parser.flush()) {
    if (token.type === 'text') {
      process.stdout.write(token.content)
    } else {
      const resolved = resolveReference({ ref: token.content, diff })
      process.stdout.write(renderReference({ resolved }))
    }
  }

  console.log('\n')
}

main().catch(e => {
  console.error(e.message)
  process.exit(1)
})
