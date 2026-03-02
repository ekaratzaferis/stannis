// Returns a controlled error object (not a throw) on first call, success on retry
let callCount = 0

export default async function controlledError() {
  callCount += 1
  if (callCount === 1) {
    return { error: 'first attempt failed' }
  }
  return { value: 'recovered' }
}

export function resetCallCount() {
  callCount = 0
}
