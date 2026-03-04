/**
 * Generate a graph representation of a workflow definition.
 *
 * @param {object} definition - normalized definition
 * @param {object|null} state - execution state (for status colors), or null
 * @param {'json'|'mermaid'|'html'} format
 * @returns {object|string}
 */
export function graph(definition, state, format = 'json') {
  if (format === 'json') {
    const nodes = []
    const edges = []
    _walkGraph(definition, null, nodes, edges, state)
    return { nodes, edges }
  }

  if (format === 'mermaid') {
    return _buildMermaid(definition, state)
  }

  if (format === 'html') {
    return _toHtml(_buildMermaid(definition, state))
  }

  throw new Error(`Unknown graph format: "${format}". Use 'json', 'mermaid', or 'html'.`)
}

// ── JSON format (unchanged) ────────────────────────────────────────────────

function _jsonNodeLabel(node) {
  if (node.type === 'task' || node.type === 'decision') {
    return `${node.type}: ${node.service}`
  }
  return node.type
}

function _walkGraph(node, parentId, nodes, edges, state) {
  const status = state?.nodeStates?.[node.id]?.status ?? null
  nodes.push({ id: node.id, label: _jsonNodeLabel(node), type: node.type, status })

  if (parentId) {
    edges.push({ from: parentId, to: node.id })
  }

  if (node.nodes) {
    let prevChildId = null
    for (const child of node.nodes) {
      _walkGraph(child, node.id, nodes, edges, state)
      if (node.type === 'sequence' && prevChildId) {
        edges.push({ from: prevChildId, to: child.id, label: 'then' })
      }
      prevChildId = child.id
    }
  }
}

// ── Mermaid format (hierarchical) ─────────────────────────────────────────

/** Replace non-alphanumeric chars so the ID is safe in Mermaid. */
function _sid(id) {
  return id.replace(/[^a-zA-Z0-9]/g, '_')
}

function _statusOf(nodeId, state) {
  return state?.nodeStates?.[nodeId]?.status ?? null
}

function _execCount(nodeId, state) {
  return state?.nodeStates?.[nodeId]?.executionCount ?? 0
}

function _svcName(service) {
  return (service ?? '').split('/').pop().replace('.js', '')
}

function _isUUID(str) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str)
}

/**
 * Render the structural definition (subgraphs + leaf nodes) into Mermaid lines.
 */
function _renderStructure(node, lines, state, indent) {
  const pad = ' '.repeat(indent)
  const id = _sid(node.id)
  const status = _statusOf(node.id, state)
  const count = _execCount(node.id, state)
  const statusPart = status ? ` [${status}]` : ''
  const countPart = count > 1 ? ` \xD7${count}` : ''
  // Show custom IDs (non-UUID) in labels for readability
  const customId = !_isUUID(node.id) ? node.id : null

  if (node.type === 'task') {
    const nameLine = customId ? `${customId}\\n${_svcName(node.service)}` : _svcName(node.service)
    lines.push(`${pad}${id}["${nameLine}${statusPart}${countPart}"]`)
  } else if (node.type === 'decision') {
    const nameLine = customId ? `${customId}\\n${_svcName(node.service)}` : _svcName(node.service)
    lines.push(`${pad}${id}{"${nameLine}${statusPart}${countPart}"}`)
  } else {
    // Container node → Mermaid subgraph for visual nesting
    const idPart = customId ? ` (${customId})` : ''
    const subLabel = `${node.type}${idPart}${statusPart}`
    lines.push(`${pad}subgraph ${id}["${subLabel}"]`)
    for (const child of node.nodes ?? []) {
      _renderStructure(child, lines, state, indent + 2)
    }
    lines.push(`${pad}end`)
  }
}

/**
 * Render edges for the definition tree.
 * - sequence: chain children left-to-right
 * - parallel/race: fan-out from container to each child
 * - decision: goTo (with ×count if looped) and next → DONE
 */
function _renderEdges(node, lines, state) {
  if (node.type === 'sequence') {
    // Chain consecutive children: child[i] --> child[i+1]
    for (let i = 0; i < node.nodes.length - 1; i++) {
      lines.push(`  ${_sid(node.nodes[i].id)} --> ${_sid(node.nodes[i + 1].id)}`)
    }
    for (const child of node.nodes) {
      _renderEdges(child, lines, state)
    }
  } else if (node.type === 'parallel' || node.type === 'race') {
    // Fan-out from container to each child
    for (const child of node.nodes) {
      lines.push(`  ${_sid(node.id)} --> ${_sid(child.id)}`)
    }
    for (const child of node.nodes) {
      _renderEdges(child, lines, state)
    }
  } else if (node.type === 'decision') {
    const id = _sid(node.id)
    const output = state?.nodeStates?.[node.id]?.output
    const count = _execCount(node.id, state)

    if (output?.next === true) {
      // Flow completed — show goTo loop edges if it looped before passing
      if (count > 1 && node.input?.nodeId) {
        lines.push(`  ${id} -->|"goTo \xD7${count - 1}"| ${_sid(node.input.nodeId)}`)
      }
      lines.push(`  ${id} -->|next| DONE`)
    } else if (output?.goTo) {
      // Ended mid-loop (partial execution)
      lines.push(`  ${id} -->|goTo| ${_sid(output.goTo)}`)
    } else {
      // No execution state — show possible paths as dashed
      if (node.input?.nodeId) {
        lines.push(`  ${id} -.->|goTo| ${_sid(node.input.nodeId)}`)
      }
      lines.push(`  ${id} -.->|next| DONE`)
    }
  }
}

function _buildMermaid(definition, state) {
  const structLines = []
  const edgeLines = []

  _renderStructure(definition, structLines, state, 2)
  _renderEdges(definition, edgeLines, state)

  const lines = ['flowchart LR', '', '  DONE((done))', '']
  lines.push(...structLines)
  if (edgeLines.length > 0) {
    lines.push('', ...edgeLines)
  }
  return lines.join('\n')
}

function _toHtml(mermaidString) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Stannis Workflow Graph</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { width: 100%; height: 100%; background: #0f1117; overflow: hidden; }
    .mermaid { width: 100%; height: 100%; padding: 16px; }
    .mermaid svg { display: block; width: 100% !important; height: auto !important; max-width: none !important; }
  </style>
  <script type="module">
    import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.esm.min.mjs'
    mermaid.initialize({ startOnLoad: false, theme: 'dark' })
    await mermaid.run()
    const svg = document.querySelector('.mermaid svg')
    if (svg) {
      svg.removeAttribute('width')
      svg.removeAttribute('height')
      svg.removeAttribute('style')
    }
  </script>
</head>
<body>
  <div class="mermaid">
${mermaidString}
  </div>
</body>
</html>`
}
