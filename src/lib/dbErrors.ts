/** Postgres SQLSTATE for unique_violation. */
const UNIQUE_VIOLATION = "23505";

/**
 * Returns the failed constraint name when `e` is a Postgres unique_violation
 * (SQLSTATE 23505), or `null` otherwise. The constraint name may be an empty
 * string if the driver did not surface it.
 *
 * Recursively unwraps `cause` so wrapped errors (e.g., from drizzle / neon
 * adapters) are still detected.
 */
export function uniqueViolationConstraint(e: unknown): string | null {
  if (!e || typeof e !== "object") return null;
  const o = e as { code?: string; constraint?: string; constraint_name?: string; cause?: unknown };
  if (o.code === UNIQUE_VIOLATION) return o.constraint ?? o.constraint_name ?? "";
  if (o.cause) return uniqueViolationConstraint(o.cause);
  return null;
}

/** Convenience boolean check around `uniqueViolationConstraint`. */
export function isUniqueViolation(e: unknown): boolean {
  return uniqueViolationConstraint(e) !== null;
}
