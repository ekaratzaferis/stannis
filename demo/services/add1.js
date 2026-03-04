// input: { "prop": "x" }
// Finds the most recent value of that prop across all history outputs and adds 1.
// Returns 1 if the prop hasn't appeared in history yet.
export default async function add1(history, input) {
  const prop = input.prop
  const values = Object.values(history)
  for (let i = values.length - 1; i >= 0; i--) {
    if (values[i] && typeof values[i][prop] === 'number') {
      return { [prop]: values[i][prop] + 1 }
    }
  }
  return { [prop]: 1 }
}
