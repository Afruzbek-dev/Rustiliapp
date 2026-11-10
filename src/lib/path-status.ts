export type PartStatus = 'locked' | 'available' | 'in_progress' | 'completed'
export type PartProgress = 'in_progress' | 'completed'

/**
 * Parts are sequential: everything before the first incomplete part is completed,
 * the first incomplete one is in_progress (if progress exists) or available,
 * everything after is locked.
 */
export function computePathStatus(
  parts: { id: string; order: number }[],
  progress: Map<string, PartProgress>,
): Map<string, PartStatus> {
  const sorted = [...parts].sort((a, b) => a.order - b.order)
  const out = new Map<string, PartStatus>()
  let frontierFound = false
  for (const p of sorted) {
    const prog = progress.get(p.id)
    if (frontierFound) out.set(p.id, 'locked')
    else if (prog === 'completed') out.set(p.id, 'completed')
    else {
      frontierFound = true
      out.set(p.id, prog === 'in_progress' ? 'in_progress' : 'available')
    }
  }
  return out
}

/** Lesson status from its two part statuses. */
export function computeLessonStatus(partStatuses: PartStatus[]): PartStatus {
  if (partStatuses.length > 0 && partStatuses.every((s) => s === 'completed')) return 'completed'
  if (partStatuses.includes('in_progress')) return 'in_progress'
  if (partStatuses.includes('available')) return 'available'
  return 'locked'
}

/** Module test is available only when every lesson of the module is completed. */
export function moduleTestStatus(lessonStatuses: PartStatus[]): 'locked' | 'available' {
  return lessonStatuses.length > 0 && lessonStatuses.every((s) => s === 'completed')
    ? 'available'
    : 'locked'
}
