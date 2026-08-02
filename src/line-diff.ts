type DifferenceKind = 'added' | 'removed'

interface DifferenceLine {
  kind: DifferenceKind
  text: string
}

interface FormatLineDiffOptions {
  color?: boolean | undefined
}

const lines = (value: string): string[] => (value.length === 0 ? [] : value.replace(/\n$/, '').split('\n'))

const changedLines = (before: string[], after: string[]): DifferenceLine[] => {
  const commonSuffixLengths = Array.from({ length: before.length + 1 }, () =>
    Array<number>(after.length + 1).fill(0),
  )

  for (let beforeIndex = before.length - 1; beforeIndex >= 0; beforeIndex -= 1) {
    for (let afterIndex = after.length - 1; afterIndex >= 0; afterIndex -= 1) {
      if (before[beforeIndex] === after[afterIndex]) {
        commonSuffixLengths[beforeIndex]![afterIndex] =
          commonSuffixLengths[beforeIndex + 1]![afterIndex + 1]! + 1
      } else {
        commonSuffixLengths[beforeIndex]![afterIndex] = Math.max(
          commonSuffixLengths[beforeIndex + 1]![afterIndex]!,
          commonSuffixLengths[beforeIndex]![afterIndex + 1]!,
        )
      }
    }
  }

  const differences: DifferenceLine[] = []
  let beforeIndex = 0
  let afterIndex = 0
  while (beforeIndex < before.length && afterIndex < after.length) {
    if (before[beforeIndex] === after[afterIndex]) {
      beforeIndex += 1
      afterIndex += 1
    } else if (
      commonSuffixLengths[beforeIndex + 1]![afterIndex]! >=
      commonSuffixLengths[beforeIndex]![afterIndex + 1]!
    ) {
      differences.push({ kind: 'removed', text: before[beforeIndex]! })
      beforeIndex += 1
    } else {
      differences.push({ kind: 'added', text: after[afterIndex]! })
      afterIndex += 1
    }
  }

  differences.push(...before.slice(beforeIndex).map(text => ({ kind: 'removed' as const, text })))
  differences.push(...after.slice(afterIndex).map(text => ({ kind: 'added' as const, text })))
  return differences
}

const background = {
  added: '\u001B[48;2;28;58;39m',
  removed: '\u001B[48;2;54;32;30m',
} as const

export const formatLineDiff = (
  before: string,
  after: string,
  { color = process.stdout.isTTY === true }: FormatLineDiffOptions = {},
): string =>
  changedLines(lines(before), lines(after))
    .map(({ kind, text }) => {
      const line = `${kind === 'added' ? '+' : '-'} ${text}`
      return color ? `${background[kind]}${line}\u001B[0m` : line
    })
    .join('\n')
