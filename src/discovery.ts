import { parse } from 'yaml'

export interface WorkflowFile {
  content: string
  path: string
}

interface DiscoverChecksOptions {
  excludedWorkflowPaths?: string[] | undefined
  files: WorkflowFile[]
  ignoredChecks?: string[] | undefined
}

type RecordValue = Record<string, unknown>

type MatrixRow = RecordValue

const isRecord = (value: unknown): value is RecordValue =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const hasKey = (value: unknown, key: string): value is RecordValue =>
  isRecord(value) && Object.hasOwn(value, key)

const valueFor = (value: unknown, key: string): unknown => (hasKey(value, key) ? value[key] : undefined)

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : [value])

const containsEveryBranchPattern = (value: unknown): boolean => {
  const patterns = asArray(value).map(pattern => String(pattern))
  return patterns.includes('**') && !patterns.some(pattern => pattern.startsWith('!'))
}

const pullRequestRunsBeforeClose = (trigger: unknown): boolean => {
  if (!isRecord(trigger) || !hasKey(trigger, 'types')) {
    return true
  }

  return asArray(valueFor(trigger, 'types')).some(type => String(type) !== 'closed')
}

const runsOnAllPullRequestBranches = (triggers: unknown): boolean => {
  if (typeof triggers === 'string') {
    return triggers === 'pull_request' || triggers === 'pull_request_target'
  }

  if (Array.isArray(triggers)) {
    return triggers.includes('pull_request') || triggers.includes('pull_request_target')
  }

  if (!isRecord(triggers)) {
    return false
  }

  if (
    ['pull_request', 'pull_request_target'].some(
      event => hasKey(triggers, event) && pullRequestRunsBeforeClose(valueFor(triggers, event)),
    )
  ) {
    return true
  }

  if (!hasKey(triggers, 'push')) {
    return false
  }

  const push = valueFor(triggers, 'push')
  if (!isRecord(push)) {
    return true
  }

  const branches = valueFor(push, 'branches')
  if (branches !== undefined) {
    return containsEveryBranchPattern(branches)
  }

  if (valueFor(push, 'tags') !== undefined) {
    return false
  }

  const ignoredBranches = valueFor(push, 'branches-ignore')
  return ignoredBranches === undefined || !containsEveryBranchPattern(ignoredBranches)
}

const terminalJobs = (jobs: RecordValue): Array<[string, unknown]> => {
  const prerequisites = new Set(
    Object.values(jobs).flatMap(job => {
      const needs = valueFor(job, 'needs')
      return needs === undefined ? [] : asArray(needs)
    }),
  )

  return Object.entries(jobs).filter(([jobId]) => !prerequisites.has(jobId))
}

const isStaticValue = (value: unknown): boolean => {
  if (typeof value === 'string') {
    return !value.includes('${{')
  }

  if (Array.isArray(value)) {
    return value.every(isStaticValue)
  }

  if (isRecord(value)) {
    return Object.values(value).every(isStaticValue)
  }

  return value === null || ['boolean', 'number'].includes(typeof value)
}

const valuesEqual = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right)

const rowMatches = (row: MatrixRow, values: RecordValue): boolean =>
  Object.entries(values).every(([key, value]) => Object.hasOwn(row, key) && valuesEqual(row[key], value))

const combinationsFor = (dimensions: Array<[string, unknown[]]>): MatrixRow[] =>
  dimensions.reduce<MatrixRow[]>(
    (rows, [key, values]) => rows.flatMap(row => values.map(value => ({ ...row, [key]: value }))),
    [{}],
  )

const matrixRowsFor = (job: unknown): MatrixRow[] | undefined => {
  const strategy = valueFor(job, 'strategy')
  const matrix = valueFor(strategy, 'matrix')
  if (!isRecord(matrix) || !isStaticValue(matrix)) {
    return undefined
  }

  const dimensions = Object.entries(matrix).flatMap(([key, value]) =>
    key === 'include' || key === 'exclude' ? [] : [[key, asArray(value)] as [string, unknown[]]],
  )
  // A matrix made up solely of `include` entries creates one job per entry;
  // there is no empty base combination for those entries to overwrite.
  const initialRows = dimensions.length === 0 ? [] : combinationsFor(dimensions)
  const exclusions = valueFor(matrix, 'exclude')
  if (exclusions !== undefined && (!Array.isArray(exclusions) || !exclusions.every(isRecord))) {
    return undefined
  }

  const originalRows = initialRows.filter(
    row => !(exclusions ?? []).some(exclusion => rowMatches(row, exclusion as RecordValue)),
  )
  const rows = originalRows.map(row => ({ ...row }))
  const inclusions = valueFor(matrix, 'include')
  if (inclusions === undefined) {
    return rows
  }
  if (!Array.isArray(inclusions) || !inclusions.every(isRecord)) {
    return undefined
  }

  for (const inclusionValue of inclusions) {
    const inclusion = inclusionValue as RecordValue
    const matchingRows = originalRows
      .map((row, index) => ({ index, row }))
      .filter(({ row }) =>
        Object.entries(inclusion).every(
          ([key, value]) => !Object.hasOwn(row, key) || valuesEqual(row[key], value),
        ),
      )
    if (matchingRows.length === 0) {
      rows.push({ ...inclusion })
      continue
    }

    matchingRows.forEach(({ index }) => {
      const row = rows[index]
      if (row !== undefined) {
        Object.assign(row, inclusion)
      }
    })
  }

  return rows
}

const valueAtPath = (value: unknown, path: string[]): unknown =>
  path.reduce<unknown>((current, key) => valueFor(current, key), value)

const resolveMatrixName = (name: string, job: unknown): string[] | undefined => {
  const rows = matrixRowsFor(job)
  if (rows === undefined) {
    return undefined
  }

  const expressions = [...name.matchAll(/\$\{\{\s*matrix\.([A-Za-z_][A-Za-z0-9_-]*(?:\.[A-Za-z_][A-Za-z0-9_-]*)*)\s*\}\}/g)]
  if (expressions.length === 0) {
    return undefined
  }

  const unresolvedExpression = name
    .replace(/\$\{\{\s*matrix\.([A-Za-z_][A-Za-z0-9_-]*(?:\.[A-Za-z_][A-Za-z0-9_-]*)*)\s*\}\}/g, '')
    .includes('${{')
  if (unresolvedExpression) {
    return undefined
  }

  const names = rows.map(row => {
    let resolvedName = name
    for (const expression of expressions) {
      const matchedPath = expression[1]
      const wholeExpression = expression[0]
      if (matchedPath === undefined || wholeExpression === undefined) {
        return undefined
      }
      const path = matchedPath.split('.')
      const value = valueAtPath(row, path)
      if (value === undefined || typeof value === 'object') {
        return undefined
      }
      resolvedName = resolvedName.replace(wholeExpression, String(value))
    }
    return resolvedName
  })

  return names.every((name): name is string => name !== undefined) ? names : undefined
}

export const parseDelimitedList = (value: string): string[] =>
  value
    .split(/[\n,]/)
    .map(item => item.trim())
    .filter(Boolean)

export const discoverChecks = ({
  files,
  excludedWorkflowPaths = [],
  ignoredChecks = [],
}: DiscoverChecksOptions): { checks: string[]; workflows: string[] } => {
  const exclusions = new Set(excludedWorkflowPaths)
  const ignored = new Set(ignoredChecks)
  const expectedChecks = new Set<string>()
  const workflows: string[] = []

  for (const { content, path } of files) {
    if (exclusions.has(path)) {
      continue
    }

    let workflow: unknown
    try {
      workflow = parse(content)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Could not parse ${path}: ${message}`)
    }

    const triggers = valueFor(workflow, 'on')
    if (!runsOnAllPullRequestBranches(triggers)) {
      continue
    }

    const jobs = valueFor(workflow, 'jobs')
    if (!isRecord(jobs)) {
      continue
    }

    for (const [jobId, job] of terminalJobs(jobs)) {
      const jobName = valueFor(job, 'name')
      if (typeof jobName === 'string' && jobName.includes('${{')) {
        const checkNames = resolveMatrixName(jobName, job)
        if (checkNames === undefined) {
          throw new Error(
            `Cannot derive the required check for ${path}'s ${jobId} job because its name is dynamic. ` +
              'Use only literal matrix values in its name, give the job a static name, or exclude the workflow.',
          )
        }

        checkNames.forEach(checkName => {
          if (!ignored.has(checkName)) {
            expectedChecks.add(checkName)
          }
        })
        continue
      }

      const checkName = typeof jobName === 'string' && jobName.length > 0 ? jobName : jobId
      if (!ignored.has(checkName)) {
        expectedChecks.add(checkName)
      }
    }
    workflows.push(path)
  }

  return {
    checks: [...expectedChecks].sort(),
    workflows: workflows.sort(),
  }
}
