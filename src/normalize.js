import { generateId } from './utils.js'

const CONTAINER_TYPES = new Set(['sequence', 'parallel', 'race'])
const ALL_TYPES = new Set(['task', 'sequence', 'parallel', 'race', 'decision'])

/**
 * Walk the definition tree and assign UUIDs to every node that lacks an `id`.
 * Mutates and returns the definition.
 * @param {object} definition
 * @returns {object}
 */
export function assignIds(definition) {
  if (!definition.id) {
    definition.id = generateId()
  }
  if (CONTAINER_TYPES.has(definition.type) && Array.isArray(definition.nodes)) {
    for (const child of definition.nodes) {
      assignIds(child)
    }
  }
  return definition
}

/**
 * Validate the definition tree. Throws a descriptive error for any issue.
 * @param {object} definition
 * @returns {object} the definition (unchanged)
 */
export function validateDefinition(definition) {
  _validate(definition, null)
  return definition
}

function _validate(node, parentId) {
  if (!node || typeof node !== 'object') {
    throw new Error(`Invalid node: expected object, got ${typeof node}`)
  }
  if (!ALL_TYPES.has(node.type)) {
    throw new Error(`Unknown node type: "${node.type}"`)
  }

  switch (node.type) {
    case 'task':
      if (!node.service || typeof node.service !== 'string') {
        throw new Error(`task node "${node.id}" must have a "service" string`)
      }
      if (node.retry != null) {
        if (typeof node.retry !== 'object') {
          throw new Error(`task node "${node.id}" retry must be an object { times, backoff }`)
        }
        if (typeof node.retry.times !== 'number' || node.retry.times < 1) {
          throw new Error(`task node "${node.id}" retry.times must be a positive number`)
        }
      }
      break

    case 'sequence':
    case 'parallel':
    case 'race':
      if (!Array.isArray(node.nodes) || node.nodes.length === 0) {
        throw new Error(`${node.type} node "${node.id}" must have a non-empty "nodes" array`)
      }
      for (const child of node.nodes) {
        _validate(child, node.id)
      }
      break

    case 'decision':
      if (!node.service || typeof node.service !== 'string') {
        throw new Error(`decision node "${node.id}" must have a "service" string`)
      }
      break
  }
}

/**
 * Recursively walk the full definition tree and build a flat nodeStates map.
 * @param {object} definition - normalized (IDs already assigned)
 * @param {string|null} parentId
 * @returns {{ [nodeId: string]: object }}
 */
export function buildNodeMap(definition, parentId = null) {
  const map = {}
  _buildMap(definition, parentId, map)
  return map
}

function _buildMap(node, parentId, map) {
  map[node.id] = {
    id: node.id,
    type: node.type,
    service: node.service ?? null,
    status: 'pending',
    input: null,
    output: null,
    error: null,
    executionCount: 0,
    parentId,
  }

  if (CONTAINER_TYPES.has(node.type) && Array.isArray(node.nodes)) {
    for (const child of node.nodes) {
      _buildMap(child, node.id, map)
    }
  }
}
