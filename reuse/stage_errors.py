from contextlib import contextmanager


class CareStageError(RuntimeError):
    """携带 CARE 阶段信息的异常，供 Python 桥原样报告给 Runtime。"""

    def __init__(self, stage, stage_name, message, cause=None):
        super().__init__(message)
        self.care_stage = stage
        self.care_stage_name = stage_name
        self.care_cause = cause


def get_care_stage(exc, default_stage="care", default_stage_name="CARE 级联影响分析"):
    """从异常中读取阶段信息；普通异常回退到调用方指定的默认阶段。"""
    stage = getattr(exc, "care_stage", None) or default_stage
    stage_name = getattr(exc, "care_stage_name", None) or default_stage_name
    return stage, stage_name


@contextmanager
def care_stage(stage, stage_name):
    """为算法阶段补充异常信息，已带阶段信息的异常保持原样。"""
    try:
        yield
    except CareStageError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise CareStageError(stage, stage_name, f"{stage_name}失败：{exc}", cause=exc) from exc
