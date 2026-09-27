// Shared, framework-free domain code (zod schemas, domain types, pure logic).
// Product domain code arrives from M1 onward; M0 only ships infrastructure helpers.
export { parseEnv, EnvValidationError } from './env';
