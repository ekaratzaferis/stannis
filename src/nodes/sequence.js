import { updateNode, saveState } from '../state.js'

/**
 * Execute a sequence node: run children in order, bubble up any break token.
 *
 * @param {object} node - sequence definition node
 * @param {object} state
 * @param {object} storage
 * @param {Function} dispatch
 * @returns {Promise<{ state: object, token: object|null }>}
 */
export async function executeSequence(node, state, storage, dispatch) {
  const nodeId = node.id
  const nodeState = state.nodeStates[nodeId]

  if (nodeState.status === 'completed' || nodeState.status === 'skipped') {
    return { state, token: null }
  }

  state = updateNode(state, nodeId, { status: 'running' })
  await saveState(storage, state)

  for (const child of node.nodes) {
    const childState = state.nodeStates[child.id]
    // Skip already-finished children
    if (childState.status === 'completed' || childState.status === 'skipped') {
      continue
    }

    const result = await dispatch(child, state, storage)
    state = result.state

    if (result.token !== null) {
      // Bubble break token up
      return { state, token: result.token }
    }
  }

  // All children done
  state = updateNode(state, nodeId, { status: 'completed' })
  await saveState(storage, state)
  return { state, token: null }
}
