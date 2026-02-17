'use client'

import { useState, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useSupabaseQuery } from '@/lib/hooks/use-supabase-query'
import {
  Search,
  Network,
  FileText,
  ChevronRight,
  ChevronDown,
  Boxes,
  GitFork,
  Tag,
} from 'lucide-react'

// ---------- Types ----------

interface EntityDescription {
  code: string
  canonical_name: string
  entity_type: string
  domain: string | null
  description: string | null
  aliases: string[] | null
  parent_code: string | null
}

interface GraphEdge {
  source_entity: string
  target_entity: string
}

interface ChunkRow {
  entity_codes: string[] | null
}

// ---------- Constants ----------

const TYPE_COLORS: Record<string, string> = {
  customer: 'hsl(var(--chart-1))',
  module: 'hsl(var(--chart-2))',
  platform: 'hsl(var(--chart-3))',
  person: 'hsl(var(--chart-4))',
  cerebro_component: 'hsl(var(--chart-5))',
}

const DEFAULT_TYPE_COLOR = 'hsl(var(--muted-foreground))'

const PAGE_SIZE = 25

// ---------- Helper: StatCard (reused pattern) ----------

function StatCard({
  title,
  value,
  icon: Icon,
  description,
  loading,
}: {
  title: string
  value: string | number
  icon: React.ComponentType<{ className?: string }>
  description?: string
  loading?: boolean
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-8 w-24" />
        ) : (
          <>
            <div className="text-2xl font-bold">{value}</div>
            {description && (
              <p className="text-xs text-muted-foreground mt-1">
                {description}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

// ---------- Main Page ----------

export default function EntitiesPage() {
  const [searchQuery, setSearchQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<string | null>(null)
  const [expandedCode, setExpandedCode] = useState<string | null>(null)
  const [page, setPage] = useState(0)

  // 1. All entities
  const { data: entities, isLoading } = useSupabaseQuery(
    ['entities'],
    async (supabase) => {
      const { data, error } = await supabase
        .schema('delomemory')
        .from('entity_descriptions')
        .select('*')
        .order('code')
      if (error) throw error
      return data as EntityDescription[]
    }
  )

  // 2. Graph edges (for connection counts)
  const { data: edges } = useSupabaseQuery(
    ['entity-edges'],
    async (supabase) => {
      const { data, error } = await supabase
        .schema('delomemory')
        .from('entity_graph')
        .select('source_entity, target_entity')
      if (error) throw error
      return data as GraphEdge[]
    }
  )

  // 3. Chunk entity_codes (for associated file counts)
  const { data: chunks } = useSupabaseQuery(
    ['entity-chunks'],
    async (supabase) => {
      const { data, error } = await supabase
        .schema('delomemory')
        .from('knowledge_chunks')
        .select('entity_codes')
      if (error) throw error
      return data as ChunkRow[]
    }
  )

  // ---------- Computed: unique types for filter pills ----------

  const entityTypes = useMemo(() => {
    if (!entities) return []
    const types = new Set(entities.map((e) => e.entity_type))
    return [...types].sort()
  }, [entities])

  // ---------- Computed: connection counts per entity ----------

  const connectionCounts = useMemo(() => {
    if (!edges) return new Map<string, number>()
    const counts = new Map<string, number>()
    for (const edge of edges) {
      counts.set(edge.source_entity, (counts.get(edge.source_entity) ?? 0) + 1)
      counts.set(edge.target_entity, (counts.get(edge.target_entity) ?? 0) + 1)
    }
    return counts
  }, [edges])

  // ---------- Computed: chunk counts per entity ----------

  const chunkCounts = useMemo(() => {
    if (!chunks) return new Map<string, number>()
    const counts = new Map<string, number>()
    for (const chunk of chunks) {
      if (chunk.entity_codes) {
        for (const code of chunk.entity_codes) {
          counts.set(code, (counts.get(code) ?? 0) + 1)
        }
      }
    }
    return counts
  }, [chunks])

  // ---------- Computed: connected entities for detail panel ----------

  const connectedEntities = useMemo(() => {
    if (!edges || !expandedCode) return []
    const connected = new Set<string>()
    for (const edge of edges) {
      if (edge.source_entity === expandedCode) connected.add(edge.target_entity)
      if (edge.target_entity === expandedCode) connected.add(edge.source_entity)
    }
    return [...connected].sort()
  }, [edges, expandedCode])

  // ---------- Computed: parent chain for detail panel ----------

  const parentChain = useMemo(() => {
    if (!entities || !expandedCode) return []
    const entityMap = new Map(entities.map((e) => [e.code, e]))
    const chain: EntityDescription[] = []
    let current = entityMap.get(expandedCode)
    while (current?.parent_code) {
      const parent = entityMap.get(current.parent_code)
      if (!parent || chain.includes(parent)) break
      chain.push(parent)
      current = parent
    }
    return chain
  }, [entities, expandedCode])

  // ---------- Filtering + search ----------

  const filteredEntities = useMemo(() => {
    if (!entities) return []
    let result = entities

    if (typeFilter) {
      result = result.filter((e) => e.entity_type === typeFilter)
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      result = result.filter((e) => {
        if (e.code.toLowerCase().includes(q)) return true
        if (e.canonical_name.toLowerCase().includes(q)) return true
        if (e.aliases?.some((a) => a.toLowerCase().includes(q))) return true
        return false
      })
    }

    return result
  }, [entities, typeFilter, searchQuery])

  // ---------- Pagination ----------

  const totalPages = Math.ceil(filteredEntities.length / PAGE_SIZE)
  const paginatedEntities = filteredEntities.slice(
    page * PAGE_SIZE,
    (page + 1) * PAGE_SIZE
  )

  // ---------- Stats ----------

  const totalEntities = entities?.length ?? 0
  const totalTypes = entityTypes.length
  const totalEdges = edges?.length ?? 0

  // ---------- Handlers ----------

  function handleTypeFilter(type: string | null) {
    setTypeFilter(type)
    setPage(0)
    setExpandedCode(null)
  }

  function handleSearch(value: string) {
    setSearchQuery(value)
    setPage(0)
    setExpandedCode(null)
  }

  function toggleExpand(code: string) {
    setExpandedCode((prev) => (prev === code ? null : code))
  }

  function getTypeColor(type: string): string {
    return TYPE_COLORS[type] ?? DEFAULT_TYPE_COLOR
  }

  // ---------- Render ----------

  return (
    <div className="space-y-6">
      {/* Header + Search */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Entity Registry
          </h1>
          <p className="text-muted-foreground">
            Browse and inspect all entities in the knowledge graph
          </p>
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search by code, name, or alias..."
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            aria-label="Search entities"
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-9 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          title="Total Entities"
          value={totalEntities}
          icon={Boxes}
          description="Registered in entity_descriptions"
          loading={isLoading}
        />
        <StatCard
          title="Entity Types"
          value={totalTypes}
          icon={Tag}
          description="Distinct entity classifications"
          loading={isLoading}
        />
        <StatCard
          title="Graph Edges"
          value={totalEdges}
          icon={GitFork}
          description="Connections in entity_graph"
          loading={!edges && isLoading}
        />
      </div>

      {/* Type filter pills */}
      <div className="flex flex-wrap gap-2">
        <Button
          variant={typeFilter === null ? 'default' : 'outline'}
          size="sm"
          className="rounded-full"
          onClick={() => handleTypeFilter(null)}
        >
          All ({totalEntities})
        </Button>
        {entityTypes.map((type) => {
          const count = entities?.filter((e) => e.entity_type === type).length ?? 0
          return (
            <Button
              key={type}
              variant={typeFilter === type ? 'default' : 'outline'}
              size="sm"
              className="rounded-full"
              onClick={() => handleTypeFilter(type)}
            >
              {type} ({count})
            </Button>
          )
        })}
      </div>

      {/* Entity table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>
              {filteredEntities.length} entit{filteredEntities.length === 1 ? 'y' : 'ies'}
              {typeFilter && ` of type "${typeFilter}"`}
              {searchQuery && ` matching "${searchQuery}"`}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : paginatedEntities.length > 0 ? (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8" />
                      <TableHead>Code</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="hidden md:table-cell">Domain</TableHead>
                      <TableHead className="text-right">Connections</TableHead>
                      <TableHead className="text-right">Chunks</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedEntities.map((entity) => {
                      const isExpanded = expandedCode === entity.code
                      const connections = connectionCounts.get(entity.code) ?? 0
                      const chunkCount = chunkCounts.get(entity.code) ?? 0

                      return (
                        <>
                          <TableRow
                            key={entity.code}
                            className="cursor-pointer hover:bg-muted/50"
                            onClick={() => toggleExpand(entity.code)}
                            aria-expanded={isExpanded}
                            aria-label={`Entity ${entity.canonical_name}, click to ${isExpanded ? 'collapse' : 'expand'} details`}
                          >
                            <TableCell className="w-8 pr-0">
                              {isExpanded ? (
                                <ChevronDown className="h-4 w-4 text-muted-foreground" />
                              ) : (
                                <ChevronRight className="h-4 w-4 text-muted-foreground" />
                              )}
                            </TableCell>
                            <TableCell className="font-mono text-sm">
                              {entity.code}
                            </TableCell>
                            <TableCell className="text-sm font-medium">
                              {entity.canonical_name}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant="secondary"
                                style={{ backgroundColor: getTypeColor(entity.entity_type), color: 'white' }}
                              >
                                {entity.entity_type}
                              </Badge>
                            </TableCell>
                            <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                              {entity.domain ?? '-'}
                            </TableCell>
                            <TableCell className="text-right text-sm">
                              {connections > 0 ? (
                                <span className="inline-flex items-center gap-1">
                                  <Network className="h-3 w-3 text-muted-foreground" />
                                  {connections}
                                </span>
                              ) : (
                                <span className="text-muted-foreground">0</span>
                              )}
                            </TableCell>
                            <TableCell className="text-right text-sm">
                              {chunkCount > 0 ? (
                                <span className="inline-flex items-center gap-1">
                                  <FileText className="h-3 w-3 text-muted-foreground" />
                                  {chunkCount}
                                </span>
                              ) : (
                                <span className="text-muted-foreground">0</span>
                              )}
                            </TableCell>
                          </TableRow>

                          {/* Expanded detail panel */}
                          {isExpanded && (
                            <TableRow key={`${entity.code}-detail`}>
                              <TableCell colSpan={7} className="bg-muted/50 p-4">
                                <div className="space-y-3">
                                  {/* Description */}
                                  {entity.description && (
                                    <div>
                                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                                        Description
                                      </p>
                                      <p className="text-sm">
                                        {entity.description}
                                      </p>
                                    </div>
                                  )}

                                  {/* Aliases */}
                                  {entity.aliases && entity.aliases.length > 0 && (
                                    <div>
                                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                                        Aliases
                                      </p>
                                      <div className="flex flex-wrap gap-1">
                                        {entity.aliases.map((alias) => (
                                          <Badge
                                            key={alias}
                                            variant="outline"
                                            className="text-xs"
                                          >
                                            {alias}
                                          </Badge>
                                        ))}
                                      </div>
                                    </div>
                                  )}

                                  {/* Parent chain */}
                                  {parentChain.length > 0 && (
                                    <div>
                                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                                        Parent Chain
                                      </p>
                                      <div className="flex items-center gap-1 text-sm">
                                        <span className="font-mono font-medium">
                                          {entity.code}
                                        </span>
                                        {parentChain.map((parent) => (
                                          <span key={parent.code} className="flex items-center gap-1">
                                            <ChevronRight className="h-3 w-3 text-muted-foreground" />
                                            <span className="font-mono">
                                              {parent.code}
                                            </span>
                                            <span className="text-muted-foreground">
                                              ({parent.canonical_name})
                                            </span>
                                          </span>
                                        ))}
                                      </div>
                                    </div>
                                  )}

                                  {/* Connected entities */}
                                  {connectedEntities.length > 0 && (
                                    <div>
                                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                                        Connected Entities ({connectedEntities.length})
                                      </p>
                                      <div className="flex flex-wrap gap-1">
                                        {connectedEntities.map((code) => (
                                          <Badge
                                            key={code}
                                            variant="secondary"
                                            className="text-xs font-mono cursor-pointer hover:bg-accent"
                                            onClick={(e) => {
                                              e.stopPropagation()
                                              setExpandedCode(code)
                                            }}
                                            aria-label={`Navigate to entity ${code}`}
                                          >
                                            {code}
                                          </Badge>
                                        ))}
                                      </div>
                                    </div>
                                  )}

                                  {/* Chunk count summary */}
                                  <div>
                                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                                      Knowledge Chunks
                                    </p>
                                    <p className="text-sm">
                                      Referenced in {chunkCount} chunk{chunkCount !== 1 ? 's' : ''}
                                    </p>
                                  </div>
                                </div>
                              </TableCell>
                            </TableRow>
                          )}
                        </>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between mt-4">
                  <p className="text-sm text-muted-foreground">
                    Page {page + 1} of {totalPages}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page === 0}
                      onClick={() => setPage((p) => p - 1)}
                      aria-label="Previous page"
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page + 1 >= totalPages}
                      onClick={() => setPage((p) => p + 1)}
                      aria-label="Next page"
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="flex items-center justify-center h-32 text-muted-foreground">
              {searchQuery || typeFilter
                ? 'No entities match the current filters'
                : 'No entities found'}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
