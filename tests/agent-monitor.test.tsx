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

const SPAWN = {
  tool_use_id: 'tu',
  prompt: 'p',
  subagentType: 'general-purpose',
  provider: { plugin: 'engine', tier: 'core' },
  parentModel: 'opus',
  background: false,
  fork: false,
} as const

test('two agents changing one file is a conflict: a toast, a red row, and a mark on the tab', async ($, on) => {
  mock.clock(on)
  const toasts: string[] = []
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.status', () => ({ value: undefined }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('tool.call', () => ({ result: {} }))
  let next = 0
  on('agent.spawn', () => ({ model: 'haiku', agentId: `a${++next}` }))

  await $.turn.start({ text: 'los', turnId: 't1' })
  await $.agent.spawn({ ...SPAWN, description: 'Login umbauen' })
  await $.agent.spawn({ ...SPAWN, description: 'Session umbauen' })
  // Reading alongside is no conflict; the second edit is.
  await $.tool.call({ tool: 'Edit', file_path: '/repo/auth.ts', old_string: 'a', new_string: 'b', agentId: 'a1' })
  await $.tool.call({ tool: 'Read', file_path: '/repo/auth.ts', agentId: 'a2' })
  expect(toasts).toEqual([])
  await $.tool.call({ tool: 'Edit', file_path: '/repo/auth.ts', old_string: 'c', new_string: 'd', agentId: 'a2' })
  await $.tool.call({ tool: 'Edit', file_path: '/repo/auth.ts', old_string: 'e', new_string: 'f', agentId: 'a1' })
  expect(toasts).toEqual(['⚠ auth.ts wird von 2 Agenten geändert'])

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ key: 'tab-files' }))?.text).toBe('Dateien (1) ⚠')
    await ui.press({ key: 'tab-files' })
    expect((await ui.find({ type: 'Text', text: /Konflikt/ }))?.text).toBe('  Konflikt: 2 Agenten haben diese Datei geändert')
    await ui.press({ key: 'tab-agents' })
    await ui.unmount()
  }
})

test('a finished subagent is announced and the status line follows what runs', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const toasts: string[] = []
  const status: (string | undefined)[] = []
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.status', (_, e) => {
    status.push(e.text)
    return { value: undefined }
  })
  on('command.register', () => ({ value: { command: 'agenten' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('agent.spawn', () => ({ model: 'haiku', agentId: 'a1' }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.turn.start({ text: 'los', turnId: 't1' })
  await $.agent.spawn({ ...SPAWN, description: 'Tests schreiben' })
  await clock.advance(42_000)
  expect(status.at(-1)).toBe('● 2 Agenten laufen · 0:42')

  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't2', agentId: 'a1', reason: 'answer' })
  expect(toasts).toEqual(['✓ Tests schreiben fertig (0:42)'])
  expect(status.at(-1)).toBe('● 1 Agent läuft · 0:42')

  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't3', reason: 'answer' })
  expect(status.at(-1)).toBeUndefined()
  // The main agent ending says nothing: the answer is there to read.
  expect(toasts).toHaveLength(1)
})

test('earlier prompts stay below, folded, and open on a press', async ($, on) => {
  mock.clock(on, { now: 1_000 })
  on('ui.toast', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('tool.call', () => ({ result: {} }))
  on('agent.spawn', () => ({ model: 'haiku', agentId: 'a1' }))

  await $.turn.start({ text: 'Bau den Login\nmit Details', turnId: 't1' })
  await $.agent.spawn({ ...SPAWN, description: 'Login bauen' })
  await $.tool.call({ tool: 'Write', file_path: '/repo/login.ts', content: 'x', agentId: 'a1' })
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't2', agentId: 'a1', reason: 'answer' })
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't3', reason: 'answer' })
  await $.turn.start({ text: 'weiter', turnId: 't4' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const folded = await ui.find({ type: 'Button', text: /Bau den Login/ })
    expect(folded?.text).toBe('▸ „Bau den Login“ · 2 Agenten · 1 Datei geändert · 0:00')
    expect(await ui.find({ type: 'Text', text: /Login bauen/ })).toBeUndefined()
    await ui.press({ key: folded?.key ?? '' })
    expect((await ui.find({ type: 'Text', text: /Login bauen/ }))?.text).toBe('✓ Login bauen · general-purpose')
    await ui.press({ key: folded?.key ?? '' })
    await ui.unmount()
  }
})

test('with no history kept, earlier prompts are gone', { options: { historySize: 0 } }, async ($, on) => {
  mock.clock(on)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  await $.turn.start({ text: 'eins', turnId: 't1' })
  await $.turn.start({ text: 'zwei', turnId: 't2' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /Frühere/ })).toBeUndefined()
  await ui.unmount()
})

test('a call running past the limit is marked as maybe stuck', { options: { stallSeconds: 60 } }, async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  on('command.register', () => ({ value: { command: 'agenten' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.status', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
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
  const call = $.tool.call({ tool: 'Bash', command: 'npm install' })
  await clock.advance(30_000)
  const early = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await early.find({ type: 'Text', text: /⏳/ })).toBeUndefined()
  await early.unmount()

  await clock.advance(35_000)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /npm install/ }))?.text).toBe('  ▸ Bash npm install ⏳ seit 1:05')
  await ui.unmount()
  release()
  await call
})

test('with the sound on, a finished subagent plays it', { options: { sound: true } }, async ($, on) => {
  mock.clock(on)
  const played: string[] = []
  on('audio.play', (_, e) => {
    played.push(String(e.clip.asset))
    return { value: undefined }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('agent.spawn', () => ({ model: 'haiku', agentId: 'a1' }))

  await $.turn.start({ text: 'los', turnId: 't1' })
  await $.agent.spawn({ ...SPAWN, description: 'Suchen' })
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't2', agentId: 'a1', reason: 'answer' })
  expect(played).toEqual(['sounds/done.wav'])
})
