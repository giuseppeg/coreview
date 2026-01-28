# Coreview - Semantic Code Review Tool

## Goal

Tool that takes a diff/commit/branch and generates a **streaming narrative explanation** with inline code references. References expand to actual code snippets on-the-fly.

## Core Insight

Code review is semantic, not syntactic. Organizing diffs isn't enough - reviewers need to understand **what is happening and why**, with relationships between changes surfaced (e.g., "this is a rename refactor, 15 call sites are mechanical updates").

## Design

### Input
```
coreview [target]
  --staged              # review staged changes (default if no target)
  --unstaged            # review unstaged changes
  --format=terminal|html|markdown
  --output=stdout|file.html
```

Target can be: branch name, commit hash, commit range (`main..HEAD`), or omitted for working changes.

### Diff Modes

| Mode | Command |
|------|---------|
| Unstaged | `git diff` |
| Staged | `git diff --cached` |
| Branch/commit | `git diff main..HEAD` |

### Processing Flow

1. **Parse diff** into structured hunks: `Map<filepath, Hunk[]>`
2. **Number hunks** and create enriched diff for LLM (with `[hunk:N]` markers)
3. **Send enriched diff + system prompt** to LLM (stream response)
4. **Stream-parse output** for `[[ref:...]]` patterns
5. **Expand references** to diff hunks with +/- coloring
6. **Render** to terminal or HTML

### Enriched Diff Format (sent to LLM)

```diff
── src/api.ts ──

[hunk:1] @@ -10,5 +10,8 @@ function init()
   const config = loadConfig()
+  validateConfig(config)
+  logger.info('Config loaded')
   return config

[hunk:2] @@ -45,3 +48,6 @@ export function fetchUser
-  return db.query(sql)
+  const result = await db.query(sql)
+  metrics.record('user_fetch')
+  return result
```

Hunks are numbered per-file. LLM can reference specific hunks.

### Reference Format

```
[[ref:src/api.ts:hunk:1]]       # specific hunk
[[ref:src/api.ts:hunk:1-3]]     # hunk range
[[ref:src/api.ts]]              # all hunks in file
```

Format: `[[ref:filepath:hunk:N]]` or `[[ref:filepath:hunk:N-M]]` or `[[ref:filepath]]`

- `ref:` prefix prevents collision with wiki links, Lua strings, etc.
- References resolve to actual diff content (with +/- lines)
- LLM outputs compact references, we expand them with diff coloring

### Reference Resolution

```ts
type Hunk = {
  index: number
  header: string           // @@ -10,5 +10,8 @@ function init()
  lines: DiffLine[]        // with +/- prefix
}

type DiffLine = {
  type: 'context' | 'add' | 'delete'
  content: string
}

type ResolvedReference =
  | { status: 'resolved'; file: string; hunks: Hunk[] }
  | { status: 'not_found'; file: string; reason: 'file_not_in_diff' | 'hunk_not_found' }
  | { status: 'malformed'; raw: string }

// Resolution rules:
// - Invalid hunk number: show warning "hunk N not found"
// - File not in diff: show warning "file not in diff"
// - Malformed syntax: render as plain text
// - Unclosed [[ref: after 200 chars: treat [[ as literal
```

### Stream Parser

Lookahead buffer with max length to handle chunk boundaries:

```ts
// Pseudocode
class ReferenceStreamParser {
  buffer = ''
  MAX_REF_LENGTH = 200

  push(chunk: string): Array<{type: 'text' | 'ref', content: string}>
  flush(): string  // call at end of stream
}
```

- Buffer only when inside potential `[[ref:...]]`
- Max 200 chars before giving up (treat `[[ref:` as literal)
- Simple indexOf-based, no regex in hot path

### LLM Integration

Use Claude Code headless mode with thin abstraction for swappability:

```bash
git diff main | claude -p "Explain this diff" \
  --system-prompt "$COREVIEW_PROMPT" \
  --output-format stream-json
```

Key flags:
- `--system-prompt` - custom prompt for explanation generation
- `--output-format stream-json` - newline-delimited JSON for streaming
- Can pipe diff as stdin

Abstraction layer interface:
```ts
type LLMProvider = {
  stream(p: {
    systemPrompt: string
    userPrompt: string
    input: string  // the diff
  }): AsyncIterable<string>
}
```

Default impl: Claude Code headless. Can swap for direct API, other models.

### System Prompt

```
You are a code review assistant. Given a git diff with numbered hunks, write a clear narrative explanation of what changed and why.

## Output Format

Write prose explanation with inline references to diff hunks. Use this exact format:
  [[ref:filepath:hunk:N]]       # specific hunk
  [[ref:filepath:hunk:N-M]]     # range of hunks
  [[ref:filepath]]              # all changes in file

Examples:
  [[ref:src/api.ts:hunk:1]]
  [[ref:src/api.ts:hunk:2-3]]
  [[ref:lib/utils.ts]]

References will be automatically expanded to show the diff with +/- lines. Do NOT copy code into your explanation - always use references.

## Guidelines

1. Start with a 1-2 sentence summary of the overall change
2. Group related changes together and explain them as a unit
3. Distinguish between:
   - Core changes (the actual new logic or modification)
   - Mechanical changes (renames propagated across files, import updates, etc.)
4. Call out:
   - Breaking changes or API modifications
   - Potential risks or areas needing careful review
   - Non-obvious side effects
5. Keep explanations concise - focus on intent and impact, not line-by-line description
6. For large refactors, explain the pattern once then note "same pattern applied to X other files"

## Example Output

This PR introduces rate limiting to the API endpoints.

The core implementation is in [[ref:src/middleware/rateLimit.ts:hunk:1]], which creates a token bucket rate limiter with configurable limits per endpoint.

The middleware is applied in [[ref:src/routes/index.ts:hunk:1]]. Each route can override the default limits via the `rateLimit` option.

Supporting changes:
- New config options [[ref:src/config.ts:hunk:1]]
- Types added [[ref:src/types/middleware.ts]]

Note: The default limit of 100 req/min in [[ref:src/middleware/rateLimit.ts:hunk:1]] may be too restrictive for batch endpoints - worth reviewing.
```

### Output Rendering

**Terminal:**
- Stream text as-is
- On `[[ref:...]]`: lookup hunk(s), emit with diff coloring
- Diff coloring: `+` lines green, `-` lines red, context lines dim
- Use `shiki` with `diff` language for syntax-aware diff highlighting
- Inline expansion (no collapse for MVP)

```ts
import { createHighlighter } from 'shiki'

const highlighter = await createHighlighter({
  themes: ['nord'],
  langs: ['diff']  // diff language for +/- coloring
})

function renderHunk(hunk: Hunk): string {
  const diffText = hunk.lines.map(l => {
    if (l.type === 'add') return '+' + l.content
    if (l.type === 'delete') return '-' + l.content
    return ' ' + l.content
  }).join('\n')

  return highlighter.codeToAnsi(diffText, { lang: 'diff', theme: 'nord' })
}
```

**HTML:**
- Same logic, output `<pre><code class="language-X">` blocks
- Can add interactivity later (collapse/expand, jump to full file)

**Markdown:**
- Expand references to fenced code blocks with language annotation

## Architecture

```
src/
  cli.ts              # arg parsing, orchestration
  diff/
    parser.ts         # git diff -> parsed hunks
    enricher.ts       # add [hunk:N] markers for LLM
    types.ts          # DiffFile, Hunk, DiffLine
  llm/
    provider.ts       # LLMProvider type
    claude-code.ts    # Claude Code headless impl
  stream/
    parser.ts         # detect [[ref:...]] in stream
    resolver.ts       # resolve refs to hunks
  render/
    terminal.ts       # shiki diff coloring
    html.ts           # HTML output
    markdown.ts       # MD output
  index.ts            # main entry
```

## MVP Scope

1. CLI that takes branch/commit or --staged/--unstaged
2. Parses diff into structured hunks
3. Enriches diff with hunk numbers for LLM
4. Sends to Claude Code headless with system prompt
5. Streams output, expands hunk references with diff coloring
6. Terminal output only

Skip for MVP:
- Multiple LLM providers (just Claude Code)
- HTML/markdown output
- Caching
- Interactive mode (approve/comment)

## Decisions (Resolved)

### Hunk-based References
**Decision: Hunk-based.** References point to diff hunks (`[[ref:file:hunk:N]]`), not file lines. This shows the actual diff with +/- lines, which is more useful for code review than just showing current file content.

### Large PRs
**Decision: Fail gracefully for v1.** If diff > 4000 lines, show error with suggestions (review commits individually, split PR, use --file-filter). Chunking loses semantic coherence and is complex - defer until we have data on how often this happens.

### Malformed References
**Decision: Best-effort rendering.**
- Clamp out-of-range lines (with warning)
- File not found: show warning inline
- Malformed syntax: render as plain text
- Never break the stream

### Reference Format
**Decision: `[[ref:filepath:line-line]]`** with `ref:` prefix to avoid collision with wiki syntax, Lua strings, etc.

### Stream Buffering
**Decision: Lookahead buffer with 200 char max.** Buffer only inside potential reference. Give up after 200 chars without closing `]]`.

### Structured Output vs Streaming
**Decision: Streaming + robust prompt.**

Claude's `--json-schema` only works with `--output-format json`, not `stream-json`. Structured output would guarantee format but lose streaming.

| Approach | Pros | Cons |
|----------|------|------|
| Structured output | Guaranteed format, no parsing | No streaming - user waits for full response |
| Stream + parse | Real-time output, good CLI UX | LLM might ignore format |

Streaming UX matters for CLI - reviews can be long. Mitigation: robust prompt with explicit wrong examples, consequence framing ("WILL BE DISPLAYED AS BROKEN TEXT").

Schema if we ever need non-streaming mode:
```typescript
type ReviewSegment =
  | { type: 'text'; content: string }
  | { type: 'reference'; file: string; hunkStart: number; hunkEnd?: number }
```

Fallback options if prompt still fails:
1. Post-process to detect unresolved mentions ("hunk 1", "lines X-Y") and warn
2. Regex-match to actual hunks
3. Offer `--structured` flag for accuracy over UX

## Token Economics

- 1000-line diff ~ 50k input tokens
- Explanation output ~ 2k tokens
- Cost ~ $0.15/review (Sonnet pricing)
- Acceptable for individual/team use

## Next Steps

1. [ ] Scaffold project (package.json, tsconfig, structure)
2. [ ] Implement diff parser (git diff -> structured hunks)
3. [ ] Implement diff enricher (add [hunk:N] markers)
4. [ ] Implement stream parser (reference detection)
5. [ ] Implement reference resolver (refs -> hunks)
6. [ ] Implement Claude Code provider
7. [ ] Implement terminal renderer (shiki diff coloring)
8. [ ] Wire up CLI
9. [ ] Test with real diffs
