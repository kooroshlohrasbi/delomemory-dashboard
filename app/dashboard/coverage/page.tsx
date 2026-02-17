'use client'

import { useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { useSupabaseQuery } from '@/lib/hooks/use-supabase-query'
import { Database, Layers, FileType, Box } from 'lucide-react'
import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  ResponsiveContainer,
  Tooltip,
} from 'recharts'

// --- Types ---

interface ChunkRow {
  domain: string
  content_type: string
}

interface EntityRow {
  code: string
  entity_type: string
  domain: string | null
}

interface CoverageGap {
  id: string
  severity: 'Low' | 'Medium' | 'High'
  message: string
}

// --- Module mapping ---

const MODULE_MAP: Record<string, string> = {
  'tenant-services': 'TSC',
  'connect': 'CON',
  'forecast': 'FST',
  'ilm': 'ILM',
  'optimize': 'OPT',
  'automate': 'AUT',
  'analyze': 'ANA',
  'onboarding': 'OBD',
  'portal': 'PTL',
  'admin': 'APL',
  'demo': 'DMD',
}

// --- StatCard (local, same pattern as dashboard/page.tsx) ---

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

// --- Helper: map domain to module code ---

function domainToModule(domain: string): string {
  // Direct match
  if (MODULE_MAP[domain]) return MODULE_MAP[domain]
  // Partial match: check if domain contains a key or vice versa
  const lower = domain.toLowerCase()
  for (const [key, code] of Object.entries(MODULE_MAP)) {
    if (lower.includes(key) || key.includes(lower)) return code
  }
  return 'Unknown'
}

// --- Page component ---

export default function CoveragePage() {
  // 1. All chunks with domain + content_type
  const { data: chunks, isLoading: chunksLoading } = useSupabaseQuery<ChunkRow[]>(
    ['coverage-chunks'],
    async (supabase) => {
      const { data, error } = await supabase
        .schema('delomemory')
        .from('knowledge_chunks')
        .select('domain, content_type')
      if (error) throw error
      return (data as ChunkRow[]) ?? []
    }
  )

  // 2. All entities with entity_type + domain
  const { data: entities, isLoading: entitiesLoading } = useSupabaseQuery<EntityRow[]>(
    ['coverage-entities'],
    async (supabase) => {
      const { data, error } = await supabase
        .schema('delomemory')
        .from('entity_descriptions')
        .select('code, entity_type, domain')
      if (error) throw error
      return (data as EntityRow[]) ?? []
    }
  )

  const isLoading = chunksLoading || entitiesLoading

  // --- Derived: heatmap matrix ---
  const { domains, contentTypes, matrix, maxCount } = useMemo(() => {
    if (!chunks || chunks.length === 0) {
      return { domains: [] as string[], contentTypes: [] as string[], matrix: {} as Record<string, Record<string, number>>, maxCount: 1 }
    }
    const domainSet = new Set<string>()
    const ctSet = new Set<string>()
    const m: Record<string, Record<string, number>> = {}

    for (const chunk of chunks) {
      const d = chunk.domain || 'unknown'
      const ct = chunk.content_type || 'unknown'
      domainSet.add(d)
      ctSet.add(ct)
      m[d] ??= {}
      m[d][ct] = (m[d][ct] || 0) + 1
    }

    const allValues = Object.values(m).flatMap((row) => Object.values(row))
    const max = allValues.length > 0 ? Math.max(...allValues) : 1

    return {
      domains: [...domainSet].sort(),
      contentTypes: [...ctSet].sort(),
      matrix: m,
      maxCount: max,
    }
  }, [chunks])

  // --- Derived: module coverage for radar chart ---
  const moduleData = useMemo(() => {
    if (!chunks || chunks.length === 0) return []
    const moduleCounts: Record<string, number> = {}
    for (const chunk of chunks) {
      const mod = domainToModule(chunk.domain || 'unknown')
      moduleCounts[mod] = (moduleCounts[mod] || 0) + 1
    }
    return Object.entries(moduleCounts)
      .map(([module, count]) => ({ module, count }))
      .sort((a, b) => a.module.localeCompare(b.module))
  }, [chunks])

  // --- Derived: entity counts by module ---
  const entityModuleCounts = useMemo(() => {
    if (!entities || entities.length === 0) return {} as Record<string, number>
    const counts: Record<string, number> = {}
    for (const entity of entities) {
      const mod = domainToModule(entity.domain || 'unknown')
      counts[mod] = (counts[mod] || 0) + 1
    }
    return counts
  }, [entities])

  // --- Derived: coverage gaps ---
  const gaps = useMemo(() => {
    const result: CoverageGap[] = []
    if (!chunks || !entities) return result

    // Modules with < 10 chunks -> "Low coverage"
    const moduleCounts: Record<string, number> = {}
    for (const chunk of chunks) {
      const mod = domainToModule(chunk.domain || 'unknown')
      moduleCounts[mod] = (moduleCounts[mod] || 0) + 1
    }
    for (const [mod, count] of Object.entries(moduleCounts)) {
      if (mod !== 'Unknown' && count < 10) {
        result.push({
          id: `low-${mod}`,
          severity: 'Medium',
          message: `Module ${mod} has only ${count} chunk${count === 1 ? '' : 's'} — low coverage`,
        })
      }
    }

    // Modules with 0 entities -> "No entities"
    const allModules = new Set(Object.keys(moduleCounts))
    for (const mod of allModules) {
      if (mod !== 'Unknown' && !entityModuleCounts[mod]) {
        result.push({
          id: `no-entities-${mod}`,
          severity: 'High',
          message: `Module ${mod} has zero entities — no structured knowledge`,
        })
      }
    }

    // Content types present in some domains but missing in others
    if (domains.length > 1 && contentTypes.length > 1) {
      for (const ct of contentTypes) {
        const domainsWithCt = domains.filter((d) => matrix[d]?.[ct])
        const domainsMissingCt = domains.filter((d) => !matrix[d]?.[ct])
        // Only flag if at least half of domains have this content type but some don't
        if (domainsWithCt.length >= domains.length / 2 && domainsMissingCt.length > 0 && domainsMissingCt.length <= 3) {
          result.push({
            id: `missing-${ct}-${domainsMissingCt.join(',')}`,
            severity: 'Low',
            message: `Content type "${ct}" missing in: ${domainsMissingCt.join(', ')}`,
          })
        }
      }
    }

    return result
  }, [chunks, entities, domains, contentTypes, matrix, entityModuleCounts])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Domain Coverage</h1>
        <p className="text-muted-foreground">
          Knowledge base coverage across domains, content types, and modules
        </p>
      </div>

      {/* Summary stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Chunks"
          value={chunks?.length ?? 0}
          icon={Database}
          description="Indexed knowledge chunks"
          loading={isLoading}
        />
        <StatCard
          title="Domains"
          value={domains.length}
          icon={Layers}
          description="Unique knowledge domains"
          loading={isLoading}
        />
        <StatCard
          title="Content Types"
          value={contentTypes.length}
          icon={FileType}
          description="Unique content type categories"
          loading={isLoading}
        />
        <StatCard
          title="Entities"
          value={entities?.length ?? 0}
          icon={Box}
          description="Registered entity descriptions"
          loading={isLoading}
        />
      </div>

      {/* Heatmap: domain x content_type */}
      <Card>
        <CardHeader>
          <CardTitle>Domain x Content Type Heatmap</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-[300px] w-full" />
          ) : chunks && chunks.length > 0 ? (
            <div role="img" aria-label="Heatmap grid showing chunk counts by domain and content type">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      <th className="text-left py-2 pr-4 font-medium text-muted-foreground">
                        Domain
                      </th>
                      {contentTypes.map((ct) => (
                        <th
                          key={ct}
                          className="py-2 px-2 text-center font-medium text-muted-foreground text-xs"
                        >
                          {ct}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {domains.map((domain) => (
                      <tr key={domain} className="border-t border-border">
                        <td className="py-2 pr-4 font-mono text-xs">
                          {domain}
                        </td>
                        {contentTypes.map((ct) => {
                          const count = matrix[domain]?.[ct] ?? 0
                          const opacity =
                            count > 0
                              ? Math.max(0.15, count / maxCount)
                              : 0
                          return (
                            <td key={ct} className="py-2 px-2 text-center">
                              <div
                                className={`mx-auto flex h-8 w-14 items-center justify-center rounded text-xs font-medium ${
                                  count > 0
                                    ? 'bg-primary text-primary-foreground'
                                    : 'bg-muted text-muted-foreground'
                                }`}
                                style={
                                  count > 0 ? { opacity } : undefined
                                }
                                title={`${domain} / ${ct}: ${count} chunks`}
                              >
                                {count}
                              </div>
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-[200px] text-muted-foreground">
              No chunk data available
            </div>
          )}
        </CardContent>
      </Card>

      {/* Radar chart + Gap detection (2-column grid) */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Module Coverage Radar */}
        <Card>
          <CardHeader>
            <CardTitle>Module Coverage</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-[350px] w-full" />
            ) : moduleData.length > 0 ? (
              <div role="img" aria-label="Radar chart showing knowledge chunk distribution across Predelo modules">
                <ResponsiveContainer width="100%" height={350}>
                  <RadarChart
                    cx="50%"
                    cy="50%"
                    outerRadius="80%"
                    data={moduleData}
                  >
                    <PolarGrid className="stroke-border" />
                    <PolarAngleAxis
                      dataKey="module"
                      fontSize={12}
                      className="fill-foreground"
                    />
                    <PolarRadiusAxis fontSize={10} />
                    <Radar
                      name="Chunks"
                      dataKey="count"
                      stroke="var(--color-chart-1)"
                      fill="var(--color-chart-1)"
                      fillOpacity={0.3}
                    />
                    <Tooltip />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="flex items-center justify-center h-[350px] text-muted-foreground">
                No module data available
              </div>
            )}
          </CardContent>
        </Card>

        {/* Gap Detection */}
        <Card>
          <CardHeader>
            <CardTitle>Coverage Gaps</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-[350px] w-full" />
            ) : gaps.length === 0 ? (
              <div className="flex items-center justify-center h-[350px] text-muted-foreground">
                No coverage gaps detected
              </div>
            ) : (
              <div className="flex flex-col gap-2 max-h-[400px] overflow-y-auto">
                {gaps.map((gap) => (
                  <div
                    key={gap.id}
                    className="flex items-center gap-2 rounded-md border border-border px-3 py-2"
                  >
                    <Badge
                      variant={
                        gap.severity === 'High'
                          ? 'destructive'
                          : gap.severity === 'Medium'
                            ? 'secondary'
                            : 'outline'
                      }
                    >
                      {gap.severity}
                    </Badge>
                    <span className="text-sm">{gap.message}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
