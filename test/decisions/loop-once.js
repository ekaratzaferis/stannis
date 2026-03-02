// Returns goTo on first invocation, next: true thereafter
// The target node ID is read from process.env.LOOP_TARGET
let called = false

export default async function loopOnce(_history, _ctx) {
  if (!called) {
    called = true
    const target = process.env.LOOP_TARGET
    if (!target) throw new Error('LOOP_TARGET env var not set')
    return { goTo: target }
  }
  return { next: true }
}

export function reset() {
  called = false
}
