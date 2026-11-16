export type Status = 'running' | 'idle' | 'done' | 'failed' | 'aborted'

/** A tool call an agent is running right now. */
export type Call = { id: string; tool: string; detail: string }

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
  reads: number
  edits: number
  writes: number
  lastAt: number
}

export type Tab = 'agents' | 'files'

declare module 'claude-code' {
  interface PluginState {
    'agent-monitor': { agents: Shaped<Agent[]>; files: Shaped<FileTouch[]>; tab: Tab; now: number }
  }
}
