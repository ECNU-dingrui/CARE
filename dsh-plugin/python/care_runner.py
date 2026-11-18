"""CARE 与 DSH Run SDK 之间的子进程桥。

约定：
- 从 stdin 读取一行 JSON 启动消息：
  ``{input, outputDirectory, workspaceDirectory?, modelConnection?, careRoot?}``
- 业务算法期间 ``sys.stdout`` 重定向到 stderr，只有本模块通过
  ``_REAL_STDOUT`` 输出单行 NDJSON 事件，避免 CARE 的 print/tqdm 污染协议。
- 事件类型：progress / log / issue / artifact / result / error。
"""

import json
import os
import sys
import traceback
from pathlib import Path

_REAL_STDOUT = sys.stdout


def emit(event):
    _REAL_STDOUT.write(json.dumps(event, ensure_ascii=False) + "\n")
    _REAL_STDOUT.flush()


def log(message, stage="care"):
    emit({"type": "log", "message": str(message), "stage": stage})


def progress(stage, stage_name, value=None, message=None):
    report = {"stage": stage, "stageName": stage_name}
    if value is not None:
        report["progress"] = value
    if message is not None:
        report["message"] = message
    emit({"type": "progress", "report": report})


def issue(message, level="warning", stage="care", fatal=False, code=None):
    payload = {"level": level, "message": str(message), "stage": stage, "fatal": bool(fatal)}
    if code is not None:
        payload["code"] = code
    emit({"type": "issue", "issue": payload})


def resolve_input_path(value, workspace_directory, care_root):
    path = Path(str(value))
    if path.is_absolute():
        return str(path)
    if workspace_directory:
        candidate = Path(workspace_directory) / path
        if candidate.exists():
            return str(candidate.resolve())
    return str((care_root / path).resolve())


def normalize_api_key(connection):
    """把运行网关返回的连接转换成 CARE 现有 api_key 结构。"""
    if not connection:
        return None
    return {
        "baseURL": connection.get("baseUrl", ""),
        "apiKey": connection.get("apiKey", ""),
        "model": connection.get("model", ""),
    }


def run_demo(start, care_root, workspace_directory, final_directory):
    """不加载 CARE、不调用模型的联调模式，用于验证 DSH/Run/插件链路。"""
    progress("prepare", "准备输入", 10)
    log("CARE DEMO 模式：跳过真实算法与模型", "demo")
    payload = start.get("input") or {}

    sample = [
        {
            "testid": "demo-1",
            "rule": "demo.rule",
            "测试关注点": "演示用例",
            "结果": "成功",
        }
    ]
    try:
        path = resolve_input_path(payload["oldTestcasesFile"], workspace_directory, care_root)
        with open(path, "r", encoding="utf-8") as handle:
            loaded = json.load(handle)
        if isinstance(loaded, list) and loaded:
            sample = loaded
    except Exception:  # noqa: BLE001
        pass

    progress("care", "CARE 级联影响分析（演示）", 45)
    outputs = [
        ("new_testcase.json", sample),
        ("change.json", ["demo.rule"]),
        ("linked_scenario.json", [{"rule": "demo.rule", "testcase": "demo-1"}]),
        ("old_rule_testcase_relation.json", {"demo.rule": ["demo-1"]}),
    ]
    for name, data in outputs:
        with open(final_directory / name, "w", encoding="utf-8") as handle:
            json.dump(data, handle, ensure_ascii=False, indent=4)
        emit(
            {
                "type": "artifact",
                "kind": "final",
                "name": name,
                "relativePath": f"final/{name}",
                "mime": "application/json",
            }
        )
    progress("done", "完成（演示）", 98)
    emit(
        {
            "type": "result",
            "text": (
                "CARE DEMO 完成：已跳过真实算法和模型，仅验证 DSH → Runtime → 插件 → "
                "Python 子进程 → 产物登记链路。设置 CARE_DEMO=0 可运行真实 CARE。"
            ),
        }
    )
    return 0


def main():
    start_line = sys.stdin.readline()
    if not start_line.strip():
        emit({"type": "error", "message": "缺少启动消息"})
        return 1

    try:
        start = json.loads(start_line)
    except Exception as exc:  # noqa: BLE001
        emit({"type": "error", "message": f"启动消息不是合法 JSON：{exc}"})
        return 1

    care_root = Path(start.get("careRoot") or Path(__file__).resolve().parents[2]).resolve()
    workspace_directory = start.get("workspaceDirectory")
    output_directory = Path(start["outputDirectory"]).resolve()
    final_directory = output_directory / "final"
    final_directory.mkdir(parents=True, exist_ok=True)

    # 让 CARE 算法里的 print 走 stderr，stdout 只保留 NDJSON 协议。
    sys.stdout = sys.stderr

    if str(care_root) not in sys.path:
        sys.path.insert(0, str(care_root))

    from reuse.stage_errors import get_care_stage

    if start.get("demo") is True or os.environ.get("CARE_DEMO") == "1":
        try:
            return run_demo(start, care_root, workspace_directory, final_directory)
        except Exception as exc:  # noqa: BLE001
            detail = traceback.format_exc()
            sys.stderr.write(detail + "\n")
            emit({"type": "error", "message": str(exc)})
            return 1

    try:
        progress("prepare", "准备输入", 8)
        payload = start.get("input") or {}
        old_rule_file = resolve_input_path(payload["oldRuleFile"], workspace_directory, care_root)
        old_testcases_file = resolve_input_path(payload["oldTestcasesFile"], workspace_directory, care_root)
        new_rule_file = resolve_input_path(payload["newRuleFile"], workspace_directory, care_root)

        for label, path in (
            ("初始法规文件", old_rule_file),
            ("初始测试用例", old_testcases_file),
            ("更新法规文件", new_rule_file),
        ):
            if not Path(path).exists():
                raise FileNotFoundError(f"{label}不存在：{path}")

        sc_model_path = payload.get("scModelPath") or str(
            care_root / "model" / "trained" / "mengzi_rule_filtering"
        )
        tc_model_path = payload.get("tcModelPath") or str(
            care_root / "model" / "trained" / "glm4_lora"
        )
        classification_knowledge_file = payload.get("classificationKnowledgeFile") or str(
            care_root / "reuse" / "domain_knowledge" / "classification_knowledge.json"
        )
        other_knowledge_file = payload.get("otherKnowledgeFile") or str(
            care_root / "reuse" / "domain_knowledge" / "knowledge.json"
        )
        skip_sc = bool(payload.get("skipSc", True))

        api_key = normalize_api_key(start.get("modelConnection"))
        if api_key is not None:
            log("使用 Runtime 模型网关执行规则抽取", "model")
        else:
            log("未提供模型网关连接，使用本地模型或仓库内 api_key.json", "model")

        # CARE 内部使用相对路径读取 prompt / cache，切到 reuse 目录。
        os.chdir(care_root / "reuse")
        from reuse.update_testcase import update_testcase

        progress("care", "CARE 级联影响分析", 15)
        new_testcases, change, linked_scenario, old_relation = update_testcase(
            old_rule_file,
            old_testcases_file,
            new_rule_file,
            sc_model_path,
            tc_model_path,
            classification_knowledge_file,
            other_knowledge_file,
            skip_sc,
            api_key=api_key,
        )

        progress("export", "导出结果", 90)
        outputs = [
            ("new_testcase.json", new_testcases, "application/json"),
            ("change.json", change, "application/json"),
            ("linked_scenario.json", linked_scenario, "application/json"),
            ("old_rule_testcase_relation.json", old_relation, "application/json"),
        ]
        for name, data, mime in outputs:
            relative_path = f"final/{name}"
            with open(final_directory / name, "w", encoding="utf-8") as handle:
                json.dump(data, handle, ensure_ascii=False, indent=4)
            emit(
                {
                    "type": "artifact",
                    "kind": "final",
                    "name": name,
                    "relativePath": relative_path,
                    "mime": mime,
                }
            )

        text = (
            f"CARE 完成：输出 {len(new_testcases)} 组测试用例，"
            f"识别变更规则 {len(change)} 条，受影响场景 {len(linked_scenario)} 个。"
        )
        progress("done", "完成", 98)
        emit({"type": "result", "text": text})
        return 0
    except Exception as exc:  # noqa: BLE001
        detail = traceback.format_exc()
        sys.stderr.write(detail + "\n")
        stage, stage_name = get_care_stage(exc)
        issue(str(exc), level="error", stage=stage, fatal=True)
        emit(
            {
                "type": "error",
                "message": str(exc),
                "stage": stage,
                "stageName": stage_name,
            }
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
