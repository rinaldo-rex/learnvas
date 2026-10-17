import type { ChatMsg } from '../types'
import { effortProblem, type ThinkingLevel, type ThinkingModel } from './thinking.ts'

/** All siblings receive the same immutable-by-convention inputs. No output from
 * one comparison answer is ever fed into another. Explicit IDs pin pi default. */
export function comparisonSnapshot(input: {
  model: ThinkingModel
  efforts: ThinkingLevel[]
  messages: ChatMsg[]
  globalNotes: string
  threadNotes: string
}) {
  const problem = effortProblem(input.efforts, input.model)
  if (problem) throw new Error(problem)
  return {
    model: input.model.id,
    efforts: input.model.thinkingLevels.filter(level => input.efforts.includes(level)),
    messages: input.messages.map(message => ({ ...message })),
    globalNotes: input.globalNotes,
    threadNotes: input.threadNotes,
  }
}
export type ComparisonSnapshot = ReturnType<typeof comparisonSnapshot>

/** Place after existing siblings, including user-resized cards. This only
 * chooses the new card's offset; it never rearranges the learner's canvas. */
export function responseOffset(side: string, base: { x: number; y: number }, siblings: {
  position: { x: number; y: number }; width: number; height: number
}[]): number {
  return Math.max(0, ...siblings.map(node => {
    if (side === 'top' || side === 'bottom') return node.position.x + node.width + 40 - base.x
    if (side === 'corner') return base.y + 480 + 40 - node.position.y
    return node.position.y + node.height + 40 - base.y
  }))
}
