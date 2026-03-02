// Jumps to process.env.GOTO_TARGET
export default async function gotoForward() {
  const target = process.env.GOTO_TARGET
  if (!target) throw new Error('GOTO_TARGET env var not set')
  return { goTo: target }
}
