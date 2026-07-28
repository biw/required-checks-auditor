export const parseWaitSeconds = (value: string): number => {
  const trimmedValue = value.trim()
  if (!/^(0|[1-9]\d*)$/.test(trimmedValue)) {
    throw new Error('wait-seconds must be a non-negative whole number of seconds.')
  }

  const seconds = Number(trimmedValue)
  if (!Number.isSafeInteger(seconds)) {
    throw new Error('wait-seconds must be a safe whole number of seconds.')
  }

  return seconds
}

export const waitForSeconds = async (seconds: number): Promise<void> => {
  if (seconds === 0) {
    return
  }

  await new Promise<void>(resolve => {
    setTimeout(resolve, seconds * 1_000)
  })
}
