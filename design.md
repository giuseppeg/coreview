# LLM-Guided Multi-Language Code Review Tool — Design Document

## Goal
Create a tool that produces a **narrative walkthrough** of large PRs/branches in **any programming language**, progressively revealing changes and explaining intent, cheaply and efficiently.

My core idea is that I get the logical diff order and then start a while loop to implement something like git add -p but at each pass I get the current block of snippets and kick in an llm explanation generation. The idea is to simplify reviews with a "walkthrough" process as if I was pairing with another engineer and they would walk me through their changes.

---

## Architecture Overview

### Step 0 — Inputs
- Git branch / PR
- Optional base branch for diff comparison
- Commit history

### Step 1 — Universal Diff Index
**Purpose:** Build language-agnostic structured metadata from raw diffs.

**Inputs:** `git diff --numstat --name-status -M -C`, optional commit log.
**Processing:**
1. **Git metadata**
   - File paths, change type, line churn, renames
2. **Hunk metadata**
   - Size, added/removed lines, comment ratio
3. **Approximate symbols**
   - Regex heuristics for functions/classes/blocks
4. **Dependency hints**
   - Import/include lines, file references
5. **Commit mapping**
   - Attach latest commit hash and message per file/hunk

**Output:** `DiffIndex` (JSON)
```ts
interface FileChange {
  path: string
  changeType: "A" | "M" | "D" | "R"
  churn: { add: number; del: number }
  latestCommit: { hash: string; message: string }
  hunks: HunkMeta[]
  approxSymbols: string[]
  references: string[]
}
interface DiffIndex {
  files: FileChange[]
  graph: DependencyGraph
}
```

---

### Step 2 — Intent Clustering & Narrative Ordering
**Purpose:** Convert DiffIndex → ordered review walkthrough.

**Processing:**
1. **Deterministic pre-grouping**
   - Cluster files by directory, dependency graph, commit, churn
2. **LLM-assisted intent clustering**
   - Input: cluster metadata only (paths, symbols, hunks, commits)
   - Output: `IntentCluster` with title, summary, dependencies
```ts
interface IntentCluster {
  id: string
  title: string
  summary: string
  files: string[]
  dependsOn: string[]
  confidence: number
}
```
3. **Dependency resolution**
   - Build DAG → topological sort → review order
4. **Review script generation**
   - Output `ReviewStep[]` with primary and supporting files
```ts
interface ReviewStep {
  clusterId: string
  intent: string
  primaryFiles: string[]
  supportingFiles: string[]
  rationale: string
}
```

**Token control:** Cap input size per cluster; drop low-signal fields for large PRs.
**Fallback:** If LLM uncertain, use directory/commit/churn order.

---

### Step 3 — Progressive Review Loop
- Iterate over `ReviewStep[]` sequentially
- For each step:
  1. Extract only relevant hunks/snippets
  2. Ask LLM to explain intent and cross-references
  3. Allow interactive “approve/next” workflow

---

## Notes & Principles
- **Language-agnostic:** No AST/parsing or LSP reliance
- **Cheap & scalable:** LLM only sees metadata + small hunks
- **Commits are first-class metadata:** drive grouping, intent hints, ordering
- **Dependency graph:** soft heuristic graph, not exact call graph
- **Caching:** store cluster summaries and explanations for reuse
- **The first steps must be headless**: the review part should be decoupled from the core steps such that I can have a terminal UI, or web page UI. For now let's implement only terminal.

---

## Technology Stack
- Node.js / TypeScript
- Git CLI for diff and log
- Regex-based symbol extraction
- Optional lightweight AST parsers (tree-sitter) for additional accuracy (can we skip this for now?)
- Any LLM with context window ~2–8k tokens for Step 2 & 3
- We need a thin abstraction for the LLM such that we can later integrate many different. For now we should use claude code in headless mode https://code.claude.com/docs/en/headless with custom system prompt json output

---

## Output
- Structured review plan (`ReviewStep[]`)
- Narrative walkthrough with explanations for each cluster/hunk
- Supports iterative, “pair-programming style” review
- when a diff block is presented it should appear with diff highlight and interactive "prompt" with the default action being leaving a comment (no. Other actions are: read (uses os `say` with ability to press Esc to stop), accept [optional message],

