import { updateNode, saveState } from '../state.js'

/**
 * Execute a race node: run all children concurrently, use first to complete.
 * All other children are marked as skipped.
 *
 * @param {object} node
 * @param {object} state
 * @param {object} storage
 * @param {Function} dispatch
 * @returns {Promise<{ state: object, token: object|null }>}
 */
export async function executeRace(node, state, storage, dispatch) {
  const nodeId = node.id
  const nodeState = state.nodeStates[nodeId]

  if (nodeState.status === 'completed' || nodeState.status === 'skipped') {
    return { state, token: null }
  }

  state = updateNode(state, nodeId, { status: 'running' })
  await saveState(storage, state)

  // We need to track which child won to mark others as skipped.
  // Each dispatch returns { state, token }. We race the promises and pick the winner.
  let winnerChildId = null
  let sharedState = state // will be updated by winner

  const promises = node.nodes.map(child => {
    return dispatch(child, state, storage).then(result => {
      return { childId: child.id, result }
    })
  })

  const { childId, result } = await Promise.race(promises)
  winnerChildId = childId
  sharedState = result.state

  // Mark all other children as skipped
  for (const child of node.nodes) {
    if (child.id !== winnerChildId) {
      sharedState = updateNode(sharedState, child.id, { status: 'skipped' })
    }
  }

  sharedState = updateNode(sharedState, nodeId, { status: 'completed' })
  await saveState(storage, sharedState)

  if (result.token !== null) {
    return { state: sharedState, token: result.token }
  }

  return { state: sharedState, token: null }
}
