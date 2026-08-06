import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { auditInputsFromWorkflow, createAuditWorkflow, runCli, type CliPrompts } from './cli-program.js'

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
        ignoredChecks: ['legacy check'],
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
        excludedWorkflowPaths: ['.github/workflows/performance.yml'],
        ignoredChecks: ['legacy check'],
        targetBranch: 'trunk',
        waitSeconds: 45,
      }),
    ).toContain(`ignored-checks: |\n            legacy check`)
    expect(
      createAuditWorkflow({
        excludedWorkflowPaths: [],
        targetBranch: 'trunk',
        waitSeconds: 45,
      }),
    ).toContain(`id: audit\n        uses: biw/required-checks-auditor@v1.0.4\n        with:\n          target-branch: trunk\n          wait-seconds: 45`)
    expect(
      createAuditWorkflow({
        excludedWorkflowPaths: [],
        targetBranch: 'trunk',
        waitSeconds: 45,
      }),
    ).toContain('uses: biw/required-checks-auditor@v1.0.4')
    expect(
      createAuditWorkflow({
        excludedWorkflowPaths: [],
        targetBranch: 'trunk',
        waitSeconds: 45,
      }),
    ).toContain(
      `if: \${{ failure() && steps.audit.outputs['ruleset-artifact-path'] != '' }}\n        uses: actions/upload-artifact@v4\n        with:\n          name: required-checks-ruleset`,
    )
  })

  it('reads explicit audit policy from an existing generated workflow', () => {
    expect(
      auditInputsFromWorkflow(`jobs:
  audit:
    steps:
      - uses: biw/required-checks-auditor@v1.0.4
        with:
          excluded-workflow-paths: |
            .github/workflows/release-build.yml
            .github/workflows/release-publish.yml
          ignored-checks: legacy, flaky
`),
    ).toEqual({
      excludedWorkflowPaths: [
        '.github/workflows/release-build.yml',
        '.github/workflows/release-publish.yml',
      ],
      ignoredChecks: ['legacy', 'flaky'],
    })
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

  it('preserves explicit exclusions and ignored checks when overwriting a generated workflow', async () => {
    const cwd = await createRepository()
    await writeFile(
      join(cwd, '.github', 'workflows', 'required-checks-auditor.yml'),
      `jobs:
  required-checks-auditor:
    steps:
      - uses: biw/required-checks-auditor@v1.0.4
        with:
          excluded-workflow-paths: |
            .github/workflows/performance.yml
            .github/workflows/release-build.yml
          ignored-checks: |
            legacy check
            flaky check
`,
    )
    const prompts: CliPrompts = {
      checkbox: async options => {
        expect(options.choices).toEqual([
          { checked: true, name: '.github/workflows/ci.yml', value: '.github/workflows/ci.yml' },
        ])
        return ['.github/workflows/ci.yml']
      },
      confirm: async options => {
        expect(options).toEqual({
          default: false,
          message: 'Overwrite .github/workflows/required-checks-auditor.yml?',
        })
        return true
      },
      input: async options => (options.message.startsWith('How long') ? '30' : 'main'),
    }

    await runCli({ cwd, log: () => {}, prompts })

    await expect(readFile(join(cwd, '.github', 'workflows', 'required-checks-auditor.yml'), 'utf8')).resolves.toContain(
      `excluded-workflow-paths: |
            .github/workflows/performance.yml
            .github/workflows/release-build.yml`,
    )
    await expect(readFile(join(cwd, '.github', 'workflows', 'required-checks-auditor.yml'), 'utf8')).resolves.toContain(
      `ignored-checks: |
            legacy check
            flaky check`,
    )
  })

  it('shows a compact diff before overwriting an existing workflow', async () => {
    const cwd = await createRepository()
    const existingWorkflow = `name: Previous audit\n`
    await writeFile(join(cwd, '.github', 'workflows', 'required-checks-auditor.yml'), existingWorkflow)
    const logs: string[] = []
    const prompts: CliPrompts = {
      checkbox: async () => ['.github/workflows/ci.yml'],
      confirm: async () => false,
      input: async options => (options.message.startsWith('How long') ? '30' : 'main'),
    }

    await runCli({ cwd, log: message => logs.push(message), prompts })

    expect(logs[0]).toMatch(/^\nChanges to \.github\/workflows\/required-checks-auditor\.yml:\n\n- name: Previous audit/)
    expect(logs[0]).not.toContain('@@')
  })

  it('does not prompt to overwrite an unchanged generated workflow', async () => {
    const cwd = await createRepository()
    const workflow = createAuditWorkflow({
      excludedWorkflowPaths: [],
      targetBranch: 'main',
      waitSeconds: 30,
    })
    await writeFile(join(cwd, '.github', 'workflows', 'required-checks-auditor.yml'), workflow)
    const prompts: CliPrompts = {
      checkbox: async () => ['.github/workflows/ci.yml', '.github/workflows/performance.yml'],
      confirm: async () => {
        throw new Error('The overwrite prompt should not be shown.')
      },
      input: async options => (options.message.startsWith('How long') ? '30' : 'main'),
    }

    const result = await runCli({ cwd, log: () => {}, prompts })

    expect(result.wroteWorkflow).toBe(false)
  })
})
