// The one place a model is chosen, and the line that dispatches a subagent on it. Reviewers get the
// strongest Claude model; Red, Green and the Builder get it for a broad slice and the faster one for a
// contained slice. The Adversary comes from another family through OpenRouter, defaulting to the
// strongest GPT model with zero-data-retention endpoints. The harness's settings may name another
// model for any role, and a fire's options may too; the table is pinned as the run is admitted.

const DEFAULT_ADVERSARY = 'openai/gpt-6-astra';

export const MODEL_TABLE = {
  reviewer: 'claude-opus-5-5',
  'adversary-fallback': 'claude-opus-5-5',
  broad: 'claude-opus-5-5',
  contained: 'claude-sonnet-5-5',
  adversary: DEFAULT_ADVERSARY,
};

// Each subagent a session dispatches, by role: the name its dispatch gives it, and the role whose model
// it runs on.
const SUBAGENTS = {
  red: ['Red subagent', 'red'],
  green: ['Green subagent', 'green'],
  builder: ['Builder subagent', 'builder'],
  mutant: ['Mutant subagent', 'reviewer'],
  reviewer: ['Reviewer', 'reviewer'],
  contract: ['Contract Reviewer', 'reviewer'],
  'adversary-fallback': ['Adversary subagent', 'adversary-fallback'],
};

// The table `base` as `settings` name models over it, each layer's in order: its `models` by role,
// and its Adversary's model.
export function resolveModels(base, ...settings) {
  return settings.reduce((table, s) => ({ ...table, ...(s?.models ?? {}), ...(s?.adversary?.model ? { adversary: s.adversary.model } : {}) }), { ...base });
}

export function createModels(table = MODEL_TABLE) {
  const resolved = { ...table };
  const pick = (role, slice) => {
    if (['red', 'green', 'builder'].includes(role)) return resolved[slice?.complexity === 'broad' ? 'broad' : 'contained'];
    if (!(role in resolved)) throw new Error(`no model for role "${role}"`);
    return resolved[role];
  };
  return {
    table: resolved,
    pick,
    // The line that dispatches a subagent: always a fresh one, on its role's model; the caller says
    // what it is given.
    dispatch(role, slice) {
      const [name, model] = SUBAGENTS[role];
      return `Dispatch a fresh ${name} (model ${pick(model, slice)})`;
    },
  };
}
