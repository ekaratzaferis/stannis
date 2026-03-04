/**
 * Complex single-thread orchestrator integration test.
 *
 * Simulates a "job queue" where the same process acts as both the scheduler
 * and the orchestrator. The orchestrator keeps calling run() in a loop,
 * handling break tokens automatically until the flow completes.
 *
 * Workflow under test:
 *
 *   sequence:
 *     task 'init'      (add1)
 *     task 'fetchData' (add1, break: true)   ← pause 1
 *     task 'processA'  (add1)
 *     parallel (sync):
 *       task 'sideA'   (add1)
 *       task 'sideB'   (double)
 *     decision 'check' (loop-once → 'processA')  ← FSM backward jump on first pass
 *     task 'finalize'  (static-value, break: true) ← pause 2
 *     task 'done'      (static-value)
 *
 * Execution trace across orchestrator calls:
 *
 *   call 1: init → fetchData (break)
 *   call 2: skip init+fetchData → processA → sideA+sideB → check (goTo processA)
 *             → [re-dispatch from root] → skip init+fetchData → processA → sideA+sideB
 *             → check (next:true) → finalize (break)
 *   call 3: skip init..finalize → done → completed
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createStannis } from '../src/index.js'
import { createMemStore } from './memstore.js'

// Orchestrate a flow to completion by re-running on every break.
// This is the pattern a real Lambda/SQS handler would implement:
// on each invocation, resume from where we left off (root dispatch).
async function orchestrate(w, maxRuns = 20) {
  let result = await w.run()
  let runs = 1

  while (result.status === 'broken') {
    if (runs >= maxRuns) throw new Error(`orchestrate: exceeded ${maxRuns} runs (infinite loop?)`)

    if (Array.isArray(result.token)) {
      // async-parallel branches: resume each one individually
      for (const token of result.token) {
        await w.run({ flowId: token.flowId, nodeId: token.nodeId })
        runs++
      }
      // Then one final run from root to let the sequence continue past the parallel
      result = await w.run({ flowId: result.flowId })
    } else {
      // Sequential break: re-dispatch from root (sequence naturally skips completed nodes)
      result = await w.run({ flowId: result.flowId })
    }
    runs++
  }

  return { result, runs }
}

test('orchestrator: drives complex workflow to completion across multiple runs', async () => {
  const { reset } = await import('./decisions/loop-once.js')
  reset()
  process.env.LOOP_TARGET = 'processA'

  const storage = createMemStore()
  const w = createStannis({
    definition: {
      type: 'sequence',
      nodes: [
        { id: 'init',      type: 'task', service: './test/services/add1.js' },
        { id: 'fetchData', type: 'task', service: './test/services/add1.js', break: true },
        { id: 'processA',  type: 'task', service: './test/services/add1.js' },
        {
          id: 'par1',
          type: 'parallel',
          nodes: [
            { id: 'sideA', type: 'task', service: './test/services/add1.js' },
            { id: 'sideB', type: 'task', service: './test/services/double.js' },
          ],
        },
        { id: 'check',    type: 'decision', service: './test/decisions/loop-once.js' },
        { id: 'finalize', type: 'task', service: './test/services/static-value.js', break: true },
        { id: 'done',     type: 'task', service: './test/services/static-value.js' },
      ],
    },
    storage,
  })

  const { result, runs } = await orchestrate(w)
  delete process.env.LOOP_TARGET

  assert.equal(result.status, 'completed', `expected completed but got ${result.status}`)
  assert.ok(runs <= 10, `expected at most 10 orchestrator runs, got ${runs}`)

  // All meaningful nodes should appear in history
  assert.ok(result.history['init'],      'init should be in history')
  assert.ok(result.history['fetchData'], 'fetchData should be in history')
  assert.ok(result.history['processA'],  'processA should be in history (ran twice via FSM)')
  assert.ok(result.history['sideA'],     'sideA should be in history')
  assert.ok(result.history['sideB'],     'sideB should be in history')
  assert.ok(result.history['finalize'],  'finalize should be in history')
  assert.ok(result.history['done'],      'done should be in history')

  // Verify final node state
  const state = await storage.get(`stannis:${result.flowId}`)
  assert.equal(state.nodeStates['init'].status,      'completed')
  assert.equal(state.nodeStates['fetchData'].status,  'completed')
  assert.equal(state.nodeStates['processA'].status,   'completed')
  assert.equal(state.nodeStates['sideA'].status,      'completed')
  assert.equal(state.nodeStates['sideB'].status,      'completed')
  assert.equal(state.nodeStates['check'].status,      'completed')
  assert.equal(state.nodeStates['finalize'].status,   'completed')
  assert.equal(state.nodeStates['done'].status,       'completed')
})

test('orchestrator: handles multiple sequential breaks correctly', async () => {
  const storage = createMemStore()
  const w = createStannis({
    definition: {
      type: 'sequence',
      nodes: [
        { id: 'a', type: 'task', service: './test/services/add1.js' },
        { id: 'b', type: 'task', service: './test/services/add1.js', break: true },
        { id: 'c', type: 'task', service: './test/services/add1.js', break: true },
        { id: 'd', type: 'task', service: './test/services/add1.js', break: true },
        { id: 'e', type: 'task', service: './test/services/add1.js' },
      ],
    },
    storage,
  })

  const { result, runs } = await orchestrate(w)

  assert.equal(result.status, 'completed')
  assert.equal(runs, 4, 'should take exactly 4 runs: initial + 3 resumes')

  // add1 chains: 0→1→2→3→4→5
  assert.deepEqual(result.history['a'], { value: 1 })
  assert.deepEqual(result.history['b'], { value: 2 })
  assert.deepEqual(result.history['c'], { value: 3 })
  assert.deepEqual(result.history['d'], { value: 4 })
  assert.deepEqual(result.history['e'], { value: 5 })
})

test('orchestrator: handles sync parallel inside sequence', async () => {
  const storage = createMemStore()
  const w = createStannis({
    definition: {
      type: 'sequence',
      nodes: [
        { id: 'pre',  type: 'task', service: './test/services/add1.js', break: true },
        {
          id: 'par',
          type: 'parallel',
          nodes: [
            { id: 'pa', type: 'task', service: './test/services/static-value.js' },
            { id: 'pb', type: 'task', service: './test/services/static-value.js' },
          ],
        },
        { id: 'post', type: 'task', service: './test/services/add1.js' },
      ],
    },
    storage,
  })

  const { result, runs } = await orchestrate(w)

  assert.equal(result.status, 'completed')
  assert.equal(runs, 2, 'pre breaks, then resumes to parallel+post')
  assert.ok(result.history['pre'])
  assert.ok(result.history['pa'])
  assert.ok(result.history['pb'])
  assert.ok(result.history['post'])
})
