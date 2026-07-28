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
