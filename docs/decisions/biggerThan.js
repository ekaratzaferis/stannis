// input: { "prop": "x", "bt": 5, "nodeId": "race-node" }
//   prop   — property name to scan history for (most recent value)
//   bt     — threshold (biggerThan)
//   nodeId — node id to jump back to if condition not met
//
// Returns { next: true } if the most recent value of prop > bt,
// otherwise { goTo: nodeId } to loop back.
export default async function biggerThan(history, input) {
  const { prop, bt, nodeId } = input
  const values = Object.values(history)
  let val = 0
  for (let i = values.length - 1; i >= 0; i--) {
    if (values[i] && typeof values[i][prop] === 'number') {
      val = values[i][prop]
      break
    }
  }
  return val > bt ? { next: true } : { goTo: nodeId }
}
