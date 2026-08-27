#!/usr/bin/env node
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dispatchOfficialSkillCli, runIntakeHandshake } from './installer.mjs'

const INTAKE_QUESTIONS = [
  { id: 'repoType', prompt: 'Repository type: git, none (no version control), or snapshot (MergeGuard snapshot mode)?', required: true, example: 'snapshot' },
  { id: 'riskLevel', prompt: 'Risk level: low, medium, or high?', required: true, example: 'medium' },
  { id: 'baselineBranch', prompt: 'Baseline branch name (default: main)?', required: false, example: 'main' },
]

await dispatchOfficialSkillCli({
  packageRoot: dirname(fileURLToPath(import.meta.url)),
  runCommand: (context) => runIntakeHandshake(context, {
    questions: INTAKE_QUESTIONS,
    outputFile: 'MERGGUARD-REQUIREMENTS.json',
    afterCapabilities(output) {
      const instruction = output.nextStep?.instruction
      if (typeof instruction === 'string' && instruction.trim()) console.log(instruction)
    },
  }),
})
