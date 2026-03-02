import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createStannis } from '../src/index.js'
import { createMemStore } from './memstore.js'

const definition = {
  type: 'sequence',
  nodes: [
    { id: 'g1', type: 'task', service: './test/services/add1.js' },
    {
      type: 'parallel',
      nodes: [
        { id: 'g2a', type: 'task', service: './test/services/static-value.js' },
        { id: 'g2b', type: 'task', service: './test/services/static-value.js' },
      ],
    },
    { id: 'g3', type: 'decision', service: './test/decisions/always-next.js' },
  ],
}

test('graph: json format returns nodes and edges', async () => {
  const storage = createMemStore()
  const w = createStannis({ definition, storage })

  const g = await w.graph('json')
  assert.ok(Array.isArray(g.nodes))
  assert.ok(Array.isArray(g.edges))
  assert.ok(g.nodes.length > 0)

  // Check node types are present
  const types = g.nodes.map(n => n.type)
  assert.ok(types.includes('task'))
  assert.ok(types.includes('parallel'))
  assert.ok(types.includes('decision'))
})

test('graph: mermaid format returns flowchart string', async () => {
  const storage = createMemStore()
  const w = createStannis({ definition, storage })

  const m = await w.graph('mermaid')
  assert.equal(typeof m, 'string')
  assert.ok(m.startsWith('flowchart TD'))
  assert.ok(m.includes('-->'))
})

test('graph: html format returns valid HTML with mermaid', async () => {
  const storage = createMemStore()
  const w = createStannis({ definition, storage })

  const h = await w.graph('html')
  assert.equal(typeof h, 'string')
  assert.ok(h.includes('<!DOCTYPE html>'))
  assert.ok(h.includes('mermaid'))
  assert.ok(h.includes('flowchart TD'))
})

test('graph: invalid format throws', async () => {
  const storage = createMemStore()
  const w = createStannis({ definition, storage })

  await assert.rejects(
    () => w.graph('xml'),
    /Unknown graph format/
  )
})

test('graph: with flowId shows node statuses', async () => {
  const storage = createMemStore()
  const w = createStannis({ definition, storage })

  const runResult = await w.run()
  const g = await w.graph('json', runResult.flowId)

  // After completion, nodes should have status
  const taskNodes = g.nodes.filter(n => n.type === 'task')
  for (const n of taskNodes) {
    assert.equal(n.status, 'completed')
  }
})
