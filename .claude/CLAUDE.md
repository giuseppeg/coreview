# Coreview

CLI that explains diffs semantically. Parses git diff into numbered hunks, sends to LLM, streams response while expanding `[[ref:...]]` patterns to colored diff snippets.

## Core Flow

1. Parse diff -> `Map<filepath, Hunk[]>` with `[hunk:N]` markers
2. LLM generates prose with `[[ref:filepath:hunk:N]]` references
3. Stream parser detects refs, resolver maps to hunks, render (ANSI or markdown)

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
[[ref:src/api.ts:hunk:1]]      # specific hunk
[[ref:src/api.ts:hunk:1-3]]    # hunk range
[[ref:src/api.ts]]             # all hunks in file
```

## Code Style

- Functional TS, no classes
- `type` over `interface`
- Function declarations
- Single object arg: `fn({ a, b })`
- No `.js` in imports
- `node:` prefix for builtins
- Inline logic, minimal abstractions
