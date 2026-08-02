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
        throw new Error(
          `Cannot derive the required check for ${path}'s ${jobId} job because its name is dynamic. ` +
            'Give the job a static name or exclude the workflow.',
        )
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
