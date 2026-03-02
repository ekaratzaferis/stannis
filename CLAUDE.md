# Stannis — Architecture & Developer Guide

## What Is Stannis?

A lightweight JavaScript library for durable task execution.
Zero external dependencies. ESM only. Plain JS with JSDoc types.

Mental model: AWS Step Functions + JS Promises + FSM, designed for serverless.

---

## The 6 Node Types that we need in order to describe every possible workflow

### Base node contract

- This node accepts a JSON input and the path of a module that will be imported in order to carry out the task
- The optional parameters are:
    - break: a boolean flag that indicates whether the execution flow will be broken AFTER the task execution. when the flow breaks, the lib should return data to the caller that will allow him to retrigger the exuction from the next node
    - retry: a Number that indicates how many times this task should be retried
- Produces an output JSON object and an error message

```js
export default async function(input, ctx) {
  return {
    type: 'task',
    metadata: { ... }, // stuff like number of execution so that we know if we should retry it or not, the parent node id, status, etc
    service: '', // the module path
    input: { ... }
    output: { ... },
    break: true,
    retry: true,
    error: 'message',
  }
}
```

### Sequential node contract

- This node accepts as input an array of other nodes.
- Each node in this array is evaluated in order
    - If it's a basic node, then we execute the task
    - If it's another sequence, we start execution of the sequence
    - etc

```js
export default async function(input, ctx) {
  return {
    type: 'sequence',
    metadata: { ... }, // stuff like number of execution so that we know if we should retry it or not, the parent node id, status, etc
    nodes: []
  }
}
```

### Parallel node contract

- This node accepts as input an array of other nodes.
- Think of this as the Promise.all equivalent. It will process all subnode in parallel
- Optional Parameter: 
    - async: a boolean flag. if true the execution stops and the library returns enough data to the caller in order to be able to re-trigger each sub-node individually. This is important. If a re-trigger happens, it will continue only one of these subnodes. In order for this parallel node to finish, all subnodes should have been executed.
- This node not only splits the execution flow into multiple branches, but is also responsible to await for the resolution of every subnode!

```js
export default async function(input, ctx) {
  return {
    type: 'parallel',
    async: true,
    metadata: { ... }, // stuff like number of execution so that we know if we should retry it or not, the parent node id, status, etc
    nodes: []
  }
}
```

### Race node contract

- This node accepts as input an array of other nodes.
- Think of this as the Promise.race equivalent. It will process all subnode in parallel, but stop as soon as one is done
- This node splits the execution flow into multiple branches, end it terminates as soon as the first one is resolved.
- No need for async param here

```js
export default async function(input, ctx) {
  return {
    type: 'race',
    metadata: { ... }, // stuff like number of execution so that we know if we should retry it or not, the parent node id, status, etc
    nodes: []
  }
}
```

### Decision node contract

This node resembles the base node, because it will require to import a module in order to make the desicion.
The input will be the output of every previously executed node. Also a path of the module that will make the decision.
The output will be
- a boolean flag called next. If true, it proceed with the execution of the next node
- a string "goTo". If present, it marks the ID of the node that the flow will return or jump to. This allows for FSM like flows

```js
export default async function(input, ctx) {
  return {
    type: 'decision',
    service: '', // the module path
    metadata: { ... }, // stuff like number of execution so that we know if we should retry it or not, the parent node id, status, etc
    output: { ... }
  }
}
```


# Architecture

The lib will follow the factory pattern. Once called, will return an instance with methods like
- print
- run
- graph
- etc

The execution flow will be generated beforehand. Except for "goto" jumps. 

That means that every time the lib is invoked to create an executioner, the entire JSON object that describes the flow is precreated.

Since we need some kind of memory in order to allow breaking and restarting the flow, the lib will accept a set and get methods that write/read the JSON objects to some kind of memory.


---

## Constraints

- Zero external runtime dependencies (node:crypto, node:path, node:url only)
- ESM only (`"type": "module"`)
- Plain JavaScript with JSDoc types (no TypeScript, no build step)
- Decision nodes MUST return `next` or `goTo
- Module paths: `./` or `../` resolved from `process.cwd()`; others passed to `import()` as-is
- Storage adapter: only `get(key)` and `set(key, value)` required
