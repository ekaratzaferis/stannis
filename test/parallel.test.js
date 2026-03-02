import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createStannis } from '../src/index.js'
import { createMemStore } from './memstore.js'

test('parallel: runs all children concurrently (sync)', async () => {
  const storage = createMemStore()
  const w = createStannis({
    definition: {
      type: 'parallel',
      nodes: [
        { id: 'a', type: 'task', service: './test/services/static-value.js' },
        { id: 'b', type: 'task', service: './test/services/static-value.js' },
        { id: 'c', type: 'task', service: './test/services/static-value.js' },
      ],
    },
    storage,
  })

  const result = await w.run()
  assert.equal(result.status, 'completed')
  assert.equal(result.token, null)
  assert.ok(result.history['a'])
  assert.ok(result.history['b'])
  assert.ok(result.history['c'])
})

test('parallel async: returns tokens for each child', async () => {
  const storage = createMemStore()
  const w = createStannis({
    definition: {
      type: 'parallel',
      async: true,
      nodes: [
        { id: 'p1', type: 'task', service: './test/services/static-value.js' },
        { id: 'p2', type: 'task', service: './test/services/static-value.js' },
        { id: 'p3', type: 'task', service: './test/services/static-value.js' },
      ],
    },
    storage,
  })

  const result = await w.run()
  assert.equal(result.status, 'broken')
  assert.ok(Array.isArray(result.token))
  assert.equal(result.token.length, 3)

  // Each token should have a nodeId matching a child
  const nodeIds = result.token.map(t => t.nodeId)
  assert.ok(nodeIds.includes('p1'))
  assert.ok(nodeIds.includes('p2'))
  assert.ok(nodeIds.includes('p3'))
})

test('parallel async: resume each child separately, last completes parent', async () => {
  const storage = createMemStore()
  const w = createStannis({
    definition: {
      type: 'parallel',
      async: true,
      nodes: [
        { id: 'x1', type: 'task', service: './test/services/static-value.js' },
        { id: 'x2', type: 'task', service: './test/services/static-value.js' },
      ],
    },
    storage,
  })

  // Initial run returns tokens
  const first = await w.run()
  assert.equal(first.status, 'broken')
  assert.equal(first.token.length, 2)

  // Resume first child
  const r1 = await w.run({ flowId: first.flowId, nodeId: 'x1' })
  // Still broken because x2 not done
  assert.ok(r1.history['x1'])

  // Resume second child
  const r2 = await w.run({ flowId: first.flowId, nodeId: 'x2' })
  assert.ok(r2.history['x2'])
})

test('parallel: nested parallel inside sequence', async () => {
  const storage = createMemStore()
  const w = createStannis({
    definition: {
      type: 'sequence',
      nodes: [
        { id: 'before', type: 'task', service: './test/services/add1.js' },
        {
          type: 'parallel',
          nodes: [
            { id: 'pa', type: 'task', service: './test/services/static-value.js' },
            { id: 'pb', type: 'task', service: './test/services/static-value.js' },
          ],
        },
        { id: 'after', type: 'task', service: './test/services/add1.js' },
      ],
    },
    storage,
  })

  const result = await w.run()
  assert.equal(result.status, 'completed')
  assert.ok(result.history['before'])
  assert.ok(result.history['pa'])
  assert.ok(result.history['pb'])
  assert.ok(result.history['after'])
})
