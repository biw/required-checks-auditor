# Required Checks Auditor

[![CI](https://badgen.net/github/checks/biw/required-checks-auditor)](https://github.com/biw/required-checks-auditor/actions)
[![npm version](https://badgen.net/npm/v/required-checks-auditor)](https://www.npmjs.com/package/required-checks-auditor)
[![npm downloads](https://badgen.net/npm/dt/required-checks-auditor)](https://www.npmjs.com/package/required-checks-auditor)


Catch GitHub pull-request checks that run but are not required by your branch rules.

## Installation

Run the following command from the repository you want to protect. It finds your PR workflows, asks which ones to watch, then writes `.github/workflows/required-checks-auditor.yml`.

```sh
npx -y required-checks-auditor@latest
```

<details>
<summary>If you prefer to add the workflow yourself</summary>

<br>

```yaml
name: Audit Required PR Checks

on:
  pull_request:
    branches: [main]
    types: [opened, ready_for_review, reopened, synchronize]
  branch_protection_rule:
    types: [created, edited, deleted]

permissions:
  contents: read
  checks: read
  statuses: read

jobs:
  required-checks-auditor:
    name: Required checks auditor
    runs-on: ubuntu-latest
    steps:
      - uses: biw/required-checks-auditor@v1.0.0
        with:
          wait-seconds: 30
          excluded-workflow-paths: |
            .github/workflows/release-build.yml
            .github/workflows/release-publish.yml
```

</details>

## Usage

After the workflow has run once, add **Required checks auditor** to the required status checks in
each branch rule or ruleset that protects the target branch. The first run fails until you do—this
is expected, and proves that the auditor itself cannot be left optional.

Keep the three permissions from the example so the auditor can read workflows, external checks,
and the effective branch rules.

### Options

- `wait-seconds`: seconds to wait before auditing; defaults to `30`. Set `0` to run immediately.
- `excluded-workflow-paths`: workflow files to leave out of automatic discovery.
- `ignored-checks`: specific check names to leave out intentionally.

The target branch and workflow revision default to the current pull request. The action includes
terminal GitHub Actions jobs and externally reported checks it observes on the pull request.

## License

MIT
