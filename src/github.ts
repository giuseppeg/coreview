type PrInfo = {
  org: string
  repo: string
  pr: number
}

export function parseGitHubPrUrl(url: string): PrInfo | null {
  const match = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/)
  if (!match) return null
  return { org: match[1], repo: match[2], pr: parseInt(match[3], 10) }
}

export async function fetchPrPatch(p: {
  org: string
  repo: string
  pr: number
  token?: string
}): Promise<string> {
  const url = `https://patch-diff.githubusercontent.com/raw/${p.org}/${p.repo}/pull/${p.pr}.patch`
  const headers: Record<string, string> = {}
  if (p.token) headers['Authorization'] = `token ${p.token}`

  const res = await fetch(url, { headers })
  if (!res.ok) {
    if (res.status === 404) {
      throw new Error(`PR not found: ${p.org}/${p.repo}#${p.pr}`)
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error(`Auth required for private repo. Set GITHUB_TOKEN env var.`)
    }
    throw new Error(`Failed to fetch PR patch: ${res.status} ${res.statusText}`)
  }
  return res.text()
}

type ParsedPatch = {
  commitMessages: string[]
  diff: string
}

export function parsePatch(patch: string): ParsedPatch {
  const commitMessages: string[] = []
  const diffLines: string[] = []
  let inDiff = false

  for (const line of patch.split('\n')) {
    // Commit header starts a new commit section
    if (line.startsWith('From ') && line.includes(' Mon Sep 17 00:00:00 2001')) {
      inDiff = false
      continue
    }

    // Extract subject line (commit message)
    if (line.startsWith('Subject: ')) {
      // Subject format: "Subject: [PATCH N/M] message" or "Subject: message"
      const subject = line
        .replace(/^Subject: /, '')
        .replace(/^\[PATCH[^\]]*\]\s*/, '')
        .trim()
      if (subject) commitMessages.push(subject)
      continue
    }

    // Diff content starts with "diff --git"
    if (line.startsWith('diff --git ')) {
      inDiff = true
    }

    if (inDiff) {
      diffLines.push(line)
    }
  }

  return {
    commitMessages,
    diff: diffLines.join('\n')
  }
}
