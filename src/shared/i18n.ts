/**
 * Tiny i18n layer shared by the main process (tray, notifications) and the
 * renderer (React UI). Keys are flat; `{name}` placeholders are interpolated.
 */

export type Lang = 'zh' | 'en'

type Dict = Record<string, string>

const zh: Dict = {
  // app / tabs
  'tab.tunnels': '隧道',
  'tab.topology': '拓扑图',
  'tab.settings': '设置',
  'tab.logs': '日志',

  // actions
  'action.reconnectAll': '全部重连',
  'action.refreshTopology': '刷新拓扑',
  'action.refresh': '刷新',
  'action.openLogs': '打开日志',
  'action.configFile': '配置文件',
  'action.location': '位置',
  'action.reconnect': '重连',
  'action.stop': '停止',
  'action.start': '启动',
  'action.command': '命令',
  'action.hideCommand': '收起命令',
  'action.copy': '复制',
  'action.copied': '已复制',

  // header
  'health.connected': '已连接',
  'metric.pid': 'PID',
  'metric.online': '在线',
  'metric.externalOnline': '其他 SSH 在线',
  'metric.retry': '重试 {n} 次',

  // tunnel states
  'state.connected': '已连接',
  'state.starting': '连接中',
  'state.reconnecting': '重连中',
  'state.error': '错误',
  'state.stopped': '已停止',
  'state.external': '已由其他 SSH 提供',

  // forward directions
  'dir.L': '本地',
  'dir.R': '远程',
  'dir.D': 'SOCKS',

  // notices
  'notice.conflict': '转发未生效:{ports} 被占用',
  'notice.same': '{ports} 已由目标相同的 SSH 连接提供,无需重复转发',

  // empty state
  'empty.title': '还没有配置任何隧道',
  'empty.hint': '编辑配置文件后重启 Vigil',

  // durations
  'unit.sec': '{n} 秒',
  'unit.min': '{m} 分 {s} 秒',
  'unit.hour': '{h} 时 {m} 分',

  // forward status
  'fst.listening': '监听中',
  'fst.externalSame': '已由同目标 SSH 接管',
  'fst.conflictSsh': '被其他 SSH 占用',
  'fst.conflictOther': '被其他程序占用',
  'fst.failed': '未监听',
  'fst.remote': '远端',
  'fst.unknown': '—',
  'fst.remotePrefix': '远端·',
  'fst.conn': ' · {n} 连接',
  'fst.ms': ' · {n}ms',

  // topology
  'topo.filterAll': '全部隧道',
  'topo.local': '你的 Mac',
  'topo.localSub': 'localhost',
  'topo.legend.ssh': 'SSH',
  'topo.legend.listening': '监听中',
  'topo.legend.externalSame': '同目标 SSH',
  'topo.legend.conflict': '冲突',
  'topo.legend.remote': '远端',

  // logs
  'logs.search': '搜索日志…',
  'logs.onlyProblems': '只看告警/错误',
  'logs.autoscroll': '自动滚动',
  'logs.lines': '{n} 行',
  'logs.clear': '清空',
  'logs.dir': '目录',
  'logs.empty': '没有日志',

  // settings
  'settings.notifyPower': '休眠/唤醒时通知',
  'settings.daemon': '后台守护',
  'settings.daemonTip': '开机自启,崩溃自动重启(LaunchAgent)',
  'settings.dockIcon': 'Dock 图标',
  'settings.dockIconTip': '在 Dock 中显示图标(默认只在菜单栏);保存后生效',
  'settings.language': '语言',
  'settings.import': '导入 ssh config',
  'settings.reload': '重载',
  'settings.save': '保存并应用',
  'settings.saving': '保存中…',
  'settings.saved': '已保存',
  'settings.newTunnel': '+ 新增隧道',
  'settings.delete': '删除',
  'settings.namePh': '名称',
  'settings.host': '主机 / Host 别名',
  'settings.hostHint': '要连的机器。推荐直接填 ~/.ssh/config 里的 Host 名(如 web-01);也可填 IP 或域名。',
  'settings.user': '用户',
  'settings.userPh': '(继承 ssh config)',
  'settings.userHint': '登录用户名。留空则用 ssh config 里的,再没有就用你 Mac 的账户名。',
  'settings.port': '端口',
  'settings.portHint': 'SSH 端口,默认 22。',
  'settings.advanced': '高级选项',
  'settings.advancedNote': '以下都可以留空 —— 留空时 Vigil 会自动从 ~/.ssh/config 读取该主机的设置。',
  'settings.identity': '私钥 IdentityFile',
  'settings.identityHint': '登录用的私钥文件,留空让 ssh 自动选择。',
  'settings.proxyJump': '跳板 ProxyJump',
  'settings.proxyJumpHint': '先经哪台机器再连目标(跳板机),填别名如 bastion。',
  'settings.localForward': '本地转发',
  'settings.localForwardDesc':
    '把远程的某个服务搬到本机。格式「本机端口:目标主机:目标端口」。例 18080:localhost:80 —— 之后访问本机的 18080,就等于访问服务器上的 80。',
  'settings.remoteForward': '远程转发',
  'settings.remoteForwardDesc':
    '把本机的服务暴露到远程。格式「远程端口:目标主机:目标端口」。例 2222:localhost:22 —— 之后在服务器上连 2222,就连回你本机的 22。',
  'settings.dynamicForward': '动态转发',
  'settings.dynamicForwardDesc':
    '在本机开一个 SOCKS 代理,浏览器等可以走它访问远程内网。格式「地址:端口」。',
  'settings.sshOptions': 'ssh -o 选项',
  'settings.sshOptionsDesc': '传给 ssh 的高级选项,每行一个「键 = 值」。不确定就不用填。',
  'settings.extraArgs': '额外参数',
  'settings.extraArgsDesc': '直接拼在 ssh 命令末尾的参数,一般用不到,不确定就留空。',
  'settings.autoReconnect': '断线自动重连',
  'settings.notifyOnReconnect': '重连时通知',
  'settings.add': '+ 添加',
  'settings.importTitle': '从 ~/.ssh/config 导入',
  'settings.importReading': '读取中…',
  'settings.importCount': '共 {total} 个 Host,{n} 个可导入',
  'settings.selectAll': '全选',
  'settings.deselectAll': '全不选',
  'settings.importN': '导入 {n}',
  'settings.close': '关闭',
  'settings.noneImportable': '没有可导入的新 Host。',
  'settings.importedN': '已导入 {n} 条,记得点保存',
  'settings.invalidHost': '有隧道没有填主机(Host),无法保存。',
  'settings.saveFailed': '保存失败:{msg}',
  'settings.daemonOn': '已开启后台守护',
  'settings.daemonOff': '已关闭后台守护',
  'settings.via': '经 {chain}',

  // notifications
  'notify.wakeTitle': 'Vigil — 系统已唤醒',
  'notify.wakeBody': '正在尝试重新连接 {n} 条 SSH 隧道…',
  'notify.droppedTitle': 'Vigil — 连接断开',
  'notify.droppedBody': '{name} 已断开,正在尝试重新连接…',
  'notify.externalTitle': 'Vigil — 端口已由相同的 SSH 接管',
  'notify.externalBody': '{name} 的 {ports} 已由目标相同的 SSH 连接提供,无需重复转发。',
  'notify.conflictTitle': 'Vigil — 转发端口冲突',
  'notify.conflictBody': '{name}:{detail},转发未生效。',

  // tray
  'tray.openDashboard': '打开主窗口',
  'tray.reconnectAll': '全部重连',
  'tray.openLogs': '打开日志目录',
  'tray.revealConfig': '查看配置文件',
  'tray.daemon': '后台守护(开机自启 + 崩溃重启)',
  'tray.quit': '退出 Vigil',
  'tray.noTunnels': '没有配置隧道'
}

const en: Dict = {
  'tab.tunnels': 'Tunnels',
  'tab.topology': 'Topology',
  'tab.settings': 'Settings',
  'tab.logs': 'Logs',

  'action.reconnectAll': 'Reconnect all',
  'action.refreshTopology': 'Refresh topology',
  'action.refresh': 'Refresh',
  'action.openLogs': 'Open logs',
  'action.configFile': 'Config file',
  'action.location': 'Reveal',
  'action.reconnect': 'Reconnect',
  'action.stop': 'Stop',
  'action.start': 'Start',
  'action.command': 'Command',
  'action.hideCommand': 'Hide command',
  'action.copy': 'Copy',
  'action.copied': 'Copied',

  'health.connected': 'connected',
  'metric.pid': 'PID',
  'metric.online': 'up',
  'metric.externalOnline': 'other ssh up',
  'metric.retry': 'retry {n}',

  'state.connected': 'Connected',
  'state.starting': 'Connecting',
  'state.reconnecting': 'Reconnecting',
  'state.error': 'Error',
  'state.stopped': 'Stopped',
  'state.external': 'Served by another ssh',

  'dir.L': 'local',
  'dir.R': 'remote',
  'dir.D': 'SOCKS',

  'notice.conflict': "Forward not active: {ports} is taken",
  'notice.same': '{ports} is already served by a same-target ssh — no need to duplicate',

  'empty.title': 'No tunnels configured yet',
  'empty.hint': 'Edit the config file and restart Vigil',

  'unit.sec': '{n}s',
  'unit.min': '{m}m {s}s',
  'unit.hour': '{h}h {m}m',

  'fst.listening': 'listening',
  'fst.externalSame': 'served by same-target ssh',
  'fst.conflictSsh': 'taken by another ssh',
  'fst.conflictOther': 'taken by another app',
  'fst.failed': 'not listening',
  'fst.remote': 'remote',
  'fst.unknown': '—',
  'fst.remotePrefix': 'remote · ',
  'fst.conn': ' · {n} conn',
  'fst.ms': ' · {n}ms',

  'topo.filterAll': 'All tunnels',
  'topo.local': 'Your Mac',
  'topo.localSub': 'localhost',
  'topo.legend.ssh': 'SSH',
  'topo.legend.listening': 'listening',
  'topo.legend.externalSame': 'same-target ssh',
  'topo.legend.conflict': 'conflict',
  'topo.legend.remote': 'remote',

  'logs.search': 'Search logs…',
  'logs.onlyProblems': 'Warnings/errors only',
  'logs.autoscroll': 'Auto-scroll',
  'logs.lines': '{n} lines',
  'logs.clear': 'Clear',
  'logs.dir': 'Folder',
  'logs.empty': 'No logs',

  'settings.notifyPower': 'Notify on sleep/wake',
  'settings.daemon': 'Background daemon',
  'settings.daemonTip': 'Start at login, restart on crash (LaunchAgent)',
  'settings.dockIcon': 'Dock icon',
  'settings.dockIconTip': 'Show an icon in the Dock (menu-bar only by default); applies on save',
  'settings.language': 'Language',
  'settings.import': 'Import ssh config',
  'settings.reload': 'Reload',
  'settings.save': 'Save & apply',
  'settings.saving': 'Saving…',
  'settings.saved': 'Saved',
  'settings.newTunnel': '+ New tunnel',
  'settings.delete': 'Delete',
  'settings.namePh': 'Name',
  'settings.host': 'Host / alias',
  'settings.hostHint':
    'The machine to connect to. Prefer a Host alias from ~/.ssh/config (e.g. web-01); an IP or domain also works.',
  'settings.user': 'User',
  'settings.userPh': '(inherit from ssh config)',
  'settings.userHint':
    'Login user. Leave blank to use ~/.ssh/config, or your Mac account name as a last resort.',
  'settings.port': 'Port',
  'settings.portHint': 'SSH port, 22 by default.',
  'settings.advanced': 'Advanced',
  'settings.advancedNote':
    'Everything below is optional — when left blank Vigil reads it from ~/.ssh/config for that host.',
  'settings.identity': 'Identity file',
  'settings.identityHint': 'Private key to log in with; leave blank to let ssh choose.',
  'settings.proxyJump': 'ProxyJump',
  'settings.proxyJumpHint': 'Jump host to route through first, e.g. bastion.',
  'settings.localForward': 'Local forward',
  'settings.localForwardDesc':
    'Bring a remote service to this machine. Format "local_port:target_host:target_port". Example 18080:localhost:80 — hitting local 18080 then reaches port 80 on the server.',
  'settings.remoteForward': 'Remote forward',
  'settings.remoteForwardDesc':
    'Expose a local service on the remote. Format "remote_port:target_host:target_port". Example 2222:localhost:22 — connecting to 2222 on the server comes back to your local 22.',
  'settings.dynamicForward': 'Dynamic forward',
  'settings.dynamicForwardDesc':
    'Run a SOCKS proxy locally so browsers can reach the remote network. Format "address:port".',
  'settings.sshOptions': 'ssh -o options',
  'settings.sshOptionsDesc': 'Extra ssh options, one "Key = Value" per row. Skip if unsure.',
  'settings.extraArgs': 'Extra args',
  'settings.extraArgsDesc': 'Appended verbatim to the ssh command; rarely needed.',
  'settings.autoReconnect': 'Auto-reconnect',
  'settings.notifyOnReconnect': 'Notify on reconnect',
  'settings.add': '+ Add',
  'settings.importTitle': 'Import from ~/.ssh/config',
  'settings.importReading': 'Reading…',
  'settings.importCount': '{total} Hosts found, {n} importable',
  'settings.selectAll': 'Select all',
  'settings.deselectAll': 'Select none',
  'settings.importN': 'Import {n}',
  'settings.close': 'Close',
  'settings.noneImportable': 'Nothing new to import.',
  'settings.importedN': 'Imported {n} — remember to save',
  'settings.invalidHost': 'A tunnel is missing its Host, so it cannot be saved.',
  'settings.saveFailed': 'Save failed: {msg}',
  'settings.daemonOn': 'Background daemon enabled',
  'settings.daemonOff': 'Background daemon disabled',
  'settings.via': 'via {chain}',

  'notify.wakeTitle': 'Vigil — system woke up',
  'notify.wakeBody': 'Reconnecting {n} SSH tunnel(s)…',
  'notify.droppedTitle': 'Vigil — connection lost',
  'notify.droppedBody': '{name} dropped, reconnecting…',
  'notify.externalTitle': 'Vigil — port already served by the same ssh',
  'notify.externalBody':
    '{name}: {ports} is already provided by a same-target ssh, no need to duplicate.',
  'notify.conflictTitle': 'Vigil — port forward conflict',
  'notify.conflictBody': '{name}: {detail} — the forward is not active.',

  'tray.openDashboard': 'Open dashboard',
  'tray.reconnectAll': 'Reconnect all',
  'tray.openLogs': 'Open log folder',
  'tray.revealConfig': 'Reveal config file',
  'tray.daemon': 'Background daemon (login + crash restart)',
  'tray.quit': 'Quit Vigil',
  'tray.noTunnels': 'No tunnels configured'
}

export const DICTS: Record<Lang, Dict> = { zh, en }

export function t(lang: Lang, key: string, params?: Record<string, string | number>): string {
  const s = DICTS[lang]?.[key] ?? DICTS.en[key] ?? key
  if (!params) return s
  return s.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? ''))
}

/** Preference can be explicit; otherwise fall back to the system locale. */
export function resolveLang(pref: string | undefined, systemLocale: string): Lang {
  if (pref === 'zh' || pref === 'en') return pref
  return systemLocale.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}
