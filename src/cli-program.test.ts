import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { createAuditWorkflow, runCli, type CliPrompts } from './cli-program.js'

const temporaryDirectories: string[] = []

const createRepository = async (): Promise<string> => {
  const cwd = await mkdtemp(join(tmpdir(), 'required-checks-auditor-'))
  temporaryDirectories.push(cwd)
  await mkdir(join(cwd, '.github', 'workflows'), { recursive: true })
  await writeFile(
    join(cwd, '.github', 'workflows', 'ci.yml'),
    `on: pull_request\njobs:\n  test:\n    name: Test\n    runs-on: ubuntu-latest\n`,
  )
  await writeFile(
    join(cwd, '.github', 'workflows', 'release.yml'),
    `on:\n  push:\n    tags: ['v*']\njobs:\n  release:\n    runs-on: ubuntu-latest\n`,
  )
  await writeFile(
    join(cwd, '.github', 'workflows', 'performance.yml'),
    `on:\n  pull_request:\n    paths: ['packages/player/**']\njobs:\n  performance:\n    name: Player performance\n    runs-on: ubuntu-latest\n`,
  )
  return cwd
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { force: true, recursive: true })))
})

describe('createAuditWorkflow', () => {
  it('renders selected exclusions as the action input', () => {
    expect(
      createAuditWorkflow({
        excludedWorkflowPaths: ['.github/workflows/performance.yml'],
        targetBranch: 'trunk',
        waitSeconds: 45,
      }),
    ).toContain(`branches: [trunk]\n    types: [opened, ready_for_review, reopened, synchronize]`)
    expect(
      createAuditWorkflow({
        excludedWorkflowPaths: [],
        targetBranch: 'trunk',
        waitSeconds: 45,
      }),
    ).toContain(`branch_protection_rule:\n    types: [created, edited, deleted]`)
    expect(
      createAuditWorkflow({
        excludedWorkflowPaths: ['.github/workflows/performance.yml'],
        targetBranch: 'trunk',
        waitSeconds: 45,
      }),
    ).toContain(`excluded-workflow-paths: |\n            .github/workflows/performance.yml`)
    expect(
      createAuditWorkflow({
        excludedWorkflowPaths: [],
        targetBranch: 'trunk',
        waitSeconds: 45,
      }),
    ).toContain(`with:\n          target-branch: trunk\n          wait-seconds: 45`)
    expect(
      createAuditWorkflow({
        excludedWorkflowPaths: [],
        targetBranch: 'trunk',
        waitSeconds: 45,
      }),
    ).toContain('uses: biw/required-checks-auditor@v1.0.2')
  })
})

describe('runCli', () => {
  it('discovers local workflows, records ignored choices, and writes only after confirmation', async () => {
    const cwd = await createRepository()
    const logs: string[] = []
    const prompts: CliPrompts = {
      checkbox: async options => {
        expect(options.choices).toEqual([
          { checked: true, name: '.github/workflows/ci.yml', value: '.github/workflows/ci.yml' },
          {
            checked: true,
            name: '.github/workflows/performance.yml',
            value: '.github/workflows/performance.yml',
          },
        ])
        return ['.github/workflows/ci.yml']
      },
      confirm: async options => {
        expect(options).toEqual({
          default: true,
          message: 'Write .github/workflows/required-checks-auditor.yml?',
        })
        return true
      },
      input: async options => {
        if (options.message.startsWith('How long')) {
          expect(options).toMatchObject({
            default: '30',
            message: 'How long would you like to wait before running this check? (in seconds)',
          })
          return '45'
        }
        return 'main'
      },
    }

    const result = await runCli({ cwd, log: message => logs.push(message), prompts })

    expect(result).toEqual({
      excludedWorkflowPaths: ['.github/workflows/performance.yml'],
      targetBranch: 'main',
      waitSeconds: 45,
      watchedWorkflowPaths: ['.github/workflows/ci.yml'],
      wroteWorkflow: true,
    })
    expect(logs.join('\n')).toContain('Required checks auditor')
    await expect(readFile(join(cwd, '.github', 'workflows', 'required-checks-auditor.yml'), 'utf8')).resolves.toContain(
      'excluded-workflow-paths:',
    )
    await expect(readFile(join(cwd, '.github', 'workflows', 'required-checks-auditor.yml'), 'utf8')).resolves.toContain(
      'wait-seconds: 45',
    )
    await expect(readFile(join(cwd, '.github', 'workflows', 'required-checks-auditor.yml'), 'utf8')).resolves.toContain(
      'target-branch: main',
    )
  })

  it('leaves the generated workflow absent when the write prompt is declined', async () => {
    const cwd = await createRepository()
    const prompts: CliPrompts = {
      checkbox: async () => ['.github/workflows/ci.yml'],
      confirm: async () => false,
      input: async options => (options.message.startsWith('How long') ? '30' : 'main'),
    }

    const result = await runCli({ cwd, log: () => {}, prompts })

    expect(result.wroteWorkflow).toBe(false)
    await expect(
      readFile(join(cwd, '.github', 'workflows', 'required-checks-auditor.yml'), 'utf8'),
    ).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
