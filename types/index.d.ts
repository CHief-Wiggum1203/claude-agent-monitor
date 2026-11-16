export type Status = 'running' | 'idle' | 'done' | 'failed' | 'aborted'

/** A tool call an agent is running right now. */
export type Call = { id: string; tool: string; detail: string; startedAt: number }

/** One agent loop: the main one (id `main`) or a subagent. */
export type Agent = {
  id: string
  label: string
  type: string
  parentId: string | null
  /** False for loops no `agent.spawn` named (compaction, memory forks): never drawn. */
  isSpawned: boolean
  status: Status
  /** The logo's color, unique among the agents in the list when it was given. */
  color: string
  startedAt: number
  endedAt: number | null
  calls: number
  running: Call[]
}

/** A file the agents touched since the last prompt, and how. */
export type FileTouch = {
  path: string
  /** The agents that touched it, in the order they first did. */
  agentIds: string[]
  /** The agents that edited or wrote it: two or more is a conflict. */
  editorIds: string[]
  reads: number
  edits: number
  writes: number
  lastAt: number
}

export type Tab = 'agents' | 'files'

/** An earlier prompt, kept as its agents and files stood when the next one began. */
export type Run = {
  id: string
  prompt: string
  agents: Agent[]
  files: FileTouch[]
}

declare module 'claude-code' {
  interface PluginState {
    'agent-monitor': {
      agents: Shaped<Agent[]>
      files: Shaped<FileTouch[]>
      history: Shaped<Run[]>
      prompt: string
      expanded: string[]
      tab: Tab
      now: number
    }
  }
}
