import * as core from '@actions/core'
import * as github from '@actions/github'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { discoverChecks, parseDelimitedList } from './discovery.js'
import {
  getBranchRuleState,
  getObservedExternalCheckContexts,
  getWorkflowFiles,
} from './github-api.js'
import { observedCheckRefs } from './observation.js'
import { createRulesetImport } from './ruleset.js'
import { resolveTargetBranch } from './target-branch.js'
import { parseWaitSeconds, waitForSeconds } from './wait.js'

const addSummary = async ({
  checks,
  missing,
  observedChecks,
  targetHasRuleset,
  targetBranch,
  workflows,
}: {
  checks: string[]
  missing: string[]
  observedChecks: string[]
  targetHasRuleset: boolean
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
    .addHeading('Ruleset', 2)
    .addList([targetHasRuleset ? 'An active ruleset applies to this branch.' : 'No active ruleset applies to this branch.'])
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
  const targetBranch = resolveTargetBranch({
    githubBaseRef: process.env.GITHUB_BASE_REF,
    pullRequestBaseRef: github.context.payload.pull_request?.base.ref,
    targetBranch: core.getInput('target-branch'),
  })
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
    pullRequestHeadRef: github.context.payload.pull_request?.head.ref || process.env.GITHUB_HEAD_REF,
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

  const { hasAppliedRuleset, requiredChecks } = await getBranchRuleState({
    branch: targetBranch,
    octokit,
    owner,
    repo,
  })
  const missingChecks = expectedChecks.filter(check => !requiredChecks.has(check))
  const rulesetArtifactPath =
    missingChecks.length > 0 && !hasAppliedRuleset
      ? join(process.env.RUNNER_TEMP ?? process.cwd(), 'required-checks-ruleset.json')
      : ''

  if (rulesetArtifactPath.length > 0) {
    await writeFile(
      rulesetArtifactPath,
      createRulesetImport({ checks: expectedChecks, targetBranch }),
      'utf8',
    )
  }

  core.setOutput('expected-checks', JSON.stringify(expectedChecks))
  core.setOutput('missing-checks', JSON.stringify(missingChecks))
  core.setOutput('observed-checks', JSON.stringify(includedObservedChecks))
  core.setOutput('ruleset-artifact-path', rulesetArtifactPath)
  core.setOutput('target-branch', targetBranch)
  core.setOutput('target-has-ruleset', String(hasAppliedRuleset))
  await addSummary({
    checks: expectedChecks,
    missing: missingChecks,
    observedChecks: includedObservedChecks,
    targetHasRuleset: hasAppliedRuleset,
    targetBranch,
    workflows: discovered.workflows,
  })

  if (missingChecks.length > 0) {
    const artifactInstructions =
      rulesetArtifactPath.length > 0
        ? '\n\nNo active ruleset applies to this branch. Download the “required-checks-ruleset” artifact and import it in Settings → Rules → Rulesets.'
        : ''
    core.setFailed(
      `The ${targetBranch} rules are missing required checks:\n${missingChecks
        .map(check => `- ${check}`)
        .join('\n')}${artifactInstructions}`,
    )
  }
}

void run().catch(error => {
  core.setFailed(error instanceof Error ? error.message : String(error))
})
