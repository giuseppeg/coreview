# Coreview

CLI that explains diffs semantically. Parses git diff into numbered hunks, sends to LLM, streams response while expanding `[[ref:...]]` patterns to colored diff snippets.

## Core Flow

1. Get diff (local git or GitHub PR via URL)
2. Parse diff -> `Map<filepath, Hunk[]>` with `[hunk:N]` markers
3. LLM generates prose with `[[ref:filepath:hunk:N]]` references
4. Stream parser detects refs, resolver maps to hunks, render (ANSI or markdown)

Max 4000 diff lines enforced.

## Paged Mode (`-p`)

When `-p` flag is passed:
- Background task streams LLM response into blocks (split on ref boundaries)
- Foreground prints blocks incrementally, pauses after each ref group
- Shows referenced files before ENTER prompt: `[ file1 | file2 ]`
- Contiguous refs (only whitespace between) stay in same block
- Not compatible with raw mode

## Raw Mode (`--raw`)

Outputs markdown without ANSI colors. Auto-enabled when stdout is not a TTY (piped to file).

- No banner/status logs, just LLM prose + diff blocks
- Diffs rendered as ` ```diff filename ` fenced blocks
- Warnings as blockquotes: `> [warning: ...]`
- Use: `coreview main > review.md`

## Reference Format

```
[[ref:src/api.ts:hunk:1]]         # specific hunk
[[ref:src/api.ts:hunk:1-3]]       # hunk range
[[ref:src/api.ts:hunk:1:L10-25]]  # lines 10-25 of hunk (for large hunks)
[[ref:src/api.ts:hunk:1:L15]]     # single line
```

## GitHub PR Support

Target can be a GitHub PR URL: `https://github.com/org/repo/pull/123`

- `src/github.ts` - `parseGitHubPrUrl`, `fetchPrPatch`, `parsePatch`
- Uses patch-diff.githubusercontent.com endpoint
- `GITHUB_TOKEN` env var for private repos
- Extracts commit messages from patch for LLM context

## Providers

LLM providers live in `src/providers/`. Each exports `createProvider({ systemPrompt }): LLMProvider`.

- `src/llm.ts` - SYSTEM_PROMPT + `getProvider({ name })` with dynamic import
- `src/providers/claude.ts` - Claude Code CLI provider (default)

To add a new provider: create `src/providers/foo.ts`, export `createProvider`. Users select via `--provider foo`.

## Code Style

- Functional TS, no classes
- `type` over `interface`
- Function declarations
- Single object arg: `fn({ a, b })`
- No `.js` in imports
- `node:` prefix for builtins
- Inline logic, minimal abstractions
