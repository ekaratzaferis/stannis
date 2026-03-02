let count = 0

export default async function counter() {
  count += 1
  return { count }
}

export function getCount() {
  return count
}

export function resetCount() {
  count = 0
}
