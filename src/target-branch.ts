interface ResolveTargetBranchOptions {
  githubBaseRef?: string | undefined
  pullRequestBaseRef?: string | undefined
  targetBranch?: string | undefined
}

export const resolveTargetBranch = ({
  githubBaseRef,
  pullRequestBaseRef,
  targetBranch,
}: ResolveTargetBranchOptions): string => targetBranch || pullRequestBaseRef || githubBaseRef || 'main'
