/**
 * Extra unit tests — 10 cases targeting uncovered branches and edge scenarios.
 *
 * Covers:
 *  - validateDefinition error paths (unknown type, missing service, bad retry, empty nodes)
 *  - task module-not-found error path
 *  - exhausted retries
 *  - executionCount tracking across retries
 *  - resume with invalid flowId / nodeId
 *  - decision forward goTo (real implementation, not placeholder)
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createStannis } from '../src/index.js'
import { createMemStore } from './memstore.js'

// ─── 1. Validate: unknown node type ────────────────────────────────────────

test('validate: unknown node type throws', () => {
  assert.throws(
    () => createStannis({
      definition: { type: 'banana', service: './test/services/add1.js' },
      storage: createMemStore(),
    }),
    /Unknown node type/
  )
})

// ─── 2. Validate: task without service ─────────────────────────────────────

test('validate: task missing service throws', () => {
  assert.throws(
    () => createStannis({
      definition: { type: 'task' },
      storage: createMemStore(),
    }),
    /must have a "service"/
  )
})

// ─── 3. Validate: retry.times < 1 ──────────────────────────────────────────

test('validate: retry.times < 1 throws', () => {
  assert.throws(
    () => createStannis({
      definition: { type: 'task', service: './test/services/add1.js', retry: { times: 0 } },
      storage: createMemStore(),
    }),
    /retry\.times must be a positive number/
  )
})

// ─── 4. Validate: empty nodes array in sequence ─────────────────────────────

test('validate: empty nodes array throws', () => {
  assert.throws(
    () => createStannis({
      definition: { type: 'sequence', nodes: [] },
      storage: createMemStore(),
    }),
    /must have a non-empty/
  )
})

// ─── 5. Task: module not found breaks flow immediately ──────────────────────
// Covers task.js lines 34-41 (module-load error path)

test('task: module not found breaks flow immediately', async () => {
  const storage = createMemStore()
  const w = createStannis({
    definition: {
      type: 'sequence',
      nodes: [
        { id: 'good', type: 'task', service: './test/services/add1.js' },
        { id: 'bad',  type: 'task', service: './test/services/does-not-exist.js' },
        { id: 'after', type: 'task', service: './test/services/add1.js' },
      ],
    },
    storage,
  })

  const result = await w.run()

  assert.equal(result.status, 'broken')
  assert.ok(result.history['good'], 'node before bad should have run')
  assert.equal(result.history['after'], undefined, 'node after bad should not have run')

  const state = await storage.get(`stannis:${result.flowId}`)
  assert.equal(state.nodeStates['bad'].status, 'broken')
  assert.ok(state.nodeStates['bad'].error, 'should have an error message')
})

// ─── 6. Task: exhausted retries breaks the flow ─────────────────────────────
// Covers the always-failing path (retry exhausted). Uses always-error.js.

test('task: exhausted retries breaks the flow after N attempts', async () => {
  const storage = createMemStore()
  const w = createStannis({
    definition: {
      type: 'sequence',
      nodes: [
        { id: 'before', type: 'task', service: './test/services/add1.js' },
        {
          id: 'alwaysFails',
          type: 'task',
          service: './test/services/always-error.js',
          retry: { times: 2, backoff: 0 },
        },
        { id: 'after', type: 'task', service: './test/services/add1.js' },
      ],
    },
    storage,
  })

  const result = await w.run()

  assert.equal(result.status, 'broken')
  assert.ok(result.history['before'], 'before should have completed')
  assert.equal(result.history['after'], undefined, 'after should not have run')

  const state = await storage.get(`stannis:${result.flowId}`)
  assert.equal(state.nodeStates['alwaysFails'].status, 'broken')
  assert.equal(state.nodeStates['alwaysFails'].error, 'permanent failure')
})

// ─── 7. Task: executionCount is tracked across retries ──────────────────────

test('task: executionCount reflects total attempts after retries', async () => {
  const storage = createMemStore()
  const w = createStannis({
    definition: {
      type: 'task',
      id: 'alwaysFails',
      service: './test/services/always-error.js',
      retry: { times: 2, backoff: 0 },
    },
    storage,
  })

  const result = await w.run()
  assert.equal(result.status, 'broken')

  const state = await storage.get(`stannis:${result.flowId}`)
  // 1 original attempt + 2 retries = 3 total
  assert.equal(state.nodeStates['alwaysFails'].executionCount, 3)
})

// ─── 8. Resume: flowId not found throws ─────────────────────────────────────

test('resume: throws if flowId not found in storage', async () => {
  const storage = createMemStore()
  const w = createStannis({
    definition: { type: 'task', service: './test/services/add1.js' },
    storage,
  })

  await assert.rejects(
    () => w.run({ flowId: 'nonexistent-flow-id' }),
    /No state found for flowId/
  )
})

// ─── 9. Resume: nodeId not in definition throws ─────────────────────────────

test('resume: throws if resume nodeId is not in definition', async () => {
  const storage = createMemStore()
  const w = createStannis({
    definition: {
      type: 'sequence',
      nodes: [
        { id: 's1', type: 'task', service: './test/services/add1.js', break: true },
        { id: 's2', type: 'task', service: './test/services/add1.js' },
      ],
    },
    storage,
  })

  const r1 = await w.run()
  assert.equal(r1.status, 'broken')

  await assert.rejects(
    () => w.run({ flowId: r1.flowId, nodeId: 'no-such-node' }),
    /not found/
  )
})

// ─── 10. Decision: forward goTo — real test ─────────────────────────────────
// Covers the placeholder in decision.test.js.
// goto-forward.js reads target from process.env.GOTO_TARGET.

test('decision: forward goTo skips intermediate nodes and runs target', async () => {
  process.env.GOTO_TARGET = 'target'

  const storage = createMemStore()
  const w = createStannis({
    definition: {
      type: 'sequence',
      nodes: [
        { id: 'first',  type: 'task', service: './test/services/add1.js' },
        { id: 'jump',   type: 'decision', service: './test/decisions/goto-forward.js' },
        { id: 'skip1',  type: 'task', service: './test/services/add1.js' },
        { id: 'skip2',  type: 'task', service: './test/services/add1.js' },
        { id: 'target', type: 'task', service: './test/services/static-value.js' },
      ],
    },
    storage,
  })

  const result = await w.run()
  delete process.env.GOTO_TARGET

  assert.equal(result.status, 'completed')
  assert.ok(result.history['first'],  'first should have run')
  assert.ok(result.history['target'], 'target should have run')
  assert.equal(result.history['skip1'], undefined, 'skip1 should not be in history')
  assert.equal(result.history['skip2'], undefined, 'skip2 should not be in history')

  const state = await storage.get(`stannis:${result.flowId}`)
  assert.equal(state.nodeStates['skip1'].status, 'skipped')
  assert.equal(state.nodeStates['skip2'].status, 'skipped')
})
