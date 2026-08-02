import { describe, expect, it } from 'vitest'

import { createRulesetImport } from './ruleset.js'

describe('createRulesetImport', () => {
  it('creates an active branch ruleset with the expected checks', () => {
    expect(
      JSON.parse(
        createRulesetImport({
          checks: ['Required checks auditor', 'test-and-lint'],
          targetBranch: 'release/1.2',
        }),
      ),
    ).toEqual({
      conditions: {
        ref_name: {
          exclude: [],
          include: ['refs/heads/release/1.2'],
        },
      },
      enforcement: 'active',
      name: 'Required PR checks for release/1.2',
      rules: [
        {
          parameters: {
            do_not_enforce_on_create: true,
            required_status_checks: [{ context: 'Required checks auditor' }, { context: 'test-and-lint' }],
            strict_required_status_checks_policy: false,
          },
          type: 'required_status_checks',
        },
      ],
      target: 'branch',
    })
  })
})
