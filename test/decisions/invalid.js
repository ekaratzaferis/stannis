// Returns neither next nor goTo — should cause an error
export default async function invalid() {
  return { something: 'else' }
}
