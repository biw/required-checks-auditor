import type { getOctokit } from '@actions/github'

import type { WorkflowFile } from './discovery.js'

export type GitHubClient = ReturnType<typeof getOctokit>

interface RequiredCheckRuleParameters {
  branch: string
  headers: Record<string, string>
  owner: string
  repo: string
}

type RulesPaginator = (
  route: 'GET /repos/{owner}/{repo}/rules/branches/{branch}',
  parameters: RequiredCheckRuleParameters,
) => Promise<unknown[]>

type RecordValue = Record<string, unknown>

interface WorkflowDirectoryEntry {
  name: string
  path: string
  type: 'file'
}

const isRecord = (value: unknown): value is RecordValue =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isWorkflowDirectoryEntry = (value: unknown): value is WorkflowDirectoryEntry =>
  isRecord(value) &&
  value.type === 'file' &&
  typeof value.name === 'string' &&
  /\.ya?ml$/i.test(value.name) &&
  typeof value.path === 'string'

const decodeContent = (content: string): string => Buffer.from(content, 'base64').toString('utf8')

export const getWorkflowFiles = async ({
  octokit,
  owner,
  repo,
  ref,
}: {
  octokit: GitHubClient
  owner: string
  repo: string
  ref: string
}): Promise<WorkflowFile[]> => {
  const { data: directory } = await octokit.rest.repos.getContent({
    owner,
    path: '.github/workflows',
    ref,
    repo,
  })

  if (!Array.isArray(directory)) {
    throw new Error('.github/workflows is not a directory at the workflow ref being audited.')
  }

  const workflowEntries = directory.filter(isWorkflowDirectoryEntry)

  return Promise.all(
    workflowEntries.map(async entry => {
      const { data } = await octokit.rest.repos.getContent({
        owner,
        path: entry.path,
        ref,
        repo,
      })

      if (
        !isRecord(data) ||
        data.type !== 'file' ||
        typeof data.content !== 'string' ||
        typeof data.path !== 'string'
      ) {
        throw new Error(`Could not read ${entry.path} as a workflow file.`)
      }

      return { content: decodeContent(data.content), path: data.path }
    }),
  )
}

const requiredContextsFromRule = (rule: unknown): string[] => {
  if (!isRecord(rule) || rule.type !== 'required_status_checks' || !isRecord(rule.parameters)) {
    return []
  }

  const requiredStatusChecks = rule.parameters.required_status_checks
  if (!Array.isArray(requiredStatusChecks)) {
    return []
  }

  return requiredStatusChecks.flatMap(check =>
    isRecord(check) && typeof check.context === 'string' ? [check.context] : [],
  )
}

export const getRequiredCheckContexts = async ({
  branch,
  octokit,
  owner,
  repo,
}: {
  branch: string
  octokit: GitHubClient
  owner: string
  repo: string
}): Promise<Set<string>> => {
  // This endpoint is newer than the endpoint map shipped with the Action toolkit's Octokit types.
  const paginateRules = octokit.paginate as unknown as RulesPaginator
  const rules = await paginateRules('GET /repos/{owner}/{repo}/rules/branches/{branch}', {
    branch,
    headers: { 'X-GitHub-Api-Version': '2022-11-28' },
    owner,
    repo,
  })

  return new Set(rules.flatMap(requiredContextsFromRule))
}

export const getObservedExternalCheckContexts = async ({
  octokit,
  owner,
  ref,
  repo,
}: {
  octokit: GitHubClient
  owner: string
  ref: string
  repo: string
}): Promise<Set<string>> => {
  const [checkRuns, statuses] = await Promise.all([
    octokit.paginate(octokit.rest.checks.listForRef, {
      filter: 'latest',
      owner,
      per_page: 100,
      ref,
      repo,
    }),
    octokit.paginate(octokit.rest.repos.listCommitStatusesForRef, {
      owner,
      per_page: 100,
      ref,
      repo,
    }),
  ])

  return new Set([
    ...checkRuns.flatMap(checkRun =>
      checkRun.app?.slug === 'github-actions' || checkRun.name.length === 0 ? [] : [checkRun.name],
    ),
    ...statuses.flatMap(status => (status.context.length === 0 ? [] : [status.context])),
  ])
}
