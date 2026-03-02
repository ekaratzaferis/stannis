import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createStannis } from '../src/index.js'
import { createMemStore } from './memstore.js'

test('sequence: runs children in order', async () => {
  const storage = createMemStore()
  const w = createStannis({
    definition: {
      type: 'sequence',
      nodes: [
        { type: 'task', service: './test/services/add1.js' },
        { type: 'task', service: './test/services/add1.js' },
        { type: 'task', service: './test/services/add1.js' },
      ],
    },
    storage,
  })

  const result = await w.run()
  assert.equal(result.status, 'completed')
  assert.equal(result.token, null)

  const outputs = Object.values(result.history)
  // Each add1 adds 1 to the previous output value
  // First: input history={}, last=undefined, value=0+1=1
  // Second: last output was {value:1}, value=1+1=2
  // Third: last output was {value:2}, value=2+1=3
  assert.equal(outputs[0].value, 1)
  assert.equal(outputs[1].value, 2)
  assert.equal(outputs[2].value, 3)
})

test('sequence: bubbles up break token mid-sequence', async () => {
  const storage = createMemStore()
  const w = createStannis({
    definition: {
      type: 'sequence',
      nodes: [
        { id: 'first', type: 'task', service: './test/services/add1.js' },
        { id: 'second', type: 'task', service: './test/services/add1.js', break: true },
        { id: 'third', type: 'task', service: './test/services/add1.js' },
      ],
    },
    storage,
  })

  const result = await w.run()
  assert.equal(result.status, 'broken')
  assert.ok(result.token !== null)

  // Only first and second ran
  assert.equal(Object.keys(result.history).length, 2)
  assert.ok(result.history['first'])
  assert.ok(result.history['second'])
  assert.equal(result.history['third'], undefined)
})

test('sequence: break-and-resume continues from next node', async () => {
  const storage = createMemStore()
  const w = createStannis({
    definition: {
      type: 'sequence',
      nodes: [
        { id: 'first', type: 'task', service: './test/services/add1.js' },
        { id: 'second', type: 'task', service: './test/services/add1.js', break: true },
        { id: 'third', type: 'task', service: './test/services/add1.js' },
      ],
    },
    storage,
  })

  const first = await w.run()
  assert.equal(first.status, 'broken')
  assert.ok(first.token !== null)

  // Resume — token has breakAfter, not nodeId, so we need to find the next node
  // The token for a break flag has breakAfter set; resume needs nodeId of next node
  // Let's check what token looks like
  assert.equal(first.token.flowId, first.flowId)
  // breakAfter means: the node 'second' completed but flow broke; next node is 'third'
  // We need to resume from 'third'
  const token = { flowId: first.flowId, nodeId: 'third' }
  const second = await w.run(token)
  assert.equal(second.status, 'completed')
  assert.ok(second.history['third'])
})

test('sequence: fail bubbles up as broken', async () => {
  const storage = createMemStore()
  const w = createStannis({
    definition: {
      type: 'sequence',
      nodes: [
        { type: 'task', service: './test/services/add1.js' },
        { type: 'task', service: './test/services/fail.js' },
        { type: 'task', service: './test/services/add1.js' },
      ],
    },
    storage,
  })

  const result = await w.run()
  assert.equal(result.status, 'broken')
})

test('sequence: nested sequences work', async () => {
  const storage = createMemStore()
  const w = createStannis({
    definition: {
      type: 'sequence',
      nodes: [
        {
          type: 'sequence',
          nodes: [
            { type: 'task', service: './test/services/add1.js' },
            { type: 'task', service: './test/services/add1.js' },
          ],
        },
        { type: 'task', service: './test/services/add1.js' },
      ],
    },
    storage,
  })

  const result = await w.run()
  assert.equal(result.status, 'completed')
  assert.equal(Object.keys(result.history).length, 3)
})
