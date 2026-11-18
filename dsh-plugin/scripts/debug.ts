/**
 * 本地调试：不启动 DSH，构造一个最小 ExecutionContext 直接调用 runBusiness。
 *
 * 用法（先构建，保证 ../lib/business.js 存在）：
 *   npm run build
 *   node --experimental-strip-types scripts/debug.ts
 *
 * 可选环境变量：
 *   CARE_ROOT            覆盖 CARE 仓库根目录
 *   CARE_PYTHON          覆盖 Python 解释器
 *   CARE_DEBUG_MODEL     传入模型连接 JSON，例如
 *                        {"baseUrl":"https://...","apiKey":"...","model":"..."}
 */

import { mkdirSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runBusiness } from '../lib/business.js'
import type { ExecutionContext } from '@software-factory/runtime-sdk'

const here = dirname(fileURLToPath(import.meta.url))
const careRoot = resolve(process.env.CARE_ROOT ?? resolve(here, '..', '..'))
const outputDirectory = resolve(here, '..', '.debug', 'run')

const input = {
  oldRuleFile: 'data/evaluation_dataset/ini_rule/dataset1_ini_rule.txt',
  oldTestcasesFile: 'data/evaluation_dataset/ini_testcase/dataset1_ini_testcase.json',
  newRuleFile: 'data/evaluation_dataset/upd_rule/dataset1_upd_rule.txt',
  classificationKnowledgeFile: 'reuse/domain_knowledge/classification_knowledge.json',
  otherKnowledgeFile: 'reuse/domain_knowledge/knowledge.json',
  skipSc: true
}

rmSync(outputDirectory, { recursive: true, force: true })
mkdirSync(resolve(outputDirectory, 'final'), { recursive: true })

const debugModel = process.env.CARE_DEBUG_MODEL
  ? (JSON.parse(process.env.CARE_DEBUG_MODEL) as Record<string, string>)
  : null

const controller = new AbortController()

const execution = {
  runId: 'debug-run',
  outputDirectory,
  signal: controller.signal,
  model: {
    selection: undefined,
    async getConnection() {
      if (!debugModel) throw new Error('本地调试未设置 CARE_DEBUG_MODEL')
      return debugModel
    },
    async call() {
      throw new Error('本地调试未实现 model.call')
    }
  },
  async reportStatus(status: string, message?: string) {
    console.log(`[status] ${status} ${message ?? ''}`)
  },
  async reportProgress(report: { stage: string; stageName: string; progress?: number; message?: string }) {
    console.log(`[progress] ${report.progress ?? '-'}% ${report.stageName} ${report.message ?? ''}`)
  },
  async log(message: string, stage?: string) {
    console.log(`[log:${stage ?? 'care'}] ${message}`)
  },
  async reportIssue(issue: { level: string; message: string }) {
    console.log(`[issue:${issue.level}] ${issue.message}`)
  },
  async addArtifact(file: { kind: string; name: string; relativePath: string; mime: string }) {
    console.log(`[artifact:${file.kind}] ${file.relativePath}`)
    return { ...file, artifactId: `debug:${file.relativePath}`, size: 0 }
  },
  registerCleanup() {
    // no-op
  }
} as unknown as ExecutionContext

const result = await runBusiness(input, execution)
console.log('\n[result]', result)
