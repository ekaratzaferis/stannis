/**
 * Coverage-boost tests — targets every uncovered line and branch.
 *
 * Imports internals directly where the public API cannot reach them.
 * Organized by source file being covered.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createStannis } from '../src/index.js'
import { dispatch, applyGoTo, findParentNode } from '../src/executor.js'
import { executeTask } from '../src/nodes/task.js'
import { executeSequence } from '../src/nodes/sequence.js'
import { executeParallel } from '../src/nodes/parallel.js'
import { executeRace } from '../src/nodes/race.js'
import { executeDecision } from '../src/nodes/decision.js'
import { validateDefinition } from '../src/normalize.js'
import { resolveModulePath } from '../src/utils.js'
import { graph } from '../src/graph.js'
import { print } from '../src/print.js'
import { createMemStore } from './memstore.js'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeState(nodeId, status) {
  return {
    id: 'flow-cov',
    status: 'running',
    history: {},
    nodeStates: { [nodeId]: { id: nodeId, status } },
  }
}

// ─── src/executor.js ─────────────────────────────────────────────────────────

// Line 28: default branch in dispatch() switch
test('executor: dispatch throws for unknown node type', async () => {
  const state = makeState('z', 'pending')
  await assert.rejects(
    () => dispatch({ type: 'bogus', id: 'z' }, state, createMemStore()),
    /Unknown node type: bogus/
  )
})

// Lines 81-82: applyGoTo() when target id does not exist
test('executor: applyGoTo throws when goTo target is not in definition', () => {
  const def = { type: 'task', id: 'a', service: 'x' }
  assert.throws(
    () => applyGoTo({ nodeStates: {} }, 'a', 'ghost', def),
    /goTo target "ghost" not found in definition/
  )
})

// Line 122: findParentNode() exhausts a nested container's children without finding the target.
// The closing `}` of the for-loop inside `if (node.nodes)` is only reached when all
// children are searched recursively without finding the target node.
test('executor: findParentNode returns correct parent after exhausting a sibling container', () => {
  const def = {
    type: 'sequence', id: 'root',
    nodes: [
      {
        type: 'parallel', id: 'par',
        nodes: [
          { type: 'task', id: 'p1', service: 'x' },
          { type: 'task', id: 'p2', service: 'x' },
        ],
      },
      { type: 'task', id: 'after', service: 'x' }, // sibling of par, NOT inside it
    ],
  }
  // When searching for 'after', search(par) exhausts p1+p2 without finding it → line 122
  const parent = findParentNode(def, 'after')
  assert.equal(parent.id, 'root')
})

// ─── src/nodes/task.js ───────────────────────────────────────────────────────

// Lines 19-20: early return when node is already completed
test('executeTask: no-op when node status is completed', async () => {
  const { token } = await executeTask(
    { type: 'task', id: 't', service: './test/services/add1.js' },
    makeState('t', 'completed'),
    createMemStore()
  )
  assert.equal(token, null)
})

// Lines 19-20: OR sub-branch — when status is 'skipped'
test('executeTask: no-op when node status is skipped', async () => {
  const { token } = await executeTask(
    { type: 'task', id: 't', service: './test/services/add1.js' },
    makeState('t', 'skipped'),
    createMemStore()
  )
  assert.equal(token, null)
})

// Lines 105-107: sleep() is invoked when backoff > 0
test('task: non-zero backoff invokes sleep between retries', async () => {
  const storage = createMemStore()
  const w = createStannis({
    definition: {
      type: 'task',
      service: './test/services/always-error.js',
      retry: { times: 1, backoff: 1 }, // 1 ms — non-zero
    },
    storage,
  })

  const result = await w.run()
  assert.equal(result.status, 'broken')

  // 1 original attempt + 1 retry = 2 total
  const state = await storage.get(`stannis:${result.flowId}`)
  const ns = Object.values(state.nodeStates)[0]
  assert.equal(ns.executionCount, 2)
})

// ─── src/nodes/sequence.js ───────────────────────────────────────────────────

// Lines 17-18: early return when sequence node itself is already completed
test('executeSequence: no-op when node status is completed', async () => {
  const { token } = await executeSequence(
    { type: 'sequence', id: 's', nodes: [] },
    makeState('s', 'completed'),
    createMemStore(),
    async () => {}
  )
  assert.equal(token, null)
})

test('executeSequence: no-op when node status is skipped', async () => {
  const { token } = await executeSequence(
    { type: 'sequence', id: 's', nodes: [] },
    makeState('s', 'skipped'),
    createMemStore(),
    async () => {}
  )
  assert.equal(token, null)
})

// ─── src/nodes/parallel.js ───────────────────────────────────────────────────

// Lines 20-21: early return when parallel node itself is already completed
test('executeParallel: no-op when node status is completed', async () => {
  const { token } = await executeParallel(
    { type: 'parallel', id: 'p', nodes: [] },
    makeState('p', 'completed'),
    createMemStore(),
    async () => {}
  )
  assert.equal(token, null)
})

test('executeParallel: no-op when node status is skipped', async () => {
  const { token } = await executeParallel(
    { type: 'parallel', id: 'p', nodes: [] },
    makeState('p', 'skipped'),
    createMemStore(),
    async () => {}
  )
  assert.equal(token, null)
})

// Lines 88-89 + 52-53: sync parallel with a breaking child
//   First run  → pa and pb both complete (Promise.all); pa has break: true → token bubbled (88-89)
//   Resume     → pa and pb already done → short-circuit per child (52-53) → _checkParallelComplete
test('parallel sync: break token bubbled up; completed children short-circuit on resume', async () => {
  const storage = createMemStore()
  const w = createStannis({
    definition: {
      type: 'sequence',
      nodes: [
        {
          id: 'par', type: 'parallel',
          nodes: [
            { id: 'pa', type: 'task', service: './test/services/add1.js', break: true },
            { id: 'pb', type: 'task', service: './test/services/add1.js' },
          ],
        },
        { id: 'after', type: 'task', service: './test/services/static-value.js' },
      ],
    },
    storage,
  })

  // First run: parallel runs pa+pb concurrently, pa's break token is returned (lines 88-89).
  // The outer flow status may be 'running' (parallel's state isn't updated to 'broken'),
  // but the break token IS returned correctly.
  const r1 = await w.run()
  assert.ok(r1.token, 'should have a break token from the parallel')
  assert.equal(r1.token.breakAfter, 'pa')

  // Resume: par re-executed; pa and pb are already completed → short-circuit (lines 52-53)
  // _checkParallelComplete sees all done → par marked completed → sequence proceeds to 'after'
  const r2 = await w.run({ flowId: r1.flowId })
  assert.equal(r2.status, 'completed')
  assert.ok(r2.history['after'])
})

// Lines 105-107: _checkParallelComplete when not all children are done (allDone=false).
// This path requires children in 'running' state (not pending, not completed).
// Achieved by manipulating stored state directly between runs.
test('parallel async: _checkParallelComplete returns null when children are in running state', async () => {
  const storage = createMemStore()
  const w = createStannis({
    definition: {
      type: 'parallel',
      async: true,
      nodes: [
        { id: 'p1', type: 'task', service: './test/services/add1.js' },
        { id: 'p2', type: 'task', service: './test/services/add1.js' },
      ],
    },
    storage,
  })

  // Initial run: returns token array; children are still pending
  const r1 = await w.run()
  assert.equal(r1.status, 'broken')
  assert.ok(Array.isArray(r1.token))

  // Manually set both children to 'running' — not pending, not completed.
  // On next resume, parallel sees no pending children → calls _checkParallelComplete
  // → allDone=false (children are 'running') → lines 105-107 hit
  const stored = await storage.get(`stannis:${r1.flowId}`)
  stored.nodeStates['p1'].status = 'running'
  stored.nodeStates['p2'].status = 'running'
  await storage.set(`stannis:${r1.flowId}`, stored)

  const r2 = await w.run({ flowId: r1.flowId })
  // No break token returned → index.js marks flow completed
  assert.equal(r2.status, 'completed')
})

// ─── src/nodes/race.js ───────────────────────────────────────────────────────

// Lines 18-19: early return when race node itself is already completed
test('executeRace: no-op when node status is completed', async () => {
  const { token } = await executeRace(
    { type: 'race', id: 'r', nodes: [] },
    makeState('r', 'completed'),
    createMemStore(),
    async () => {}
  )
  assert.equal(token, null)
})

test('executeRace: no-op when node status is skipped', async () => {
  const { token } = await executeRace(
    { type: 'race', id: 'r', nodes: [] },
    makeState('r', 'skipped'),
    createMemStore(),
    async () => {}
  )
  assert.equal(token, null)
})

// Lines 50-51: race winner has a break token — it is bubbled up
test('race: break token from winner is returned to caller', async () => {
  const storage = createMemStore()
  const w = createStannis({
    definition: {
      type: 'race',
      nodes: [
        // Single child guarantees it always wins Promise.race
        { id: 'only', type: 'task', service: './test/services/add1.js', break: true },
      ],
    },
    storage,
  })

  const result = await w.run()
  assert.equal(result.status, 'broken')
  assert.equal(result.token.breakAfter, 'only')
})

// ─── src/nodes/decision.js ───────────────────────────────────────────────────

// Lines 23-24: early return when decision node itself is already completed
test('executeDecision: no-op when node status is completed', async () => {
  const { token } = await executeDecision(
    { type: 'decision', id: 'd', service: './test/decisions/always-next.js' },
    makeState('d', 'completed'),
    createMemStore()
  )
  assert.equal(token, null)
})

test('executeDecision: no-op when node status is skipped', async () => {
  const { token } = await executeDecision(
    { type: 'decision', id: 'd', service: './test/decisions/always-next.js' },
    makeState('d', 'skipped'),
    createMemStore()
  )
  assert.equal(token, null)
})

// Lines 34-38: decision service module fails to load
test('decision: nonexistent service module breaks flow', async () => {
  const storage = createMemStore()
  const w = createStannis({
    definition: { type: 'decision', service: './test/decisions/no-such-module.js' },
    storage,
  })
  const result = await w.run()
  assert.equal(result.status, 'broken')
})

// Lines 44-48: decision service module throws at runtime.
// goto-forward.js throws when GOTO_TARGET env var is absent.
test('decision: unhandled throw inside service module breaks flow', async () => {
  delete process.env.GOTO_TARGET
  const storage = createMemStore()
  const w = createStannis({
    definition: {
      type: 'sequence',
      nodes: [
        { id: 'pre', type: 'task',     service: './test/services/add1.js' },
        { id: 'dec', type: 'decision', service: './test/decisions/goto-forward.js' },
        { id: 'post', type: 'task',    service: './test/services/add1.js' },
      ],
    },
    storage,
  })

  const result = await w.run()
  assert.equal(result.status, 'broken')

  const state = await storage.get(`stannis:${result.flowId}`)
  assert.equal(state.nodeStates['dec'].status, 'broken')
  assert.ok(state.nodeStates['dec'].error, 'should have error message')
})

// ─── src/normalize.js ────────────────────────────────────────────────────────

// Lines 36-37: _validate() when node is null or not an object
test('validate: throws when node is null', () => {
  assert.throws(
    () => validateDefinition(null),
    /Invalid node/
  )
})

test('validate: throws when a child node is null (recursive path)', () => {
  // A sequence with a null child triggers _validate(null, parentId) recursively
  assert.throws(
    () => createStannis({
      definition: { type: 'sequence', nodes: [null] },
      storage: createMemStore(),
    }),
    /Invalid node/
  )
})

// ─── src/utils.js ────────────────────────────────────────────────────────────

// Line 23: resolveModulePath returns bare specifiers and absolute paths unchanged
test('resolveModulePath: returns bare npm specifier unchanged', () => {
  assert.equal(resolveModulePath('my-package'), 'my-package')
})

test('resolveModulePath: returns node: protocol specifier unchanged', () => {
  assert.equal(resolveModulePath('node:fs'), 'node:fs')
})

// ─── src/print.js ────────────────────────────────────────────────────────────

// Line 28: _printNode() returns early when nodeState entry is absent (defensive guard)
test('print: skips node when nodeState entry is absent', () => {
  // Use service names that match the node ids so we can detect them in the output.
  // print() renders: `task ${service}` — so 'task present-svc' and 'task absent-svc'.
  const state = {
    id: 'flow-pr',
    status: 'running',
    definition: {
      type: 'sequence', id: 'root',
      nodes: [
        { type: 'task', id: 'present', service: 'present-svc' },
        { type: 'task', id: 'absent',  service: 'absent-svc' }, // intentionally missing from nodeStates
      ],
    },
    nodeStates: {
      root:    { status: 'running' },
      present: { status: 'completed' },
      // 'absent' is intentionally absent — triggers `if (!ns) return`
    },
    history: {},
  }
  const output = print(state)
  assert.ok(output.includes('present-svc'), 'present node should appear in output')
  assert.ok(!output.includes('absent-svc'), 'absent node should be skipped')
})

// _icon() ?? '?' branch: status not present in STATUS_ICONS
test('print: shows ? icon for completely unknown node status', () => {
  const state = {
    id: 'flow-unk',
    status: 'running',
    definition: { type: 'task', id: 'x', service: 'a' },
    nodeStates: { x: { status: 'totally-unknown-status' } },
    history: {},
  }
  const output = print(state)
  assert.ok(output.includes('[?]'))
})

// ─── src/graph.js ────────────────────────────────────────────────────────────

// Line 88: default case in _mermaidNode() switch — node type not in the switch
test('graph: mermaid renders default box for node type not in switch', () => {
  // Bypass createStannis validation by calling graph() directly with a fabricated type
  const def = { type: 'alien', id: 'ufo' }
  const result = graph(def, null, 'mermaid')
  assert.ok(result.startsWith('flowchart LR'))
  assert.ok(result.includes('ufo'))
})

// ─── src/index.js ────────────────────────────────────────────────────────────

// Uncovered branch: parent?.type === 'parallel' && parent?.async evaluates to false
// (resume with a valid nodeId whose parent is NOT an async parallel)
test('resume: explicit nodeId for non-async-parallel child dispatches from root', async () => {
  const storage = createMemStore()
  const w = createStannis({
    definition: {
      type: 'sequence',
      nodes: [
        { id: 'a', type: 'task', service: './test/services/add1.js', break: true },
        { id: 'b', type: 'task', service: './test/services/add1.js' },
      ],
    },
    storage,
  })

  const r1 = await w.run()
  assert.equal(r1.status, 'broken')

  // Passing nodeId 'b' (valid, but parent is a sequence, not async parallel)
  // → parent.type !== 'parallel' → false branch → dispatchNodeId = null → root dispatch
  const r2 = await w.run({ flowId: r1.flowId, nodeId: 'b' })
  assert.equal(r2.status, 'completed')
  assert.ok(r2.history['b'])
})

// ─── Test helper file coverage ───────────────────────────────────────────────

test('counter service: increments and resets correctly', async () => {
  const { default: counter, getCount, resetCount } = await import('./services/counter.js')
  resetCount()
  await counter()
  await counter()
  assert.equal(getCount(), 2)
  resetCount()
  assert.equal(getCount(), 0)
})

test('double service: returns 0 when history is empty', async () => {
  const { default: double } = await import('./services/double.js')
  // Empty history → last = undefined → last?.value = undefined → ?? 0 → value * 2 = 0
  const result = await double({})
  assert.deepEqual(result, { value: 0 })
})

test('loop-once decision: throws when LOOP_TARGET env var is not set', async () => {
  const { default: loopOnce, reset } = await import('./decisions/loop-once.js')
  reset()
  delete process.env.LOOP_TARGET
  await assert.rejects(
    () => loopOnce({}, {}),
    /LOOP_TARGET env var not set/
  )
})

test('goto-forward decision: throws when GOTO_TARGET env var is not set', async () => {
  const { default: gotoForward } = await import('./decisions/goto-forward.js')
  delete process.env.GOTO_TARGET
  await assert.rejects(
    () => gotoForward(),
    /GOTO_TARGET env var not set/
  )
})

// ─── Additional branch-coverage tests ────────────────────────────────────────

// src/nodes/task.js: `result && result.error` — when result is null (falsy), the &&
// short-circuits without reading .error. Covered by a service that returns null.
test('task: handles null return from service (no error, completes normally)', async () => {
  const storage = createMemStore()
  const w = createStannis({
    definition: { type: 'task', service: './test/services/null-return.js' },
    storage,
  })
  const result = await w.run()
  assert.equal(result.status, 'completed')
})

// src/nodes/parallel.js: sync map — `|| childState.status === 'skipped'` branch.
// Triggered when a child already has 'skipped' status when the parallel re-runs.
test('executeParallel sync: skipped child is short-circuited (OR sub-branch)', async () => {
  const storage = createMemStore()
  let dispatchCalls = 0
  const mockDispatch = async (_child, state) => {
    dispatchCalls++
    return { state, token: null }
  }

  const node = {
    type: 'parallel', id: 'par',
    nodes: [
      { id: 'c1', type: 'task', service: 'x' }, // will be 'skipped'
      { id: 'c2', type: 'task', service: 'x' }, // will be 'pending' → dispatched
    ],
  }
  const state = {
    id: 'f-par',
    status: 'running',
    history: {},
    nodeStates: {
      par: { status: 'running' },
      c1:  { status: 'skipped' }, // already skipped → short-circuit (lines 52-53, 'skipped' branch)
      c2:  { status: 'pending' }, // pending → dispatch called
    },
  }

  await executeParallel(node, state, storage, mockDispatch)
  assert.equal(dispatchCalls, 1, 'only the pending child should be dispatched')
})

// src/executor.js applyGoTo: forward jump — `ns.status !== 'pending'` branch.
// When a node in the forward-jump range is already completed (not pending),
// it is NOT marked as skipped.
test('applyGoTo: forward jump leaves already-completed nodes unchanged', () => {
  const def = {
    type: 'sequence', id: 'root',
    nodes: [
      { id: 'a', type: 'decision', service: 'x' },
      { id: 'b', type: 'task', service: 'x' }, // completed — NOT re-marked
      { id: 'c', type: 'task', service: 'x' }, // pending — marked as skipped
      { id: 'd', type: 'task', service: 'x' }, // the target
    ],
  }
  const state = {
    nodeStates: {
      root: { status: 'running' },
      a:    { status: 'completed' },
      b:    { status: 'completed' }, // non-pending → ns.status !== 'pending' branch
      c:    { status: 'pending' },   // pending → marked as skipped
      d:    { status: 'pending' },
    },
  }
  const newState = applyGoTo(state, 'a', 'd', def)
  assert.equal(newState.nodeStates.b.status, 'completed') // unchanged
  assert.equal(newState.nodeStates.c.status, 'skipped')   // was pending
})

// src/executor.js applyGoTo: backward jump — `|| ns.status === 'skipped'` branch.
// When the backward-jump range contains a previously-skipped node, it is reset to pending.
test('applyGoTo: backward jump resets skipped nodes to pending', () => {
  const def = {
    type: 'sequence', id: 'root',
    nodes: [
      { id: 'a', type: 'task', service: 'x' },
      { id: 'b', type: 'task', service: 'x' }, // was skipped by a prior forward jump
      { id: 'c', type: 'task', service: 'x' },
      { id: 'd', type: 'decision', service: 'x' },
    ],
  }
  const state = {
    nodeStates: {
      root: { status: 'running' },
      a:    { status: 'completed' },
      b:    { status: 'skipped' },  // skipped → triggers || branch in backward jump
      c:    { status: 'completed' },
      d:    { status: 'completed' },
    },
  }
  // Backward jump from 'd' to 'a': all nodes in range are reset to pending
  const newState = applyGoTo(state, 'd', 'a', def)
  assert.equal(newState.nodeStates.a.status, 'pending')
  assert.equal(newState.nodeStates.b.status, 'pending') // was 'skipped', now pending
  assert.equal(newState.nodeStates.c.status, 'pending')
  assert.equal(newState.nodeStates.d.status, 'pending')
})

// src/executor.js applyGoTo: `ns` is falsy (node missing from nodeStates).
// Both forward and backward jumps guard with `if (ns && ...)`.
test('applyGoTo: skips nodes missing from nodeStates without throwing', () => {
  const def = {
    type: 'sequence', id: 'root',
    nodes: [
      { id: 'a', type: 'decision', service: 'x' },
      { id: 'b', type: 'task', service: 'x' }, // NOT in nodeStates — ns is null
      { id: 'c', type: 'task', service: 'x' },
    ],
  }
  const state = {
    nodeStates: {
      root: { status: 'running' },
      a:    { status: 'completed' },
      // 'b' intentionally absent — ns is null → `ns && ...` short-circuits
      c:    { status: 'pending' },
    },
  }
  // Forward jump from 'a' to 'c' — 'b' is in range but missing from nodeStates
  const newState = applyGoTo(state, 'a', 'c', def)
  assert.equal(newState.nodeStates.b, undefined) // was absent, still absent
})

// src/graph.js _statusOf: `state.nodeStates?.[nodeId]` when nodeId is not in nodeStates.
// Returns undefined → ?? null → null status for that node.
test('graph: node missing from nodeStates gets null status', () => {
  const def = {
    type: 'sequence', id: 'root',
    nodes: [
      { id: 'present', type: 'task', service: 'x' },
      { id: 'absent',  type: 'task', service: 'x' }, // not in state.nodeStates
    ],
  }
  const stateWithMissing = {
    nodeStates: {
      root:    { status: 'running' },
      present: { status: 'completed' },
      // 'absent' intentionally missing
    },
  }
  const result = graph(def, stateWithMissing, 'json')
  const absentNode = result.nodes.find(n => n.id === 'absent')
  assert.equal(absentNode.status, null) // missing nodeState → _statusOf returns null
})

// src/nodes/parallel.js: `s === 'broken'` branch in _checkParallelComplete.
// When an async parallel child errors (status='broken'), _checkParallelComplete treats it as done.
test('parallel async: _checkParallelComplete counts broken children as done', async () => {
  const storage = createMemStore()
  const w = createStannis({
    definition: {
      type: 'parallel',
      async: true,
      nodes: [
        { id: 'e1', type: 'task', service: './test/services/always-error.js' },
        { id: 'e2', type: 'task', service: './test/services/always-error.js' },
      ],
    },
    storage,
  })

  // First run: returns [e1_token, e2_token] (both pending)
  const r1 = await w.run()
  assert.ok(Array.isArray(r1.token))

  // Resume each branch: always-error → each child becomes 'broken'
  const t1 = r1.token[0]
  const t2 = r1.token[1]
  await w.run({ flowId: r1.flowId, nodeId: t1.nodeId })
  await w.run({ flowId: r1.flowId, nodeId: t2.nodeId })

  // Final run from root: parallel sees no pending children, calls _checkParallelComplete
  // → e1.status='broken', e2.status='broken' → s === 'broken' branch covered → allDone=true
  const rFinal = await w.run({ flowId: r1.flowId })
  assert.equal(rFinal.status, 'completed')
})

// src/graph.js line 77: `node.status ? \` [${node.status}]\` : ''` — truthy branch.
// All previous mermaid tests passed state=null, giving every node status=null (falsy).
// Running a real flow first gives nodes a concrete status so the truthy branch is taken.
test('graph: mermaid includes status tag when node has a non-null status', async () => {
  const storage = createMemStore()
  const w = createStannis({
    definition: { type: 'task', service: './test/services/add1.js' },
    storage,
  })
  const { flowId } = await w.run()
  const result = await w.graph('mermaid', flowId)
  assert.ok(typeof result === 'string')
  assert.ok(result.includes('[completed]'), 'status tag should appear in mermaid output')
})

// src/index.js line 112: `if (!state)` true branch — print() with nonexistent flowId.
test('index: print() throws when flowId has no stored state', async () => {
  const w = createStannis({
    definition: { type: 'task', service: './test/services/add1.js' },
    storage: createMemStore(),
  })
  await assert.rejects(
    () => w.print('no-such-flow-id'),
    /No state found for flowId/
  )
})

// src/nodes/task.js line 26: `nodeState.executionCount ?? 0` right-side branch.
// buildNodeMap initialises executionCount: 0 (always a number), so the ?? right side
// (executionCount is null/undefined) is unreachable via the public API.
// Covered by calling executeTask directly with a fabricated nodeState that omits executionCount.
test('task: undefined executionCount in nodeState defaults to 0 via ??', async () => {
  const state = {
    id: 'cov-ec',
    status: 'running',
    history: {},
    nodeStates: {
      // executionCount intentionally absent → nodeState.executionCount = undefined → ?? 0
      t: { id: 't', type: 'task', status: 'pending', input: null, output: null, error: null },
    },
  }
  const storage = createMemStore()
  await storage.set('stannis:cov-ec', state)
  const { state: next } = await executeTask(
    { id: 't', type: 'task', service: './test/services/add1.js' },
    state,
    storage
  )
  // First execution: (undefined ?? 0) + 1 = 1
  assert.equal(next.nodeStates.t.executionCount, 1)
})

// src/nodes/parallel.js lines 68-69: merge-state loop edge branches.
// Line 68: `existing?.status` false branch — when a nodeId from result.state.nodeStates
//           is absent from the current state.nodeStates (existing = undefined).
// Line 69: `STATUS_PRIORITY[incoming.status] ?? 0` right-side — incoming.status not in map.
// Both are covered by a custom dispatch that returns a state with an extra phantom nodeId
// carrying an unknown status string.
test('parallel sync: merge handles phantom nodeId and unknown status from result state', async () => {
  const mockDispatch = async (child, state) => {
    return {
      state: {
        ...state,
        nodeStates: {
          ...state.nodeStates,
          [child.id]: { ...state.nodeStates[child.id], status: 'completed' },
          // 'phantom' is not in the current state.nodeStates → existing = undefined (line 68)
          // 'totally-alien' is not in STATUS_PRIORITY → STATUS_PRIORITY[...] = undefined (line 69)
          phantom: { id: 'phantom', status: 'totally-alien' },
        },
      },
      token: null,
    }
  }

  const node = {
    type: 'parallel', id: 'par',
    nodes: [{ id: 'c1', type: 'task', service: 'x' }],
  }
  const state = {
    id: 'f-ph',
    status: 'running',
    history: {},
    nodeStates: {
      par: { id: 'par', status: 'running' },
      c1:  { id: 'c1', status: 'pending' },
    },
  }

  const storage = createMemStore()
  await storage.set('stannis:f-ph', state)
  const result = await executeParallel(node, state, storage, mockDispatch)
  // The merge doesn't crash; c1 ended up completed, phantom added with priority 0
  assert.ok(result)
})

// src/index.js: `parent?.type === 'parallel' && parent?.async` — A=true, B=false branch.
// Parent is a sync parallel (no async:true property) → parent.async is undefined → false.
test('resume: nodeId inside a sync parallel dispatches from root (not async-parallel branch)', async () => {
  const storage = createMemStore()
  const w = createStannis({
    definition: {
      type: 'sequence',
      nodes: [{
        id: 'par', type: 'parallel', // sync (no async: true)
        nodes: [
          { id: 'c1', type: 'task', service: './test/services/add1.js' },
          { id: 'c2', type: 'task', service: './test/services/add1.js' },
        ],
      }],
    },
    storage,
  })
  const r1 = await w.run()
  assert.equal(r1.status, 'completed')

  // Resume with nodeId 'c1' inside a sync parallel.
  // parent.type === 'parallel' is true, but parent.async is undefined (falsy) → false branch
  // → dispatchNodeId = null → dispatch from root
  const r2 = await w.run({ flowId: r1.flowId, nodeId: 'c1' })
  assert.equal(r2.status, 'completed')
})
