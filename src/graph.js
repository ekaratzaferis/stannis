/**
 * Generate a graph representation of a workflow definition.
 *
 * @param {object} definition - normalized definition
 * @param {object|null} state - execution state (for status colors), or null
 * @param {'json'|'mermaid'|'html'} format
 * @returns {object|string}
 */
export function graph(definition, state, format = 'json') {
  const nodes = []
  const edges = []

  _walkGraph(definition, null, nodes, edges, state)

  if (format === 'json') {
    return { nodes, edges }
  }

  if (format === 'mermaid') {
    return _toMermaid(nodes, edges)
  }

  if (format === 'html') {
    const mermaid = _toMermaid(nodes, edges)
    return _toHtml(mermaid)
  }

  throw new Error(`Unknown graph format: "${format}". Use 'json', 'mermaid', or 'html'.`)
}

function _nodeLabel(node) {
  if (node.type === 'task' || node.type === 'decision') {
    return `${node.type}: ${node.service}`
  }
  return node.type
}

function _statusOf(nodeId, state) {
  if (!state) return null
  return state.nodeStates?.[nodeId]?.status ?? null
}

function _walkGraph(node, parentId, nodes, edges, state) {
  const status = _statusOf(node.id, state)
  nodes.push({
    id: node.id,
    label: _nodeLabel(node),
    type: node.type,
    status,
  })

  if (parentId) {
    edges.push({ from: parentId, to: node.id })
  }

  if (node.nodes) {
    let prevChildId = null
    for (const child of node.nodes) {
      _walkGraph(child, node.id, nodes, edges, state)
      // For sequence, add sequential edges between children
      if (node.type === 'sequence' && prevChildId) {
        edges.push({ from: prevChildId, to: child.id, label: 'then' })
      }
      prevChildId = child.id
    }
  }
}

function _sanitizeId(id) {
  // Mermaid node IDs can't contain hyphens in some contexts — replace with underscores
  return id.replace(/-/g, '_')
}

function _mermaidNode(node) {
  const safeId = _sanitizeId(node.id)
  const label = node.label.replace(/"/g, "'")
  const status = node.status ? ` [${node.status}]` : ''
  switch (node.type) {
    case 'task':
      return `  ${safeId}["${label}${status}"]`
    case 'decision':
      return `  ${safeId}{"${label}${status}"}`
    case 'sequence':
    case 'parallel':
    case 'race':
      return `  ${safeId}(["${label}${status}"])`
    default:
      return `  ${safeId}["${label}${status}"]`
  }
}

function _toMermaid(nodes, edges) {
  const lines = ['flowchart TD']
  for (const n of nodes) {
    lines.push(_mermaidNode(n))
  }
  for (const e of edges) {
    const from = _sanitizeId(e.from)
    const to = _sanitizeId(e.to)
    if (e.label) {
      lines.push(`  ${from} -->|${e.label}| ${to}`)
    } else {
      lines.push(`  ${from} --> ${to}`)
    }
  }
  return lines.join('\n')
}

function _toHtml(mermaidString) {
  const escaped = mermaidString.replace(/`/g, '\\`')
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Stannis Workflow Graph</title>
  <script type="module">
    import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.esm.min.mjs'
    mermaid.initialize({ startOnLoad: true, theme: 'default' })
  </script>
</head>
<body>
  <div class="mermaid">
${mermaidString}
  </div>
</body>
</html>`
}
