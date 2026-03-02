import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createStannis } from '../src/index.js'
import { createMemStore } from './memstore.js'

test('print: returns formatted string after run', async () => {
  const storage = createMemStore()
  const w = createStannis({
    definition: {
      type: 'sequence',
      nodes: [
        { id: 'p1', type: 'task', service: './test/services/add1.js' },
        { id: 'p2', type: 'task', service: './test/services/add1.js' },
      ],
    },
    storage,
  })

  const result = await w.run()
  const str = await w.print(result.flowId)

  assert.equal(typeof str, 'string')
  assert.ok(str.includes('✓'))
  assert.ok(str.includes('task'))
  assert.ok(str.includes('add1.js'))
})

test('print: shows broken node with error message', async () => {
  const storage = createMemStore()
  const w = createStannis({
    definition: {
      type: 'task',
      service: './test/services/fail.js',
    },
    storage,
  })

  const result = await w.run()
  const str = await w.print(result.flowId)

  assert.ok(str.includes('✗'))
  assert.ok(str.includes('deliberate failure'))
})

test('print: shows pending nodes after break', async () => {
  const storage = createMemStore()
  const w = createStannis({
    definition: {
      type: 'sequence',
      nodes: [
        { id: 'first', type: 'task', service: './test/services/add1.js', break: true },
        { id: 'second', type: 'task', service: './test/services/add1.js' },
      ],
    },
    storage,
  })

  const result = await w.run()
  const str = await w.print(result.flowId)

  assert.ok(str.includes('✓')) // first completed
  assert.ok(str.includes('[ ]')) // second still pending
})

test('print: requires flowId', async () => {
  const storage = createMemStore()
  const w = createStannis({
    definition: { type: 'task', service: './test/services/add1.js' },
    storage,
  })

  await assert.rejects(
    () => w.print(),
    /requires a flowId/
  )
})
