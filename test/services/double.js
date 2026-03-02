export default async function double(history) {
  const values = Object.values(history)
  const last = values[values.length - 1]
  const value = (last?.value ?? 0)
  return { value: value * 2 }
}
