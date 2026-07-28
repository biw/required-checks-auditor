import { describe, expect, it } from 'vitest'

import { parseWaitSeconds } from './wait.js'

describe('parseWaitSeconds', () => {
  it('accepts non-negative whole seconds', () => {
    expect(parseWaitSeconds('0')).toBe(0)
    expect(parseWaitSeconds(' 30 ')).toBe(30)
  })

  it.each(['', '-1', '1.5', 'thirty'])('rejects an invalid duration: %s', value => {
    expect(() => parseWaitSeconds(value)).toThrow('wait-seconds must be a non-negative whole number')
  })
})
