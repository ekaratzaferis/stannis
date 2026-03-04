/**
 * Worker process for the multi-process integration test.
 *
 * Holds the scheduler in memory and processes messages from the parent thread:
 *
 *   { type: 'start', key, definition }
 *     → runs the workflow from scratch
 *     → replies { type: 'result', key, result }
 *
 *   { type: 'resume', key, flowId }
 *     → resumes the workflow from root (no nodeId = re-dispatch from root)
 *     → replies { type: 'result', key, result }
 *
 *   { type: 'resume-branch', key, flowId, nodeId }
 *     → resumes a specific async-parallel branch
 *     → replies { type: 'result', key, result }
 *
 *   { type: 'shutdown' }
 *     → exits the process
 *
 * Each key maps to a { scheduler } instance backed by the shared in-memory store.
 */

import { createStannis } from '../src/index.js'
import { createMemStore } from './memstore.js'

const storage = createMemStore()
const schedulers = new Map() // key → scheduler

process.on('message', async (msg) => {
  if (msg.type === 'shutdown') {
    process.exit(0)
  }

  try {
    if (msg.type === 'start') {
      const w = createStannis({ definition: msg.definition, storage })
      const result = await w.run()
      schedulers.set(msg.key, w)
      process.send({ type: 'result', key: msg.key, result })
    }

    else if (msg.type === 'resume') {
      const w = schedulers.get(msg.key)
      if (!w) throw new Error(`No scheduler found for key: ${msg.key}`)
      const result = await w.run({ flowId: msg.flowId })
      process.send({ type: 'result', key: msg.key, result })
    }

    else if (msg.type === 'resume-branch') {
      const w = schedulers.get(msg.key)
      if (!w) throw new Error(`No scheduler found for key: ${msg.key}`)
      const result = await w.run({ flowId: msg.flowId, nodeId: msg.nodeId })
      process.send({ type: 'result', key: msg.key, result })
    }
  } catch (err) {
    process.send({ type: 'error', key: msg.key, message: err.message })
  }
})
