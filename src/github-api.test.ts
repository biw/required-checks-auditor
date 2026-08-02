import { describe, expect, it } from 'vitest'

import {
  getBranchRuleState,
  getObservedExternalCheckContexts,
  getRequiredCheckContexts,
  getWorkflowFiles,
  type GitHubClient,
} from './github-api.js'

describe('getWorkflowFiles', () => {
  it('reads and decodes workflow files at the requested ref', async () => {
    const requests: Array<{ owner: string; path: string; ref: string; repo: string }> = []
    const octokit = {
      paginate: async () => [],
      rest: {
        repos: {
          getContent: async (request: { owner: string; path: string; ref: string; repo: string }) => {
            requests.push(request)
            if (request.path === '.github/workflows') {
              return {
                data: [
                  { name: 'ci.yml', path: '.github/workflows/ci.yml', type: 'file' },
                  { name: 'notes.txt', path: '.github/workflows/notes.txt', type: 'file' },
                ],
              }
            }

            return {
              data: {
                content: Buffer.from('on: pull_request').toString('base64'),
                path: request.path,
                type: 'file',
              },
            }
          },
        },
      },
    } as unknown as GitHubClient

    const files = await getWorkflowFiles({
      octokit,
      owner: 'biw',
      ref: 'refs/pull/1/merge',
      repo: 'example',
    })

    expect(files).toEqual([{ content: 'on: pull_request', path: '.github/workflows/ci.yml' }])
    expect(requests.map(request => request.ref)).toEqual(['refs/pull/1/merge', 'refs/pull/1/merge'])
  })
})

describe('getRequiredCheckContexts', () => {
  it('aggregates required contexts from all active status-check rules', async () => {
    const octokit = {
      paginate: async (
        route: string,
        options: { branch: string; owner: string; repo: string },
      ) => {
        expect(route).toBe('GET /repos/{owner}/{repo}/rules/branches/{branch}')
        expect(options.branch).toBe('main')
        expect(options.owner).toBe('biw')
        expect(options.repo).toBe('example')
        return [
          {
            parameters: {
              required_status_checks: [{ context: 'test' }, { context: 'lint' }],
            },
            type: 'required_status_checks',
          },
          { type: 'pull_request' },
          {
            parameters: { required_status_checks: [{ context: 'browser-performance' }] },
            type: 'required_status_checks',
          },
        ]
      },
      rest: { repos: { getContent: async () => ({ data: [] }) } },
    } as unknown as GitHubClient

    const contexts = await getRequiredCheckContexts({
      branch: 'main',
      octokit,
      owner: 'biw',
      repo: 'example',
    })

    expect([...contexts].sort()).toEqual(['browser-performance', 'lint', 'test'])
  })
})

describe('getBranchRuleState', () => {
  it('reports whether any ruleset applies to the target branch', async () => {
    const octokit = {
      paginate: async () => [
        { ruleset_id: 1, type: 'deletion' },
        {
          parameters: { required_status_checks: [{ context: 'test' }] },
          ruleset_id: 2,
          type: 'required_status_checks',
        },
      ],
      rest: { repos: { getContent: async () => ({ data: [] }) } },
    } as unknown as GitHubClient

    await expect(
      getBranchRuleState({ branch: 'main', octokit, owner: 'biw', repo: 'example' }),
    ).resolves.toEqual({ hasAppliedRuleset: true, requiredChecks: new Set(['test']) })
  })

  it('does not treat legacy branch protection as a ruleset', async () => {
    const octokit = {
      paginate: async () => [
        {
          parameters: { required_status_checks: [{ context: 'test' }] },
          type: 'required_status_checks',
        },
      ],
      rest: { repos: { getContent: async () => ({ data: [] }) } },
    } as unknown as GitHubClient

    await expect(
      getBranchRuleState({ branch: 'main', octokit, owner: 'biw', repo: 'example' }),
    ).resolves.toEqual({ hasAppliedRuleset: false, requiredChecks: new Set(['test']) })
  })
})

describe('getObservedExternalCheckContexts', () => {
  it('includes external check runs and legacy statuses but excludes GitHub Actions job checks', async () => {
    const listForRef = () => Promise.resolve({ data: { check_runs: [] } })
    const listCommitStatusesForRef = () => Promise.resolve({ data: [] })
    const octokit = {
      paginate: async (endpoint: unknown, options: { owner: string; ref: string; repo: string }) => {
        expect(options).toMatchObject({ owner: 'biw', ref: 'merge-sha', repo: 'example' })
        if (endpoint === listForRef) {
          return [
            { app: { slug: 'github-actions' }, name: 'Required checks auditor' },
            { app: { slug: 'codecov' }, name: 'codecov/patch' },
            { app: { slug: 'third-party' }, name: '' },
          ]
        }

        if (endpoint === listCommitStatusesForRef) {
          return [{ context: 'continuous-integration/jenkins' }, { context: '' }]
        }

        throw new Error('Unexpected endpoint')
      },
      rest: {
        checks: { listForRef },
        repos: { listCommitStatusesForRef },
      },
    } as unknown as GitHubClient

    const contexts = await getObservedExternalCheckContexts({
      octokit,
      owner: 'biw',
      ref: 'merge-sha',
      repo: 'example',
    })

    expect([...contexts].sort()).toEqual(['codecov/patch', 'continuous-integration/jenkins'])
  })
})
