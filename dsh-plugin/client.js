// Loaded by the DSH browser module loader; React and configuration storage belong to the host.
window.__ModuleLoader__.load({
  id: '@local/care-dsh-plugin',
  factory(require) {
    const React = require('react'), h = React.createElement
    // The row id comes from cordis.patch.yml; the row slot key is <package>#<rowId>.
    const ENTRY_ID = 'care-dsh'
    const ROW_KEY = '@local/care-dsh-plugin#care-dsh'
    const NS = 'careDshSettings'
    const words = {
      zh: {
        title: 'CARE 测试用例演进配置',
        intro: '在此填写 CARE 运行环境。保存后下一次任务生效，无需修改 cordis.patch.yml 或重启 DSH。',
        careRoot: 'CARE 仓库根目录',
        careRootHint: '包含 reuse/update_testcase.py 的目录。留空时按插件安装位置或当前工作区自动推导。',
        python: 'Python 解释器',
        pythonHint: 'DSH 服务端可用的解释器路径，建议指向已安装 CARE 依赖的虚拟环境。留空时使用 CARE_PYTHON 或 python3。',
        script: 'Python 桥接脚本（可选）',
        scriptHint: '默认使用插件自带的 python/care_runner.py；只有替换桥接脚本时才需要填写。',
        demo: '演示模式',
        demoHint: '不运行真实 CARE 与模型，只验证 DSH → Runtime → 插件 → Python 子进程 → 产物登记链路。',
        save: '保存', discard: '放弃修改', saving: '正在保存…', saved: '已保存，下一次任务生效。',
        loading: '正在读取配置…', unavailable: '配置暂不可用：请启用 DSH 原生设置服务。',
        readOnly: '当前连接没有保存配置的权限。',
        conflict: '配置已在其他页面修改，请放弃修改后重新填写。',
        failed: '保存失败，请检查服务端提示。', dirty: '有未保存的修改',
        summary: 'CARE 运行环境', summaryAuto: '自动推导仓库', summaryDemo: '演示模式',
      },
      en: {
        title: 'CARE Test Suite Evolution settings',
        intro: 'Configure the CARE runtime here. Saved values apply to the next task without editing cordis.patch.yml or restarting DSH.',
        careRoot: 'CARE repository root',
        careRootHint: 'Directory containing reuse/update_testcase.py. Leave blank to infer it from the plugin location or the current workspace.',
        python: 'Python interpreter',
        pythonHint: 'Interpreter available to the DSH server, preferably a virtual environment with CARE dependencies installed. Leave blank to use CARE_PYTHON or python3.',
        script: 'Python bridge script (optional)',
        scriptHint: 'Defaults to the bundled python/care_runner.py. Fill this only when replacing the bridge script.',
        demo: 'Demo mode',
        demoHint: 'Skip the real CARE algorithm and models; only verify the DSH → Runtime → plugin → Python subprocess → artifact chain.',
        save: 'Save', discard: 'Discard changes', saving: 'Saving…', saved: 'Saved. Applies to the next task.',
        loading: 'Loading configuration…', unavailable: 'Configuration unavailable: enable the native DSH settings service.',
        readOnly: 'This connection cannot save configuration.',
        conflict: 'Another page changed the configuration. Discard changes and edit again.',
        failed: 'Could not save. Check the server message.', dirty: 'Unsaved changes',
        summary: 'CARE runtime', summaryAuto: 'auto-detect repository', summaryDemo: 'demo mode',
      },
    }

    function format(value) {
      const source = value !== null && typeof value === 'object' ? value : {}
      const python = source.python !== null && typeof source.python === 'object' ? source.python : {}
      return {
        careRoot: typeof source.careRoot === 'string' ? source.careRoot : '',
        demo: source.demo === true,
        python: {
          executable: typeof python.executable === 'string' ? python.executable : '',
          script: typeof python.script === 'string' ? python.script : '',
        },
      }
    }

    function Configuration({ scope, view, t }) {
      const observer = React.useMemo(() => ({
        subscribe: fn => scope.subscribe(fn),
        get: () => scope.getSnapshot(),
      }), [scope])
      const state = React.useSyncExternalStore(observer.subscribe, observer.get, observer.get)
      const [draft, setDraft] = React.useState(null)
      const [baseline, setBaseline] = React.useState(null)
      const [revision, setRevision] = React.useState()
      const [saving, setSaving] = React.useState(false)
      const [notice, setNotice] = React.useState('')
      const [error, setError] = React.useState('')
      const id = React.useId()
      const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(baseline)
      const conflict = dirty && revision !== state.revision

      React.useEffect(() => {
        if (state.status === 'ready' && state.value && !dirty && !saving) {
          const next = format(state.value)
          setDraft(next)
          setBaseline(next)
          setRevision(state.revision)
        }
      }, [state.status, state.value, state.revision, dirty, saving])

      if (view === 'summary') {
        if (state.status !== 'ready' || !state.value) return t('summary')
        const config = format(state.value)
        const parts = []
        if (config.demo) parts.push(t('summaryDemo'))
        parts.push(config.python.executable || 'python3')
        parts.push(config.careRoot || t('summaryAuto'))
        return h('span', null, parts.join(' · '))
      }

      const disabled = saving || !state.writable || state.status !== 'ready'

      function update(patch) {
        setDraft(current => {
          if (!current) return current
          if (patch.python) return { ...current, python: { ...current.python, ...patch.python } }
          return { ...current, ...patch }
        })
        setError('')
        setNotice('')
      }

      function setField(path, value) {
        if (path.length === 1) update({ [path[0]]: value })
        else update({ [path[0]]: { [path[1]]: value } })
      }

      function discard() {
        const current = scope.getSnapshot()
        if (!current.value) return
        const next = format(current.value)
        setDraft(next)
        setBaseline(next)
        setRevision(current.revision)
        setError('')
        setNotice('')
      }

      async function save(event) {
        event.preventDefault()
        if (disabled || !dirty || conflict || !draft) return
        setSaving(true)
        setError('')
        setNotice('')
        try {
          const values = {
            careRoot: draft.careRoot.trim(),
            demo: draft.demo,
            executable: draft.python.executable.trim(),
            script: draft.python.script.trim(),
          }
          const accepted = await scope.mutate([
            { op: 'set', path: ['careRoot'], value: values.careRoot },
            { op: 'set', path: ['demo'], value: values.demo },
            { op: 'set', path: ['python', 'executable'], value: values.executable },
            { op: 'set', path: ['python', 'script'], value: values.script },
          ], revision)
          if (accepted) {
            const current = scope.getSnapshot()
            const next = format(current.value ?? {
              careRoot: values.careRoot,
              demo: values.demo,
              python: { executable: values.executable, script: values.script },
            })
            setDraft(next)
            setBaseline(next)
            setRevision(current.revision)
            setNotice(t('saved'))
          } else {
            setError(t(scope.getSnapshot().revision !== revision ? 'conflict' : 'failed'))
          }
        } catch (reason) {
          setError(t('failed') + (reason && reason.message ? ' ' + reason.message : ''))
        } finally {
          setSaving(false)
        }
      }

      function field(path, label, hint) {
        const key = path.join('.')
        const value = path.length === 1 ? draft[path[0]] : draft[path[0]][path[1]]
        return h('div', { key },
          h('label', { htmlFor: id + key }, t(label)),
          h('input', {
            id: id + key,
            name: key,
            type: 'text',
            value,
            disabled,
            'aria-describedby': id + key + '-hint',
            placeholder: key === 'python.executable' ? 'python3' : undefined,
            onChange: event => setField(path, event.target.value),
          }),
          h('p', { id: id + key + '-hint' }, t(hint)))
      }

      return h('form', { className: 'care-dsh-settings', onSubmit: save, noValidate: true },
        h('style', null, '.care-dsh-settings{display:flex;flex-direction:column;gap:20px;color:var(--dsw-alias-label-primary);font-size:14px}.care-dsh-settings h4{margin:0;font-size:16px}.care-dsh-settings p{font-size:13px;color:var(--dsw-alias-label-secondary);margin:6px 0}.care-dsh-settings label{display:block;margin-bottom:8px}.care-dsh-settings input[type=text]{box-sizing:border-box;width:100%;padding:10px 12px;border:1px solid var(--dsw-alias-border-l3);border-radius:8px;background:var(--dsw-alias-bg-layer-3);color:inherit;font:inherit}.care-dsh-settings .care-dsh-check{display:flex;align-items:flex-start;gap:8px}.care-dsh-settings .care-dsh-check input{margin-top:2px}.care-dsh-settings footer{display:flex;gap:12px}.care-dsh-settings button{padding:8px 16px;border-radius:8px;border:1px solid var(--dsw-alias-border-l3);background:transparent;color:inherit;font:inherit;cursor:pointer}.care-dsh-settings button[type=submit]{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}.care-dsh-settings button:disabled{opacity:.4;cursor:default}.care-dsh-settings [role=alert]{color:var(--dsw-alias-label-error)}'),
        h('header', null, h('h4', null, t('title')), h('p', null, t('intro'))),
        state.status !== 'ready' || !draft
          ? h('p', { role: 'status' }, t(state.status === 'loading' ? 'loading' : 'unavailable'))
          : h(React.Fragment, null,
            !state.writable && h('p', { role: 'status' }, t('readOnly')),
            field(['careRoot'], 'careRoot', 'careRootHint'),
            field(['python', 'executable'], 'python', 'pythonHint'),
            field(['python', 'script'], 'script', 'scriptHint'),
            h('div', { className: 'care-dsh-check' },
              h('input', {
                id: id + 'demo',
                name: 'demo',
                type: 'checkbox',
                checked: draft.demo,
                disabled,
                onChange: event => update({ demo: event.target.checked }),
              }),
              h('div', null,
                h('label', { htmlFor: id + 'demo', style: { marginBottom: 0 } }, t('demo')),
                h('p', null, t('demoHint')))),
            (error || conflict) && h('p', { role: 'alert' }, error || t('conflict')),
            h('footer', null,
              h('button', { type: 'submit', disabled: disabled || !dirty || conflict },
                t(saving ? 'saving' : 'save')),
              h('button', { type: 'button', disabled: saving || !dirty, onClick: discard },
                t('discard'))),
            h('p', { role: 'status' }, notice || (dirty ? t('dirty') : ''))))
    }

    return {
      inject: ['slots', 'locale', 'configForms'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, words))
        const scope = ctx.configForms.get(ENTRY_ID)
        ctx.slots.inject('plugins.row.config', () => ctx.slots.register({
          name: 'plugins.row.config',
          key: ROW_KEY,
          locale: NS,
          inject: () => ({ scope }),
        }, Configuration))
      },
    }
  },
})
