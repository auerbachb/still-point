const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  if (normalizedA < normalizedB) {
    return [userA, userB];
  }

  if (normalizedA > normalizedB) {
    return [userB, userA];
  }

  return userA < userB ? [userA, userB] : [userB, userA];
}
