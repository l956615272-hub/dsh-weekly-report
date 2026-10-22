/**
 * Browser half of dsh-weekly-report.
 *
 * Hand-authored __ModuleLoader__ bundle: the only runtime import is React from
 * the platform module table, so the plugin needs no build step.
 */
window.__ModuleLoader__.load({
  id: 'dsh-weekly-report',
  factory: (require) => {
    const React = require('react');
    const h = React.createElement;
    const BASE = '/dsh-weekly-report';
    const DAY = 24 * 60 * 60 * 1000;
    const BORDER = '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.35))';
    const DIVIDER = '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.18))';

    /** Workspace UI service, acquired through ctx.inject; used only for navigation. */
    let workspaceUi = null;

    const PRESETS = [
      { id: 'today', label: '今天' },
      { id: '7d', label: '近 7 天' },
      { id: 'this-week', label: '本周' },
      { id: 'last-week', label: '上周' },
      { id: 'this-month', label: '本月' },
      { id: 'last-month', label: '上月' },
      { id: 'custom', label: '自定义' }
    ];

    const REPORT_TYPES = [
      { id: 'daily', label: '日报' },
      { id: 'weekly', label: '周报' },
      { id: 'monthly', label: '月报' }
    ];

    const styles = {
      root: { padding: '4px 2px 28px', fontSize: 13, lineHeight: 1.5, color: 'inherit' },
      row: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 },
      chip: (active) => ({
        padding: '3px 10px',
        borderRadius: 999,
        border: BORDER,
        cursor: 'pointer',
        fontSize: 12,
        background: active ? 'var(--dsw-alias-bg-accent, rgba(80,140,255,0.18))' : 'transparent',
        color: 'inherit'
      }),
      button: (primary) => ({
        padding: '5px 14px',
        borderRadius: 6,
        border: BORDER,
        cursor: 'pointer',
        fontSize: 13,
        background: primary ? 'var(--dsw-alias-bg-accent, rgba(80,140,255,0.22))' : 'transparent',
        color: 'inherit',
        fontWeight: primary ? 600 : 400
      }),
      input: { fontSize: 12, padding: '4px 6px', borderRadius: 6, border: BORDER, background: 'transparent', color: 'inherit', colorScheme: 'light dark' },
      textarea: { width: '100%', minHeight: 96, fontSize: 12, padding: '6px 8px', borderRadius: 6, border: BORDER, background: 'transparent', color: 'inherit', colorScheme: 'light dark', fontFamily: 'inherit', resize: 'vertical' },
      card: { border: BORDER, borderRadius: 8, padding: '8px 10px', marginBottom: 8 },
      section: { marginBottom: 16 },
      sectionTitle: { fontSize: 14, fontWeight: 600, marginBottom: 6 },
      workspaceTitle: { fontWeight: 600, marginBottom: 4 },
      session: { display: 'flex', gap: 8, alignItems: 'flex-start', padding: '5px 0', borderTop: DIVIDER },
      groupHead: { display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' },
      chevron: (open) => ({
        flex: '0 0 12px',
        width: 12,
        textAlign: 'center',
        opacity: 0.7,
        transform: open ? 'rotate(0deg)' : 'rotate(-90deg)',
        transition: 'transform 120ms ease'
      }),
      // Workspaces with many sessions scroll on their own, so a long list no
      // longer pushes the rest of the form off screen.
      groupList: {
        maxHeight: 264,
        overflowY: 'auto',
        overscrollBehavior: 'contain',
        marginTop: 4,
        paddingRight: 6,
        display: 'flex',
        flexDirection: 'column'
      },
      muted: { opacity: 0.65, fontSize: 12 },
      hint: { opacity: 0.65, fontSize: 12, marginTop: -4, marginBottom: 8 },
    };

    function startOfDay(ms) {
      const date = new Date(ms);
      date.setHours(0, 0, 0, 0);
      return date.getTime();
    }

    function startOfWeek(ms) {
      const date = new Date(startOfDay(ms));
      const weekday = (date.getDay() + 6) % 7;
      date.setDate(date.getDate() - weekday);
      return date.getTime();
    }

    /**
     * Resolve the window for a preset. `now` is passed in on purpose: anchoring
     * to Date.now() inside render hands every render a new window, which changes
     * the load callback identity and re-fires the fetch effect forever.
     */
    function rangeOf(preset, customFrom, customTo, now) {
      if (preset === 'today') return { from: startOfDay(now), to: now };
      if (preset === '7d') return { from: now - 7 * DAY, to: now };
      if (preset === 'this-week') { const from = startOfWeek(now); return { from, to: from + 7 * DAY - 1 }; }
      if (preset === 'last-week') { const from = startOfWeek(now) - 7 * DAY; return { from, to: from + 7 * DAY - 1 }; }
      if (preset === 'this-month') {
        const start = new Date(now);
        start.setDate(1);
        const next = new Date(start);
        next.setMonth(next.getMonth() + 1);
        return { from: startOfDay(start.getTime()), to: next.getTime() - 1 };
      }
      if (preset === 'last-month') {
        const start = new Date(now);
        start.setDate(1);
        start.setMonth(start.getMonth() - 1);
        const end = new Date(start);
        end.setMonth(end.getMonth() + 1);
        return { from: startOfDay(start.getTime()), to: end.getTime() - 1 };
      }
      const from = customFrom ? Date.parse(customFrom + 'T00:00:00') : now - 7 * DAY;
      const to = customTo ? Date.parse(customTo + 'T23:59:59.999') : now;
      return { from, to };
    }

    function toDateInput(ms) {
      const date = new Date(ms);
      const pad = (value) => String(value).padStart(2, '0');
      return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
    }

    function formatTime(ms) {
      if (!ms) return '—';
      const date = new Date(ms);
      const pad = (value) => String(value).padStart(2, '0');
      return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + ' ' +
        pad(date.getHours()) + ':' + pad(date.getMinutes());
    }

    async function callApi(path, options) {
      const response = await fetch(BASE + path, options);
      let payload = null;
      try {
        payload = await response.json();
      } catch {
        throw new Error('HTTP ' + response.status);
      }
      if (!payload || payload.ok !== true) throw new Error((payload && payload.error) || ('HTTP ' + response.status));
      return payload.data;
    }

    function toggleInSet(setter, value) {
      setter((previous) => {
        const next = new Set(previous);
        if (next.has(value)) next.delete(value);
        else next.add(value);
        return next;
      });
    }

    function WeeklyReportPanel(props) {
      // The settings shell hands every section a `close` callback, so a finished
      // flow can dismiss the panel and show the Session it just started.
      const closeSettings = props && typeof props.close === 'function' ? props.close : null;
      const [preset, setPreset] = React.useState('7d');
      const [customFrom, setCustomFrom] = React.useState(() => toDateInput(Date.now() - 7 * DAY));
      const [customTo, setCustomTo] = React.useState(() => toDateInput(Date.now()));
      const [reportType, setReportType] = React.useState('weekly');
      const [includeSubagents, setIncludeSubagents] = React.useState(false);
      const [query, setQuery] = React.useState('');
      const [selected, setSelected] = React.useState(() => new Set());
      // Workspace keys the user folded away; expanded by default.
      const [collapsed, setCollapsed] = React.useState(() => new Set());
      const [state, setState] = React.useState({ status: 'idle' });

      const [workspaces, setWorkspaces] = React.useState([]);
      const [gitEnabled, setGitEnabled] = React.useState(false);
      const [gitWorkspaces, setGitWorkspaces] = React.useState(() => new Set());
      const [repos, setRepos] = React.useState([]);
      const [repoSelection, setRepoSelection] = React.useState(() => new Set());
      const [authors, setAuthors] = React.useState('');
      const [allBranches, setAllBranches] = React.useState(false);
      const [includeMerges, setIncludeMerges] = React.useState(false);

      const [sample, setSample] = React.useState('');
      const [extra, setExtra] = React.useState('');
      const [preview, setPreview] = React.useState(null);
      const [promptText, setPromptText] = React.useState('');
      const [busy, setBusy] = React.useState(false);
      const [notice, setNotice] = React.useState(null);
      const [reports, setReports] = React.useState([]);
      const [samples, setSamples] = React.useState([]);
      const [sampleName, setSampleName] = React.useState('');
      const [viewer, setViewer] = React.useState(null);

      // The window only moves when the user changes it or presses 刷新.
      const [anchor, setAnchor] = React.useState(() => Date.now());
      const range = React.useMemo(
        () => rangeOf(preset, customFrom, customTo, anchor),
        [preset, customFrom, customTo, anchor]
      );

      const load = React.useCallback(async () => {
        setState({ status: 'loading' });
        try {
          const data = await callApi('/sessions?from=' + range.from + '&to=' + range.to + (includeSubagents ? '&subagents=1' : ''));
          setState({ status: 'ready', data });
        } catch (error) {
          setState({ status: 'error', message: (error && error.message) || String(error) });
        }
      }, [range.from, range.to, includeSubagents]);

      React.useEffect(() => { load(); }, [load]);

      React.useEffect(() => {
        callApi('/workspaces')
          .then((data) => {
            setWorkspaces(data.workspaces || []);
            if (data.identity) {
              const values = [data.identity.name, data.identity.email].filter(Boolean);
              setAuthors((previous) => previous || values.join(', '));
            }
          })
          .catch(() => {});
        callApi('/reports')
          .then((data) => setReports(data.reports || []))
          .catch(() => {});
        callApi('/samples')
          .then((data) => setSamples(data.samples || []))
          .catch(() => {});
      }, []);

      const workspacePaths = React.useMemo(
        () => workspaces.filter((item) => gitWorkspaces.has(item.id)).map((item) => item.path),
        [workspaces, gitWorkspaces]
      );

      React.useEffect(() => {
        if (!gitEnabled || workspacePaths.length === 0) {
          setRepos([]);
          setRepoSelection(new Set());
          return;
        }
        let cancelled = false;
        Promise.all(workspacePaths.map((path) => callApi('/repos?workspace=' + encodeURIComponent(path)).catch(() => ({ repos: [] }))))
          .then((results) => {
            if (cancelled) return;
            const merged = results.flatMap((result) => result.repos || []);
            setRepos(merged);
            setRepoSelection(new Set(merged.map((repo) => repo.path)));
          })
          .catch(() => {});
        return () => { cancelled = true; };
      }, [gitEnabled, workspacePaths.join('|')]);

      const groups = state.data ? state.data.groups : [];
      const needle = query.trim().toLowerCase();
      const visible = groups
        .map((group) => ({
          ...group,
          entries: group.entries.filter((entry) => {
            if (!needle) return true;
            return (entry.title || '').toLowerCase().includes(needle) ||
              (entry.workspaceTitle || '').toLowerCase().includes(needle) ||
              (entry.cwd || '').toLowerCase().includes(needle) ||
              (entry.sessionId || '').toLowerCase().includes(needle);
          })
        }))
        .filter((group) => group.entries.length > 0);

      const totalVisible = visible.reduce((sum, group) => sum + group.entries.length, 0);
      const visibleIds = visible.flatMap((group) => group.entries.map((entry) => entry.sessionId));

      const buildBody = () => ({
        from: range.from,
        to: range.to,
        reportType,
        includeSubagents,
        sessionIds: [...selected],
        git: gitEnabled
          ? {
            enabled: true,
            workspaces: [...workspacePaths],
            repos: [...repoSelection],
            authors: authors.split(/[,，;\s]+/).map((item) => item.trim()).filter(Boolean),
            allBranches,
            includeMerges
          }
          : { enabled: false },
        sample,
        extra,
        origin: (typeof window !== 'undefined' && window.location && window.location.origin) || ''
      });

      const openPreview = async () => {
        if (selected.size === 0) {
          setNotice({ kind: 'error', text: '请先勾选至少一个会话。' });
          return;
        }
        setBusy(true);
        setNotice(null);
        try {
          const data = await callApi('/prompt', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(buildBody())
          });
          setPromptText(data.prompt);
          const defaultTarget = workspacePaths.length > 0
            ? (workspaces.find((item) => item.path === workspacePaths[0]) || {}).id
            : (workspaces[0] || {}).id;
          setPreview({ reportName: data.reportName, workspaceId: defaultTarget || '' });
        } catch (error) {
          setNotice({ kind: 'error', text: '生成提示词失败：' + ((error && error.message) || error) });
        } finally {
          setBusy(false);
        }
      };

      const send = async () => {
        setNotice(null);
        setBusy(true);
        try {
          const workspaceId = preview.workspaceId ||
            (workspacePaths.length > 0
              ? (workspaces.find((item) => item.path === workspacePaths[0]) || {}).id
              : (workspaces[0] || {}).id);
          if (!workspaceId) throw new Error('没有可用工作区，请先在 DSH 里打开一个工作区');
          // The host creates the Session and sends the prompt, so the browser
          // half needs no session service and every failure is a visible HTTP error.
          const data = await callApi('/dispatch', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              workspaceId,
              prompt: promptText,
              clientTimeZone: (() => {
                try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return undefined; }
              })()
            })
          });
          const sessionId = data.sessionId;
          try {
            if (workspaceUi && typeof workspaceUi.openSession === 'function') workspaceUi.openSession(sessionId);
          } catch { /* navigation is best effort */ }
          setPreview(null);
          setNotice({ kind: 'ok', text: '已新建会话并发送提示词（' + sessionId + '）。' });
          if (closeSettings) {
            // Dismiss the settings panel so the new Session is visible. No point
            // re-scanning the catalog for a panel that is about to unmount.
            try {
              closeSettings();
            } catch { /* closing the panel is best effort */ }
          } else {
            setAnchor(Date.now());
          }
        } catch (error) {
          setNotice({ kind: 'error', text: '发送失败：' + ((error && error.message) || error) });
        } finally {
          setBusy(false);
        }
      };

      const groupKeyOf = (group) => group.workspaceId || group.title || '(未分组)';

      const toggleGroup = (key) => setCollapsed((previous) => {
        const next = new Set(previous);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });

      const renderSessions = () => {
        if (state.status === 'loading') return h('div', { style: styles.muted }, '正在扫描会话日志…');
        if (state.status === 'error') return h('div', { style: styles.muted }, '加载失败：' + state.message);
        if (visible.length === 0) return h('div', { style: styles.muted }, '这个时间段内没有符合条件的会话。');
        return visible.map((group) => {
          const key = groupKeyOf(group);
          const open = !collapsed.has(key);
          const chosen = group.entries.filter((entry) => selected.has(entry.sessionId)).length;
          const all = chosen === group.entries.length;
          return h('div', { key, style: styles.card },
            h('div', {
              style: styles.groupHead,
              role: 'button',
              'aria-expanded': open,
              title: open ? '折叠这个工作区' : '展开这个工作区',
              onClick: () => toggleGroup(key)
            },
              h('span', { style: styles.chevron(open) }, '▾'),
              h('div', { style: styles.workspaceTitle }, (group.title || '(未分组)') + ' · ' + group.entries.length + ' 个会话'),
              chosen > 0 ? h('span', { style: styles.muted }, '已选 ' + chosen + '/' + group.entries.length) : null,
              h('div', {
                style: { ...styles.chip(all), marginLeft: 'auto' },
                onClick: (event) => {
                  event.stopPropagation();
                  setSelected((previous) => {
                    const next = new Set(previous);
                    const every = group.entries.every((entry) => next.has(entry.sessionId));
                    for (const entry of group.entries) {
                      if (every) next.delete(entry.sessionId);
                      else next.add(entry.sessionId);
                    }
                    return next;
                  });
                }
              }, '全选本工作区')
            ),
            open
              ? h('div', { style: styles.groupList }, group.entries.map((entry) => h('div', { key: entry.sessionId, style: styles.session },
                  h('input', {
                    type: 'checkbox',
                    checked: selected.has(entry.sessionId),
                    onChange: () => toggleInSet(setSelected, entry.sessionId)
                  }),
                  h('div', { style: { flex: 1, minWidth: 0 } },
                    h('div', { style: { wordBreak: 'break-all' } }, entry.title || entry.sessionId),
                    h('div', { style: styles.muted },
                      entry.cwd + ' · 窗口内 ' + entry.windowMessages + ' 条用户消息 · 最后活动 ' + formatTime(entry.lastActivity) +
                      (entry.mergedFrom && entry.mergedFrom.length ? ' · 已合并 ' + entry.mergedFrom.length + ' 个副本' : '')
                    )
                  )
                )))
              : null
          );
        });
      };

      const loadSamples = () => callApi('/samples').then((data) => setSamples(data.samples || [])).catch(() => {});

      const saveSample = async () => {
        if (!sample.trim()) {
          setNotice({ kind: 'error', text: '样例内容为空，先粘贴一份以前的报告。' });
          return;
        }
        const name = sampleName.trim() || ('样例-' + toDateInput(Date.now()));
        try {
          await callApi('/samples', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name, markdown: sample })
          });
          setSampleName('');
          loadSamples();
          setNotice({ kind: 'ok', text: '样例已保存：' + name + '（下次可以直接点选）' });
        } catch (error) {
          setNotice({ kind: 'error', text: '保存样例失败：' + ((error && error.message) || error) });
        }
      };

      const loadSample = async (name) => {
        try {
          const data = await callApi('/samples?name=' + encodeURIComponent(name));
          setSample(data.markdown);
          setNotice({ kind: 'ok', text: '已载入样例：' + name });
        } catch (error) {
          setNotice({ kind: 'error', text: '载入样例失败：' + ((error && error.message) || error) });
        }
      };

      const openReport = async (name) => {
        try {
          const data = await callApi('/reports?name=' + encodeURIComponent(name));
          setViewer({ name: data.name, markdown: data.markdown });
        } catch (error) {
          setNotice({ kind: 'error', text: '打开报告失败：' + ((error && error.message) || error) });
        }
      };

      // The preview is an in-panel view, not a floating overlay: the settings
      // shell owns its own stacking context, so a fixed-position modal gets
      // painted under the dialog chrome (and used to hide error messages).
      const previewView = preview
        ? h('div', null,
            h('div', { style: { fontSize: 16, fontWeight: 600, marginBottom: 2 } }, '提示词预览（可直接修改）'),
            h('div', { style: { ...styles.muted, marginBottom: 10 } },
              '报告文件名：' + preview.reportName + ' · 发送到一个新建会话，由它跑证据命令并写报告。'),
            h('textarea', {
              value: promptText,
              onChange: (event) => setPromptText(event.target.value),
              style: { ...styles.textarea, minHeight: 320, fontFamily: 'var(--dsw-font-mono, monospace)' }
            }),
            h('div', { style: { ...styles.row, marginTop: 10 } },
              h('div', { style: { ...styles.muted, marginRight: 8 } }, '报告生成会话落地工作区：'),
              h('select', {
                value: preview.workspaceId || '',
                style: styles.input,
                onChange: (event) => setPreview({ ...preview, workspaceId: event.target.value })
              }, workspaces.map((item) => h('option', { key: item.id, value: item.id }, item.title + '（' + item.path + '）')))
            ),
            notice ? h('div', { style: styles.card }, notice.text) : null,
            h('div', { style: styles.row },
              h('div', { style: styles.button(true), onClick: () => { if (!busy) send(); } }, busy ? '发送中…' : '新建会话并发送'),
              h('div', {
                style: styles.button(false),
                onClick: () => {
                  const clipboard = typeof navigator !== 'undefined' && navigator.clipboard;
                  if (!clipboard) {
                    setNotice({ kind: 'error', text: '当前环境不支持复制，请手动全选文本框内容复制。' });
                    return;
                  }
                  clipboard.writeText(promptText)
                    .then(() => setNotice({ kind: 'ok', text: '提示词已复制，可以手动粘贴到任意会话。' }))
                    .catch(() => setNotice({ kind: 'error', text: '复制失败，请手动全选文本框内容复制。' }));
                }
              }, '复制提示词'),
              h('div', { style: styles.button(false), onClick: () => { setPreview(null); setNotice(null); } }, '返回修改')
            )
          )
        : null;

      const reportView = viewer
        ? h('div', null,
            h('div', { style: { fontSize: 16, fontWeight: 600, marginBottom: 6 } }, viewer.name),
            h('textarea', {
              value: viewer.markdown,
              readOnly: true,
              style: { ...styles.textarea, minHeight: 360, fontFamily: 'var(--dsw-font-mono, monospace)' }
            }),
            h('div', { style: styles.row },
              h('div', {
                style: styles.button(false),
                onClick: () => { setSample(viewer.markdown); setSampleName(viewer.name.replace(/\.md$/, '')); setViewer(null); }
              }, '存为格式样例'),
              h('div', { style: styles.button(false), onClick: () => setViewer(null) }, '返回')
            )
          )
        : null;

      const formView = h('div', { style: styles.root },
        h('div', { style: { fontSize: 16, fontWeight: 600, marginBottom: 2 } }, '周报生成'),
        h('div', { style: { ...styles.muted, marginBottom: 12 } },
          '按会话最后一次对话时间筛选，只使用所选时间段内产生的对话内容；可选结合工作区的 git 提交记录。'),

        h('div', { style: styles.section },
          h('div', { style: styles.sectionTitle }, '1. 报告类型与时间范围'),
          h('div', { style: styles.row }, REPORT_TYPES.map((item) => h('div', {
            key: item.id, style: styles.chip(reportType === item.id), onClick: () => setReportType(item.id)
          }, item.label))),
          h('div', { style: styles.row }, PRESETS.map((item) => h('div', {
            key: item.id, style: styles.chip(preset === item.id), onClick: () => setPreset(item.id)
          }, item.label))),
          preset === 'custom'
            ? h('div', { style: styles.row },
                h('input', { type: 'date', value: customFrom, style: styles.input, onChange: (event) => setCustomFrom(event.target.value) }),
                h('span', { style: styles.muted }, '至'),
                h('input', { type: 'date', value: customTo, style: styles.input, onChange: (event) => setCustomTo(event.target.value) })
              )
            : null
        ),

        h('div', { style: styles.section },
          h('div', { style: styles.sectionTitle }, '2. 选择会话（已选 ' + selected.size + ' 个）'),
          h('div', { style: styles.row },
            h('label', { style: { ...styles.muted, display: 'flex', gap: 6, alignItems: 'center' } },
              h('input', { type: 'checkbox', checked: includeSubagents, onChange: (event) => setIncludeSubagents(event.target.checked) }),
              '包含 subagent 会话（默认排除）'
            ),
            h('input', {
              type: 'search', placeholder: '搜索会话标题 / 路径 / ID', value: query,
              style: { ...styles.input, minWidth: 220 }, onChange: (event) => setQuery(event.target.value)
            }),
            h('div', { style: styles.chip(false), onClick: () => setSelected(new Set(visibleIds)) }, '全选当前列表'),
            h('div', { style: styles.chip(false), onClick: () => setSelected(new Set()) }, '清空'),
            h('div', { style: styles.chip(false), onClick: () => setAnchor(Date.now()) }, '刷新'),
            h('div', { style: styles.chip(false), onClick: () => setCollapsed(new Set(visible.map(groupKeyOf))) }, '折叠全部'),
            h('div', { style: styles.chip(false), onClick: () => setCollapsed(new Set()) }, '展开全部')
          ),
          h('div', { style: { ...styles.muted, marginBottom: 8 } },
            state.status === 'ready'
              ? '扫描 ' + (state.data.scanned || 0) + ' 个日志文件，命中 ' + (state.data.total || 0) + ' 个会话；当前显示 ' + totalVisible + ' 个'
              : '')
          , renderSessions()
        ),

        h('div', { style: styles.section },
          h('div', { style: styles.sectionTitle }, '3. 结合 git 记录（可选）'),
          h('label', { style: { ...styles.muted, display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 } },
            h('input', { type: 'checkbox', checked: gitEnabled, onChange: (event) => setGitEnabled(event.target.checked) }),
            '把所选工作区的 git 提交记录一起交给模型'
          ),
          gitEnabled
            ? h('div', null,
                h('div', { style: styles.row },
                  h('div', { style: { ...styles.muted, minWidth: 90 } }, '来源工作区：'),
                  workspaces.length === 0
                    ? h('div', { style: styles.muted }, '（没有读取到工作区）')
                    : workspaces.map((item) => h('div', {
                      key: item.id, style: styles.chip(gitWorkspaces.has(item.id)),
                      onClick: () => toggleInSet(setGitWorkspaces, item.id)
                    }, item.title))
                ),
                repos.length > 0
                  ? h('div', { style: styles.card },
                      h('div', { style: { ...styles.muted, marginBottom: 4 } }, '发现 ' + repos.length + ' 个仓库（默认全部纳入）：'),
                      repos.map((repo) => h('div', { key: repo.path, style: styles.session },
                        h('input', {
                          type: 'checkbox', checked: repoSelection.has(repo.path),
                          onChange: () => toggleInSet(setRepoSelection, repo.path)
                        }),
                        h('div', { style: { flex: 1, minWidth: 0 } },
                          h('div', null, repo.name),
                          h('div', { style: styles.muted }, repo.path + (repo.branch ? ' · 当前分支 ' + repo.branch : ''))
                        )
                      ))
                    )
                  : (gitWorkspaces.size > 0 ? h('div', { style: styles.muted }, '所选工作区下没有发现 git 仓库。') : null),
                h('div', { style: styles.row },
                  h('div', { style: { ...styles.muted, minWidth: 90 } }, 'git 用户名：'),
                  h('input', {
                    value: authors, placeholder: '姓名或邮箱，多个用逗号分隔', style: { ...styles.input, minWidth: 260 },
                    onChange: (event) => setAuthors(event.target.value)
                  })
                ),
                h('div', { style: styles.row },
                  h('div', { style: styles.chip(!allBranches), onClick: () => setAllBranches(false) }, '仅当前分支'),
                  h('div', { style: styles.chip(allBranches), onClick: () => setAllBranches(true) }, '全部分支'),
                  h('label', { style: { ...styles.muted, display: 'flex', gap: 6, alignItems: 'center', marginLeft: 12 } },
                    h('input', { type: 'checkbox', checked: includeMerges, onChange: (event) => setIncludeMerges(event.target.checked) }),
                    '包含 merge 提交'
                  )
                ),
                h('div', { style: styles.hint }, '默认排除 merge 提交：合并进来的提交通常属于别人的分支，计入会让"我做了什么"失真。'),
                h('div', { style: styles.hint }, 'git 时间过滤按带时区的绝对时间；作者按姓名或邮箱字面匹配，可多个。')
              )
            : null
        ),

        h('div', { style: styles.section },
          h('div', { style: styles.sectionTitle }, '4. 报告格式样例（可选但强烈建议）'),
          h('div', { style: styles.hint }, '把你以前写的日报/周报粘进来，模型会参考它的结构、章节和详略，而不是靠猜。'),
          h('textarea', {
            value: sample, style: styles.textarea, placeholder: '粘贴一份你以前写的报告…',
            onChange: (event) => setSample(event.target.value)
          }),
          h('div', { style: styles.row },
            h('input', {
              value: sampleName, placeholder: '样例名称（可留空）', style: { ...styles.input, minWidth: 180 },
              onChange: (event) => setSampleName(event.target.value)
            }),
            h('div', { style: styles.chip(false), onClick: saveSample }, '保存为常用样例')
          ),
          samples.length > 0
            ? h('div', { style: styles.row },
                h('div', { style: styles.muted }, '常用样例：'),
                samples.map((item) => h('div', {
                  key: item.name, style: styles.chip(false), title: '点击载入', onClick: () => loadSample(item.name)
                }, item.name.replace(/\.md$/, '')))
              )
            : null
        ),

        h('div', { style: styles.section },
          h('div', { style: styles.sectionTitle }, '5. 额外要求（可选）'),
          h('textarea', {
            value: extra, style: { ...styles.textarea, minHeight: 56 }, placeholder: '例如：重点写推荐系统那部分；不要写测试环境的问题…',
            onChange: (event) => setExtra(event.target.value)
          })
        ),

        h('div', { style: styles.row },
          h('div', { style: styles.button(true), onClick: busy ? undefined : openPreview }, busy ? '正在准备…' : '生成提示词预览'),
          h('div', { style: styles.button(false), onClick: () => callApi('/reports').then((data) => setReports(data.reports || [])).catch(() => {}) }, '刷新报告库')
        ),

        notice
          ? h('div', { style: { ...styles.card, borderColor: notice.kind === 'error' ? 'rgba(255,90,90,0.6)' : 'rgba(90,200,120,0.6)' } }, notice.text)
          : null,

        reports.length > 0
          ? h('div', { style: styles.section },
              h('div', { style: styles.sectionTitle }, '报告库（' + reports.length + ' 份）'),
              reports.slice(0, 10).map((report) => h('div', {
                key: report.name,
                style: { ...styles.session, cursor: 'pointer' },
                onClick: () => openReport(report.name)
              },
                h('div', { style: { flex: 1, minWidth: 0 } },
                  h('div', null, report.name),
                  h('div', { style: styles.muted }, formatTime(report.mtimeMs) + ' · ' + Math.round(report.size / 1024) + ' KB · 点击查看')
                )
              ))
            )
          : null,

      );

      if (preview) return previewView;
      if (viewer) return reportView;
      return formView;
    }

    function apply(ctx) {
      // Only navigation needs a client service, and it is best effort: the
      // Session itself is created and prompted by the host route.
      ctx.inject(['uiWorkspace'], (host) => {
        workspaceUi = host.get('uiWorkspace') || null;
      });
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'weekly-report',
        order: 70,
        label: () => '周报生成'
      }, WeeklyReportPanel));
    }

    return { name: 'dsh-weekly-report', inject: ['slots'], apply };
  }
});
