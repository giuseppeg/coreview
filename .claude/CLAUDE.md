# Coreview

CLI that explains diffs semantically. Parses git diff into numbered hunks, sends to LLM, streams response while expanding `[[ref:...]]` patterns to colored diff snippets.

## Core Flow

1. Parse diff -> `Map<filepath, Hunk[]>` with `[hunk:N]` markers
2. LLM generates prose with `[[ref:filepath:hunk:N]]` references
3. Stream parser detects refs, resolver maps to hunks, render with ANSI colors

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
