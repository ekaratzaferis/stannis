import { resolveModulePath } from '../utils.js'
import { updateNode, addHistory, saveState } from '../state.js'

/**
 * Execute a task node.
 * Returns { state, token } where token is null on success or { flowId, nodeId } on break.
 *
 * @param {object} node - the task definition node
 * @param {object} state - current execution state
 * @param {object} storage
 * @returns {Promise<{ state: object, token: object|null }>}
 */
export async function executeTask(node, state, storage) {
  const nodeId = node.id
  const nodeState = state.nodeStates[nodeId]

  // Skip already-completed or skipped nodes (e.g. during resume)
  if (nodeState.status === 'completed' || nodeState.status === 'skipped') {
    return { state, token: null }
  }

  // Mark as running
  state = updateNode(state, nodeId, { status: 'running', input: state.history })
  await saveState(storage, state)

  const executionCount = (nodeState.executionCount ?? 0) + 1
  state = updateNode(state, nodeId, { executionCount })

  let mod
  try {
    const modulePath = resolveModulePath(node.service)
    mod = await import(modulePath)
  } catch (e) {
    state = updateNode(state, nodeId, {
      status: 'broken',
      error: e.message,
    })
    state = { ...state, status: 'broken' }
    await saveState(storage, state)
    return { state, token: { flowId: state.id, nodeId } }
  }

  let result
  try {
    result = await mod.default(state.history, { nodeState: state.nodeStates[nodeId] })
  } catch (e) {
    // Unhandled throw → immediately break
    state = updateNode(state, nodeId, {
      status: 'broken',
      error: e.message,
      executionCount,
    })
    state = { ...state, status: 'broken' }
    await saveState(storage, state)
    return { state, token: { flowId: state.id, nodeId } }
  }

  // Controlled error from module
  if (result && result.error) {
    const retry = node.retry
    if (retry && executionCount <= retry.times) {
      const backoff = retry.backoff ?? 0
      const delay = backoff * Math.pow(2, executionCount - 1)
      if (delay > 0) await sleep(delay)
      // Reset executionCount in state before recursing (it will be incremented again)
      state = updateNode(state, nodeId, {
        status: 'pending',
        executionCount,
        error: result.error,
      })
      return executeTask(node, state, storage)
    }
    // Exhausted retries
    state = updateNode(state, nodeId, {
      status: 'broken',
      error: result.error,
      executionCount,
    })
    state = { ...state, status: 'broken' }
    await saveState(storage, state)
    return { state, token: { flowId: state.id, nodeId } }
  }

  // Success
  const output = result ?? null
  state = updateNode(state, nodeId, {
    status: 'completed',
    output,
    executionCount,
    error: null,
  })
  state = addHistory(state, nodeId, output)
  await saveState(storage, state)

  // Check break flag
  if (node.break) {
    state = { ...state, status: 'broken' }
    await saveState(storage, state)
    return { state, token: { flowId: state.id, nodeId: null, breakAfter: nodeId } }
  }

  return { state, token: null }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
