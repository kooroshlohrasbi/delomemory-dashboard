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
import { format } from 'date-fns'
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Download,
  Activity,
  Users,
  Timer,
  Filter,
} from 'lucide-react'
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'

const PAGE_SIZE = 25

const CHART_COLORS = [
  'var(--color-chart-1)',
  'var(--color-chart-2)',
  'var(--color-chart-3)',
  'var(--color-chart-4)',
  'var(--color-chart-5)',
]

const ACCESS_LEVEL_LABELS: Record<number, string> = {
  1: 'L1 - Read Only',
  2: 'L2 - Standard',
  3: 'L3 - Elevated',
  4: 'L4 - Admin',
}

interface AuditSummaryRow {
  user_id: string | null
  query_time_ms: number | null
  chunks_returned: number | null
  chunks_filtered: number | null
  access_level: number
  tool_name: string | null
  created_at: string
}

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

export default function LogsPage() {
  const [page, setPage] = useState(0)
  const [toolFilter, setToolFilter] = useState<string | null>(null)
  const [showUserBreakdown, setShowUserBreakdown] = useState(false)

  // Paginated query for the table (existing)
  const { data, isLoading } = useSupabaseQuery(
    ['logs', String(page), toolFilter ?? 'all'],
    async (supabase) => {
      let query = supabase
        .schema('delomemory')
        .from('access_audit_log')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

      if (toolFilter) {
        query = query.eq('tool_name', toolFilter)
      }

      const { data, count } = await query
      return { rows: data ?? [], total: count ?? 0 }
    }
  )

  // Fetch distinct tool names for filter (existing)
  const { data: tools } = useSupabaseQuery(['log-tools'], async (supabase) => {
    const { data } = await supabase
      .schema('delomemory')
      .from('access_audit_log')
      .select('tool_name')
    if (!data) return []
    return [...new Set(data.map((r) => r.tool_name).filter(Boolean))] as string[]
  })

  // NEW: Summary query — fetches ALL audit rows for aggregate stats
  const { data: summaryData, isLoading: summaryLoading } = useSupabaseQuery(
    ['logs-summary'],
    async (supabase) => {
      const { data, error } = await supabase
        .schema('delomemory')
        .from('access_audit_log')
        .select('user_id, query_time_ms, chunks_returned, chunks_filtered, access_level, tool_name, created_at')
      if (error) throw error
      return (data ?? []) as AuditSummaryRow[]
    }
  )

  // Computed summary stats
  const summaryStats = useMemo(() => {
    if (!summaryData || summaryData.length === 0) {
      return { totalEntries: 0, uniqueUsers: 0, avgLatency: 'N/A', filteredRatio: 'N/A' }
    }

    const totalEntries = summaryData.length
    const uniqueUsers = new Set(summaryData.map((r) => r.user_id)).size

    const timings = summaryData.filter((r) => r.query_time_ms != null)
    const avgLatency =
      timings.length > 0
        ? `${Math.round(timings.reduce((s, r) => s + (r.query_time_ms ?? 0), 0) / timings.length)}ms`
        : 'N/A'

    const totalFiltered = summaryData.reduce((s, r) => s + (r.chunks_filtered ?? 0), 0)
    const totalReturned = summaryData.reduce((s, r) => s + (r.chunks_returned ?? 0), 0)
    const totalChunks = totalFiltered + totalReturned
    const filteredRatio =
      totalChunks > 0 ? `${Math.round((totalFiltered / totalChunks) * 100)}%` : 'N/A'

    return { totalEntries, uniqueUsers, avgLatency, filteredRatio }
  }, [summaryData])

  // Computed per-user breakdown
  const userBreakdown = useMemo(() => {
    if (!summaryData || summaryData.length === 0) return []

    const grouped: Record<
      string,
      { count: number; totalMs: number; tools: Record<string, number>; lastActive: string }
    > = {}

    for (const row of summaryData) {
      const uid = row.user_id ?? 'unknown'
      if (!grouped[uid]) {
        grouped[uid] = { count: 0, totalMs: 0, tools: {}, lastActive: row.created_at }
      }
      grouped[uid].count++
      grouped[uid].totalMs += row.query_time_ms ?? 0
      const tool = row.tool_name ?? 'unknown'
      grouped[uid].tools[tool] = (grouped[uid].tools[tool] ?? 0) + 1
      if (row.created_at > grouped[uid].lastActive) {
        grouped[uid].lastActive = row.created_at
      }
    }

    return Object.entries(grouped)
      .map(([user, stats]) => {
        const topTool = Object.entries(stats.tools).sort((a, b) => b[1] - a[1])[0]
        return {
          user,
          count: stats.count,
          avgLatency: stats.count > 0 ? Math.round(stats.totalMs / stats.count) : 0,
          mostUsedTool: topTool ? topTool[0] : 'N/A',
          lastActive: stats.lastActive,
        }
      })
      .sort((a, b) => b.count - a.count)
  }, [summaryData])

  // Computed access level distribution
  const accessLevelData = useMemo(() => {
    if (!summaryData || summaryData.length === 0) return []

    const counts: Record<number, number> = {}
    for (const row of summaryData) {
      const level = row.access_level ?? 0
      counts[level] = (counts[level] ?? 0) + 1
    }

    return Object.entries(counts)
      .map(([level, count]) => ({
        name: ACCESS_LEVEL_LABELS[Number(level)] ?? `L${level} - Unknown`,
        value: count,
      }))
      .sort((a, b) => b.value - a.value)
  }, [summaryData])

  // Export handler
  function handleExport() {
    if (!summaryData) return
    const blob = new Blob([JSON.stringify(summaryData, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `delomemory-audit-log-${format(new Date(), 'yyyy-MM-dd')}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0

  return (
    <div className="space-y-6">
      {/* Enhanced header with Export button */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Query Logs</h1>
          <p className="text-muted-foreground">
            Audit trail of all MCP tool invocations
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleExport}
          disabled={!summaryData || summaryData.length === 0}
          aria-label="Export audit log as JSON"
        >
          <Download className="h-4 w-4 mr-2" />
          Export JSON
        </Button>
      </div>

      {/* Summary stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Entries"
          value={summaryStats.totalEntries}
          icon={Activity}
          description="All-time audit log entries"
          loading={summaryLoading}
        />
        <StatCard
          title="Unique Users"
          value={summaryStats.uniqueUsers}
          icon={Users}
          description="Distinct users in audit log"
          loading={summaryLoading}
        />
        <StatCard
          title="Avg Latency"
          value={summaryStats.avgLatency}
          icon={Timer}
          description="Mean query duration"
          loading={summaryLoading}
        />
        <StatCard
          title="Filtered Ratio"
          value={summaryStats.filteredRatio}
          icon={Filter}
          description="Chunks filtered by access control"
          loading={summaryLoading}
        />
      </div>

      {/* Tool filter (existing) */}
      <div className="flex flex-wrap gap-2">
        <Button
          variant={toolFilter === null ? 'default' : 'outline'}
          size="sm"
          className="rounded-full"
          onClick={() => {
            setToolFilter(null)
            setPage(0)
          }}
        >
          All
        </Button>
        {tools?.map((tool) => (
          <Button
            key={tool}
            variant={toolFilter === tool ? 'default' : 'outline'}
            size="sm"
            className="rounded-full"
            onClick={() => {
              setToolFilter(tool)
              setPage(0)
            }}
          >
            {tool}
          </Button>
        ))}
      </div>

      {/* Per-User Breakdown + Access Level Pie — 2-column grid */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Per-User Breakdown (collapsible) */}
        <Card>
          <CardHeader className="pb-2">
            <Button
              variant="ghost"
              className="flex w-full items-center justify-between p-0 h-auto hover:bg-transparent"
              onClick={() => setShowUserBreakdown((prev) => !prev)}
              aria-expanded={showUserBreakdown}
              aria-controls="user-breakdown-content"
            >
              <CardTitle className="text-base font-medium">
                Per-User Activity Breakdown
              </CardTitle>
              {showUserBreakdown ? (
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              )}
            </Button>
          </CardHeader>
          {showUserBreakdown && (
            <CardContent id="user-breakdown-content">
              {summaryLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              ) : userBreakdown.length > 0 ? (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>User</TableHead>
                        <TableHead className="text-right">Queries</TableHead>
                        <TableHead className="text-right">Avg Latency</TableHead>
                        <TableHead className="hidden sm:table-cell">Top Tool</TableHead>
                        <TableHead className="hidden md:table-cell">Last Active</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {userBreakdown.map((row) => (
                        <TableRow key={row.user}>
                          <TableCell className="text-sm font-medium">
                            {row.user}
                          </TableCell>
                          <TableCell className="text-right text-sm">
                            {row.count}
                          </TableCell>
                          <TableCell className="text-right text-sm">
                            {row.avgLatency}ms
                          </TableCell>
                          <TableCell className="hidden sm:table-cell">
                            <Badge variant="secondary">{row.mostUsedTool}</Badge>
                          </TableCell>
                          <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                            {format(new Date(row.lastActive), 'MMM d, HH:mm')}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="flex items-center justify-center h-20 text-muted-foreground">
                  No user data available
                </div>
              )}
            </CardContent>
          )}
        </Card>

        {/* Access Level Distribution Pie */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-medium">
              Access Level Distribution
            </CardTitle>
          </CardHeader>
          <CardContent>
            {summaryLoading ? (
              <Skeleton className="h-[250px] w-full" />
            ) : accessLevelData.length > 0 ? (
              <div
                role="img"
                aria-label="Pie chart showing query distribution by access level"
              >
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie
                      data={accessLevelData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={80}
                      label={({ name }) => name}
                      fontSize={11}
                    >
                      {accessLevelData.map((_, i) => (
                        <Cell
                          key={i}
                          fill={CHART_COLORS[i % CHART_COLORS.length]}
                        />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="flex items-center justify-center h-[250px] text-muted-foreground">
                No access level data available
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Paginated audit log table (existing, preserved) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>
              {data ? `${data.total} entries` : 'Loading...'}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : data && data.rows.length > 0 ? (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Timestamp</TableHead>
                      <TableHead>User</TableHead>
                      <TableHead>Tool</TableHead>
                      <TableHead className="hidden lg:table-cell">
                        Query
                      </TableHead>
                      <TableHead className="text-right">Duration</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.rows.map((row, i) => (
                      <TableRow key={i}>
                        <TableCell className="whitespace-nowrap text-sm">
                          {format(
                            new Date(row.created_at),
                            'MMM d, HH:mm:ss'
                          )}
                        </TableCell>
                        <TableCell className="text-sm">
                          {row.user_id ?? 'unknown'}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">{row.tool_name}</Badge>
                        </TableCell>
                        <TableCell className="hidden lg:table-cell max-w-[300px] truncate text-sm text-muted-foreground">
                          {row.query_text ?? '-'}
                        </TableCell>
                        <TableCell className="text-right text-sm">
                          {row.query_time_ms != null
                            ? `${row.query_time_ms}ms`
                            : '-'}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              row.access_level > 0 ? 'default' : 'destructive'
                            }
                          >
                            {row.access_level > 0 ? 'OK' : 'DENIED'}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination */}
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
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page + 1 >= totalPages}
                    onClick={() => setPage((p) => p + 1)}
                    aria-label="Next page"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center h-32 text-muted-foreground">
              No log entries found
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
