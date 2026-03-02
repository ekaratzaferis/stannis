/**
 * Generate a human-readable status string for a flow.
 *
 * @param {object} state - execution state
 * @returns {string}
 */
export function print(state) {
  const lines = [`Flow: ${state.id} [${state.status}]`]
  _printNode(state.definition, state.nodeStates, 0, lines)
  return lines.join('\n')
}

const STATUS_ICONS = {
  completed: '✓',
  failed: '✗',
  broken: '✗',
  running: '→',
  skipped: '⊘',
  pending: ' ',
}

function _icon(status) {
  return STATUS_ICONS[status] ?? '?'
}

function _printNode(node, nodeStates, depth, lines) {
  const ns = nodeStates[node.id]
  if (!ns) return

  const indent = '  '.repeat(depth)
  const icon = _icon(ns.status)
  const label = node.type === 'task' || node.type === 'decision'
    ? `${node.type} ${node.service}`
    : node.type

  const errorSuffix = ns.error ? `  — "${ns.error}"` : ''
  lines.push(`${indent}[${icon}] ${label}${errorSuffix}`)

  if (node.nodes) {
    for (const child of node.nodes) {
      _printNode(child, nodeStates, depth + 1, lines)
    }
  }
}
