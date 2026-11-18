# CARE DSH 插件（接入 software-factory-runtime）

把本仓库的 CARE（Python）包装成一个 DSH Host 业务插件，通过
`@software-factory/runtime-sdk` 登记 Run Tool，由 `software-factory-runtime`
统一管理任务、进度、日志、取消和产物。

- 工具 ID：`sf_care_evolve_testcase`
- 业务入口：`reuse/update_testcase.py`（子进程桥接）
- 模型：优先使用 Runtime 模型网关（`openai-completions`），未取得连接时回退到本地模型或仓库内 `api_key.json`

## 目录

```
dsh-plugin/
├── package.json
├── tsconfig.json
├── cordis.patch.yml
├── src/index.ts              # registerRunTool 登记
├── src/business.ts           # 子进程、NDJSON 事件、产物登记
├── python/care_runner.py     # Python 桥，调用 update_testcase
├── scripts/debug.ts          # 不启动 DSH 的本地调试
├── agent-registration.json   # 平台入库资料（占位，按实际补充）
└── vendor/                   # 放 SDK TGZ
```

## 1. 前置条件

- Node.js 24+
- DSH `0.2.1-alpha.2`（与 Runtime 0.4.0 / SDK 0.4.1 对齐）
- Python 3.9 + CARE 依赖（`pip install -r ../requirements.txt && pip install -e ../`）
- DSH 服务端能运行 Python；使用本地模型时还需 GPU 与模型目录（`../model/trained/...`）

## 2. 安装 SDK 与 Runtime

### SDK（本插件的依赖）

`vendor/software-factory-runtime-sdk-0.4.1.tgz` 已从 Release 下载，然后：

```bash
cd dsh-plugin
npm install
npm run build
```

> GitHub 源码 ZIP 不能替代已构建的 SDK 包。

### Runtime（DSH 宿主插件，不是本插件依赖）

`runtime-release/software-factory-runtime/` 是 Release 的预编译 Runtime 0.4.0
（已含 `lib/index.js`）。在 DSH 插件管理中安装这个目录的绝对路径：

```
<CARE>/dsh-plugin/runtime-release/software-factory-runtime
```

不要用 `git clone` 的 Runtime 源码目录安装：源码没有 `lib/`，且构建需要完整的
reconstruct 工作区（`packages/contracts`、`packages/runtime-sdk`、`gateway/` 和 DSH 源码）。

## 3. 配置

`cordis.patch.yml` 中的 `config` 会传给 `apply(ctx, config)`：

```yaml
- insert:
    - id: care-dsh
      name: '@local/care-dsh-plugin'
      config:
        python:
          executable: /path/to/venv/bin/python   # 指向已安装 CARE 依赖的解释器
        careRoot: /absolute/path/to/CARE        # 留空时按插件位置推导
```

也可以用环境变量 `CARE_PYTHON`、`CARE_ROOT` 覆盖。

模型中真实 API Key 不写入本插件；Runtime 网关提供临时连接。若无法取得连接，
CARE 会尝试本地模型，或在仓库根目录存在 `api_key.json` 时使用其中的配置。

## 4. 本地调试

```bash
cd dsh-plugin
npm run build
node --experimental-strip-types scripts/debug.ts
```

默认使用 `data/evaluation_dataset` 的 dataset1。需要真实模型时：

```bash
CARE_DEBUG_MODEL='{"baseUrl":"https://api.example.com/v1","apiKey":"sk-...","model":"..."}' \
  node --experimental-strip-types scripts/debug.ts
```

调试输出目录为 `dsh-plugin/.debug/run/`。

### 4.1 本机快速看效果（demo 模式）

真实 CARE 需要 Python 依赖、模型或 API Key。只想先验证 DSH → Runtime → 插件 → Python
子进程 → 产物登记这条链路时，用 demo 模式，不需要模型和 CARE 依赖：

```bash
cd dsh-plugin
npm run build
CARE_DEMO=1 node --experimental-strip-types scripts/debug.ts
```

终端会看到 progress / log / artifact 事件和最终结果。进入 DSH 时，启动 DSH 前设置
`CARE_DEMO=1`，或在 `cordis.patch.yml` 中把 `demo` 设为 `true`。

demo 只写示例 `new_testcase.json` 等文件，不运行真实算法。

## 5. 在 DSH 中启用

1. 按 DSH 插件管理安装本目录的绝对路径；包名为 `@local/care-dsh-plugin`。
2. 确保同一 profile 中**先启用 `software-factory-runtime`**，再启用本插件。
3. 在真实工作区会话中先调用 `sf_runtime_get_tool_contract` 确认契约，再调用：

```json
{
  "toolId": "sf_care_evolve_testcase",
  "input": {
    "oldRuleFile": "data/evaluation_dataset/ini_rule/dataset1_ini_rule.txt",
    "oldTestcasesFile": "data/evaluation_dataset/ini_testcase/dataset1_ini_testcase.json",
    "newRuleFile": "data/evaluation_dataset/upd_rule/dataset1_upd_rule.txt"
  }
}
```

返回 `runId` 后，用 `sf_runtime_get_run` / `sf_runtime_wait_run` 查询，用
`sf_runtime_get_artifact` 取最终文件。

## 6. 输入说明

- `oldRuleFile` / `newRuleFile`：PDF 或 TXT 法规文件。
- `oldTestcasesFile`：初始测试用例集 JSON。
- 相对路径优先按工作区解析；找不到时按 CARE 仓库根目录解析。
- 输出写入 Run 的 `execution.outputDirectory/final/`：
  `new_testcase.json`、`change.json`、`linked_scenario.json`、
  `old_rule_testcase_relation.json`。

## 7. Python 侧改动

- `reuse/update_testcase.py`：`update_testcase(..., skip_sc=True, api_key=None)`，
  不再在导入时强制读取 `../api_key.json`。
- `reuse/process_fi_to_fo.py`：`request_api` 使用 `OpenAI(base_url=..., api_key=...)`，
  可接收 Runtime 模型网关返回的 `baseUrl/apiKey/model`。

## 8. 已知限制

- CARE 的规则分类（`process_sci_to_sco.py`）和本地规则抽取仍然依赖本地模型/服务；
  网关只替代 OpenAI Chat Completions 调用。`skipSc: true`（默认）可跳过分类模型。
- PDF 解析、`sentence-transformers`、`z3` 等依赖必须装在 DSH 服务端的 Python 环境中。
- 当前 `agent-registration.json` 为入库资料模板，字段以平台最新基线为准。
