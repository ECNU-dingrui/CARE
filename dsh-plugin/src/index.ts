import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { registerRunTool } from '@software-factory/runtime-sdk'
import { runBusiness, setHostContext, setPluginConfig, type CarePluginConfig } from './business.js'

export const name = 'care-dsh-plugin'
export const inject = ['tools', 'sfRuntime']

/**
 * DSH 插件配置表单的字段定义。volatile 字段可在设置页保存后立即生效，
 * 无需修改 cordis.patch.yml 或重启 DSH。
 */
export const Config = z.object({
  careRoot: z.string().default('')
    .description('CARE 仓库根目录；留空时按插件安装位置自动推导。')
    .volatile(),
  demo: z.boolean().default(false)
    .description('演示模式：不运行真实 CARE 与模型，只验证 DSH 任务链路。')
    .volatile(),
  python: z.object({
    executable: z.string().default('')
      .description('DSH 服务端可用的 Python 解释器；留空时使用 CARE_PYTHON 或 python3。')
      .volatile(),
    script: z.string().default('')
      .description('可选的 Python 桥接脚本；留空使用插件内置 python/care_runner.py。')
      .volatile(),
  }).default({}),
})

function useCustomConfigForm(ctx: Context): void {
  ctx.inject(['settings'], (scope) => {
    const settings = (scope as unknown as {
      settings: { configure(presentation: { auto?: boolean }, owner: unknown): () => void }
    }).settings
    scope.effect(() => settings.configure({ auto: false }, ctx.fiber))
  })
}

export function apply(ctx: Context, config?: CarePluginConfig): void {
  setPluginConfig(config)
  setHostContext(ctx)
  useCustomConfigForm(ctx)
  registerRunTool(ctx, {
    toolId: 'sf_care_evolve_testcase',
    description:
      '给定初始法规文件、初始测试用例集和更新后的法规文件，执行 CARE 级联影响分析，'
      + '复用未受影响的测试用例并更新受影响的测试用例，输出新的测试用例集与变更信息。',
    inputSchema: {
      type: 'object',
      properties: {
        oldRuleFile: {
          type: 'string',
          description: '初始法规文件路径（PDF 或 TXT）。相对路径按工作区解析。'
        },
        oldTestcasesFile: {
          type: 'string',
          description: '初始测试用例集 JSON 文件路径。相对路径按工作区解析。'
        },
        newRuleFile: {
          type: 'string',
          description: '更新后的法规文件路径（PDF 或 TXT）。相对路径按工作区解析。'
        },
        scModelPath: {
          type: 'string',
          description: '可选：规则分类模型路径；skipSc 为 true 时不使用。'
        },
        tcModelPath: {
          type: 'string',
          description: '可选：规则抽取模型路径；仅在未提供模型网关连接时使用。'
        },
        classificationKnowledgeFile: {
          type: 'string',
          description: '可选：分类知识库 JSON，默认使用仓库内 reuse/domain_knowledge/classification_knowledge.json。'
        },
        otherKnowledgeFile: {
          type: 'string',
          description: '可选：领域知识库 JSON，默认使用仓库内 reuse/domain_knowledge/knowledge.json。'
        },
        skipSc: {
          type: 'boolean',
          description: '可选：是否跳过规则分类模型，默认 true。'
        }
      },
      required: ['oldRuleFile', 'oldTestcasesFile', 'newRuleFile']
    },
    modelProtocols: ['openai-completions'],
    execute: runBusiness
  })
}
