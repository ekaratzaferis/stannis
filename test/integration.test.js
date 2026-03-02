import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createStannis } from '../src/index.js'
import { createMemStore } from './memstore.js'

test('integration: sequential break-and-resume across two run() calls', async () => {
  const storage = createMemStore()
  const w = createStannis({
    definition: {
      type: 'sequence',
      nodes: [
        { id: 'step1', type: 'task', service: './test/services/add1.js' },
        { id: 'step2', type: 'task', service: './test/services/add1.js', break: true },
        { id: 'step3', type: 'task', service: './test/services/add1.js' },
        { id: 'step4', type: 'task', service: './test/services/add1.js' },
      ],
    },
    storage,
  })

  // First run: executes step1 and step2, then breaks
  const r1 = await w.run()
  assert.equal(r1.status, 'broken')
  assert.ok(r1.history['step1'])
  assert.ok(r1.history['step2'])
  assert.equal(r1.history['step3'], undefined)

  // Resume from step3
  const r2 = await w.run({ flowId: r1.flowId, nodeId: 'step3' })
  assert.equal(r2.status, 'completed')
  assert.ok(r2.history['step3'])
  assert.ok(r2.history['step4'])
})

test('integration: parallel async — three tokens, three separate resumes', async () => {
  const storage = createMemStore()
  const w = createStannis({
    definition: {
      type: 'parallel',
      async: true,
      nodes: [
        { id: 'branch1', type: 'task', service: './test/services/add1.js' },
        { id: 'branch2', type: 'task', service: './test/services/add1.js' },
        { id: 'branch3', type: 'task', service: './test/services/add1.js' },
      ],
    },
    storage,
  })

  // Initial: returns 3 tokens
  const r0 = await w.run()
  assert.equal(r0.status, 'broken')
  assert.equal(r0.token.length, 3)

  const tokens = r0.token

  // Resume each branch
  await w.run({ flowId: r0.flowId, nodeId: 'branch1' })
  await w.run({ flowId: r0.flowId, nodeId: 'branch2' })
  const final = await w.run({ flowId: r0.flowId, nodeId: 'branch3' })

  // After all three resume, parallel should be complete
  assert.ok(final.history['branch1'])
  assert.ok(final.history['branch2'])
  assert.ok(final.history['branch3'])
})

test('integration: goTo backward loop (FSM)', async () => {
  const { reset } = await import('./decisions/loop-once.js')
  reset()
  process.env.LOOP_TARGET = 'loopStart'

  const storage = createMemStore()
  const w = createStannis({
    definition: {
      type: 'sequence',
      nodes: [
        { id: 'loopStart', type: 'task', service: './test/services/add1.js' },
        { type: 'decision', service: './test/decisions/loop-once.js' },
        { id: 'loopEnd', type: 'task', service: './test/services/static-value.js' },
      ],
    },
    storage,
  })

  const result = await w.run()
  delete process.env.LOOP_TARGET

  assert.equal(result.status, 'completed')
  assert.ok(result.history['loopEnd'])
  // loopStart ran twice — its output in history is the last one
  assert.ok(result.history['loopStart'])
})

test('integration: goTo forward skips intermediate nodes', async () => {
  process.env.GOTO_TARGET = 'finalNode'

  const storage = createMemStore()
  const w = createStannis({
    definition: {
      type: 'sequence',
      nodes: [
        { id: 'startNode', type: 'task', service: './test/services/add1.js' },
        { type: 'decision', service: './test/decisions/goto-forward.js' },
        { id: 'skipped1', type: 'task', service: './test/services/add1.js' },
        { id: 'skipped2', type: 'task', service: './test/services/add1.js' },
        { id: 'finalNode', type: 'task', service: './test/services/static-value.js' },
      ],
    },
    storage,
  })

  const result = await w.run()
  delete process.env.GOTO_TARGET

  assert.equal(result.status, 'completed')
  assert.ok(result.history['startNode'])
  assert.ok(result.history['finalNode'])
  assert.equal(result.history['skipped1'], undefined)
  assert.equal(result.history['skipped2'], undefined)

  // Verify skipped nodes are marked as skipped
  const state = await storage.get(`stannis:${result.flowId}`)
  assert.equal(state.nodeStates['skipped1'].status, 'skipped')
  assert.equal(state.nodeStates['skipped2'].status, 'skipped')
})

test('integration: unhandled throw immediately breaks', async () => {
  const storage = createMemStore()
  const w = createStannis({
    definition: {
      type: 'sequence',
      nodes: [
        { id: 'before', type: 'task', service: './test/services/add1.js' },
        { id: 'thrower', type: 'task', service: './test/services/fail.js' },
        { id: 'after', type: 'task', service: './test/services/add1.js' },
      ],
    },
    storage,
  })

  const result = await w.run()
  assert.equal(result.status, 'broken')
  assert.ok(result.history['before'])
  assert.equal(result.history['after'], undefined)

  const state = await storage.get(`stannis:${result.flowId}`)
  assert.equal(state.nodeStates['thrower'].status, 'broken')
  assert.ok(state.nodeStates['thrower'].error.includes('deliberate failure'))
})

test('integration: decision returning neither next nor goTo throws', async () => {
  const storage = createMemStore()
  const w = createStannis({
    definition: {
      type: 'decision',
      service: './test/decisions/invalid.js',
    },
    storage,
  })

  await assert.rejects(
    () => w.run(),
    /must return \{ next \} or \{ goTo \}/
  )
})

test('integration: complex nested workflow completes', async () => {
  const storage = createMemStore()
  const w = createStannis({
    definition: {
      type: 'sequence',
      nodes: [
        { id: 'init', type: 'task', service: './test/services/add1.js' },
        {
          type: 'parallel',
          nodes: [
            {
              type: 'sequence',
              nodes: [
                { id: 'p1a', type: 'task', service: './test/services/add1.js' },
                { id: 'p1b', type: 'task', service: './test/services/double.js' },
              ],
            },
            { id: 'p2', type: 'task', service: './test/services/static-value.js' },
          ],
        },
        { id: 'fin', type: 'task', service: './test/services/static-value.js' },
      ],
    },
    storage,
  })

  const result = await w.run()
  assert.equal(result.status, 'completed')
  assert.ok(result.history['init'])
  assert.ok(result.history['p1a'])
  assert.ok(result.history['p1b'])
  assert.ok(result.history['p2'])
  assert.ok(result.history['fin'])
})
