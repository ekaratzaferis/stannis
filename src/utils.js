import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'

/**
 * Generate a unique node/flow ID.
 * @returns {string}
 */
export function generateId() {
  return randomUUID()
}

/**
 * Resolve a service module path.
 * Paths starting with ./ or ../ are resolved from process.cwd().
 * All others are passed through as-is (bare specifiers, absolute paths).
 * @param {string} service
 * @returns {string}
 */
export function resolveModulePath(service) {
  if (service.startsWith('./') || service.startsWith('../')) {
    return resolve(process.cwd(), service)
  }
  return service
}
