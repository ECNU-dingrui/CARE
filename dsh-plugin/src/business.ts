import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import type { Readable } from 'node:stream'
import { existsSync } from 'node:fs'
import { dirname, delimiter, isAbsolute, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Volatile } from '@deepseek-ai/cordis'
import type { BusinessResult, ExecutionContext } from '@software-factory/runtime-sdk'

/** 配置字段在 DSH 设置页保存后是 volatile 引用，需要每次通过 get() 读取最新值。 */
type Live<T> = T | Volatile<T>

export interface CarePluginConfig {
  /** CARE 仓库根目录；留空时按插件安装位置推导。 */
  careRoot?: Live<string>
  /** 联调模式：不运行真实 CARE 与模型，只验证插件链路；也可用 CARE_DEMO=1。 */
  demo?: Live<boolean>
  python?: {
    /** Python 解释器；默认环境变量 CARE_PYTHON 或 python3。 */
    executable?: Live<string>
    /** bridge 脚本；默认 dsh-plugin/python/care_runner.py。 */
    script?: Live<string>
  }
}

let pluginConfig: CarePluginConfig = {}
let hostContext: unknown

export function setPluginConfig(config: CarePluginConfig | undefined): void {
  pluginConfig = config ?? {}
}

function readLive<T>(value: Live<T> | undefined): T | undefined {
  if (value === undefined) return undefined
  if (typeof value === 'object' && value !== null && 'get' in value) {
    return (value as unknown as { get(): T }).get()
  }
  return value
}

export function setHostContext(ctx: unknown): void {
  hostContext = ctx
}

interface BridgeEvent {
  type: 'progress' | 'log' | 'issue' | 'artifact' | 'result' | 'error'
  [key: string]: unknown
}

interface ModelConnection {
  baseUrl: string
  apiKey: string
  model: string
  protocol: string
}

interface ManagedChild {
  stdout: Readable
  stderr: Readable
  wait(): Promise<number>
  terminate(): void
}

interface HostSubprocess {
  resolveExecutable?(
    command: string,
    env?: Readonly<Record<string, string>>,
    signal?: AbortSignal
  ): Promise<string>
  spawn?(spec: Record<string, unknown>): {
    stdout?: Readable
    stderr?: Readable
    done: Promise<{ exitCode: number | null; signal: string | null }>
    terminate(): void
  }
}

function moduleRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  // lib/business.js -> 插件根目录
  return resolve(here, '..')
}

function resolveCareRoot(): string {
  const configured = readLive(pluginConfig.careRoot)?.trim() || process.env.CARE_ROOT?.trim()
  if (configured) return resolve(configured)
  for (const candidate of [resolve(moduleRoot(), '..'), process.cwd()]) {
    if (existsSync(resolve(candidate, 'reuse', 'update_testcase.py'))) return candidate
  }
  throw new Error(
    '未找到 CARE 仓库根目录。请在 DSH 插件配置页设置 CARE 仓库根目录，'
    + '或设置环境变量 CARE_ROOT 指向包含 reuse/update_testcase.py 的目录。'
  )
}

function resolvePython(): string {
  const configured = readLive(pluginConfig.python?.executable)?.trim()
    || process.env.CARE_PYTHON?.trim()
  if (configured) return configured
  return process.platform === 'win32' ? 'python' : 'python3'
}

function resolveBridgeScript(careRoot: string): string {
  const configured = readLive(pluginConfig.python?.script)?.trim()
  if (configured) return isAbsolute(configured) ? configured : resolve(careRoot, configured)
  return resolve(moduleRoot(), 'python', 'care_runner.py')
}

/** 从 <workspace>/outputs/runs/<runId> 推导工作区目录。 */
function deriveWorkspace(outputDirectory: string): string | undefined {
  const normalized = outputDirectory.replace(/[\\/]+$/, '')
  const marker = `${sep}outputs${sep}runs${sep}`
  const index = normalized.lastIndexOf(marker)
  if (index < 0) return undefined
  return normalized.slice(0, index)
}

async function readModelConnection(
  execution: ExecutionContext
): Promise<ModelConnection | null> {
  try {
    const connection = await execution.model.getConnection({ protocol: 'openai-completions' })
    return connection as ModelConnection
  } catch (error) {
    await execution.log(
      `未取得模型网关连接，CARE 将回退到本地模型或仓库内 api_key.json：${String(error)}`,
      'model'
    )
    return null
  }
}

function waitForExit(child: ChildProcessWithoutNullStreams): Promise<number> {
  return new Promise<number>((resolveExit, rejectExit) => {
    child.once('error', rejectExit)
    child.once('exit', (code, signal) => {
      if (code !== null) {
        resolveExit(code)
        return
      }
      resolveExit(signal === null ? 0 : 1)
    })
  })
}

function killOnAbort(child: ChildProcessWithoutNullStreams): void {
  if (child.exitCode !== null) return
  child.kill('SIGTERM')
  const timer = setTimeout(() => {
    if (child.exitCode === null) child.kill('SIGKILL')
  }, 5000)
  timer.unref()
}

/**
 * 优先用 DSH 的 ctx.subprocess 托管子进程（取消、进程范围、退出等待由宿主负责）；
 * 宿主没有 subprocess 服务时回退到 Node spawn。
 */
async function startChild(
  python: string,
  script: string,
  careRoot: string,
  startJson: string,
  execution: ExecutionContext
): Promise<ManagedChild> {
  const env = {
    PYTHONPATH: [careRoot, process.env.PYTHONPATH].filter(Boolean).join(delimiter),
    PYTHONUNBUFFERED: '1',
    PYTHONUTF8: '1',
    PYTHONIOENCODING: 'utf-8'
  }
  let subprocess: HostSubprocess | undefined
  try {
    subprocess = (hostContext as { subprocess?: HostSubprocess } | undefined)?.subprocess
  } catch {
    subprocess = undefined
  }

  if (subprocess?.resolveExecutable && subprocess.spawn) {
    const executable = await subprocess.resolveExecutable(python, env, execution.signal)
    const handle = subprocess.spawn({
      argv: [executable, script],
      cwd: careRoot,
      stdio: {
        stdin: { data: startJson + '\n' },
        stdout: 'pipe',
        stderr: 'pipe'
      },
      graceMs: 5000,
      signal: execution.signal,
      env
    })
    if (!handle.stdout || !handle.stderr) {
      throw new Error('ctx.subprocess 未返回 stdout/stderr 管道')
    }
    return {
      stdout: handle.stdout,
      stderr: handle.stderr,
      wait: async () => {
        const outcome = await handle.done
        return outcome.exitCode ?? (outcome.signal === null ? 0 : 1)
      },
      terminate: () => handle.terminate()
    }
  }

  const child = spawn(python, [script], {
    cwd: careRoot,
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'pipe']
  })
  child.stdin.write(startJson + '\n')
  child.stdin.end()
  return {
    stdout: child.stdout,
    stderr: child.stderr,
    wait: () => waitForExit(child),
    terminate: () => killOnAbort(child)
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export async function runBusiness(
  input: Record<string, unknown>,
  execution: ExecutionContext
): Promise<BusinessResult> {
  execution.signal.throwIfAborted()

  const careRoot = resolveCareRoot()
  const script = resolveBridgeScript(careRoot)
  const python = resolvePython()

  await execution.reportProgress({
    stage: 'init',
    stageName: '初始化 CARE',
    progress: 2
  })

  const modelConnection = await readModelConnection(execution)
  if (modelConnection === null) {
    await execution.reportIssue({
      level: 'warning',
      stage: 'model',
      message: '任务未使用模型网关；需要本地模型或有效 api_key.json 才能完成规则抽取。'
    })
  }

  await execution.reportProgress({
    stage: 'care',
    stageName: 'CARE 级联影响分析',
    progress: 5
  })

  const startJson = JSON.stringify({
    input,
    outputDirectory: execution.outputDirectory,
    workspaceDirectory: deriveWorkspace(execution.outputDirectory),
    modelConnection,
    careRoot,
    demo: readLive(pluginConfig.demo) === true || process.env.CARE_DEMO === '1'
  })

  const child = await startChild(python, script, careRoot, startJson, execution)

  let terminated = false
  const terminate = (): void => {
    if (terminated) return
    terminated = true
    child.terminate()
  }

  const onAbort = (): void => terminate()
  execution.signal.addEventListener('abort', onAbort)
  execution.registerCleanup(async () => {
    execution.signal.removeEventListener('abort', onAbort)
    terminate()
  })

  let stderr = ''
  child.stderr.on('data', (chunk: Buffer | string) => {
    stderr += chunk.toString()
  })

  const exitPromise = child.wait()
  const finalArtifacts: string[] = []
  let resultText = ''
  let failureStage: string | undefined
  let failureStageName: string | undefined

  const lines = createInterface({ input: child.stdout })
  try {
    for await (const line of lines) {
      const trimmed = line.trim()
      if (trimmed === '') continue

      let event: BridgeEvent
      try {
        event = JSON.parse(trimmed) as BridgeEvent
      } catch {
        await execution.log(trimmed, 'care')
        continue
      }

      switch (event.type) {
        case 'progress': {
          const report = asRecord(event.report)
          await execution.reportProgress({
            stage: String(report.stage ?? 'care'),
            stageName: String(report.stageName ?? 'CARE'),
            progress: typeof report.progress === 'number' ? report.progress : undefined,
            message: typeof report.message === 'string' ? report.message : undefined
          })
          break
        }
        case 'log':
          await execution.log(
            String(event.message ?? ''),
            typeof event.stage === 'string' ? event.stage : undefined
          )
          break
        case 'issue': {
          const issue = asRecord(event.issue)
          await execution.reportIssue({
            level: issue.level === 'error' ? 'error' : 'warning',
            message: String(issue.message ?? 'CARE 报告了一个问题'),
            stage: typeof issue.stage === 'string' ? issue.stage : undefined,
            code: typeof issue.code === 'string' ? issue.code : undefined,
            fatal: issue.fatal === true
          })
          break
        }
        case 'artifact': {
          const artifact = await execution.addArtifact({
            kind: event.kind === 'intermediate' ? 'intermediate' : 'final',
            name: String(event.name ?? 'artifact'),
            relativePath: String(event.relativePath ?? ''),
            mime: String(event.mime ?? 'application/octet-stream')
          })
          if (event.kind !== 'intermediate') finalArtifacts.push(artifact.artifactId)
          break
        }
        case 'result':
          resultText = String(event.text ?? '')
          break
        case 'error':
          if (typeof event.stage === 'string') failureStage = event.stage
          if (typeof event.stageName === 'string') failureStageName = event.stageName
          throw new Error(String(event.message ?? 'CARE 执行失败'))
        default:
          await execution.log(trimmed, 'care')
      }
    }

    const code = await exitPromise
    if (code !== 0) {
      throw new Error(
        `CARE 进程退出码 ${code}${stderr.trim() ? `：${stderr.trim().slice(-2000)}` : ''}`
      )
    }
  } catch (error) {
    terminate()
    const reason = error instanceof Error ? error.message : String(error)
    await execution.reportIssue({
      level: 'error',
      stage: failureStage ?? 'care',
      message: failureStageName ? `${failureStageName}：${reason}` : reason,
      fatal: true
    })
    throw error
  } finally {
    execution.signal.removeEventListener('abort', onAbort)
  }

  execution.signal.throwIfAborted()
  if (resultText === '' && finalArtifacts.length === 0) {
    throw new Error('CARE 未返回文本结果或最终文件')
  }
  await execution.reportProgress({
    stage: 'done',
    stageName: '完成',
    progress: 100
  })
  return { text: resultText, files: finalArtifacts }
}
