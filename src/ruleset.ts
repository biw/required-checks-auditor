export const createRulesetImport = ({
  checks,
  targetBranch,
}: {
  checks: string[]
  targetBranch: string
}): string =>
  `${JSON.stringify(
    {
      conditions: {
        ref_name: {
          exclude: [],
          include: [`refs/heads/${targetBranch}`],
        },
      },
      enforcement: 'active',
      name: `Required PR checks for ${targetBranch}`,
      rules: [
        {
          parameters: {
            do_not_enforce_on_create: true,
            required_status_checks: checks.map(context => ({ context })),
            strict_required_status_checks_policy: false,
          },
          type: 'required_status_checks',
        },
      ],
      target: 'branch',
    },
    null,
    2,
  )}\n`
