import { atom, read, update } from 'claude-code'
import type { Register, StateDollar, ToolCallInput } from 'claude-code'

import type { Agent, Call, Status } from '../types'

const PANE = 'agent-monitor'
const TITLE = 'Agenten live'
const MAIN = 'main'

// Change the tag when Agent's fields change: it declines what an earlier
// version stored, which outlives a reload.
const agents = atom({ plugin: 'agent-monitor', key: 'agents' } as const, [], {
  shape: 'agents-2',
})

// The main agent wears Claude's own orange; each subagent the first free one after it.
const PALETTE = ['#D97757', '#4C8DF6', '#3FB37F', '#A970E8', '#E85D9A', '#22B8C9', '#E8B52E', '#8A9AAE']

// The mascot on a 12 x 7 grid: '#' filled, '.' empty (the eyes are holes).
const MASCOT = [
  '..########..',
  '..#.####.#..',
  '############',
  '############',
  '..########..',
  '..#.#..#.#..',
  '..#.#..#.#..',
]

function logoSvg(color: string) {
  const cells = MASCOT.flatMap((row, y) =>
    [...row].map((c, x) => (c === '#' ? `<rect x="${x}" y="${y}" width="1.02" height="1.02"/>` : '')),
  ).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 7" shape-rendering="crispEdges"><g fill="${color}">${cells}</g></svg>`
}

function freeColor(list: readonly Agent[]) {
  const used = new Set(list.map(a => a.color))
  return PALETTE.slice(1).find(c => !used.has(c)) ?? PALETTE[1 + (list.length % (PALETTE.length - 1))] ?? '#4C8DF6'
}
// The time the pane counts elapsed seconds against, ticked while anything runs.
const now = atom({ plugin: 'agent-monitor', key: 'now' } as const, 0)

const GLYPH: Record<Status, string> = {
  running: '●',
  idle: '○',
  done: '✓',
  failed: '✗',
  aborted: '■',
}
const COLOR: Record<Status, string> = {
  running: 'claude',
  idle: 'inactive',
  done: 'success',
  failed: 'error',
  aborted: 'warning',
}
const WORD: Record<Status, string> = {
  running: 'läuft',
  idle: 'wartet auf dich',
  done: 'fertig',
  failed: 'Fehler',
  aborted: 'abgebrochen',
}

// The input field that best says what a call does, in this order.
const DETAIL_KEYS = [
  'command',
  'file_path',
  'notebook_path',
  'pattern',
  'url',
  'query',
  'skill',
  'description',
  'prompt',
  'path',
] as const

function detailOf(e: ToolCallInput): string {
  const fields = e as unknown as Record<string, unknown>
  for (const key of DETAIL_KEYS) {
    const value = fields[key]
    if (typeof value !== 'string' || value.trim() === '') continue
    if (key.endsWith('path')) return value.split('/').slice(-2).join('/')
    return value.trim().split('\n')[0] ?? ''
  }
  return ''
}

const toolName = (tool: string) =>
  tool.startsWith('mcp__') ? (tool.split('__').pop() ?? tool) : tool

function blank(id: string, at: number, color: string): Agent {
  return {
    color: id === MAIN ? (PALETTE[0] ?? '#D97757') : color,
    id,
    label: '',
    type: '',
    parentId: id === MAIN ? null : MAIN,
    isSpawned: id === MAIN,
    status: 'running',
    startedAt: at,
    endedAt: null,
    calls: 0,
    running: [],
  }
}

// Changes one agent, adding it first when the list has none of that id.
function upsert($: StateDollar, id: string, at: number, change: (a: Agent) => Agent) {
  return update($, agents, list => {
    const found = list.find(a => a.id === id)
    const changed = change(found ?? blank(id, at, freeColor(list)))
    return found ? list.map(a => (a.id === id ? changed : a)) : [...list, changed]
  })
}

// The drawn agents depth-first, each under the agent that spawned it.
function ordered(list: readonly Agent[]) {
  const shown = list.filter(a => a.isSpawned)
  const ids = new Set(shown.map(a => a.id))
  const parentOf = (a: Agent) => (a.parentId !== null && ids.has(a.parentId) ? a.parentId : null)
  const rows: { agent: Agent; depth: number }[] = []
  const walk = (parent: string | null, depth: number) => {
    for (const agent of shown.filter(a => parentOf(a) === parent)) {
      rows.push({ agent, depth })
      walk(agent.id, depth + 1)
    }
  }
  walk(null, 0)
  return rows
}

function elapsed(agent: Agent, at: number) {
  const end = agent.endedAt ?? Math.max(at, agent.startedAt)
  const seconds = Math.max(0, Math.round((end - agent.startedAt) / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'agenten',
      description: 'Öffnet das Panel mit den laufenden Agenten und Subagenten',
    })
    void $.ui.open({ id: PANE, title: TITLE })
    $.clock.every(1000, async () => {
      const list = await read($, agents)
      if (!list.some(a => a.status === 'running')) return
      const at = await $.clock.now()
      await update($, now, () => at)
    })

    return next(e)
  })

  on('command.run', { command: 'agenten' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })

    return { text: 'Agenten-Panel geöffnet.' }
  })

  on('turn.start', async ($, e, next) => {
    const at = await $.clock.now()
    if (e.agentId === undefined) {
      // A new prompt: the subagents that finished before it leave the pane.
      await update($, agents, list => list.filter(a => a.id === MAIN || a.status === 'running'))
      await upsert($, MAIN, at, a => ({ ...a, status: 'running', startedAt: at, endedAt: null, calls: 0, running: [] }))
    } else {
      await upsert($, e.agentId, at, a => ({ ...a, status: 'running', endedAt: null }))
    }
    await update($, now, () => at)

    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    const id = started.deny === undefined ? started.agentId : undefined
    if (id !== undefined) {
      const at = await $.clock.now()
      await upsert($, id, at, a => ({
        ...a,
        label: e.description,
        type: e.subagentType,
        parentId: e.parentAgentId ?? MAIN,
        isSpawned: true,
      }))
    }

    return started
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const id = e.agentId ?? MAIN
    const call: Call = { id: e.tool_use_id, tool: toolName(e.tool), detail: detailOf(e) }
    const at = await $.clock.now()
    await upsert($, id, at, a => ({ ...a, status: 'running', calls: a.calls + 1, running: [...a.running, call] }))
    const ran = await next(e)
    await update($, agents, list =>
      list.map(a => (a.id === id ? { ...a, running: a.running.filter(c => c.id !== call.id) } : a)),
    )

    return ran
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const id = e.agentId ?? MAIN
    const at = await $.clock.now()
    const status: Status = e.isAborted
      ? 'aborted'
      : e.reason === 'error' || e.reason === 'refusal'
        ? 'failed'
        : id === MAIN
          ? 'idle'
          : 'done'
    await update($, agents, list =>
      list
        // A loop no spawn named (a compaction, say) is forgotten once it ends.
        .filter(a => a.id !== id || a.isSpawned)
        .map(a => (a.id === id ? { ...a, status, endedAt: at, running: [] } : a)),
    )

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const table = $.ui.resolve(e)
    const { Box, Text } = table
    // The terminal draws no Svg: there the logo is a colored glyph.
    const Svg = 'Svg' in table ? table.Svg : undefined
    const rows = ordered(await read($, agents))
    const at = await read($, now)

    if (rows.length === 0) {
      return <Text dimColor>Noch keine Aktivität.</Text>
    }

    return (
      <Box flexDirection="column" gap={1}>
        {rows.map(({ agent, depth }) => (
          <Box key={agent.id} flexDirection="column" paddingLeft={depth * 2}>
            <Box flexDirection="row" alignItems="center" gap={1}>
              {Svg === undefined ? (
                <Text color={agent.color}>▟█▙</Text>
              ) : (
                <Svg source={logoSvg(agent.color)} alt="Agent-Logo" width={24} height={14} />
              )}
              <Text wrap="truncate-end">
                <Text color={COLOR[agent.status]}>{GLYPH[agent.status]} </Text>
                <Text bold>{agent.id === MAIN ? 'Hauptagent' : agent.label || 'Subagent'}</Text>
                {agent.type !== '' && <Text dimColor> · {agent.type}</Text>}
              </Text>
            </Box>
            <Text dimColor wrap="truncate-end">
              {'  '}
              {WORD[agent.status]} · {elapsed(agent, at)} · {agent.calls}{' '}
              {agent.calls === 1 ? 'Tool' : 'Tools'}
            </Text>
            {agent.running.map(call => (
              <Text wrap="truncate-end">
                {'  ▸ '}
                <Text color="claude">{call.tool}</Text>
                {call.detail !== '' && <Text dimColor> {call.detail}</Text>}
              </Text>
            ))}
            {agent.status === 'running' && agent.running.length === 0 && (
              <Text dimColor italic>
                {'  '}denkt nach …
              </Text>
            )}
          </Box>
        ))}
      </Box>
    )
  })
}
