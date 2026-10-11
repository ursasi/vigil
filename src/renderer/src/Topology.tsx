import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MarkerType,
  Handle,
  Position,
  BaseEdge,
  EdgeLabelRenderer,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
  type ReactFlowInstance
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { ResolvedTunnel, TunnelStatus } from '../../shared/types'
import { classifyForward, FST_COLOR } from './status'
import { useI18n } from './i18n'
import { IconLaptop, IconRelay, IconServer } from './icons'

const LOCAL = '__local__'
const COL_W = 370
const ROW_H = 140

type NodeState = 'ok' | 'warn' | 'down' | 'idle'
type NodeKind = 'local' | 'jump' | 'target'

interface HopData extends Record<string, unknown> {
  label: string
  sub: string
  kind: NodeKind
  state: NodeState
}

function KindIcon({ kind, size }: { kind: NodeKind; size: number }): JSX.Element {
  if (kind === 'local') return <IconLaptop size={size} />
  if (kind === 'jump') return <IconRelay size={size} />
  return <IconServer size={size} />
}

const BOTTOM_SLOTS = 4

function HopNode({ data }: NodeProps<Node<HopData>>): JSX.Element {
  const d = data
  return (
    <div className={`rfnode rfnode--${d.kind} rfnode--${d.state}`}>
      <Handle type="target" position={Position.Left} id="in" />
      <Handle type="source" position={Position.Right} id="out" />
      {Array.from({ length: BOTTOM_SLOTS }).map((_, i) => (
        <Handle
          key={`fo${i}`}
          type="source"
          position={Position.Bottom}
          id={`fwd-out-${i}`}
          style={{ left: `${14 + i * 24}%` }}
        />
      ))}
      {Array.from({ length: BOTTOM_SLOTS }).map((_, i) => (
        <Handle
          key={`fi${i}`}
          type="target"
          position={Position.Bottom}
          id={`fwd-in-${i}`}
          style={{ left: `${22 + i * 24}%` }}
        />
      ))}
      <span className="rfnode__icon">
        <KindIcon kind={d.kind} size={18} />
      </span>
      <div className="rfnode__text">
        <div className="rfnode__title">{d.label}</div>
        {d.sub && <div className="rfnode__sub">{d.sub}</div>}
      </div>
    </div>
  )
}

const nodeTypes = { hop: HopNode }

/** Orthogonal edge that drops to its own horizontal lane, so parallel
 *  forwards never overlap their labels. */
function LaneEdge(props: EdgeProps): JSX.Element {
  const { sourceX, sourceY, targetX, targetY, markerEnd, style, label, data } = props
  const laneY = (data?.laneY as number | undefined) ?? Math.max(sourceY, targetY) + 40
  const path = `M ${sourceX},${sourceY} L ${sourceX},${laneY} L ${targetX},${laneY} L ${targetX},${targetY}`
  const color = (style?.stroke as string) ?? '#8b95ab'
  return (
    <>
      <BaseEdge path={path} markerEnd={markerEnd} style={style} />
      <EdgeLabelRenderer>
        <div
          className="laneLabel"
          style={{
            transform: `translate(-50%,-50%) translate(${(sourceX + targetX) / 2}px, ${laneY}px)`,
            color,
            borderColor: `${color}55`
          }}
        >
          {label as string}
        </div>
      </EdgeLabelRenderer>
    </>
  )
}

const edgeTypes = { lane: LaneEdge }

type TFn = (key: string, params?: Record<string, string | number>) => string

function buildElements(
  tunnels: ResolvedTunnel[],
  statuses: TunnelStatus[],
  t: TFn
): { nodes: Node[]; edges: Edge[] } {
  const statusById = new Map(statuses.map((s) => [s.id, s]))
  const connectedIds = new Set(
    tunnels
      .filter((t) => {
        const st = statusById.get(t.id)?.state
        return st === 'connected' || st === 'external'
      })
      .map((t) => t.id)
  )
  const warningIds = new Set(statuses.filter((s) => s.warnings.length > 0).map((s) => s.id))

  const layer = new Map<string, number>([[LOCAL, 0]])
  const meta = new Map<string, { user: string; hostname: string; port: number }>()
  const targetAliases = new Set<string>()
  for (const t of tunnels) {
    t.chain.forEach((h, i) => {
      layer.set(h.alias, Math.max(layer.get(h.alias) ?? 0, i + 1))
      if (!meta.has(h.alias)) meta.set(h.alias, { user: h.user, hostname: h.hostname, port: h.port })
    })
    if (t.chain.length) targetAliases.add(t.chain[t.chain.length - 1].alias)
  }

  const byLayer = new Map<number, string[]>()
  for (const [alias, l] of layer) {
    if (alias === LOCAL) continue
    const arr = byLayer.get(l) ?? []
    arr.push(alias)
    byLayer.set(l, arr)
  }

  const pos = new Map<string, { x: number; y: number }>([[LOCAL, { x: 0, y: 0 }]])
  for (const [l, aliases] of [...byLayer.entries()].sort((a, b) => a[0] - b[0])) {
    aliases.sort()
    aliases.forEach((alias, i) => {
      pos.set(alias, { x: l * COL_W, y: (i - (aliases.length - 1) / 2) * ROW_H })
    })
  }

  const nodes: Node[] = [
    {
      id: LOCAL,
      type: 'hop',
      position: pos.get(LOCAL) as { x: number; y: number },
      data: {
        label: t('topo.local'),
        sub: t('topo.localSub'),
        kind: 'local',
        state: connectedIds.size ? 'ok' : 'idle'
      } satisfies HopData
    }
  ]

  for (const [alias, p] of pos) {
    if (alias === LOCAL) continue
    const m = meta.get(alias)
    const isConnected = tunnels.some(
      (t) => connectedIds.has(t.id) && t.chain.some((h) => h.alias === alias)
    )
    const hasWarning = tunnels.some(
      (t) => warningIds.has(t.id) && t.chain.some((h) => h.alias === alias)
    )
    const state: NodeState = hasWarning ? 'warn' : isConnected ? 'ok' : 'down'
    nodes.push({
      id: alias,
      type: 'hop',
      position: p,
      data: {
        label: alias,
        sub: m ? `${m.user}@${m.hostname}:${m.port}` : '',
        kind: targetAliases.has(alias) ? 'target' : 'jump',
        state
      } satisfies HopData
    })
  }

  // SSH transport edges (deduped across tunnels)
  const sshSeen = new Map<string, { port: number; animated: boolean }>()
  for (const t of tunnels) {
    const seq = [LOCAL, ...t.chain.map((h) => h.alias)]
    for (let i = 0; i < seq.length - 1; i++) {
      const key = `${seq[i]}->${seq[i + 1]}`
      const prev = sshSeen.get(key)
      sshSeen.set(key, {
        port: t.chain[i].port,
        animated: (prev?.animated ?? false) || connectedIds.has(t.id)
      })
    }
  }
  const edges: Edge[] = []
  for (const [key, v] of sshSeen) {
    const [a, b] = key.split('->')
    edges.push({
      id: `ssh:${key}`,
      source: a,
      target: b,
      sourceHandle: 'out',
      targetHandle: 'in',
      label: `:${v.port}`,
      animated: v.animated,
      style: { stroke: v.animated ? '#4c8dff' : '#3a4356', strokeWidth: 2 },
      labelStyle: { fill: '#9aa3b5', fontSize: 10, fontWeight: 600 },
      labelBgStyle: { fill: '#12151c' },
      labelBgPadding: [5, 3],
      labelBgBorderRadius: 5,
      markerEnd: { type: MarkerType.ArrowClosed, color: v.animated ? '#4c8dff' : '#3a4356' }
    })
  }

  // Forward edges: each gets its own horizontal lane below the chain.
  const maxBottom = Math.max(...nodes.map((n) => n.position.y)) + 60
  for (const t of tunnels) {
    if (!t.chain.length) continue
    const target = t.chain[t.chain.length - 1].alias
    t.forwards.forEach((f, i) => {
      const { status } = classifyForward(f, t)
      const color = FST_COLOR[status]
      const isLocal = f.direction !== 'R'
      const slot = i % BOTTOM_SLOTS
      edges.push({
        id: `fwd:${t.id}:${i}`,
        type: 'lane',
        source: isLocal ? LOCAL : target,
        target: isLocal ? target : LOCAL,
        sourceHandle: `fwd-out-${slot}`,
        targetHandle: `fwd-in-${slot}`,
        data: { laneY: maxBottom + 34 + i * 32 },
        label: `${f.direction}  ${f.label}`,
        animated: status === 'listening',
        style: { stroke: color, strokeWidth: 1.6, strokeDasharray: '6 5' },
        markerEnd: { type: MarkerType.ArrowClosed, color }
      })
    })
  }

  return { nodes, edges }
}

export interface TopologyProps {
  topology: ResolvedTunnel[]
  statuses: TunnelStatus[]
}

export default function Topology({ topology, statuses }: TopologyProps): JSX.Element {
  const { t } = useI18n()
  const [filter, setFilter] = useState<string>('all')
  const rfRef = useRef<ReactFlowInstance | null>(null)

  const shown = useMemo(
    () => (filter === 'all' ? topology : topology.filter((t) => t.id === filter)),
    [topology, filter]
  )

  const { nodes, edges } = useMemo(
    () => buildElements(shown, statuses, t),
    [shown, statuses, t]
  )

  // Keep the graph fitted when the window resizes or the visible set changes.
  useEffect(() => {
    const fit = (): void => {
      void rfRef.current?.fitView({ padding: 0.25, duration: 250 })
    }
    const t = setTimeout(fit, 80)
    window.addEventListener('resize', fit)
    return () => {
      clearTimeout(t)
      window.removeEventListener('resize', fit)
    }
  }, [nodes.length, filter])

  return (
    <div className="topology">
      <div className="topology__bar">
        <select value={filter} onChange={(e) => setFilter(e.target.value)} className="select">
          <option value="all">{t('topo.filterAll')}</option>
          {topology.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <div className="legend">
          <span className="legend__item">
            <i style={{ background: '#4c8dff' }} /> {t('topo.legend.ssh')}
          </span>
          <span className="legend__item">
            <i style={{ background: FST_COLOR.listening }} /> {t('topo.legend.listening')}
          </span>
          <span className="legend__item">
            <i style={{ background: FST_COLOR['external-same'] }} /> {t('topo.legend.externalSame')}
          </span>
          <span className="legend__item">
            <i style={{ background: FST_COLOR['conflict-other'] }} /> {t('topo.legend.conflict')}
          </span>
          <span className="legend__item">
            <i style={{ background: FST_COLOR.remote }} /> {t('topo.legend.remote')}
          </span>
        </div>
      </div>
      <div className="topology__canvas">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onInit={(inst) => {
            rfRef.current = inst
          }}
          fitView
          fitViewOptions={{ padding: 0.25 }}
          proOptions={{ hideAttribution: true }}
          nodesConnectable={false}
          minZoom={0.3}
        >
          <Background color="#1e2430" gap={24} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </div>
  )
}
