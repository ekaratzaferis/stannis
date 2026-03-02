import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createStannis } from '../src/index.js'
import { createMemStore } from './memstore.js'

test('race: one winner, others skipped', async () => {
  const storage = createMemStore()
  const w = createStannis({
    definition: {
      type: 'race',
      nodes: [
        { id: 'r1', type: 'task', service: './test/services/static-value.js' },
        { id: 'r2', type: 'task', service: './test/services/static-value.js' },
        { id: 'r3', type: 'task', service: './test/services/static-value.js' },
      ],
    },
    storage,
  })

  const result = await w.run()
  assert.equal(result.status, 'completed')
  assert.equal(result.token, null)

  // Exactly one node should be in history (the winner)
  assert.equal(Object.keys(result.history).length, 1)

  // Load state to verify skipped nodes
  const state = await storage.get(`stannis:${result.flowId}`)
  const statuses = [
    state.nodeStates['r1'].status,
    state.nodeStates['r2'].status,
    state.nodeStates['r3'].status,
  ]
  const completed = statuses.filter(s => s === 'completed').length
  const skipped = statuses.filter(s => s === 'skipped').length
  assert.equal(completed, 1)
  assert.equal(skipped, 2)
})

test('race: nested inside sequence', async () => {
  const storage = createMemStore()
  const w = createStannis({
    definition: {
      type: 'sequence',
      nodes: [
        {
          type: 'race',
          nodes: [
            { id: 'ra', type: 'task', service: './test/services/add1.js' },
            { id: 'rb', type: 'task', service: './test/services/add1.js' },
          ],
        },
        { id: 'after', type: 'task', service: './test/services/static-value.js' },
      ],
    },
    storage,
  })

  const result = await w.run()
  assert.equal(result.status, 'completed')
  assert.ok(result.history['after'])
})
