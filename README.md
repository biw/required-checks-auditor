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
      - id: audit
        uses: biw/required-checks-auditor@v1.0.3
        with:
          target-branch: main
          wait-seconds: 30
          excluded-workflow-paths: |
            .github/workflows/release-build.yml
            .github/workflows/release-publish.yml
      - name: Upload starter ruleset
        if: ${{ failure() && steps.audit.outputs['ruleset-artifact-path'] != '' }}
        uses: actions/upload-artifact@v4
        with:
          name: required-checks-ruleset
          path: ${{ steps.audit.outputs['ruleset-artifact-path'] }}
          if-no-files-found: error
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
- `target-branch`: protected branch whose active rules are audited. It defaults to the pull request's
  base branch; set it explicitly when the workflow can run on stacked pull requests.
- `excluded-workflow-paths`: workflow files to leave out of automatic discovery. This is the
  explicit escape hatch for workflows whose relevance cannot be determined statically.
- `ignored-checks`: specific check names to leave out intentionally.

The generated workflow always sets `target-branch` to the branch selected during setup, so stacked
pull requests are checked against the protected branch rather than an intermediate stack branch.
Rerunning setup preserves existing `excluded-workflow-paths` and `ignored-checks` values in the
generated workflow. Automatic discovery ignores workflows that only run for closed pull requests,
manual dispatch, or `pull_request_target`, and skips jobs with straightforward release-source
branch conditions unless the audited pull request uses that release branch. Keep explicit
exclusions for more complex conditional workflows.
The workflow revision defaults to the current workflow commit. The action includes terminal GitHub
Actions jobs and externally reported checks it observes on the pull request.

If no active ruleset applies to the target branch and checks are missing, the failed run includes a
`required-checks-ruleset` artifact. Download it and import it in **Settings → Rules → Rulesets**.
If a ruleset already applies, the action only reports the missing checks so you can update that
existing policy.

## License

MIT
