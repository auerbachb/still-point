const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/** Canonical undirected pair: user1Id < user2Id lexicographically. */
export function orderedUserPair(userA: string, userB: string): [string, string] {
  return userA < userB ? [userA, userB] : [userB, userA];
}
