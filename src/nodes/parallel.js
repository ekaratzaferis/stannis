import { updateNode, saveState } from '../state.js'

/**
 * Execute a parallel node.
 *
 * async=false (default): Promise.all all children, merge states sequentially after.
 * async=true: return one resume token per unstarted child; each child runs separately on resume.
 *
 * @param {object} node
 * @param {object} state
 * @param {object} storage
 * @param {Function} dispatch
 * @returns {Promise<{ state: object, token: object|null|Array }>}
 */
export async function executeParallel(node, state, storage, dispatch) {
  const nodeId = node.id
  const nodeState = state.nodeStates[nodeId]

  if (nodeState.status === 'completed' || nodeState.status === 'skipped') {
    return { state, token: null }
  }

  state = updateNode(state, nodeId, { status: 'running' })
  await saveState(storage, state)

  if (node.async) {
    // Async parallel: return tokens for every pending child
    const tokens = []
    for (const child of node.nodes) {
      const childState = state.nodeStates[child.id]
      if (childState.status === 'pending') {
        tokens.push({ flowId: state.id, nodeId: child.id })
      }
    }

    if (tokens.length > 0) {
      state = { ...state, status: 'broken' }
      await saveState(storage, state)
      return { state, token: tokens }
    }

    // All children already done — check if parallel is complete
    return _checkParallelComplete(node, state, storage)
  }

  // Sync parallel: run all children concurrently
  // We need to handle state carefully — each branch starts from current state
  // but we collect results and merge node states / history after all complete
  const promises = node.nodes.map(child => {
    const childState = state.nodeStates[child.id]
    if (childState.status === 'completed' || childState.status === 'skipped') {
      return Promise.resolve({ state, token: null })
    }
    return dispatch(child, state, storage)
  })

  const results = await Promise.all(promises)

  // Merge all resulting states.
  // Use priority-based merge so a 'completed' status from one branch is never
  // overwritten by a stale 'pending' seen by a concurrent sibling branch.
  const STATUS_PRIORITY = { pending: 0, skipped: 1, running: 2, broken: 3, completed: 4 }

  for (const result of results) {
    // Merge nodeStates: keep the most-advanced status
    for (const [id, incoming] of Object.entries(result.state.nodeStates)) {
      const existing = state.nodeStates[id]
      const existingPriority = STATUS_PRIORITY[existing?.status] ?? 0
      const incomingPriority = STATUS_PRIORITY[incoming.status] ?? 0
      state = {
        ...state,
        nodeStates: {
          ...state.nodeStates,
          [id]: incomingPriority > existingPriority ? incoming : existing,
        },
      }
    }
    // Merge history
    state = {
      ...state,
      history: { ...state.history, ...result.state.history },
    }
  }

  // Check for any break token
  const breakResult = results.find(r => r.token !== null)
  if (breakResult) {
    return { state, token: breakResult.token }
  }

  return _checkParallelComplete(node, state, storage)
}

async function _checkParallelComplete(node, state, storage) {
  const allDone = node.nodes.every(child => {
    const s = state.nodeStates[child.id].status
    return s === 'completed' || s === 'skipped' || s === 'broken'
  })

  if (allDone) {
    state = updateNode(state, node.id, { status: 'completed' })
    await saveState(storage, state)
    return { state, token: null }
  }

  // Some children still pending (async mode, partial resume)
  return { state, token: null }
}
