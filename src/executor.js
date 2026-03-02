import { executeTask } from './nodes/task.js'
import { executeSequence } from './nodes/sequence.js'
import { executeParallel } from './nodes/parallel.js'
import { executeRace } from './nodes/race.js'
import { executeDecision } from './nodes/decision.js'
import { updateNode, saveState } from './state.js'

/**
 * Dispatch a node to its executor.
 * @param {object} node - definition node
 * @param {object} state - current execution state
 * @param {object} storage
 * @returns {Promise<{ state: object, token: object|null }>}
 */
export async function dispatch(node, state, storage) {
  switch (node.type) {
    case 'task':
      return executeTask(node, state, storage)
    case 'sequence':
      return executeSequence(node, state, storage, dispatch)
    case 'parallel':
      return executeParallel(node, state, storage, dispatch)
    case 'race':
      return executeRace(node, state, storage, dispatch)
    case 'decision':
      return executeDecision(node, state, storage)
    default:
      throw new Error(`Unknown node type: ${node.type}`)
  }
}

/**
 * Find a node in the definition tree by id.
 * @param {object} node
 * @param {string} targetId
 * @returns {object|null}
 */
export function findNode(node, targetId) {
  if (node.id === targetId) return node
  if (node.nodes) {
    for (const child of node.nodes) {
      const found = findNode(child, targetId)
      if (found) return found
    }
  }
  return null
}

/**
 * Get the flat list of node IDs in definition order (DFS pre-order).
 * @param {object} node
 * @returns {string[]}
 */
export function flattenNodeIds(node) {
  const ids = [node.id]
  if (node.nodes) {
    for (const child of node.nodes) {
      ids.push(...flattenNodeIds(child))
    }
  }
  return ids
}

/**
 * Apply a goTo jump.
 * Forward jumps: mark intermediate nodes as skipped.
 * Backward jumps: reset nodes from target back to the source (inclusive) to pending,
 *   so they will re-execute on the next dispatch from root.
 * @param {object} state
 * @param {string} fromId - the node that issued the goTo (decision node id)
 * @param {string} toId - target node id
 * @param {object} definition - root definition
 * @returns {object} new state
 */
export function applyGoTo(state, fromId, toId, definition) {
  const allIds = flattenNodeIds(definition)
  const fromIndex = allIds.indexOf(fromId)
  const toIndex = allIds.indexOf(toId)

  if (toIndex === -1) {
    throw new Error(`goTo target "${toId}" not found in definition`)
  }

  if (toIndex > fromIndex) {
    // Forward jump: mark intermediates as skipped
    for (let i = fromIndex + 1; i < toIndex; i++) {
      const id = allIds[i]
      const ns = state.nodeStates[id]
      if (ns && ns.status === 'pending') {
        state = updateNode(state, id, { status: 'skipped' })
      }
    }
  } else if (toIndex < fromIndex) {
    // Backward jump (FSM loop): reset nodes from target to source back to pending
    // so they re-execute when the sequence is re-entered from root
    for (let i = toIndex; i <= fromIndex; i++) {
      const id = allIds[i]
      const ns = state.nodeStates[id]
      if (ns && (ns.status === 'completed' || ns.status === 'skipped')) {
        state = updateNode(state, id, { status: 'pending' })
      }
    }
  }

  return state
}

/**
 * Find the parent node of a given nodeId in the definition tree.
 * @param {object} definition
 * @param {string} nodeId
 * @returns {object|null}
 */
export function findParentNode(definition, nodeId) {
  function search(node) {
    if (node.nodes) {
      for (const child of node.nodes) {
        if (child.id === nodeId) return node
        const found = search(child)
        if (found) return found
      }
    }
    return null
  }
  return search(definition)
}

/**
 * Run the flow starting from a specific node (or the root).
 * Handles goTo by re-entering dispatch with the target node.
 *
 * @param {object} definition - normalized definition
 * @param {object} state - current execution state
 * @param {object} storage
 * @param {string|null} startNodeId - null means start from root
 * @returns {Promise<{ state: object, token: object|null|Array }>}
 */
export async function run(definition, state, storage, startNodeId = null) {
  if (startNodeId) {
    const targetNode = findNode(definition, startNodeId)
    if (!targetNode) {
      throw new Error(`Resume node "${startNodeId}" not found in definition`)
    }
    return runFromNode(targetNode, definition, state, storage)
  }
  return runFromNode(definition, definition, state, storage)
}

async function runFromNode(node, definition, state, storage) {
  const result = await dispatch(node, state, storage)
  state = result.state

  if (result.token && result.token.goTo) {
    const goToId = result.token.goTo
    const fromId = result.token.fromNodeId ?? node.id
    // Apply jump: skips intermediates for forward, resets loop nodes for backward
    state = applyGoTo(state, fromId, goToId, definition)
    await saveState(storage, state)
    // Re-dispatch from ROOT — the sequence will skip completed nodes and
    // naturally continue from wherever is now pending (the goTo target)
    return runFromNode(definition, definition, state, storage)
  }

  return result
}
