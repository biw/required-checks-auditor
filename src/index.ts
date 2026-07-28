import * as core from '@actions/core'
import * as github from '@actions/github'

import { discoverChecks, parseDelimitedList } from './discovery.js'
import {
  getObservedExternalCheckContexts,
  getRequiredCheckContexts,
  getWorkflowFiles,
} from './github-api.js'
import { observedCheckRefs } from './observation.js'
import { parseWaitSeconds, waitForSeconds } from './wait.js'

const addSummary = async ({
  checks,
  missing,
  observedChecks,
  targetBranch,
  workflows,
}: {
  checks: string[]
  missing: string[]
  observedChecks: string[]
  targetBranch: string
  workflows: string[]
}): Promise<void> => {
  const rows: Array<Array<string | { data: string; header: true }>> = [
    [
      { data: 'Check', header: true },
      { data: 'Required by active rules', header: true },
    ],
    ...checks.map(check => [check, missing.includes(check) ? 'No' : 'Yes']),
  ]

  await core.summary
    .addHeading(`Required checks audit for ${targetBranch}`)
    .addTable(rows)
    .addHeading('Discovered workflows', 2)
    .addList(workflows)
    .addHeading('Observed external checks', 2)
    .addList(observedChecks.length === 0 ? ['None'] : observedChecks)
    .write()
}

const run = async (): Promise<void> => {
  const waitSeconds = parseWaitSeconds(core.getInput('wait-seconds') || '30')
  if (waitSeconds > 0) {
    core.info(`Waiting ${waitSeconds} seconds before auditing required checks.`)
    await waitForSeconds(waitSeconds)
  }

  const token = core.getInput('github-token', { required: true })
  const targetBranch =
    core.getInput('target-branch') ||
    github.context.payload.pull_request?.base.ref ||
    process.env.GITHUB_BASE_REF ||
    'main'
  const workflowRef = core.getInput('workflow-ref') || github.context.sha
  const excludedWorkflowPaths = parseDelimitedList(core.getInput('excluded-workflow-paths'))

  const octokit = github.getOctokit(token)
  const { owner, repo } = github.context.repo
  const files = await getWorkflowFiles({ octokit, owner, ref: workflowRef, repo })
  const ignoredChecks = parseDelimitedList(core.getInput('ignored-checks'))
  const discovered = discoverChecks({
    excludedWorkflowPaths,
    files,
    ignoredChecks,
  })
  const isPullRequestAudit =
    github.context.eventName === 'pull_request' || github.context.eventName === 'pull_request_target'
  const observedChecks = new Set<string>()
  if (isPullRequestAudit) {
    const refs = observedCheckRefs({
      eventName: github.context.eventName,
      payload: github.context.payload,
      workflowSha: github.context.sha,
    })
    for (const [index, ref] of refs.entries()) {
      try {
        const contexts = await getObservedExternalCheckContexts({ octokit, owner, ref, repo })
        contexts.forEach(check => observedChecks.add(check))
      } catch (error) {
        const status =
          typeof error === 'object' && error !== null && 'status' in error ? error.status : undefined
        if (status === 404 && index > 0) {
          continue
        }
        if (status === 403) {
          throw new Error(
            'Reading external checks requires checks: read and statuses: read permissions on GITHUB_TOKEN.',
          )
        }
        throw error
      }
    }
  }
  const includedObservedChecks = [...observedChecks].filter(check => !ignoredChecks.includes(check)).sort()
  const expectedChecks = [...new Set([...discovered.checks, ...includedObservedChecks])].sort()

  if (expectedChecks.length === 0) {
    throw new Error('No PR-relevant workflow checks were discovered.')
  }

  const requiredChecks = await getRequiredCheckContexts({ branch: targetBranch, octokit, owner, repo })
  const missingChecks = expectedChecks.filter(check => !requiredChecks.has(check))

  core.setOutput('expected-checks', JSON.stringify(expectedChecks))
  core.setOutput('missing-checks', JSON.stringify(missingChecks))
  core.setOutput('observed-checks', JSON.stringify(includedObservedChecks))
  core.setOutput('target-branch', targetBranch)
  await addSummary({
    checks: expectedChecks,
    missing: missingChecks,
    observedChecks: includedObservedChecks,
    targetBranch,
    workflows: discovered.workflows,
  })

  if (missingChecks.length > 0) {
    core.setFailed(
      `The ${targetBranch} rules are missing required checks:\n${missingChecks
        .map(check => `- ${check}`)
        .join('\n')}`,
    )
  }
}

void run().catch(error => {
  core.setFailed(error instanceof Error ? error.message : String(error))
})
