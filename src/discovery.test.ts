import { describe, expect, it } from 'vitest'

import { discoverChecks, parseDelimitedList } from './discovery.js'

const workflow = (path: string, content: string) => ({ content, path })

describe('discoverChecks', () => {
  it('discovers terminal jobs from PR workflows, including path-filtered workflows', () => {
    const result = discoverChecks({
      files: [
        workflow(
          '.github/workflows/perf.yml',
          `on:
  pull_request:
    paths:
      - packages/player/**
jobs:
  detect:
    runs-on: ubuntu-latest
  player-perf:
    name: Player performance
    needs: detect
    runs-on: ubuntu-latest
`,
        ),
        workflow(
          '.github/workflows/review.yml',
          `on: pull_request
jobs:
  review:
    runs-on: ubuntu-latest
`,
        ),
      ],
    })

    expect(result.checks).toEqual(['Player performance', 'review'])
    expect(result.workflows).toEqual([
      '.github/workflows/perf.yml',
      '.github/workflows/review.yml',
    ])
  })

  it('discovers workflows that push to every branch but ignores tag-only workflows', () => {
    const result = discoverChecks({
      files: [
        workflow(
          '.github/workflows/test.yml',
          `on:
  push:
    branches: ['**']
jobs:
  test:
    runs-on: ubuntu-latest
`,
        ),
        workflow(
          '.github/workflows/release.yml',
          `on:
  push:
    tags: ['v*']
jobs:
  release:
    runs-on: ubuntu-latest
`,
        ),
      ],
    })

    expect(result.checks).toEqual(['test'])
    expect(result.workflows).toEqual(['.github/workflows/test.yml'])
  })

  it('ignores workflows that only run after a PR closes or by manual dispatch', () => {
    const result = discoverChecks({
      files: [
        workflow(
          '.github/workflows/release-publish.yml',
          `on:
  pull_request:
    types: [closed]
  workflow_dispatch:
jobs:
  publish:
    runs-on: ubuntu-latest
  cleanup-abandoned:
    runs-on: ubuntu-latest
`,
        ),
        workflow(
          '.github/workflows/manual.yml',
          `on: workflow_dispatch
jobs:
  cleanup:
    runs-on: ubuntu-latest
`,
        ),
        workflow(
          '.github/workflows/closed-target.yml',
          `on:
  pull_request_target:
    types: [closed]
jobs:
  cleanup:
    runs-on: ubuntu-latest
`,
        ),
      ],
    })

    expect(result).toEqual({ checks: [], workflows: [] })
  })

  it('discovers pull_request_target workflows that run before a pull request closes', () => {
    const result = discoverChecks({
      files: [
        workflow(
          '.github/workflows/mute-pr-notifications.yml',
          `on: pull_request_target
jobs:
  mute-notification:
    runs-on: ubuntu-latest
`,
        ),
      ],
    })

    expect(result).toEqual({
      checks: ['mute-notification'],
      workflows: ['.github/workflows/mute-pr-notifications.yml'],
    })
  })

  it('supports exclusions and ignores exact check names', () => {
    const result = discoverChecks({
      excludedWorkflowPaths: ['.github/workflows/release.yml'],
      files: [
        workflow(
          '.github/workflows/release.yml',
          `on: pull_request
jobs:
  release:
    runs-on: ubuntu-latest
`,
        ),
        workflow(
          '.github/workflows/checks.yml',
          `on: pull_request
jobs:
  lint:
    runs-on: ubuntu-latest
  test:
    runs-on: ubuntu-latest
`,
        ),
      ],
      ignoredChecks: ['lint'],
    })

    expect(result.checks).toEqual(['test'])
    expect(result.workflows).toEqual(['.github/workflows/checks.yml'])
  })

  it('expands job names that use literal matrix values', () => {
    const result = discoverChecks({
      files: [
        workflow(
          '.github/workflows/ci.yml',
          `on: pull_request
jobs:
  unit-tests:
    name: Unit Tests - \${{ matrix.platform }}
    runs-on: \${{ matrix.runner }}
    strategy:
      matrix:
        include:
          - runner: ubuntu-latest
            platform: Linux
          - runner: macos-latest
            platform: macOS
          - runner: windows-latest
            platform: Windows
`,
        ),
      ],
    })

    expect(result).toEqual({
      checks: ['Unit Tests - Linux', 'Unit Tests - Windows', 'Unit Tests - macOS'],
      workflows: ['.github/workflows/ci.yml'],
    })
  })

  it('expands literal matrix dimensions, exclusions, and additions', () => {
    const result = discoverChecks({
      files: [
        workflow(
          '.github/workflows/test.yml',
          `on: pull_request
jobs:
  test:
    name: Test (\${{ matrix.os }}, Node \${{ matrix.node.version }})
    runs-on: \${{ matrix.os }}
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest]
        node:
          - version: 22
          - version: 24
        exclude:
          - os: macos-latest
            node:
              version: 22
        include:
          - os: windows-latest
            node:
              version: 24
`,
        ),
      ],
    })

    expect(result.checks).toEqual([
      'Test (macos-latest, Node 24)',
      'Test (ubuntu-latest, Node 22)',
      'Test (ubuntu-latest, Node 24)',
      'Test (windows-latest, Node 24)',
    ])
  })

  it('fails instead of guessing a dynamic job name', () => {
    expect(() =>
      discoverChecks({
        files: [
          workflow(
            '.github/workflows/checks.yml',
            `on: pull_request
jobs:
  test:
    name: \${{ matrix.node }}
    runs-on: ubuntu-latest
`,
          ),
        ],
      }),
    ).toThrow(/name is dynamic/)
  })
})

describe('input helpers', () => {
  it('parses list inputs', () => {
    expect(parseDelimitedList('one, two\nthree')).toEqual(['one', 'two', 'three'])
  })
})
