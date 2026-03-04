// Always returns a controlled error (never recovers). Used for exhausted-retries tests.
export default async function alwaysError() {
  return { error: 'permanent failure' }
}
