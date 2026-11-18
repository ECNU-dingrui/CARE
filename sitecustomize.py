"""CARE 插件运行时的环境修补。

DSH 的 CARE 插件以 ``PYTHONPATH=<CARE 根目录>`` 启动 Python，因此本模块会在
解释器初始化时被自动导入。它做两件事：

1. 若仓库根目录存在 ``.venv``，把其中的 site-packages 放到 ``sys.path`` 最前面
   （系统 dist-packages 里的旧版 typing_extensions 会与 torch / transformers
   冲突），使未设置 ``CARE_PYTHON`` 的 ``python3`` 也能 import CARE 依赖。
2. 宿主的 ``no_proxy`` 里带有 ``[::1]`` 这类带方括号的 IPv6 条目，httpx 0.28
   解析时会抛 ``Invalid port: ':1]'``，导致调用模型网关失败；这里去掉方括号
   条目（localhost / 127.0.0.1 / ::1 仍在白名单内）。

通过 ``run.sh`` 启动（会导出 ``CARE_PYTHON=.venv/bin/python``）或删除
``.venv`` 后，本模块同样安全：不存在的路径不会注入，代理修补只作用于
CARE 子进程。
"""

import os
import site
import sys

_ROOT = os.path.dirname(os.path.abspath(__file__))
_SITE_PACKAGES = os.path.join(
    _ROOT, ".venv", "lib", "python%d.%d" % sys.version_info[:2], "site-packages"
)

if os.path.isdir(_SITE_PACKAGES) and _SITE_PACKAGES not in sys.path:
    sys.path.insert(0, _SITE_PACKAGES)
    site.addsitedir(_SITE_PACKAGES)

for _name in ("no_proxy", "NO_PROXY"):
    _value = os.environ.get(_name)
    if not _value:
        continue
    _entries = [item.strip() for item in _value.split(",") if item.strip()]
    _cleaned = [item for item in _entries if not item.startswith("[")]
    os.environ[_name] = ",".join(_cleaned)
