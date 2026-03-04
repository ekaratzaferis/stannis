import { resolveModulePath } from '../utils.js'
import { updateNode, saveState } from '../state.js'

/**
 * Execute a decision node.
 * The service module receives (history, ctx) and must return { next } or { goTo }.
 *
 * Returns:
 *   token: null          — continue to next sibling
 *   token: { stop }      — stop execution (next: false)
 *   token: { flowId, nodeId, goTo } — jump to target node
 *
 * @param {object} node
 * @param {object} state
 * @param {object} storage
 * @returns {Promise<{ state: object, token: object|null }>}
 */
export async function executeDecision(node, state, storage) {
  const nodeId = node.id
  const nodeState = state.nodeStates[nodeId]

  if (nodeState.status === 'completed' || nodeState.status === 'skipped') {
    return { state, token: null }
  }

  state = updateNode(state, nodeId, { status: 'running' })
  await saveState(storage, state)

  let mod
  try {
    const modulePath = resolveModulePath(node.service)
    mod = await import(modulePath)
  } catch (e) {
    state = updateNode(state, nodeId, { status: 'broken', error: e.message })
    state = { ...state, status: 'broken' }
    await saveState(storage, state)
    return { state, token: { flowId: state.id, nodeId } }
  }

  let result
  try {
    result = await mod.default(state.history, node.input ?? {}, { nodeState: state.nodeStates[nodeId] })
  } catch (e) {
    state = updateNode(state, nodeId, { status: 'broken', error: e.message })
    state = { ...state, status: 'broken' }
    await saveState(storage, state)
    return { state, token: { flowId: state.id, nodeId } }
  }

  if (!result || (result.next === undefined && result.goTo === undefined)) {
    throw new Error(
      `decision node "${nodeId}" service must return { next } or { goTo }, got: ${JSON.stringify(result)}`
    )
  }

  state = updateNode(state, nodeId, { status: 'completed', output: result })
  await saveState(storage, state)

  if (result.goTo !== undefined) {
    // Include fromNodeId so executor can compute backward/forward jump direction
    return { state, token: { flowId: state.id, goTo: result.goTo, fromNodeId: nodeId } }
  }

  if (result.next === false) {
    // Stop execution
    return { state, token: { stop: true } }
  }

  // next === true → continue to following sibling
  return { state, token: null }
}
