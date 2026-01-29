# ±coreview

Semantic code review tool that generates streaming narrative explanations of diffs with inline code references.

## Usage

```bash
coreview [options] [target]
```

**Options:**
- `-p` Paged mode - pause after each code reference block for step-by-step review
- `--raw` Output markdown without colors (auto-enabled when piped)
- `--provider <name>` LLM provider (default: `claude`)

**Target:** branch name, commit hash, or commit range. Omit to review all local changes (staged + unstaged).

**Examples:**
```bash
coreview              # all local changes vs HEAD
coreview -p main      # paged review of changes since main
coreview abc123       # changes since commit
coreview main > r.md  # export review as markdown
```

### Paged Mode (`-p`)

In paged mode, the review pauses after each code block. You'll see:
- The explanation text followed by the diff snippet(s)
- A list of referenced files: `[ src/cli.ts | src/llm.ts ]`
- Press ENTER to continue to the next section

This allows you to read at your own pace and open referenced files as you go.

## How it works

1. Parses git diff into structured hunks with `[hunk:N]` markers
2. Sends enriched diff to LLM provider with a system prompt
3. Streams the response, detecting `[[ref:filepath:hunk:N]]` patterns
4. Expands references inline as ANSI-colored diffs (TTY) or markdown code blocks (piped)

## Requirements

- Node.js 18+
- Default provider (`claude`): [Claude Code CLI](https://claude.ai/code) installed and authenticated

## Limitations

- The tool is a very alpha experimental vertion
- Max 4000 diff lines (fails gracefully with suggestions)

## License

AGPL-3.0-or-later, see [full license](./LICENSE.md).
