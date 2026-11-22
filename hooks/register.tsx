import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, StateDollar, ToolCallInput } from 'claude-code'

import type { Agent, Call, Change, FileTouch, Fill, Run, Status } from '../types'

const PANE = 'agent-monitor'
const TITLE = 'Agenten live'
const MAIN = 'main'
// Agents shown in the widget before "+ N weitere".
const WIDGET_ROWS = 4

// Change the tag when Agent's fields change: it declines what an earlier
// version stored, which outlives a reload.
const agents = atom({ plugin: 'agent-monitor', key: 'agents' } as const, [], {
  shape: 'agents-4',
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
const files = atom({ plugin: 'agent-monitor', key: 'files' } as const, [], {
  shape: 'files-3',
})
// The files whose changes are opened in the files tab.
const openDiffs = atom({ plugin: 'agent-monitor', key: 'openDiffs' } as const, [])
const tab = atom({ plugin: 'agent-monitor', key: 'tab' } as const, 'agents')
// Earlier prompts, newest first, and the one running now.
const history = atom({ plugin: 'agent-monitor', key: 'history' } as const, [], {
  shape: 'history-2',
})
const prompt = atom({ plugin: 'agent-monitor', key: 'prompt' } as const, '')
// The earlier prompts opened in the pane.
const expanded = atom({ plugin: 'agent-monitor', key: 'expanded' } as const, [])

// How each file tool touches its file.
const FILE_TOOLS: Record<string, 'reads' | 'edits' | 'writes'> = {
  Read: 'reads',
  Edit: 'edits',
  MultiEdit: 'edits',
  NotebookEdit: 'edits',
  Write: 'writes',
}

function touchedPath(e: ToolCallInput): string | undefined {
  const fields = e as unknown as Record<string, unknown>
  const path = fields.file_path ?? fields.notebook_path
  return typeof path === 'string' && path !== '' ? path : undefined
}

// Lines kept per side of one change, and changes kept per file.
const MAX_LINES = 30
const MAX_CHANGES = 20

const linesOf = (text: unknown) => (typeof text === 'string' && text !== '' ? text.split('\n') : [])

/** What one successful file call changed, from its own input. */
function changesOf(e: ToolCallInput, agentId: string): Change[] {
  const fields = e as unknown as Record<string, unknown>
  const pairs: [unknown, unknown][] =
    e.tool === 'Write'
      ? [[undefined, fields.content]]
      : e.tool === 'NotebookEdit'
        ? [[undefined, fields.new_source]]
        : Array.isArray(fields.edits)
          ? (fields.edits as Record<string, unknown>[]).map(edit => [edit.old_string, edit.new_string])
          : [[fields.old_string, fields.new_string]]

  return pairs.map(([before, after]) => {
    const removed = linesOf(before)
    const added = linesOf(after)
    return {
      agentId,
      kind: e.tool === 'Write' ? 'write' : 'edit',
      removed: removed.slice(0, MAX_LINES),
      added: added.slice(0, MAX_LINES),
      isCut: removed.length > MAX_LINES || added.length > MAX_LINES,
    }
  })
}

// The time the pane counts elapsed seconds against, ticked while anything runs.
const now = atom({ plugin: 'agent-monitor', key: 'now' } as const, 0)
// The context window's fill as the last measurement reported it.
const context = atom({ plugin: 'agent-monitor', key: 'context' } as const, null)

const BAR_CELLS = 12
const kTokens = (n: number) => `${Math.round(n / 100) / 10}k`

/** "Kontext ███████░░░░░ 62 % · 246.9k / 400k", or nothing before the first reading. */
function contextLine(fill: Fill | null) {
  if (fill === null) return undefined
  const filled = Math.round((fill.percent / 100) * BAR_CELLS)
  const bar = '█'.repeat(filled) + '░'.repeat(BAR_CELLS - filled)
  return `Kontext ${bar} ${fill.percent} % · ${kTokens(fill.tokens)} / ${kTokens(fill.window)}`
}

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
    advisor: 0,
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

function clock(ms: number) {
  const seconds = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

const elapsed = (agent: Agent, at: number) =>
  clock((agent.endedAt ?? Math.max(at, agent.startedAt)) - agent.startedAt)

const isChanged = (f: FileTouch) => f.edits + f.writes > 0
const isConflict = (f: FileTouch) => f.editorIds.length > 1
const fileName = (path: string) => path.split('/').pop() ?? path
const agentName = (a: Agent) => (a.id === MAIN ? 'Hauptagent' : a.label || 'Subagent')

// Whether the status line holds this mod's entry, so it is cleared once.
let hasStatus = false

async function showStatus($: EngineInterface) {
  const list = await read($, agents)
  const running = list.filter(a => a.isSpawned && a.status === 'running')
  if (running.length === 0) {
    if (hasStatus) $.ui.status(undefined)
    hasStatus = false
    return
  }
  const at = await $.clock.now()
  const since = Math.min(...running.map(a => a.startedAt))
  const count = running.length === 1 ? '1 Agent läuft' : `${running.length} Agenten laufen`
  $.ui.status(`● ${count} · ${clock(at - since)}`)
  hasStatus = true
}

export const register: Register = (on, options) => {
  const historySize = Number(options.historySize)
  const stallMs = Number(options.stallSeconds) * 1000
  const hasSound = options.sound === true
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'agenten',
      description: 'Öffnet das Panel mit den laufenden Agenten und Subagenten',
    })
    // On the desktop app a small widget instead of a whole column; /agenten opens it full.
    void $.ui.open({ id: PANE, title: TITLE, placement: 'widget' })
    $.clock.every(1000, async () => {
      const list = await read($, agents)
      if (list.some(a => a.status === 'running')) {
        const at = await $.clock.now()
        await update($, now, () => at)
      }
      await showStatus($)
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
      // A new prompt: the one before it moves into the history, with the
      // subagents that finished; those still running stay in the pane.
      const list = await read($, agents)
      if (historySize > 0 && list.some(a => a.id === MAIN)) {
        const kept = list.filter(a => a.id === MAIN || a.status !== 'running')
        const run: Run = { id: `run-${at}`, prompt: await read($, prompt), agents: kept, files: await read($, files) }
        await update($, history, runs => [run, ...runs].slice(0, historySize))
      }
      await update($, prompt, () => e.text.trim().split('\n')[0] ?? '')
      await update($, agents, all => all.filter(a => a.id === MAIN || a.status === 'running'))
      await update($, files, () => [])
      await upsert($, MAIN, at, a => ({ ...a, status: 'running', startedAt: at, endedAt: null, calls: 0, advisor: 0, running: [] }))
    } else {
      await upsert($, e.agentId, at, a => ({ ...a, status: 'running', endedAt: null }))
    }
    await update($, now, () => at)
    await showStatus($)

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
    const at = await $.clock.now()
    const call: Call = { id: e.tool_use_id, tool: toolName(e.tool), detail: detailOf(e), startedAt: at }
    await upsert($, id, at, a => ({ ...a, status: 'running', calls: a.calls + 1, running: [...a.running, call] }))
    const ran = await next(e)
    await update($, agents, list =>
      list.map(a => (a.id === id ? { ...a, running: a.running.filter(c => c.id !== call.id) } : a)),
    )
    const kind = FILE_TOOLS[e.tool]
    const path = touchedPath(e)
    // Counted once the call went through: a refused or failed write touched nothing.
    const hasWorked = ran.deny === undefined && ran.isError !== true
    if (kind !== undefined && path !== undefined && hasWorked) {
      const doneAt = await $.clock.now()
      const before = (await read($, files)).find(f => f.path === path)
      await update($, files, list => {
        const found = list.find(f => f.path === path)
        const base: FileTouch = found ?? {
          path,
          agentIds: [],
          editorIds: [],
          reads: 0,
          edits: 0,
          writes: 0,
          lastAt: doneAt,
          changes: [],
        }
        const isEdit = kind !== 'reads'
        const touched: FileTouch = {
          ...base,
          agentIds: base.agentIds.includes(id) ? base.agentIds : [...base.agentIds, id],
          editorIds: !isEdit || base.editorIds.includes(id) ? base.editorIds : [...base.editorIds, id],
          [kind]: base[kind] + 1,
          lastAt: doneAt,
          changes: isEdit ? [...base.changes, ...changesOf(e, id)].slice(-MAX_CHANGES) : base.changes,
        }
        return found ? list.map(f => (f.path === path ? touched : f)) : [...list, touched].slice(-200)
      })
      // A second agent changing the same file: said once, when it begins.
      const after = (await read($, files)).find(f => f.path === path)
      if (after !== undefined && isConflict(after) && !(before !== undefined && isConflict(before))) {
        $.ui.toast(`⚠ ${fileName(path)} wird von ${after.editorIds.length} Agenten geändert`)
      }
    }

    return ran
  }).catch(($, e, next) => next(e))

  // The advisor runs on the API's side: no tool.call, only the step's result names it.
  on('turn.step', async function* ($, e, next) {
    const step = yield* next(e)
    const asked = (step.serverToolUses ?? []).filter(use => use.name === 'advisor').length
    const id = e.agentId ?? MAIN
    if (asked > 0) await update($, agents, list => list.map(a => (a.id === id ? { ...a, advisor: a.advisor + asked } : a)))

    return step
  })

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
    const ended = (await read($, agents)).find(a => a.id === id)
    if (ended !== undefined && id !== MAIN) {
      const said = status === 'done' ? 'fertig' : WORD[status]
      $.ui.toast(`${GLYPH[status]} ${agentName(ended)} ${said} (${elapsed(ended, at)})`)
      if (hasSound) void $.audio.play({ asset: 'sounds/done.wav' }).catch(() => undefined)
    }
    await showStatus($)

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    const { tokens, window, percent } = e.context
    if (e.changed.includes('context') && tokens !== undefined && percent !== undefined) {
      await update($, context, () => ({ tokens, window, percent }))
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const table = $.ui.resolve(e)
    const { Box, Button, Text } = table
    // The terminal draws no Svg: there the logo is a colored glyph.
    const Svg = 'Svg' in table ? table.Svg : undefined
    const list = await read($, agents)
    const touched = await read($, files)
    const shown = await read($, tab)
    const at = await read($, now)
    const runs = await read($, history)
    const opened = await read($, expanded)
    const diffs = await read($, openDiffs)
    const rows = ordered(list)
    const fillLine = contextLine(await read($, context))
    const fillRow = fillLine !== undefined && <Text wrap="truncate-end">{fillLine}</Text>

    const logo = (agent: Agent, size: 'big' | 'small') =>
      Svg === undefined ? (
        <Text color={agent.color}>{size === 'big' ? '▟█▙' : '■'}</Text>
      ) : (
        <Svg
          source={logoSvg(agent.color)}
          alt={agentName(agent)}
          width={size === 'big' ? 24 : 14}
          height={size === 'big' ? 14 : 8}
        />
      )

    const agentRow = (agent: Agent, depth: number, fileList: readonly FileTouch[], key: string) => {
      const changedFiles = fileList.filter(f => f.agentIds.includes(agent.id) && isChanged(f)).length

      return (
        <Box key={key} flexDirection="column" paddingLeft={depth * 2}>
          <Box flexDirection="row" alignItems="center" gap={1}>
            {logo(agent, 'big')}
            <Text wrap="truncate-end">
              <Text color={COLOR[agent.status]}>{GLYPH[agent.status]} </Text>
              <Text bold>{agentName(agent)}</Text>
              {agent.type !== '' && <Text dimColor> · {agent.type}</Text>}
            </Text>
          </Box>
          <Text dimColor wrap="truncate-end">
            {'  '}
            {WORD[agent.status]} · {elapsed(agent, at)} · {agent.calls} {agent.calls === 1 ? 'Tool' : 'Tools'}
            {agent.advisor > 0 && ` · ${agent.advisor}× Advisor`}
            {changedFiles > 0 && ` · ${changedFiles} ${changedFiles === 1 ? 'Datei' : 'Dateien'} geändert`}
          </Text>
          {agent.running.map(call => {
            // A call running longer than the set limit may be stuck.
            const isStalled = stallMs > 0 && at - call.startedAt >= stallMs

            return (
              <Text wrap="truncate-end">
                {'  ▸ '}
                <Text color={isStalled ? 'warning' : 'claude'}>{call.tool}</Text>
                {call.detail !== '' && <Text dimColor> {call.detail}</Text>}
                {isStalled && <Text color="warning"> ⏳ seit {clock(at - call.startedAt)}</Text>}
              </Text>
            )
          })}
          {agent.status === 'running' && agent.running.length === 0 && (
            <Text dimColor italic>
              {'  '}denkt nach …
            </Text>
          )}
        </Box>
      )
    }

    const conflicts = touched.filter(isConflict).length

    // The widget: one line per agent, readable at a glance, nothing to click.
    if (e.props.placement === 'widget') {
      const glance = rows.slice(0, WIDGET_ROWS)
      const more = rows.length - glance.length

      return (
        <Box flexDirection="column">
          {fillRow}
          {glance.length === 0 && <Text dimColor>Noch keine Aktivität.</Text>}
          {glance.map(({ agent }) => {
            const call = agent.running[agent.running.length - 1]
            const doing =
              call !== undefined ? call.tool : agent.status === 'running' ? 'denkt nach …' : WORD[agent.status]

            return (
              <Box key={agent.id} flexDirection="row" alignItems="center" gap={1}>
                {logo(agent, 'small')}
                <Text wrap="truncate-end">
                  <Text color={COLOR[agent.status]}>{GLYPH[agent.status]} </Text>
                  <Text bold>{agentName(agent)}</Text>
                  <Text dimColor>
                    {' '}
                    · {elapsed(agent, at)} · {doing}
                    {agent.advisor > 0 && ` · ${agent.advisor}× Advisor`}
                  </Text>
                </Text>
              </Box>
            )
          })}
          {more > 0 && <Text dimColor>+ {more} weitere</Text>}
          {conflicts > 0 && (
            <Text color="error">
              ⚠ {conflicts} {conflicts === 1 ? 'Datei' : 'Dateien'} im Konflikt
            </Text>
          )}
        </Box>
      )
    }

    const tabs = (
      <Box flexDirection="row" gap={1}>
        <Button
          key="tab-agents"
          label={`Agenten (${rows.length})`}
          variant={shown === 'agents' ? 'primary' : 'secondary'}
          onPress={() => update($, tab, () => 'agents')}
        />
        <Button
          key="tab-files"
          label={`Dateien (${touched.length})${conflicts > 0 ? ' ⚠' : ''}`}
          variant={shown === 'files' ? 'primary' : 'secondary'}
          onPress={() => update($, tab, () => 'files')}
        />
      </Box>
    )

    if (shown === 'files') {
      const byId = new Map(list.map(a => [a.id, a]))
      // Conflicts first, then changed files, then the most recently touched.
      const sorted = [...touched].sort(
        (a, b) =>
          Number(isConflict(b)) - Number(isConflict(a)) ||
          Number(isChanged(b)) - Number(isChanged(a)) ||
          b.lastAt - a.lastAt,
      )

      return (
        <Box flexDirection="column" gap={1}>
          {tabs}
          {sorted.length === 0 && <Text dimColor>Seit dem letzten Prompt wurde keine Datei angefasst.</Text>}
          {sorted.map(file => {
            const changed = isChanged(file)
            const conflict = isConflict(file)
            const parts = [
              file.writes > 0 ? `${file.writes}× geschrieben` : '',
              file.edits > 0 ? `${file.edits}× bearbeitet` : '',
              file.reads > 0 ? `${file.reads}× gelesen` : '',
            ].filter(part => part !== '')
            const folder = file.path.split('/').slice(-3, -1).join('/')

            return (
              <Box key={file.path} flexDirection="column">
                <Box flexDirection="row" alignItems="center" gap={1}>
                  <Text color={conflict ? 'error' : changed ? 'warning' : 'inactive'}>
                    {conflict ? '⚠' : changed ? '✎' : '·'}
                  </Text>
                  <Text bold={changed} color={conflict ? 'error' : undefined} wrap="truncate-end">
                    {fileName(file.path)}
                    {folder !== '' && <Text dimColor> {folder}/</Text>}
                  </Text>
                </Box>
                <Box flexDirection="row" alignItems="center" gap={1} paddingLeft={2}>
                  {file.agentIds.map(id => {
                    const agent = byId.get(id)
                    return agent === undefined ? null : logo(agent, 'small')
                  })}
                  <Text dimColor wrap="truncate-end">{parts.join(' · ')}</Text>
                  {file.changes.length > 0 && (
                    <Button
                      key={`diff-${file.path}`}
                      label={diffs.includes(file.path) ? 'Diff ▾' : 'Diff ▸'}
                      variant="secondary"
                      onPress={() =>
                        update($, openDiffs, paths =>
                          paths.includes(file.path) ? paths.filter(p => p !== file.path) : [...paths, file.path],
                        )
                      }
                    />
                  )}
                </Box>
                {diffs.includes(file.path) &&
                  file.changes.map(change => {
                    const by = byId.get(change.agentId)
                    return (
                      <Box flexDirection="column" paddingLeft={2}>
                        <Text dimColor wrap="truncate-end">
                          {change.kind === 'write' ? 'geschrieben' : 'bearbeitet'} von{' '}
                          {by === undefined ? 'Agent' : agentName(by)}
                        </Text>
                        {change.removed.map(line => (
                          <Text color="error" wrap="truncate-end">
                            - {line}
                          </Text>
                        ))}
                        {change.added.map(line => (
                          <Text color="success" wrap="truncate-end">
                            + {line}
                          </Text>
                        ))}
                        {change.isCut && <Text dimColor>… gekürzt</Text>}
                      </Box>
                    )
                  })}
                {conflict && (
                  <Text color="error" wrap="truncate-end">
                    {'  '}Konflikt: {file.editorIds.length} Agenten haben diese Datei geändert
                  </Text>
                )}
              </Box>
            )
          })}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" gap={1}>
        {fillRow}
        {tabs}
        {rows.length === 0 && <Text dimColor>Noch keine Aktivität.</Text>}
        {rows.map(({ agent, depth }) => agentRow(agent, depth, touched, agent.id))}
        {runs.length > 0 && (
          <Text dimColor bold>
            Frühere Prompts
          </Text>
        )}
        {runs.map(run => {
          const isOpen = opened.includes(run.id)
          const runRows = ordered(run.agents)
          const main = run.agents.find(a => a.id === MAIN)
          const changed = run.files.filter(isChanged).length
          const summary = [
            `${runRows.length} ${runRows.length === 1 ? 'Agent' : 'Agenten'}`,
            changed > 0 ? `${changed} ${changed === 1 ? 'Datei' : 'Dateien'} geändert` : '',
            main !== undefined ? elapsed(main, at) : '',
          ].filter(part => part !== '')

          return (
            <Box key={run.id} flexDirection="column">
              <Button
                key={run.id}
                label={`${isOpen ? '▾' : '▸'} „${run.prompt || '…'}“ · ${summary.join(' · ')}`}
                variant="secondary"
                onPress={() =>
                  update($, expanded, ids => (ids.includes(run.id) ? ids.filter(id => id !== run.id) : [...ids, run.id]))
                }
              />
              {isOpen && runRows.map(({ agent, depth }) => agentRow(agent, depth + 1, run.files, `${run.id}-${agent.id}`))}
            </Box>
          )
        })}
      </Box>
    )
  })
}
