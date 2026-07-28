import { readdir, readFile } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { join } from 'node:path'

import type { WorkflowFile } from './discovery.js'

const workflowFileName = (name: string): boolean => /\.ya?ml$/i.test(name)

export const readLocalWorkflowFiles = async (cwd: string): Promise<WorkflowFile[]> => {
  const workflowsDirectory = join(cwd, '.github', 'workflows')

  let entries: Array<Dirent<string>>
  try {
    entries = await readdir(workflowsDirectory, { withFileTypes: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Could not read ${workflowsDirectory}: ${message}`)
  }

  const workflowNames = entries
    .filter(entry => entry.isFile() && workflowFileName(entry.name))
    .map(entry => entry.name)
    .sort()

  return Promise.all(
    workflowNames.map(async name => ({
      content: await readFile(join(workflowsDirectory, name), 'utf8'),
      path: `.github/workflows/${name}`,
    })),
  )
}
