/**
 * Load execution state from storage.
 * @param {object} storage - { get(key): Promise<any>, set(key, value): Promise<void> }
 * @param {string} flowId
 * @returns {Promise<object|null>}
 */
export async function loadState(storage, flowId) {
  return storage.get(`stannis:${flowId}`)
}

/**
 * Save execution state to storage.
 * @param {object} storage
 * @param {object} state
 * @returns {Promise<void>}
 */
export async function saveState(storage, state) {
  await storage.set(`stannis:${state.id}`, state)
}

/**
 * Return a new state with the given node's state patched.
 * @param {object} state
 * @param {string} nodeId
 * @param {object} patch
 * @returns {object}
 */
export function updateNode(state, nodeId, patch) {
  return {
    ...state,
    nodeStates: {
      ...state.nodeStates,
      [nodeId]: {
        ...state.nodeStates[nodeId],
        ...patch,
      },
    },
  }
}

/**
 * Return a new state with the given node's output added to history.
 * @param {object} state
 * @param {string} nodeId
 * @param {any} output
 * @returns {object}
 */
export function addHistory(state, nodeId, output) {
  return {
    ...state,
    history: {
      ...state.history,
      [nodeId]: output,
    },
  }
}
