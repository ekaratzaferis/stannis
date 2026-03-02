# Stannis

Lightweight durable workflow execution for Node.js.

**Mental model:** AWS Step Functions + JS Promises + FSM — designed for serverless environments where a single logical flow may span multiple process invocations.

- Zero runtime dependencies
- ESM only (`"type": "module"`)
- Plain JavaScript with JSDoc types (no build step)
- Node.js 20+

---

## Install

```bash
npm install stannis
```

---

## Quick Start

```js
import { createStannis } from 'stannis'

// 1. Define your workflow
const definition = {
  type: 'sequence',
  nodes: [
    { id: 'validate', type: 'task', service: './tasks/validate.js' },
    { id: 'charge',   type: 'task', service: './tasks/charge.js', break: true },
    { id: 'notify',   type: 'task', service: './tasks/notify.js' },
  ],
}

// 2. Provide a storage adapter
const storage = {
  async get(key)        { /* read from your DB */ },
  async set(key, value) { /* write to your DB  */ },
}

// 3. Create and run
const flow = createStannis({ definition, storage })
const result = await flow.run()

if (result.token) {
  // Flow paused — persist the token and resume later
  console.log('Resume with:', result.token)
} else {
  console.log('Completed:', result.history)
}

// 4. Resume later
const resumed = await flow.run(savedToken)
```

---

## API

### `createStannis({ definition, storage })`

Creates a workflow executor. The definition is normalized (IDs assigned) once at creation time.

Returns an object with three methods: `run`, `print`, and `graph`.

---

### `run(resumeToken?)`

```js
const result = await flow.run()
// or
const result = await flow.run({ flowId: '...', nodeId: '...' })
```

**Returns:**

```js
{
  flowId: 'abc123',          // unique ID for this execution
  status: 'completed' | 'broken',
  token: null | { flowId, nodeId } | [{ flowId, nodeId }, ...],
  history: { nodeId: output, ... }
}
```

- `token: null` — workflow completed
- `token: { flowId, nodeId }` — workflow paused at a `break` node or after an error; pass this back to `run()` to resume
- `token: [...]` — array of tokens from an `async` parallel node; each child must be resumed separately

On every resume call, pass the token (or a manually constructed `{ flowId, nodeId }` pointing to the next node to execute).

---

### `print(flowId)`

Returns a formatted string showing the status of every node in the workflow.

```js
const str = await flow.print(result.flowId)
// Flow: abc123 [completed]
// [✓] sequence
//   [✓] task ./tasks/validate.js
//   [✓] task ./tasks/charge.js
//   [✓] task ./tasks/notify.js
```

Status icons: `✓` completed, `✗` broken/failed, `→` running, `⊘` skipped, ` ` pending.

---

### `graph(format?, flowId?)`

Returns a visual representation of the workflow.

```js
const json    = await flow.graph('json', flowId)    // { nodes, edges } for D3/vis.js
const mermaid = await flow.graph('mermaid', flowId) // flowchart TD string
const html    = await flow.graph('html', flowId)    // self-contained HTML page
```

When `flowId` is provided, node statuses are loaded from storage and included in the output.

---

## Node Types

### `task`

The basic unit of work. Imports a module and calls its default export.

```js
{
  type: 'task',
  id: 'my-step',           // optional — auto-assigned UUID if omitted
  service: './my-task.js', // module path
  break: true,             // optional — pause execution after this node completes
  retry: {                 // optional — retry on controlled error
    times: 3,
    backoff: 500,          // ms; actual delay = backoff * 2^(attempt-1)
  },
}
```

### `sequence`

Runs child nodes one after the other in order.

```js
{
  type: 'sequence',
  nodes: [ ...nodes ],
}
```

### `parallel`

Runs all child nodes concurrently.

```js
{
  type: 'parallel',
  async: false,    // default — wait for all children in the same invocation
  nodes: [ ...nodes ],
}
```

When `async: true`, execution stops immediately and returns one resume token per child. Each child must be resumed with a separate `run()` call. The parent parallel is marked complete once all children have finished.

### `race`

Runs all child nodes concurrently; stops as soon as the first one completes. All others are marked `skipped`.

```js
{
  type: 'race',
  nodes: [ ...nodes ],
}
```

### `decision`

Imports a module and uses its return value to control flow.

```js
{
  type: 'decision',
  service: './my-decision.js',
}
```

The module must return `{ next }` or `{ goTo }` — anything else throws.

| Return value       | Effect |
|--------------------|--------|
| `{ next: true }`   | Continue to the next node in the parent sequence |
| `{ next: false }`  | Stop execution (no token returned, flow ends) |
| `{ goTo: 'id' }`   | Jump to the node with that ID |

`goTo` supports both directions:
- **Forward** — intermediate nodes are marked `skipped`
- **Backward** — nodes between the target and the decision are reset to `pending`, enabling FSM-style loops

---

## Service Module Contract

Every `task` and `decision` node imports its `service` module and calls its default export:

```js
// my-task.js
export default async function(history, ctx) {
  // history: { [nodeId]: output } — outputs of all previously completed nodes
  // ctx.nodeState: current node's execution state (id, executionCount, ...)

  return { result: 'some value' } // any JSON-serialisable object
}
```

For a **task**, returning `{ error: 'message' }` (instead of throwing) triggers retry logic if configured. Throwing always breaks immediately with no retry.

For a **decision**, the return value must be `{ next: boolean }` or `{ goTo: string }`.

---

## Storage Adapter

Stannis needs a place to persist execution state across invocations. Provide any object with two async methods:

```js
const storage = {
  async get(key)        { return db.get(key)        },
  async set(key, value) { return db.set(key, value) },
}
```

Keys follow the format `stannis:{flowId}`. Values are plain JSON objects.

**Example adapters:**

```js
// In-memory (testing / single-process)
function memStore() {
  const store = new Map()
  return {
    get: async (k)    => store.get(k) ?? null,
    set: async (k, v) => store.set(k, v),
  }
}

// Redis
import { createClient } from 'redis'
const client = createClient()
const storage = {
  get: async (k)    => { const v = await client.get(k); return v ? JSON.parse(v) : null },
  set: async (k, v) => client.set(k, JSON.stringify(v)),
}

// DynamoDB / any async KV store — same two-method pattern
```

---

## Execution State

Stored under key `stannis:{flowId}`:

```js
{
  id: 'flow_abc123',
  status: 'pending' | 'running' | 'completed' | 'broken',
  definition: { ... },       // normalized definition with all IDs assigned
  history: { nodeId: output },
  nodeStates: {
    'node_id': {
      id, type, service?,
      status: 'pending' | 'running' | 'completed' | 'broken' | 'skipped',
      input: {}, output: {}, error: null | 'message',
      executionCount: 0,
      parentId: null | 'parent_node_id',
    },
    ...
  }
}
```

---

## Patterns

### Break and Resume (human-in-the-loop / serverless checkpoint)

```js
// First invocation
const r1 = await flow.run()
// r1.token = { flowId: 'abc', nodeId: null, breakAfter: 'charge' }
// Store r1.token somewhere (DB, queue message, etc.)

// Later — second invocation
const r2 = await flow.run({ flowId: r1.token.flowId, nodeId: 'notify' })
// r2.status === 'completed'
```

### Async Parallel (fan-out to separate workers)

```js
// Initial run returns one token per branch
const r0 = await flow.run()
// r0.token = [{ flowId, nodeId: 'branch-a' }, { flowId, nodeId: 'branch-b' }]

// Dispatch each token to a separate worker/lambda
for (const token of r0.token) {
  await queue.send(token)
}

// Each worker resumes its own branch
const worker = createStannis({ definition, storage })
await worker.run(token)
```

### FSM Loop (retry until condition met)

```js
// decision module: loop-until-paid.js
let attempts = 0
export default async function(history) {
  attempts++
  const paid = await checkPaymentStatus()
  if (!paid && attempts < 5) return { goTo: 'poll-payment' }
  return { next: true }
}

// definition
{
  type: 'sequence',
  nodes: [
    { id: 'poll-payment', type: 'task', service: './poll-payment.js' },
    { type: 'decision', service: './loop-until-paid.js' },
    { type: 'task', service: './fulfill-order.js' },
  ],
}
```

---

## Module Path Resolution

| Path format          | Resolved as |
|----------------------|-------------|
| `./foo.js`           | `path.resolve(process.cwd(), './foo.js')` |
| `../bar.js`          | `path.resolve(process.cwd(), '../bar.js')` |
| `my-package`         | Passed directly to `import()` |
| `/absolute/path.js`  | Passed directly to `import()` |

---

## Constraints

- No external runtime dependencies (`node:crypto`, `node:path` only)
- ESM only — `"type": "module"` required in your project
- Node.js 20+
- Decision modules **must** return `{ next }` or `{ goTo }` — anything else throws immediately
