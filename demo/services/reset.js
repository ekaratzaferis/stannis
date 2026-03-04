// input: { "prop": "x" }
// Sets the prop to 0, regardless of history.
export default async function reset(history, input) {
  return { [input.prop]: 0 }
}
