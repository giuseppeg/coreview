export type DiffLine = {
  type: 'context' | 'add' | 'delete'
  content: string
}

export type Hunk = {
  index: number
  header: string
  lines: DiffLine[]
}

export type DiffFile = {
  path: string
  hunks: Hunk[]
}

export type ParsedDiff = Map<string, DiffFile>

export type LineRange = {
  start: number
  end: number
}

export type ResolvedReference =
  | { status: 'resolved'; file: string; hunks: Hunk[]; lineRange?: LineRange }
  | { status: 'not_found'; file: string; reason: 'file_not_in_diff' | 'hunk_not_found' }
  | { status: 'malformed'; raw: string }

export type StreamToken =
  | { type: 'text'; content: string }
  | { type: 'ref'; content: string; file: string }

export type LLMProvider = {
  stream(p: {
    systemPrompt: string
    userPrompt: string
    input: string
  }): AsyncIterable<string>
}
