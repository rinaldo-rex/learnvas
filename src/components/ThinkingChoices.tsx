import type { ThinkingLevel, ThinkingModel } from '../lib/thinking'

export function ThinkingChoices({ model, value, onChange }: {
  model: ThinkingModel | undefined
  value: ThinkingLevel[]
  onChange(levels: ThinkingLevel[]): void
}) {
  if (!model) return null
  if (!model.reasoning) return <div className="thinking-choices nodrag nopan">
    <span>This model has no configurable thinking effort · one normal answer.</span>
    {(value.length !== 1 || value[0] !== 'off') && <button type="button" className="ghost" onClick={() => onChange(['off'])}>Use normal answer</button>}
  </div>
  const levels = [...model.thinkingLevels, ...value.filter(level => !model.thinkingLevels.includes(level))]
  return <fieldset className="thinking-choices nodrag nopan">
    <legend>Thinking effort</legend>
    <div className="thinking-options">{levels.map(level => {
      const supported = model.thinkingLevels.includes(level)
      return <label key={level} className={supported ? '' : 'thinking-unavailable'}>
        <input type="checkbox" checked={value.includes(level)} onChange={event => onChange(event.target.checked ? [...value, level] : value.filter(item => item !== level))} />
        {level}{!supported && ' (unavailable)'}
      </label>
    })}</div>
    <p>Each selected effort makes a separate request. Selected answers run together.</p>
  </fieldset>
}
