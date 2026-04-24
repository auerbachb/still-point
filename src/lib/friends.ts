const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

function normalizeUuidForComparison(value: string): string {
  return value.replace(/-/g, "").toLowerCase();
}

/** Canonical undirected pair using PostgreSQL UUID ordering semantics. */
export function orderedUserPair(userA: string, userB: string): [string, string] {
  const normalizedA = normalizeUuidForComparison(userA);
  const normalizedB = normalizeUuidForComparison(userB);
  return normalizedA < normalizedB ? [userA, userB] : [userB, userA];
}
