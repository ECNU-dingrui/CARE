import { registerRunTool } from '@software-factory/runtime-sdk'
import { runBusiness, setHostContext, setPluginConfig, type CarePluginConfig } from './business.js'

export const name = 'care-dsh-plugin'
export const inject = ['tools', 'sfRuntime']

export function apply(_ctx: unknown, config?: CarePluginConfig): void {
  setPluginConfig(config)
  setHostContext(_ctx)
  registerRunTool(_ctx as never, {
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
