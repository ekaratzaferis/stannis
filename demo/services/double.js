// input: { "prop": "x" }
// Finds the most recent value of that prop across all history outputs and doubles it.
// Returns 1 if the prop hasn't appeared in history yet.
export default async function double(history, input) {
  const prop = input.prop
  const values = Object.values(history)
  for (let i = values.length - 1; i >= 0; i--) {
    if (values[i] && typeof values[i][prop] === 'number') {
      return { [prop]: values[i][prop] * 2 }
    }
  }
  return { [prop]: 1 }
}
