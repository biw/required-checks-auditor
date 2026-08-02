import { describe, expect, it } from 'vitest'

import { resolveTargetBranch } from './target-branch.js'

describe('resolveTargetBranch', () => {
  it('keeps an explicit protected branch for stacked pull requests', () => {
    expect(
      resolveTargetBranch({
        githubBaseRef: 'stack/first-pr',
        pullRequestBaseRef: 'stack/first-pr',
        targetBranch: 'main',
      }),
    ).toBe('main')
  })

  it('falls back from the PR base branch to main', () => {
    expect(resolveTargetBranch({ pullRequestBaseRef: 'develop' })).toBe('develop')
    expect(resolveTargetBranch({})).toBe('main')
  })
})
