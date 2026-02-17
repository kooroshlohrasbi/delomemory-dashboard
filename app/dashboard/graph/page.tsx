'use client'

import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { useSupabaseQuery } from '@/lib/hooks/use-supabase-query'
import { Network, X } from 'lucide-react'

const ForceGraph2D = dynamic(() => import('react-force-graph-2d'), {
  ssr: false,
  loading: () => <Skeleton className="h-[500px] w-full rounded-lg" />,
})

// ---------- Types ----------

interface EntityDescription {
  code: string
  canonical_name: string
  entity_type: string
  domain: string | null
  access_level: number | null
  description: string | null
  aliases: string[] | null
  parent_code: string | null
}

interface GraphEdge {
  source_entity: string
  target_entity: string
  relationship_type: string
  weight: number | null
}

interface GraphNode {
  id: string
  name: string
  type: string
  domain: string | null
  accessLevel: number | null
  description: string | null
  aliases: string[] | null
  val: number
}

interface GraphLink {
  source: string
  target: string
  label: string
}

// ---------- Constants ----------

const TYPE_COLORS: Record<string, string> = {
  customer: '#ef4444',
  module: '#3b82f6',
  platform: '#8b5cf6',
  person: '#f59e0b',
  process: '#10b981',
  concept: '#6366f1',
  cerebro_component: '#ec4899',
  product: '#14b8a6',
  partner: '#f97316',
  team: '#a855f7',
}

const FALLBACK_COLOR = '#6b7280'

function getNodeColor(type: string | undefined): string {
  return TYPE_COLORS[type ?? ''] ?? FALLBACK_COLOR
}

// ---------- Main Page ----------

export default function GraphExplorerPage() {
  const containerRef = useRef<HTMLDivElement>(null)
  const [dimensions, setDimensions] = useState({ width: 800, height: 500 })
  const [activeTypes, setActiveTypes] = useState<Set<string>>(new Set())
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)

  // --- Data fetching ---

  const { data: entities, isLoading: entitiesLoading } = useSupabaseQuery(
    ['graph-entities'],
    async (supabase) => {
      const { data, error } = await supabase
        .schema('delomemory')
        .from('entity_descriptions')
        .select(
          'code, canonical_name, entity_type, domain, access_level, description, aliases, parent_code'
        )
      if (error) throw error
      return data as EntityDescription[]
    }
  )

  const { data: edges, isLoading: edgesLoading } = useSupabaseQuery(
    ['graph-edges'],
    async (supabase) => {
      const { data, error } = await supabase
        .schema('delomemory')
        .from('entity_graph')
        .select('source_entity, target_entity, relationship_type, weight')
      if (error) throw error
      return data as GraphEdge[]
    }
  )

  const isLoading = entitiesLoading || edgesLoading

  // --- Initialize active types when entities load ---

  useEffect(() => {
    if (entities) {
      setActiveTypes(new Set(entities.map((e) => e.entity_type)))
    }
  }, [entities])

  // --- Responsive container width ---

  useEffect(() => {
    if (!containerRef.current) return
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setDimensions({ width: entry.contentRect.width, height: 500 })
      }
    })
    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [])

  // --- Unique entity types ---

  const entityTypes = useMemo(() => {
    if (!entities) return []
    return [...new Set(entities.map((e) => e.entity_type))].sort()
  }, [entities])

  // --- Build graph data with type filtering ---

  const graphData = useMemo(() => {
    if (!entities || !edges) return { nodes: [] as GraphNode[], links: [] as GraphLink[] }

    const filteredEntities = entities.filter((e) => activeTypes.has(e.entity_type))
    const nodeSet = new Set(filteredEntities.map((e) => e.code))

    return {
      nodes: filteredEntities.map((e) => ({
        id: e.code,
        name: e.canonical_name,
        type: e.entity_type,
        domain: e.domain,
        accessLevel: e.access_level,
        description: e.description,
        aliases: e.aliases,
        val: 1,
      })),
      links: edges
        .filter((e) => nodeSet.has(e.source_entity) && nodeSet.has(e.target_entity))
        .map((e) => ({
          source: e.source_entity,
          target: e.target_entity,
          label: e.relationship_type,
        })),
    }
  }, [entities, edges, activeTypes])

  // --- Selected node detail ---

  const selectedEntity = useMemo(() => {
    if (!selectedNodeId || !entities) return null
    return entities.find((e) => e.code === selectedNodeId) ?? null
  }, [selectedNodeId, entities])

  const connectedEntities = useMemo(() => {
    if (!selectedNodeId || !edges || !entities) return []
    const connected = new Set<string>()
    for (const edge of edges) {
      if (edge.source_entity === selectedNodeId) connected.add(edge.target_entity)
      if (edge.target_entity === selectedNodeId) connected.add(edge.source_entity)
    }
    const entityMap = new Map(entities.map((e) => [e.code, e]))
    return [...connected]
      .map((code) => entityMap.get(code))
      .filter((e): e is EntityDescription => e !== undefined)
      .sort((a, b) => a.code.localeCompare(b.code))
  }, [selectedNodeId, edges, entities])

  // --- Handlers ---

  const handleNodeClick = useCallback(
    (node: { id?: string | number }) => {
      const nodeId = String(node.id)
      setSelectedNodeId((prev) => (prev === nodeId ? null : nodeId))
    },
    []
  )

  function toggleType(type: string) {
    setActiveTypes((prev) => {
      const next = new Set(prev)
      if (next.has(type)) {
        next.delete(type)
      } else {
        next.add(type)
      }
      return next
    })
  }

  function selectAll() {
    if (entities) {
      setActiveTypes(new Set(entities.map((e) => e.entity_type)))
    }
  }

  function selectNone() {
    setActiveTypes(new Set())
  }

  // --- Render ---

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Knowledge Graph</h1>
          <p className="text-muted-foreground">
            Interactive force-directed visualization of all entities and relationships
          </p>
        </div>
        {!isLoading && entities && edges && (
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <span>{graphData.nodes.length} nodes</span>
            <span className="text-border">|</span>
            <span>{graphData.links.length} edges</span>
          </div>
        )}
      </div>

      {/* Type filter */}
      {entityTypes.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium">Filter by Entity Type</CardTitle>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={selectAll}>
                  All
                </Button>
                <Button variant="ghost" size="sm" onClick={selectNone}>
                  None
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="flex flex-wrap gap-2" role="group" aria-label="Entity type filters">
              {entityTypes.map((type) => {
                const isActive = activeTypes.has(type)
                const count = entities?.filter((e) => e.entity_type === type).length ?? 0
                return (
                  <Button
                    key={type}
                    variant={isActive ? 'default' : 'outline'}
                    size="sm"
                    className="rounded-full gap-2"
                    onClick={() => toggleType(type)}
                    aria-pressed={isActive}
                  >
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: getNodeColor(type) }}
                      aria-hidden="true"
                    />
                    {type} ({count})
                  </Button>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Graph visualization */}
      <Card>
        <CardContent className="p-0">
          <div
            ref={containerRef}
            role="img"
            aria-label="Force-directed knowledge graph showing entities as nodes and relationships as edges"
            className="w-full"
          >
            {isLoading ? (
              <Skeleton className="h-[500px] w-full rounded-lg" />
            ) : graphData.nodes.length > 0 ? (
              <ForceGraph2D
                graphData={graphData}
                nodeLabel="name"
                nodeColor={(node: Record<string, unknown>) =>
                  getNodeColor(node.type as string | undefined)
                }
                nodeRelSize={6}
                linkDirectionalArrowLength={3}
                linkDirectionalArrowRelPos={1}
                linkLabel="label"
                onNodeClick={handleNodeClick}
                width={dimensions.width}
                height={dimensions.height}
                backgroundColor="transparent"
              />
            ) : (
              <div className="flex items-center justify-center h-[500px] text-muted-foreground">
                <div className="text-center space-y-2">
                  <Network className="h-8 w-8 mx-auto opacity-50" />
                  <p>
                    {activeTypes.size === 0
                      ? 'No entity types selected. Use the filters above to show nodes.'
                      : 'No graph data available'}
                  </p>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Selected node detail panel */}
      {selectedEntity && (
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <CardTitle className="flex items-center gap-2">
                  <code className="text-sm font-mono bg-muted px-2 py-0.5 rounded">
                    {selectedEntity.code}
                  </code>
                  <span>{selectedEntity.canonical_name}</span>
                </CardTitle>
                <div className="flex items-center gap-2">
                  <Badge
                    variant="secondary"
                    style={{
                      backgroundColor: getNodeColor(selectedEntity.entity_type),
                      color: 'white',
                    }}
                  >
                    {selectedEntity.entity_type}
                  </Badge>
                  {selectedEntity.domain && (
                    <Badge variant="outline">{selectedEntity.domain}</Badge>
                  )}
                  {selectedEntity.access_level !== null && (
                    <Badge variant="outline">L{selectedEntity.access_level}</Badge>
                  )}
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelectedNodeId(null)}
                aria-label="Close detail panel"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Description */}
            {selectedEntity.description && (
              <div>
                <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                  Description
                </h3>
                <p className="text-sm">{selectedEntity.description}</p>
              </div>
            )}

            {/* Aliases */}
            {selectedEntity.aliases && selectedEntity.aliases.length > 0 && (
              <div>
                <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                  Aliases
                </h3>
                <div className="flex flex-wrap gap-1">
                  {selectedEntity.aliases.map((alias) => (
                    <Badge key={alias} variant="outline" className="text-xs">
                      {alias}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Connected entities */}
            {connectedEntities.length > 0 && (
              <div>
                <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                  Connected Entities ({connectedEntities.length})
                </h3>
                <div className="flex flex-wrap gap-1">
                  {connectedEntities.map((entity) => (
                    <Badge
                      key={entity.code}
                      variant="secondary"
                      className="text-xs font-mono cursor-pointer hover:bg-accent"
                      style={{
                        borderLeft: `3px solid ${getNodeColor(entity.entity_type)}`,
                      }}
                      onClick={() => setSelectedNodeId(entity.code)}
                      aria-label={`Navigate to entity ${entity.canonical_name}`}
                    >
                      {entity.code}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
