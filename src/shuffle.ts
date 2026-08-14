/**
 * Pick a track that has not been selected during the current shuffle cycle.
 * The supplied set is updated in place so callers can keep the cycle history
 * synchronous even when playback events arrive before React re-renders.
 */
export function pickNextShuffledId(
  trackIds: string[],
  currentId: string | null,
  played: Set<string>,
  random: () => number = Math.random,
): string | null {
  if (!trackIds.length) return null

  const queuedIds = new Set(trackIds)
  for (const id of played) {
    if (!queuedIds.has(id)) played.delete(id)
  }
  if (currentId) played.add(currentId)

  let candidates = trackIds.filter((id) => id !== currentId && !played.has(id))

  // Start another complete cycle only after every queued track was selected.
  // The current track belonged to the old cycle: exclude it from this one pick
  // to prevent an immediate repeat, but do not count it in the new cycle.
  if (!candidates.length) {
    played.clear()
    candidates = trackIds.filter((id) => id !== currentId)
  }

  // A one-track queue has no alternative, so replaying it is unavoidable.
  if (!candidates.length) return trackIds[0]

  const index = Math.min(
    Math.floor(random() * candidates.length),
    candidates.length - 1,
  )
  const nextId = candidates[index]
  played.add(nextId)
  return nextId
}
