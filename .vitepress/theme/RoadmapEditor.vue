<script setup lang="ts">
import { computed, markRaw, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { withBase } from 'vitepress'
import {
  ConnectionMode,
  VueFlow,
  type Connection,
  type Edge,
  type EdgeMouseEvent,
  type Node,
  type NodeMouseEvent,
} from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import { MiniMap } from '@vue-flow/minimap'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/controls/dist/style.css'
import '@vue-flow/minimap/dist/style.css'
import { cloneRoadmapGraph, isRoadmapGraph } from './roadmaps/graph'
import { roadmapDefinitionById, roadmapGroups, roadmapsById } from './roadmaps/registry'
import type {
  RoadmapChoice,
  RoadmapChoicePosition,
  RoadmapEdgeKind,
  RoadmapGraph,
  RoadmapHandle,
  RoadmapNodeKind,
} from './roadmaps/types'
import RoadmapEditorNode from './RoadmapEditorNode.vue'
import './roadmap-editor.css'

interface EditorNodeData {
  label: string
  kind: RoadmapNodeKind
  choice?: RoadmapChoice
  choicePosition?: RoadmapChoicePosition
}

interface EditorEdgeData {
  kind: RoadmapEdgeKind
  bend?: number
}

interface EditorFlowApi {
  screenToFlowCoordinate(position: { x: number; y: number }): { x: number; y: number }
  panBy(delta: { x: number; y: number }): boolean
  zoomIn(): Promise<boolean>
  zoomOut(): Promise<boolean>
}

interface ContextMenuState {
  x: number
  y: number
  position: { x: number; y: number }
  nodeId?: string
  edgeId?: string
}

interface RoadmapHistory {
  snapshots: RoadmapGraph[]
  index: number
}

type EditorNode = Node<EditorNodeData> & {
  dimensions?: { width: number; height: number }
  selected?: boolean
}
type EditorEdge = Edge<EditorEdgeData>

const initialRoadmap = roadmapsById.get('frontend')
if (!initialRoadmap) throw new Error('Missing Frontend roadmap')

const isDev = import.meta.env.DEV
const fileInput = ref<HTMLInputElement | null>(null)
const canvasElement = ref<HTMLElement | null>(null)
const flowInstance = ref<EditorFlowApi | null>(null)
const nodes = ref<EditorNode[]>([])
const edges = ref<EditorEdge[]>([])
const activeRoadmapId = ref(initialRoadmap.id)
const metadata = ref({
  title: initialRoadmap.title,
  storageKey: initialRoadmap.storageKey,
  viewport: cloneRoadmapGraph(initialRoadmap).viewport,
})
const selectedNodeId = ref<string>()
const selectedEdgeId = ref<string>()
const status = ref('草稿只保存在当前浏览器')
const isHydrated = ref(false)
const isGridSnapEnabled = ref(true)
const isSpacePressed = ref(false)
const contextMenu = ref<ContextMenuState>()
let persistTimer: number | undefined
let historyTimer: number | undefined
let isApplyingHistorySnapshot = false
const historyByRoadmap = new Map<string, RoadmapHistory>()
const historyLimit = 100

const nodeTypes = { roadmap: markRaw(RoadmapEditorNode) }
const selectedNode = computed(() => nodes.value.find((node) => node.id === selectedNodeId.value))
const selectedEdge = computed(() => edges.value.find((edge) => edge.id === selectedEdgeId.value))
const selectedNodes = computed(() => nodes.value.filter((node) => node.selected))
const activeDefinition = computed(() => roadmapDefinitionById.get(activeRoadmapId.value))
const draftKey = computed(() => `zzuli-roadmap:draft:${activeRoadmapId.value}:v2`)
const graph = computed<RoadmapGraph>(() => ({
  version: 1,
  id: activeRoadmapId.value,
  title: metadata.value.title.trim() || '未命名路线图',
  storageKey: metadata.value.storageKey.trim() || 'frontend',
  viewport: {
    width: Math.max(480, Math.round(Number(metadata.value.viewport.width) || 760)),
    height: Math.max(480, Math.round(Number(metadata.value.viewport.height) || 900)),
  },
  nodes: nodes.value.map((node) => ({
    id: node.id,
    label: node.data.label.trim() || '未命名节点',
    kind: node.data.kind,
    position: {
      x: Math.round(node.position.x),
      y: Math.round(node.position.y),
    },
    ...(node.data.choice ? { choice: node.data.choice } : {}),
    ...(node.data.choicePosition ? { choicePosition: node.data.choicePosition } : {}),
  })),
  edges: edges.value.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    kind: edge.data?.kind ?? 'branch',
    ...(edge.sourceHandle ? { sourceHandle: edge.sourceHandle as RoadmapHandle } : {}),
    ...(edge.targetHandle ? { targetHandle: edge.targetHandle as RoadmapHandle } : {}),
    ...(typeof edge.data?.bend === 'number' ? { bend: Math.round(edge.data.bend) } : {}),
  })),
}))

function edgeStyle(kind: RoadmapEdgeKind) {
  return kind === 'main'
    ? { stroke: 'var(--roadmap-editor-main-edge)', strokeWidth: 2 }
    : { stroke: 'var(--roadmap-editor-branch-edge)', strokeWidth: 1.5, strokeDasharray: '2 5' }
}

function toEditorNodes(source: RoadmapGraph): EditorNode[] {
  return source.nodes.map((node) => ({
    id: node.id,
    type: 'roadmap',
    position: { ...node.position },
    data: {
      label: node.label,
      kind: node.kind,
      ...(node.choice ? { choice: node.choice } : {}),
      ...(node.choicePosition ? { choicePosition: node.choicePosition } : {}),
    },
  }))
}

function toEditorEdges(source: RoadmapGraph): EditorEdge[] {
  return source.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle,
    targetHandle: edge.targetHandle,
    type: edge.kind === 'main' ? 'smoothstep' : 'default',
    style: edgeStyle(edge.kind),
    data: { kind: edge.kind, bend: edge.bend },
  }))
}

function applyGraph(source: RoadmapGraph) {
  const copy = cloneRoadmapGraph(source)
  metadata.value = {
    title: copy.title,
    storageKey: copy.storageKey,
    viewport: { ...copy.viewport },
  }
  nodes.value = toEditorNodes(copy)
  edges.value = toEditorEdges(copy)
  selectedNodeId.value = undefined
  selectedEdgeId.value = undefined
}

function graphSignature(source: RoadmapGraph) {
  return JSON.stringify(source)
}

function currentHistory() {
  const existing = historyByRoadmap.get(activeRoadmapId.value)
  if (existing) return existing

  const created: RoadmapHistory = {
    snapshots: [cloneRoadmapGraph(graph.value)],
    index: 0,
  }
  historyByRoadmap.set(activeRoadmapId.value, created)
  return created
}

function resetHistory(source: RoadmapGraph) {
  const snapshot = cloneRoadmapGraph(source)
  const existing = historyByRoadmap.get(activeRoadmapId.value)
  const current = existing?.snapshots[existing.index]
  if (current && graphSignature(current) === graphSignature(snapshot)) return

  historyByRoadmap.set(activeRoadmapId.value, { snapshots: [snapshot], index: 0 })
}

function pushHistorySnapshot(source = graph.value) {
  const history = currentHistory()
  const snapshot = cloneRoadmapGraph(source)
  const current = history.snapshots[history.index]
  if (current && graphSignature(current) === graphSignature(snapshot)) return

  history.snapshots = history.snapshots.slice(0, history.index + 1)
  history.snapshots.push(snapshot)
  if (history.snapshots.length > historyLimit) history.snapshots.shift()
  history.index = history.snapshots.length - 1
}

function commitPendingHistory() {
  window.clearTimeout(historyTimer)
  historyTimer = undefined
  if (!isHydrated.value || isApplyingHistorySnapshot) return
  pushHistorySnapshot()
}

function scheduleHistorySnapshot() {
  if (!isHydrated.value || isApplyingHistorySnapshot) return
  window.clearTimeout(historyTimer)
  historyTimer = window.setTimeout(commitPendingHistory, 260)
}

function applyHistorySnapshot(source: RoadmapGraph, mode: 'reset' | 'push' | 'restore') {
  if (mode === 'push') commitPendingHistory()

  isApplyingHistorySnapshot = true
  applyGraph(source)
  if (mode === 'reset') resetHistory(graph.value)
  if (mode === 'push') pushHistorySnapshot()

  void nextTick(() => {
    isApplyingHistorySnapshot = false
  })
}

function moveHistory(direction: -1 | 1) {
  commitPendingHistory()
  const history = currentHistory()
  const nextIndex = history.index + direction
  const snapshot = history.snapshots[nextIndex]
  if (!snapshot) return

  history.index = nextIndex
  applyHistorySnapshot(snapshot, 'restore')
  status.value = direction === -1 ? '已撤销上一步操作' : '已重做上一步操作'
}

function newId(prefix: string) {
  const used = new Set([...nodes.value.map((node) => node.id), ...edges.value.map((edge) => edge.id)])
  let index = 1
  while (used.has(`${prefix}-${index}`)) index += 1
  return `${prefix}-${index}`
}

function snapCoordinate(value: number) {
  return isGridSnapEnabled.value ? Math.round(value / 16) * 16 : Math.round(value)
}

function defaultNodePosition(kind: 'main' | 'branch' | 'note') {
  const offset = nodes.value.length * 18
  return {
    x: 220 + (offset % 220),
    y: 160 + offset + (kind === 'branch' ? 52 : 0),
  }
}

function addNode(kind: 'main' | 'branch' | 'note', position?: { x: number; y: number }) {
  const id = newId(
    kind === 'main' ? 'milestone' : kind === 'branch' ? 'topic' : 'note',
  )
  const nextPosition = position ?? defaultNodePosition(kind)
  const label =
    kind === 'main'
      ? '新里程碑'
      : kind === 'branch'
        ? '新主题'
        : '提示文本'
  nodes.value.push({
    id,
    type: 'roadmap',
    position: {
      x: snapCoordinate(nextPosition.x),
      y: snapCoordinate(nextPosition.y),
    },
    data: { label, kind },
  })
  selectedNodeId.value = id
  selectedEdgeId.value = undefined
  status.value =
    kind === 'note'
      ? '已添加纯文本节点；它不会参与连线或学习进度'
      : kind === 'branch'
        ? '已新建分支节点；可拖动圆点建立连接'
        : '已新建主线节点'
}

function addChild(parentId: string) {
  const parent = nodes.value.find((node) => node.id === parentId)
  if (!parent) return
  if (parent.data.kind === 'note') {
    status.value = '纯文本节点不能拥有子节点'
    return
  }

  const childIndex = edges.value.filter((edge) => edge.source === parentId).length
  const id = newId('topic')
  const direction = parent.position.x > metadata.value.viewport.width * 0.68 ? -1 : 1
  const sourceHandle: RoadmapHandle = direction === 1 ? 'right' : 'left'
  const targetHandle: RoadmapHandle = direction === 1 ? 'left' : 'right'

  nodes.value.push({
    id,
    type: 'roadmap',
    position: {
      x: snapCoordinate(parent.position.x + direction * 220),
      y: snapCoordinate(parent.position.y + childIndex * 64),
    },
    data: { label: '新主题', kind: 'branch' },
  })
  edges.value.push({
    id: newId('branch'),
    source: parentId,
    target: id,
    sourceHandle,
    targetHandle,
    type: 'default',
    style: edgeStyle('branch'),
    data: { kind: 'branch' },
  })
  selectedNodeId.value = id
  selectedEdgeId.value = undefined
  status.value = '已添加子节点，并使用虚线连接；可在右侧改为主线'
}

function createNodeFromToolbar() {
  if (selectedNode.value) {
    addChild(selectedNode.value.id)
    return
  }

  addNode('main')
}

function getPointerFlowPosition(event: MouseEvent) {
  const fromInstance = flowInstance.value?.screenToFlowCoordinate({
    x: event.clientX,
    y: event.clientY,
  })
  if (fromInstance) return fromInstance

  return defaultNodePosition('main')
}

function closeContextMenu() {
  contextMenu.value = undefined
}

function openContextMenu(event: MouseEvent, target: Pick<ContextMenuState, 'nodeId' | 'edgeId'> = {}) {
  const bounds = canvasElement.value?.getBoundingClientRect()
  if (!bounds) return

  const menuWidth = 178
  const menuHeight = target.nodeId ? 82 : target.edgeId ? 118 : 112
  contextMenu.value = {
    x: Math.max(8, Math.min(event.clientX - bounds.left, bounds.width - menuWidth - 8)),
    y: Math.max(8, Math.min(event.clientY - bounds.top, bounds.height - menuHeight - 8)),
    position: getPointerFlowPosition(event),
    ...target,
  }
}

function onPaneContextMenu(event: MouseEvent) {
  event.preventDefault()
  openContextMenu(event)
}

function onNodeContextMenu({ event, node }: NodeMouseEvent) {
  if (!(event instanceof MouseEvent)) return
  event.preventDefault()
  selectedNodeId.value = node.id
  selectedEdgeId.value = undefined
  openContextMenu(event, { nodeId: node.id })
}

function createFromContext(kind: 'main' | 'branch' | 'note') {
  const menu = contextMenu.value
  addNode(kind, menu?.position)
  closeContextMenu()
}

function addChildFromContext() {
  const nodeId = contextMenu.value?.nodeId
  if (nodeId) addChild(nodeId)
  closeContextMenu()
}

function onConnect(connection: Connection) {
  if (!connection.source || !connection.target || connection.source === connection.target) return
  if (edges.value.some((edge) => edge.source === connection.source && edge.target === connection.target)) return

  const source = nodes.value.find((node) => node.id === connection.source)
  const target = nodes.value.find((node) => node.id === connection.target)
  if (source?.data.kind === 'note' || target?.data.kind === 'note') return
  const kind: RoadmapEdgeKind =
    source?.data.kind !== 'branch' && target?.data.kind !== 'branch' ? 'main' : 'branch'
  const id = newId(kind === 'main' ? 'main' : 'branch')

  edges.value.push({
    id,
    source: connection.source,
    target: connection.target,
    sourceHandle: connection.sourceHandle,
    targetHandle: connection.targetHandle,
    type: kind === 'main' ? 'smoothstep' : 'default',
    style: edgeStyle(kind),
    data: { kind },
  })
  selectedEdgeId.value = id
  selectedNodeId.value = undefined
}

function onNodeClick({ node }: NodeMouseEvent) {
  selectedNodeId.value = node.id
  selectedEdgeId.value = undefined
  closeContextMenu()
}

function onEdgeClick({ edge }: EdgeMouseEvent) {
  selectedEdgeId.value = edge.id
  selectedNodeId.value = undefined
  closeContextMenu()
}

function onEdgeContextMenu({ event, edge }: EdgeMouseEvent) {
  if (!(event instanceof MouseEvent)) return
  event.preventDefault()
  selectedEdgeId.value = edge.id
  selectedNodeId.value = undefined
  openContextMenu(event, { edgeId: edge.id })
}

function onPaneClick() {
  selectedNodeId.value = undefined
  selectedEdgeId.value = undefined
  closeContextMenu()
}

async function syncSelection() {
  await nextTick()
  const selection = selectedNodes.value
  if (selection.length === 1) {
    selectedNodeId.value = selection[0].id
    selectedEdgeId.value = undefined
    return
  }

  if (selection.length > 1) {
    selectedNodeId.value = undefined
    selectedEdgeId.value = undefined
  }
}

function getNodeSize(node: EditorNode) {
  const fallback =
    node.data.kind === 'note'
      ? { width: 208, height: 48 }
      : node.data.kind === 'branch'
        ? { width: 144, height: 48 }
        : { width: 160, height: 48 }
  const width = node.dimensions?.width ?? fallback.width
  const height = node.dimensions?.height ?? fallback.height
  return { width, height }
}

function centerOf(node: EditorNode) {
  const size = getNodeSize(node)
  return {
    x: node.position.x + size.width / 2,
    y: node.position.y + size.height / 2,
  }
}

function handleToward(from: { x: number; y: number }, to: { x: number; y: number }): RoadmapHandle {
  const deltaX = to.x - from.x
  const deltaY = to.y - from.y
  if (Math.abs(deltaX) > Math.abs(deltaY)) return deltaX >= 0 ? 'right' : 'left'
  return deltaY >= 0 ? 'bottom' : 'top'
}

function oppositeHandle(handle: RoadmapHandle): RoadmapHandle {
  return { top: 'bottom', right: 'left', bottom: 'top', left: 'right' }[handle]
}

function insertNodeFromContext(kind: 'main' | 'branch') {
  const menu = contextMenu.value
  const edge = menu?.edgeId ? edges.value.find((candidate) => candidate.id === menu.edgeId) : undefined
  if (!menu || !edge) return

  const source = nodes.value.find((node) => node.id === edge.source)
  const target = nodes.value.find((node) => node.id === edge.target)
  if (!source || !target) return

  const size = kind === 'branch' ? { width: 144, height: 48 } : { width: 160, height: 48 }
  const id = newId(kind === 'main' ? 'milestone' : 'topic')
  const insertedNode: EditorNode = {
    id,
    type: 'roadmap',
    position: {
      x: snapCoordinate(menu.position.x - size.width / 2),
      y: snapCoordinate(menu.position.y - size.height / 2),
    },
    data: { label: kind === 'main' ? '新里程碑' : '新主题', kind },
  }
  const insertedCenter = centerOf(insertedNode)
  const edgeKind = edge.data?.kind ?? 'branch'
  const sourceHandle = edge.sourceHandle as RoadmapHandle | undefined
  const targetHandle = edge.targetHandle as RoadmapHandle | undefined

  nodes.value.push(insertedNode)
  edges.value = edges.value.flatMap((candidate) => {
    if (candidate.id !== edge.id) return [candidate]

    return [
      {
        ...candidate,
        target: id,
        sourceHandle: sourceHandle ?? handleToward(centerOf(source), insertedCenter),
        targetHandle: oppositeHandle(handleToward(centerOf(source), insertedCenter)),
        type: edgeKind === 'main' ? 'smoothstep' : 'default',
        style: edgeStyle(edgeKind),
        data: { kind: edgeKind },
      },
      {
        id: newId(edgeKind === 'main' ? 'main' : 'branch'),
        source: id,
        target: target.id,
        sourceHandle: handleToward(insertedCenter, centerOf(target)),
        targetHandle: targetHandle ?? oppositeHandle(handleToward(insertedCenter, centerOf(target))),
        type: edgeKind === 'main' ? 'smoothstep' : 'default',
        style: edgeStyle(edgeKind),
        data: { kind: edgeKind },
      },
    ]
  })
  selectedNodeId.value = id
  selectedEdgeId.value = undefined
  closeContextMenu()
  status.value = `已在连线上插入${kind === 'main' ? '主线节点' : '分支节点'}；原连线已拆分为两段`
}

function updateSelectedNodePositions(
  update: (node: EditorNode, size: { width: number; height: number }, index: number) => { x: number; y: number },
) {
  const selection = selectedNodes.value
  if (selection.length < 2) return false

  selection.forEach((node, index) => {
    const next = update(node, getNodeSize(node), index)
    node.position = {
      x: snapCoordinate(next.x),
      y: snapCoordinate(next.y),
    }
  })
  return true
}

function alignSelection(direction: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') {
  const selection = selectedNodes.value
  if (selection.length < 2) return

  const measurements = selection.map((node) => ({ node, ...getNodeSize(node) }))
  const isHorizontal = direction === 'left' || direction === 'center' || direction === 'right'
  const start = Math.min(
    ...measurements.map((item) => (isHorizontal ? item.node.position.x : item.node.position.y)),
  )
  const end = Math.max(
    ...measurements.map((item) =>
      isHorizontal ? item.node.position.x + item.width : item.node.position.y + item.height,
    ),
  )
  const middle = (start + end) / 2

  const changed = updateSelectedNodePositions((node, size) => {
    if (direction === 'left') return { x: start, y: node.position.y }
    if (direction === 'center') return { x: middle - size.width / 2, y: node.position.y }
    if (direction === 'right') return { x: end - size.width, y: node.position.y }
    if (direction === 'top') return { x: node.position.x, y: start }
    if (direction === 'middle') return { x: node.position.x, y: middle - size.height / 2 }
    return { x: node.position.x, y: end - size.height }
  })
  if (changed) status.value = '已对齐选中的节点'
}

function distributeSelection(axis: 'horizontal' | 'vertical') {
  const selection = selectedNodes.value
  if (selection.length < 3) return

  const ordered = [...selection]
    .map((node) => ({ node, ...getNodeSize(node) }))
    .sort((a, b) =>
      axis === 'horizontal'
        ? a.node.position.x + a.width / 2 - (b.node.position.x + b.width / 2)
        : a.node.position.y + a.height / 2 - (b.node.position.y + b.height / 2),
    )
  const first = ordered[0]
  const last = ordered.at(-1)
  if (!first || !last) return

  const firstCenter =
    axis === 'horizontal' ? first.node.position.x + first.width / 2 : first.node.position.y + first.height / 2
  const lastCenter =
    axis === 'horizontal' ? last.node.position.x + last.width / 2 : last.node.position.y + last.height / 2
  const gap = (lastCenter - firstCenter) / (ordered.length - 1)

  ordered.forEach((item, index) => {
    const center = firstCenter + index * gap
    item.node.position =
      axis === 'horizontal'
        ? { x: snapCoordinate(center - item.width / 2), y: item.node.position.y }
        : { x: item.node.position.x, y: snapCoordinate(center - item.height / 2) }
  })
  status.value = '已均匀分布选中的节点'
}

function toggleGridSnap() {
  isGridSnapEnabled.value = !isGridSnapEnabled.value
  status.value = isGridSnapEnabled.value ? '已开启 16px 网格吸附' : '已关闭网格吸附'
}

function isTextInput(target: EventTarget | null) {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  )
}

const viewPanDiffs: Record<string, { x: number; y: number }> = {
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
}
const viewPanStep = 80
const viewPanFastStep = 320

function panViewport(direction: { x: number; y: number }, fast: boolean) {
  const step = fast ? viewPanFastStep : viewPanStep
  // panBy 的正值沿变换方向移动内容，取反后方向键才是“视口朝该方向移动”
  flowInstance.value?.panBy({ x: -direction.x * step, y: -direction.y * step })
}

function onWindowKeyDown(event: KeyboardEvent) {
  const inTextInput = isTextInput(event.target)
  if (event.code === 'Space' && !inTextInput) isSpacePressed.value = true
  if (inTextInput || event.defaultPrevented) return

  const key = event.key.toLowerCase()
  const isCanvasShortcut = !event.altKey && !event.metaKey && !event.ctrlKey
  const panDiff = viewPanDiffs[event.key]
  if (panDiff && isCanvasShortcut) {
    event.preventDefault()
    panViewport(panDiff, event.shiftKey)
    return
  }
  if (isCanvasShortcut && (key === '+' || key === '=' || event.code === 'NumpadAdd')) {
    event.preventDefault()
    void flowInstance.value?.zoomIn()
    return
  }
  if (isCanvasShortcut && (key === '-' || event.code === 'NumpadSubtract')) {
    event.preventDefault()
    void flowInstance.value?.zoomOut()
    return
  }

  if (event.altKey || (!event.metaKey && !event.ctrlKey)) return
  if (key === 'z') {
    event.preventDefault()
    moveHistory(event.shiftKey ? 1 : -1)
  } else if (key === 'y' && event.ctrlKey) {
    event.preventDefault()
    moveHistory(1)
  }
}

function onWindowKeyUp(event: KeyboardEvent) {
  if (event.code === 'Space') isSpacePressed.value = false
}

function updateSelectedNode() {
  const node = selectedNode.value
  if (!node) return
  const choice =
    node.data.kind === 'main' || node.data.kind === 'branch' ? node.data.choice : undefined
  const choicePosition = choice ? node.data.choicePosition : undefined
  const data: EditorNodeData = {
    ...node.data,
    label: node.data.label.slice(0, 80),
  }
  if (choice) data.choice = choice
  else delete data.choice
  if (choicePosition) data.choicePosition = choicePosition
  else delete data.choicePosition
  node.data = data
}

function updateSelectedEdge() {
  const edge = selectedEdge.value
  if (!edge) return
  const kind = edge.data?.kind ?? 'branch'
  edge.type = kind === 'main' ? 'smoothstep' : 'default'
  edge.style = edgeStyle(kind)
}

function removeNodes(ids: string[]) {
  const requested = new Set(ids)
  const rootIds = nodes.value
    .filter((node) => requested.has(node.id) && node.data.kind === 'root')
    .map((node) => node.id)
  const removableIds = new Set(ids.filter((id) => !rootIds.includes(id)))
  if (!removableIds.size) {
    status.value = '根节点不可删除'
    return
  }

  nodes.value = nodes.value.filter((node) => !removableIds.has(node.id))
  edges.value = edges.value.filter(
    (edge) => !removableIds.has(edge.source) && !removableIds.has(edge.target),
  )
  selectedNodeId.value = undefined
  selectedEdgeId.value = undefined
  closeContextMenu()
  status.value = rootIds.length ? '已删除其他节点；根节点已保留' : '已删除选中的节点'
}

function deleteSelectedNodes() {
  removeNodes(selectedNodes.value.map((node) => node.id))
}

function deleteContextNode() {
  const nodeId = contextMenu.value?.nodeId
  if (nodeId) removeNodes([nodeId])
  closeContextMenu()
}

function deleteSelection() {
  if (selectedNodes.value.length > 1) {
    deleteSelectedNodes()
    return
  }

  const nodeId = selectedNodeId.value
  if (nodeId) {
    removeNodes([nodeId])
    return
  }

  if (selectedEdgeId.value) {
    edges.value = edges.value.filter((edge) => edge.id !== selectedEdgeId.value)
    selectedEdgeId.value = undefined
    closeContextMenu()
    status.value = '已删除选中的连线'
  }
}

function saveDraft() {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(draftKey.value, JSON.stringify(graph.value))
    status.value = '草稿已保存在当前浏览器'
  } catch {
    status.value = '无法写入本地草稿'
  }
}

function scheduleDraftSave() {
  if (!isHydrated.value || typeof window === 'undefined') return
  window.clearTimeout(persistTimer)
  persistTimer = window.setTimeout(saveDraft, 280)
}

function resetDraft() {
  if (typeof window === 'undefined') return
  if (!window.confirm('放弃当前本地草稿并恢复已发布的路线图吗？')) return
  const published = roadmapsById.get(activeRoadmapId.value)
  if (!published) return
  window.localStorage.removeItem(draftKey.value)
  applyHistorySnapshot(published, 'push')
  status.value = '已恢复已发布版本'
}

function downloadGraph() {
  if (typeof window === 'undefined') return
  const blob = new Blob([`${JSON.stringify(graph.value, null, 2)}\n`], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${graph.value.id}-roadmap.json`
  link.click()
  URL.revokeObjectURL(url)
  status.value = '已导出 JSON 文件'
}

function openImport() {
  fileInput.value?.click()
}

async function importGraph(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return

  try {
    const parsed: unknown = JSON.parse(await file.text())
    if (!isRoadmapGraph(parsed) || parsed.id !== activeRoadmapId.value) {
      throw new Error('invalid graph')
    }
    applyHistorySnapshot(parsed, 'push')
    status.value = '已载入 JSON，草稿会自动保存'
  } catch {
    status.value = `导入失败：请选择有效的 ${activeDefinition.value?.label ?? ''} 路线图 JSON`
  }
}

async function saveToProject() {
  if (!isDev) return

  try {
    const response = await fetch(withBase('/__roadmap-editor/save'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(graph.value),
    })
    if (!response.ok) throw new Error('save failed')
    status.value = `已写入 src/roadmaps/${activeDefinition.value?.fileName ?? ''}`
  } catch {
    status.value = '写入项目失败，请确认正在运行本地开发服务'
  }
}

function loadActiveRoadmap() {
  const published = roadmapsById.get(activeRoadmapId.value)
  if (!published) return

  let draft: unknown
  try {
    const saved = window.localStorage.getItem(draftKey.value)
    draft = saved ? JSON.parse(saved) : undefined
  } catch {
    draft = undefined
  }

  const restored = isRoadmapGraph(draft) && draft.id === activeRoadmapId.value
  applyHistorySnapshot(restored ? draft : published, 'reset')
  status.value = restored ? '已恢复本地草稿' : '草稿只保存在当前浏览器'
}

function switchRoadmap(event: Event) {
  const nextId = (event.target as HTMLSelectElement).value
  if (nextId === activeRoadmapId.value || !roadmapsById.has(nextId)) return
  commitPendingHistory()
  if (isHydrated.value) saveDraft()
  activeRoadmapId.value = nextId
  loadActiveRoadmap()
}

onMounted(async () => {
  window.addEventListener('keydown', onWindowKeyDown)
  window.addEventListener('keyup', onWindowKeyUp)
  window.addEventListener('blur', onWindowBlur)

  loadActiveRoadmap()
  isHydrated.value = true
  await nextTick()
})

function onWindowBlur() {
  isSpacePressed.value = false
}

onBeforeUnmount(() => {
  window.clearTimeout(persistTimer)
  window.clearTimeout(historyTimer)
  window.removeEventListener('keydown', onWindowKeyDown)
  window.removeEventListener('keyup', onWindowKeyUp)
  window.removeEventListener('blur', onWindowBlur)
})

watch(
  [nodes, edges, metadata],
  () => {
    scheduleDraftSave()
    scheduleHistorySnapshot()
  },
  { deep: true },
)
</script>

<template>
  <section class="roadmap-editor" aria-label="路线图编辑器">
    <header class="roadmap-editor__header">
      <h1>编辑路线图</h1>
    </header>

    <div class="roadmap-editor__toolbar" aria-label="编辑器工具栏">
      <div class="roadmap-editor__toolbar-group">
        <label class="roadmap-editor__route-picker">
          <select aria-label="选择路线图" :value="activeRoadmapId" @change="switchRoadmap">
            <optgroup v-for="group in roadmapGroups" :key="group.group" :label="group.group">
              <option v-for="item in group.items" :key="item.id" :value="item.id">{{ item.label }}</option>
            </optgroup>
          </select>
        </label>
        <button type="button" title="选中节点时会添加子节点" @click="createNodeFromToolbar">+ 节点</button>
        <button
          class="roadmap-editor__snap-toggle"
          :class="{ 'is-active': isGridSnapEnabled }"
          type="button"
          :aria-pressed="isGridSnapEnabled"
          @click="toggleGridSnap"
        >
          网格吸附
        </button>
      </div>
      <div class="roadmap-editor__toolbar-group roadmap-editor__toolbar-group--end">
        <button type="button" @click="openImport">导入</button>
        <button type="button" @click="downloadGraph">导出 JSON</button>
        <button
          type="button"
          :disabled="!selectedNode && !selectedEdge && !selectedNodes.length"
          @click="deleteSelection"
        >
          删除选中
        </button>
        <button type="button" @click="resetDraft">恢复发布版</button>
        <button v-if="isDev" class="is-primary" type="button" @click="saveToProject">保存到项目</button>
      </div>
      <input ref="fileInput" class="roadmap-editor__file" type="file" accept="application/json" @change="importGraph" />
    </div>

    <p class="roadmap-editor__status" aria-live="polite">{{ status }}</p>

    <div class="roadmap-editor__workspace">
      <div ref="canvasElement" class="roadmap-editor__canvas" :class="{ 'is-panning': isSpacePressed }">
        <VueFlow
          ref="flowInstance"
          v-model:nodes="nodes"
          v-model:edges="edges"
          :node-types="nodeTypes"
          :connection-mode="ConnectionMode.Loose"
          :selection-key-code="true"
          pan-activation-key-code="Space"
          :pan-on-drag="[1]"
          :nodes-draggable="!isSpacePressed"
          :snap-to-grid="isGridSnapEnabled"
          :snap-grid="[16, 16]"
          :min-zoom="0.15"
          :max-zoom="2"
          fit-view-on-init
          :fit-view-options="{ padding: 0.2 }"
          @connect="onConnect"
          @node-click="onNodeClick"
          @edge-click="onEdgeClick"
          @edge-context-menu="onEdgeContextMenu"
          @pane-click="onPaneClick"
          @pane-context-menu="onPaneContextMenu"
          @node-context-menu="onNodeContextMenu"
          @selection-end="syncSelection"
        >
          <Background variant="lines" :gap="16" :size="1" pattern-color="var(--vp-c-divider)" />
          <Controls />
          <MiniMap :node-color="(node) => (node.data?.kind === 'branch' ? 'var(--roadmap-editor-minimap-branch)' : 'var(--roadmap-editor-minimap-main)')" />
        </VueFlow>
        <div
          v-if="selectedNodes.length > 1"
          class="roadmap-editor__selection-toolbar"
          role="toolbar"
          :aria-label="`已选中 ${selectedNodes.length} 个节点的批量操作`"
          @pointerdown.stop
          @click.stop
        >
          <span>{{ selectedNodes.length }} 个节点</span>
          <div class="roadmap-editor__selection-actions" aria-label="对齐">
            <button type="button" title="左对齐" @click="alignSelection('left')">左</button>
            <button type="button" title="水平居中" @click="alignSelection('center')">中</button>
            <button type="button" title="右对齐" @click="alignSelection('right')">右</button>
            <button type="button" title="顶部对齐" @click="alignSelection('top')">上</button>
            <button type="button" title="垂直居中" @click="alignSelection('middle')">中</button>
            <button type="button" title="底部对齐" @click="alignSelection('bottom')">下</button>
          </div>
          <div class="roadmap-editor__selection-actions" aria-label="均匀分布">
            <button type="button" :disabled="selectedNodes.length < 3" title="横向均分" @click="distributeSelection('horizontal')">横分</button>
            <button type="button" :disabled="selectedNodes.length < 3" title="纵向均分" @click="distributeSelection('vertical')">纵分</button>
          </div>
          <button class="is-danger" type="button" title="删除选中的节点" @click="deleteSelectedNodes">删除</button>
        </div>
        <div
          v-if="contextMenu"
          class="roadmap-editor__context-menu"
          :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }"
          role="menu"
          @pointerdown.stop
          @contextmenu.prevent
          @click.stop
        >
          <template v-if="contextMenu.nodeId">
            <button type="button" role="menuitem" @click="addChildFromContext">添加子节点</button>
            <button class="is-danger" type="button" role="menuitem" @click="deleteContextNode">删除节点</button>
          </template>
          <template v-else-if="contextMenu.edgeId">
            <button type="button" role="menuitem" @click="insertNodeFromContext('main')">在此插入主线节点</button>
            <button type="button" role="menuitem" @click="insertNodeFromContext('branch')">在此插入分支节点</button>
            <button class="is-danger" type="button" role="menuitem" @click="deleteSelection">删除连线</button>
          </template>
          <template v-else>
            <button type="button" role="menuitem" @click="createFromContext('main')">新建主线节点</button>
            <button type="button" role="menuitem" @click="createFromContext('branch')">新建分支节点</button>
            <button type="button" role="menuitem" @click="createFromContext('note')">新建纯文本</button>
          </template>
        </div>
      </div>

      <aside class="roadmap-editor__inspector" aria-label="编辑选项">
        <template v-if="selectedNode">
          <p class="roadmap-editor__panel-title">节点</p>
          <label v-if="selectedNode.data.kind === 'note'">
            文本
            <textarea v-model="selectedNode.data.label" rows="4" maxlength="80" @input="updateSelectedNode"></textarea>
          </label>
          <label v-else>
            文本
            <input v-model="selectedNode.data.label" maxlength="80" @input="updateSelectedNode" />
          </label>
          <label>
            类型
            <select
              v-model="selectedNode.data.kind"
              :disabled="selectedNode.data.kind === 'root'"
              @change="updateSelectedNode"
            >
              <option v-if="selectedNode.data.kind === 'root'" value="root">根节点</option>
              <option value="main">主线节点</option>
              <option value="branch">分支节点</option>
              <option value="note">纯文本</option>
            </select>
          </label>
          <label v-if="selectedNode.data.kind === 'main' || selectedNode.data.kind === 'branch'">
            路线标记
            <select v-model="selectedNode.data.choice" @change="updateSelectedNode">
              <option :value="undefined">无</option>
              <option value="recommended">推荐路线</option>
              <option value="alternative">替代选择</option>
            </select>
          </label>
          <label v-if="selectedNode.data.choice">
            标记位置
            <select v-model="selectedNode.data.choicePosition" @change="updateSelectedNode">
              <option value="right">右侧</option>
              <option value="left">左侧</option>
            </select>
          </label>
          <div class="roadmap-editor__coordinates">
            <label>
              X
              <input v-model.number="selectedNode.position.x" type="number" @input="updateSelectedNode" />
            </label>
            <label>
              Y
              <input v-model.number="selectedNode.position.y" type="number" @input="updateSelectedNode" />
            </label>
          </div>
        </template>

        <template v-else-if="selectedEdge">
          <p class="roadmap-editor__panel-title">连线</p>
          <label>
            连接方式
            <select v-model="selectedEdge.data!.kind" @change="updateSelectedEdge">
              <option value="main">主线（实线）</option>
              <option value="branch">分支（虚线）</option>
            </select>
          </label>
          <p class="roadmap-editor__hint">每条连线独立设置：主线用实线，展开主题用虚线。</p>
          <button class="roadmap-editor__delete-edge" type="button" @click="deleteSelection">删除连线</button>
        </template>

        <template v-else>
          <p class="roadmap-editor__panel-title">画布</p>
          <label>
            路线图名称
            <input v-model="metadata.title" maxlength="80" />
          </label>
          <div class="roadmap-editor__coordinates">
            <label>
              画布宽度
              <input v-model.number="metadata.viewport.width" type="number" min="480" />
            </label>
            <label>
              画布高度
              <input v-model.number="metadata.viewport.height" type="number" min="480" />
            </label>
          </div>
          <p class="roadmap-editor__hint">方向键平移画布（Shift 加速），+ / - 缩放；按住中键或空格加拖动平移。⌘/Ctrl + Z 撤销。</p>
          <p class="roadmap-editor__hint">桌面端保留你摆放的位置；移动端自动转成便于阅读的纵向主线。</p>
        </template>
      </aside>
    </div>
  </section>
</template>
