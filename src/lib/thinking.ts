export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
export type ThinkingLevel = typeof THINKING_LEVELS[number]
export type RecordedThinking = ThinkingLevel | 'unsupported'

export function isThinkingLevel(value: unknown): value is ThinkingLevel {
  return typeof value === 'string' && (THINKING_LEVELS as readonly string[]).includes(value)
}

export interface ThinkingModel {
  id: string
  thinkingLevels: ThinkingLevel[]
  defaultThinking: ThinkingLevel
  reasoning: boolean
}

export function promptEfforts(selected: ThinkingLevel[] | undefined, model: ThinkingModel | undefined): ThinkingLevel[] {
  return selected ?? (model ? [model.defaultThinking] : [])
}

export function effortProblem(efforts: ThinkingLevel[], model: ThinkingModel | undefined): string | null {
  if (!model) return 'No model is ready. Reload generation settings or choose an available model.'
  const unavailable = efforts.filter(level => !model.thinkingLevels.includes(level))
  if (unavailable.length) return `Unavailable for this model: ${unavailable.join(', ')}. Review the choices below.`
  if (!efforts.length) return 'Select at least one thinking effort.'
  if (new Set(efforts).size !== efforts.length) return 'Select each effort only once.'
  return null
}

export function thinkingLabel(data: { thinking?: RecordedThinking; requestedThinking?: ThinkingLevel }): string {
  if (!data.thinking) return data.requestedThinking ? `Thinking: unconfirmed (requested ${data.requestedThinking})` : 'Thinking: not recorded'
  if (data.thinking === 'unsupported') return 'Thinking: not supported'
  const different = data.requestedThinking && data.requestedThinking !== data.thinking
  return `Thinking: ${data.thinking}${different ? ` (requested ${data.requestedThinking})` : ''}`
}

export interface GenerationMetadata {
  model: string
  thinking?: RecordedThinking
}

export function isGenerationMetadata(value: unknown): value is GenerationMetadata {
  if (!value || typeof value !== 'object') return false
  const data = value as Record<string, unknown>
  return typeof data.model === 'string' && !!data.model.trim() &&
    (data.thinking === undefined || data.thinking === 'unsupported' || isThinkingLevel(data.thinking))
}
