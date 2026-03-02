import { assignIds, validateDefinition, buildNodeMap } from './normalize.js'
import { loadState, saveState } from './state.js'
import { run as executeRun, findNode, findParentNode } from './executor.js'
import { graph as buildGraph } from './graph.js'
import { print as buildPrint } from './print.js'
import { generateId } from './utils.js'

/**
 * Create a Stannis workflow executor.
 *
 * @param {object} options
 * @param {object} options.definition - workflow definition tree
 * @param {object} options.storage - { get(key): Promise<any>, set(key, value): Promise<void> }
 * @returns {{ run(resumeToken?): Promise<object>, print(): Promise<string>, graph(format?): Promise<string|object> }}
 */
export function createStannis({ definition, storage }) {
  // Normalize the definition once at creation time
  const normalized = assignIds(validateDefinition(structuredClone(definition)))

  return {
    /**
     * Run the workflow (or resume from a token).
     *
     * @param {object} [resumeToken] - { flowId, nodeId } to resume; omit for fresh start
     * @returns {Promise<{ flowId: string, status: string, token: object|null|Array, history: object }>}
     */
    async run(resumeToken) {
      let state

      if (resumeToken) {
        // Resume: load existing state
        state = await loadState(storage, resumeToken.flowId)
        if (!state) {
          throw new Error(`No state found for flowId: ${resumeToken.flowId}`)
        }

        const startNodeId = resumeToken.nodeId
        if (startNodeId && !findNode(normalized, startNodeId)) {
          throw new Error(`Resume node "${startNodeId}" not found`)
        }

        state = { ...state, status: 'running' }
        await saveState(storage, state)

        // Determine effective dispatch entry point.
        // For async-parallel children: dispatch the specific branch only.
        // For everything else (sequences, root nodes): re-dispatch from root so the
        // parent sequence naturally skips completed siblings and continues onwards.
        let dispatchNodeId = null // null = root
        if (startNodeId) {
          const parent = findParentNode(normalized, startNodeId)
          if (parent?.type === 'parallel' && parent?.async) {
            dispatchNodeId = startNodeId
          }
        }

        const result = await executeRun(normalized, state, storage, dispatchNodeId)
        state = result.state

        if (!result.token) {
          state = { ...state, status: 'completed' }
          await saveState(storage, state)
        }

        return {
          flowId: state.id,
          status: state.status,
          token: result.token ?? null,
          history: state.history,
        }
      }

      // Fresh start
      const flowId = generateId()
      const nodeStates = buildNodeMap(normalized)

      state = {
        id: flowId,
        status: 'running',
        definition: normalized,
        history: {},
        nodeStates,
      }
      await saveState(storage, state)

      const result = await executeRun(normalized, state, storage, null)
      state = result.state

      if (!result.token) {
        state = { ...state, status: 'completed' }
        await saveState(storage, state)
      }

      return {
        flowId: state.id,
        status: state.status,
        token: result.token ?? null,
        history: state.history,
      }
    },

    /**
     * Load the latest state for a flow and return a formatted status string.
     * If flowId is provided, loads that flow; otherwise loads most recent (not supported without flowId).
     *
     * @param {string} flowId
     * @returns {Promise<string>}
     */
    async print(flowId) {
      if (!flowId) throw new Error('print() requires a flowId')
      const state = await loadState(storage, flowId)
      if (!state) throw new Error(`No state found for flowId: ${flowId}`)
      return buildPrint(state)
    },

    /**
     * Generate a graph representation of the workflow.
     * Optionally loads live status from storage if flowId provided.
     *
     * @param {'json'|'mermaid'|'html'} [format='json']
     * @param {string} [flowId] - if provided, load current node statuses
     * @returns {Promise<object|string>}
     */
    async graph(format = 'json', flowId) {
      let state = null
      if (flowId) {
        state = await loadState(storage, flowId)
      }
      return buildGraph(normalized, state, format)
    },
  }
}
