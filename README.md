# ±coreview

Semantic code review tool that generates streaming narrative explanations of diffs with inline code references.

## Install

```bash
npm install
npm run build
npm link  # optional, for global `coreview` command
```

## Usage

```bash
coreview [target]
```

**Target:** branch name, commit hash, or commit range. Omit to review all local changes (staged + unstaged).

**Examples:**
```bash
coreview              # all local changes vs HEAD
coreview main         # changes since main
coreview abc123       # changes since commit
coreview main..HEAD   # explicit range
```

## How it works

1. Parses git diff into structured hunks with `[hunk:N]` markers
2. Sends enriched diff to Claude Code (headless mode) with a system prompt
3. Streams the response, detecting `[[ref:filepath:hunk:N]]` patterns
4. Expands references inline with colored diff output (+green, -red)

## Requirements

- Node.js 18+
- [Claude Code CLI](https://claude.ai/code) installed and authenticated

## Limitations

- The tool is a very alpha experimental vertion
- Max 4000 diff lines (fails gracefully with suggestions)
- Terminal output only (HTML/markdown planned)

## License

AGPL-3.0-or-later, see [full license](./LICENSE.md).
