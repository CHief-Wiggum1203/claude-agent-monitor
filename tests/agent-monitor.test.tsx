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
