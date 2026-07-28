import { describe, expect, it } from 'vitest'

import { observedCheckRefs } from './observation.js'

const currentSha = 'b'.repeat(40)
const previousSha = 'a'.repeat(40)

describe('observedCheckRefs', () => {
  it('includes the previous PR head SHA only for synchronize events', () => {
    expect(
      observedCheckRefs({
        eventName: 'pull_request',
        payload: { action: 'synchronize', before: previousSha },
        workflowSha: currentSha,
      }),
    ).toEqual([currentSha, previousSha])
  })

  it('does not include an invalid or duplicated prior SHA', () => {
    expect(
      observedCheckRefs({
        eventName: 'pull_request',
        payload: { action: 'synchronize', before: currentSha },
        workflowSha: currentSha,
      }),
    ).toEqual([currentSha])
    expect(
      observedCheckRefs({
        eventName: 'pull_request',
        payload: { action: 'opened', before: previousSha },
        workflowSha: currentSha,
      }),
    ).toEqual([currentSha])
  })
})
