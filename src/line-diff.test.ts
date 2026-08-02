import { describe, expect, it } from 'vitest'

import { formatLineDiff } from './line-diff.js'

describe('formatLineDiff', () => {
  it('shows only changed lines without hunk framing', () => {
    expect(
      formatLineDiff('name: Audit\nwait-seconds: 30\n', 'name: Audit\nwait-seconds: 45\n', {
        color: false,
      }),
    ).toBe('- wait-seconds: 30\n+ wait-seconds: 45')
  })

  it('uses muted red and green backgrounds without changing the text color', () => {
    expect(formatLineDiff('old\n', 'new\n', { color: true })).toBe(
      '\u001B[48;2;54;32;30m- old\u001B[0m\n\u001B[48;2;28;58;39m+ new\u001B[0m',
    )
  })
})
