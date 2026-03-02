export default async function alwaysStop() {
  return { next: false }
}
