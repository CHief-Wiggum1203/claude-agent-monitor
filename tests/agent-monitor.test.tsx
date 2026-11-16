import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'agent-monitor',
  component: 'Pane',
  requestId: 'agent-monitor',
  props: {
    title: 'Agenten live',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const SURFACES = ['terminal', 'desktop', 'vscode', 'mobile'] as const

test('a subagent and its running tool show under the main agent, then finish', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })
  on('command.register', () => ({ value: { command: 'agenten' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('agent.spawn', () => ({ model: 'haiku', agentId: 'a1' }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  let release = () => {}
  const gate = new Promise<void>(resolve => {
    release = resolve
  })
  on('tool.call', async () => {
    await gate

    return { result: {} }
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.turn.start({ text: 'los', turnId: 't1' })
  await $.agent.spawn({
    tool_use_id: 'tu1',
    prompt: 'suche',
    description: 'Auth-Code finden',
    subagentType: 'Explore',
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'opus',
    background: false,
    fork: false,
  })
  const call = $.tool.call({ tool: 'Bash', command: 'npm test\nmore', agentId: 'a1' })
  await clock.advance(5_000)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /Hauptagent/ }))?.text).toBe('● Hauptagent')
    expect((await ui.find({ type: 'Text', text: /Auth-Code/ }))?.text).toBe('● Auth-Code finden · Explore')
    expect((await ui.find({ type: 'Text', text: /npm test/ }))?.text).toBe('  ▸ Bash npm test')
    expect((await ui.find({ type: 'Text', text: /0:05 · 0 Tools/ }))?.text).toBe('  läuft · 0:05 · 0 Tools')
    expect((await ui.find({ type: 'Text', text: /1 Tool$/ }))?.text).toBe('  läuft · 0:05 · 1 Tool')
    await ui.unmount()
  }

  release()
  await call
  await $.turn.complete({ answer: 'ok', durationMs: 6_000, isAborted: false, turnId: 't2', agentId: 'a1', reason: 'answer' })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /Auth-Code/ }))?.text).toBe('✓ Auth-Code finden · Explore')
  expect(await ui.find({ type: 'Text', text: /npm test/ })).toBeUndefined()
  await ui.unmount()

  // The next prompt clears the finished subagent away.
  await $.turn.start({ text: 'weiter', turnId: 't3' })
  const next = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await next.find({ type: 'Text', text: /Auth-Code/ })).toBeUndefined()
  await next.unmount()
})

test('a loop no spawn named (a compaction) is never drawn', async ($, on) => {
  mock.clock(on)
  on('tool.call', () => ({ result: {} }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))

  await $.turn.start({ text: 'los', turnId: 't1' })
  await $.tool.call({ tool: 'Bash', command: 'ls', agentId: 'fork-1' })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /Subagent/ })).toBeUndefined()
  await ui.unmount()
})

test('the pane says so before anything ran', async ($, on) => {
  mock.clock(on)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text' }))?.text).toBe('Noch keine Aktivität.')
  await ui.unmount()
})

test('the files tab lists what the agents touched, changed files first', async ($, on) => {
  mock.clock(on, { now: 1_000 })
  on('tool.call', () => ({ result: {} }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))

  await $.turn.start({ text: 'los', turnId: 't1' })
  await $.tool.call({ tool: 'Read', file_path: '/repo/src/auth/login.ts' })
  await $.tool.call({ tool: 'Read', file_path: '/repo/src/auth/login.ts' })
  await $.tool.call({ tool: 'Edit', file_path: '/repo/src/auth/session.ts', old_string: 'a', new_string: 'b' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /1 Datei geändert/ }))?.text).toBe('  läuft · 0:00 · 3 Tools · 1 Datei geändert')
    await ui.press({ key: 'tab-files' })
    const first = await ui.find({ type: 'Text', text: /\.ts/ })
    expect(first?.text).toBe('session.ts src/auth/')
    expect((await ui.find({ type: 'Text', text: /bearbeitet/ }))?.text).toBe('1× bearbeitet')
    expect((await ui.find({ type: 'Text', text: /gelesen/ }))?.text).toBe('2× gelesen')
    await ui.press({ key: 'tab-agents' })
    await ui.unmount()
  }

  // A new prompt starts the list over.
  await $.turn.start({ text: 'weiter', turnId: 't2' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'tab-files' })
  expect((await ui.find({ type: 'Text', text: /keine Datei/ }))?.text).toBe('Seit dem letzten Prompt wurde keine Datei angefasst.')
  await ui.unmount()
})

test('a refused or failed file call is not counted as touching the file', async ($, on) => {
  mock.clock(on)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('tool.call', (_, e) =>
    e.tool === 'Write'
      ? { deny: 'no summary files' }
      : e.tool === 'Edit'
        ? { result: {}, isError: true, text: 'old_string not found' }
        : { result: {} },
  )

  await $.turn.start({ text: 'los', turnId: 't1' })
  await $.tool.call({ tool: 'Write', file_path: '/repo/summary.md', content: 'x' })
  await $.tool.call({ tool: 'Edit', file_path: '/repo/notes.md', old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'Read', file_path: '/repo/login.ts' })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'tab-files' })
  expect(await ui.find({ type: 'Text', text: /summary\.md/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /notes\.md/ })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /login\.ts/ }))?.text).toBe('login.ts /repo/')
  await ui.unmount()
})
