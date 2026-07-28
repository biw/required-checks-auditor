type PullRequestEventPayload = Record<string, unknown>

const isCommitSha = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{40}$/i.test(value)

export const observedCheckRefs = ({
  eventName,
  payload,
  workflowSha,
}: {
  eventName: string
  payload: PullRequestEventPayload
  workflowSha: string
}): string[] => {
  const refs = new Set([workflowSha])
  if (eventName === 'pull_request' && payload.action === 'synchronize' && isCommitSha(payload.before)) {
    refs.add(payload.before)
  }

  return [...refs]
}
