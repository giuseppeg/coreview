# Coreview Design

## Current Implementation

Single-pass streaming review: parse diff, send to LLM, stream response with inline references.

```
git diff / PR URL
      |
      v
  parseDiff() -> Map<filepath, Hunk[]> with [hunk:N] markers
      |
      v
  enrichDiff() -> text blob for LLM
      |
      v
  LLM stream with SYSTEM_PROMPT
      |
      v
  createStreamParser() detects [[ref:...]] tokens
      |
      v
  resolveReference() + renderReference() -> ANSI or markdown
```

### Key Modules

- `cli.ts` - arg parsing, diff source (git or GitHub PR), main loop
- `diff.ts` - `parseDiff`, `enrichDiff`, `countDiffLines`
- `stream.ts` - `createStreamParser`, `resolveReference`
- `render.ts` - `renderReference` (ANSI/markdown output)
- `llm.ts` - `SYSTEM_PROMPT`, `getProvider`
- `github.ts` - PR URL parsing, patch fetching
- `providers/claude.ts` - Claude Code CLI provider

### Modes

- **Default**: stream everything, render refs inline
- **Paged (`-p`)**: pause after each ref group, show file list, ENTER to continue
- **Raw (`--raw`)**: markdown output, no ANSI, auto-enabled when piped

---

## Future Ideas (not implemented and probably bad ideas)

These were in the original vision but not built:

### Intent Clustering
Group related changes by intent (feature, bugfix, refactor) using LLM on metadata only. Would enable smarter ordering and summaries.

### Dependency Graph
Build soft dependency graph from imports/references. Order review by dependencies.

### Interactive Review
- Approve/reject hunks
- Leave inline comments
- TTS read-aloud with `say`
- Export comments to PR

### Caching
Store cluster summaries and explanations for incremental reviews.

### Multi-stage Pipeline
```
DiffIndex -> IntentClusters -> ReviewSteps -> Progressive Loop
```
Instead of current single-pass approach.
