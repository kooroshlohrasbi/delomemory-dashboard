'use client'

import { useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
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
import { subDays, format } from 'date-fns'
import { Timer, Gauge, Activity, Clock } from 'lucide-react'
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'

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

const CHUNK_BUCKETS = [
  { label: '0', min: 0, max: 0 },
  { label: '1-5', min: 1, max: 5 },
  { label: '6-10', min: 6, max: 10 },
  { label: '11-20', min: 11, max: 20 },
  { label: '21-50', min: 21, max: 50 },
  { label: '50+', min: 51, max: Infinity },
]

interface AuditRow {
  query_time_ms: number | null
  access_level: number
  chunks_returned: number | null
  user_id: string | null
  tool_name: string | null
  query_text: string | null
  created_at: string
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0
  const sorted = [...arr].sort((a, b) => a - b)
  const idx = Math.ceil((p / 100) * sorted.length) - 1
  return sorted[Math.max(0, idx)]
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

export default function AnalyticsPage() {
  const thirtyDaysAgo = subDays(new Date(), 30).toISOString()

  // Shared audit log fetch for latency, access level, chunks, and slow queries
  const { data: auditRows, isLoading: loadingAudit } = useSupabaseQuery(
    ['analytics-audit-full'],
    async (supabase) => {
      const { data, error } = await supabase
        .schema('delomemory')
        .from('access_audit_log')
        .select('query_time_ms, access_level, chunks_returned, user_id, tool_name, query_text, created_at')
        .gte('created_at', thirtyDaysAgo)
      if (error) throw error
      return (data ?? []) as AuditRow[]
    }
  )

  // Computed metrics from audit rows
  const latencyValues = useMemo(() => {
    if (!auditRows) return []
    return auditRows
      .filter((r) => r.query_time_ms != null)
      .map((r) => r.query_time_ms as number)
  }, [auditRows])

  const p50 = useMemo(() => percentile(latencyValues, 50), [latencyValues])
  const p95 = useMemo(() => percentile(latencyValues, 95), [latencyValues])
  const totalQueries = auditRows?.length ?? 0
  const avgLatency = useMemo(() => {
    if (latencyValues.length === 0) return 0
    return Math.round(latencyValues.reduce((a, b) => a + b, 0) / latencyValues.length)
  }, [latencyValues])

  // Access level distribution
  const accessDistData = useMemo(() => {
    if (!auditRows) return []
    const counts: Record<number, number> = {}
    auditRows.forEach((r) => {
      const level = r.access_level ?? 0
      counts[level] = (counts[level] ?? 0) + 1
    })
    return Object.entries(counts)
      .map(([level, count]) => ({
        name: ACCESS_LEVEL_LABELS[Number(level)] ?? `L${level}`,
        value: count,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [auditRows])

  // Chunks returned histogram
  const chunksHistData = useMemo(() => {
    if (!auditRows) return []
    return CHUNK_BUCKETS.map((bucket) => {
      const count = auditRows.filter((r) => {
        const c = r.chunks_returned ?? 0
        return c >= bucket.min && c <= bucket.max
      }).length
      return { name: bucket.label, count }
    })
  }, [auditRows])

  // Slow query log (above P95)
  const slowQueries = useMemo(() => {
    if (!auditRows || p95 === 0) return []
    return auditRows
      .filter((r) => r.query_time_ms != null && (r.query_time_ms as number) > p95)
      .sort((a, b) => (b.query_time_ms as number) - (a.query_time_ms as number))
      .slice(0, 20)
  }, [auditRows, p95])

  // Queries by user (top 10)
  const { data: userStats, isLoading: loadingUsers } = useSupabaseQuery(
    ['analytics', 'by-user'],
    async (supabase) => {
      const { data } = await supabase
        .schema('delomemory')
        .from('access_audit_log')
        .select('user_id')
        .gte('created_at', thirtyDaysAgo)

      if (!data) return []
      const counts: Record<string, number> = {}
      data.forEach((r) => {
        const name = r.user_id ?? 'unknown'
        counts[name] = (counts[name] ?? 0) + 1
      })
      return Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([user, queries]) => ({ user, queries }))
    }
  )

  // Queries by tool
  const { data: toolStats, isLoading: loadingTools } = useSupabaseQuery(
    ['analytics', 'by-tool'],
    async (supabase) => {
      const { data } = await supabase
        .schema('delomemory')
        .from('access_audit_log')
        .select('tool_name')
        .gte('created_at', thirtyDaysAgo)

      if (!data) return []
      const counts: Record<string, number> = {}
      data.forEach((r) => {
        const tool = r.tool_name ?? 'unknown'
        counts[tool] = (counts[tool] ?? 0) + 1
      })
      return Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .map(([tool, count]) => ({ tool, count }))
    }
  )

  // Average response time trend (daily)
  const { data: timeTrend, isLoading: loadingTrend } = useSupabaseQuery(
    ['analytics', 'time-trend'],
    async (supabase) => {
      const { data } = await supabase
        .schema('delomemory')
        .from('access_audit_log')
        .select('created_at, query_time_ms')
        .gte('created_at', thirtyDaysAgo)
        .not('query_time_ms', 'is', null)
        .order('created_at', { ascending: true })

      if (!data || data.length === 0) return []

      const grouped: Record<string, { sum: number; count: number }> = {}
      for (let i = 0; i < 30; i++) {
        const day = format(subDays(new Date(), 29 - i), 'yyyy-MM-dd')
        grouped[day] = { sum: 0, count: 0 }
      }
      data.forEach((row) => {
        const day = format(new Date(row.created_at), 'yyyy-MM-dd')
        if (grouped[day]) {
          grouped[day].sum += row.query_time_ms ?? 0
          grouped[day].count++
        }
      })

      return Object.entries(grouped).map(([date, { sum, count }]) => ({
        date: format(new Date(date), 'MMM d'),
        avg_ms: count > 0 ? Math.round(sum / count) : 0,
      }))
    }
  )

  // Top entities accessed
  const { data: entityStats, isLoading: loadingEntities } = useSupabaseQuery(
    ['analytics', 'top-entities'],
    async (supabase) => {
      const { data } = await supabase
        .schema('delomemory')
        .from('entity_graph')
        .select('source_entity, target_entity')
        .limit(500)

      if (!data) return []
      const counts: Record<string, number> = {}
      data.forEach((r) => {
        if (r.source_entity) counts[r.source_entity] = (counts[r.source_entity] ?? 0) + 1
        if (r.target_entity) counts[r.target_entity] = (counts[r.target_entity] ?? 0) + 1
      })
      return Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([entity, connections]) => ({ entity, connections }))
    }
  )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Analytics</h1>
        <p className="text-muted-foreground">
          Usage patterns and performance insights (last 30 days)
        </p>
      </div>

      {/* Stat cards row */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="P50 Latency"
          value={`${p50}ms`}
          icon={Gauge}
          description="Median query duration"
          loading={loadingAudit}
        />
        <StatCard
          title="P95 Latency"
          value={`${p95}ms`}
          icon={Timer}
          description="95th percentile duration"
          loading={loadingAudit}
        />
        <StatCard
          title="Total Queries"
          value={totalQueries}
          icon={Activity}
          description="Last 30 days"
          loading={loadingAudit}
        />
        <StatCard
          title="Avg Latency"
          value={`${avgLatency}ms`}
          icon={Clock}
          description="Mean query duration"
          loading={loadingAudit}
        />
      </div>

      {/* Existing charts: Queries by User + Queries by Tool */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Queries by User */}
        <Card>
          <CardHeader>
            <CardTitle>Queries by User</CardTitle>
          </CardHeader>
          <CardContent>
            {loadingUsers ? (
              <Skeleton className="h-[300px] w-full" />
            ) : userStats && userStats.length > 0 ? (
              <div role="img" aria-label="Bar chart showing queries by user in the last 30 days">
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={userStats} layout="vertical">
                    <CartesianGrid
                      strokeDasharray="3 3"
                      className="stroke-border"
                      horizontal={false}
                    />
                    <XAxis type="number" fontSize={12} allowDecimals={false} />
                    <YAxis
                      dataKey="user"
                      type="category"
                      fontSize={12}
                      width={80}
                      tickLine={false}
                    />
                    <Tooltip />
                    <Bar
                      dataKey="queries"
                      fill="var(--color-chart-1)"
                      radius={[0, 4, 4, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="flex items-center justify-center h-[300px] text-muted-foreground">
                No user data available
              </div>
            )}
          </CardContent>
        </Card>

        {/* Queries by Tool */}
        <Card>
          <CardHeader>
            <CardTitle>Queries by Tool</CardTitle>
          </CardHeader>
          <CardContent>
            {loadingTools ? (
              <Skeleton className="h-[300px] w-full" />
            ) : toolStats && toolStats.length > 0 ? (
              <div role="img" aria-label="Pie chart showing query distribution by tool">
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={toolStats}
                      dataKey="count"
                      nameKey="tool"
                      cx="50%"
                      cy="50%"
                      outerRadius={100}
                      label={({ tool }) => tool}
                      fontSize={12}
                    >
                      {toolStats.map((_, i) => (
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
              <div className="flex items-center justify-center h-[300px] text-muted-foreground">
                No tool data available
              </div>
            )}
          </CardContent>
        </Card>

        {/* Response Time Trend */}
        <Card>
          <CardHeader>
            <CardTitle>Average Response Time</CardTitle>
          </CardHeader>
          <CardContent>
            {loadingTrend ? (
              <Skeleton className="h-[300px] w-full" />
            ) : timeTrend && timeTrend.length > 0 ? (
              <div role="img" aria-label="Line chart showing average response time trend over the last 30 days">
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={timeTrend}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      className="stroke-border"
                    />
                    <XAxis
                      dataKey="date"
                      fontSize={12}
                      tickLine={false}
                      axisLine={false}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      fontSize={12}
                      tickLine={false}
                      axisLine={false}
                      unit="ms"
                    />
                    <Tooltip formatter={(value: number) => `${value}ms`} />
                    <Line
                      type="monotone"
                      dataKey="avg_ms"
                      stroke="var(--color-chart-2)"
                      strokeWidth={2}
                      dot={false}
                      name="Avg response time"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="flex items-center justify-center h-[300px] text-muted-foreground">
                No timing data available
              </div>
            )}
          </CardContent>
        </Card>

        {/* Top Entities */}
        <Card>
          <CardHeader>
            <CardTitle>Top Connected Entities</CardTitle>
          </CardHeader>
          <CardContent>
            {loadingEntities ? (
              <Skeleton className="h-[300px] w-full" />
            ) : entityStats && entityStats.length > 0 ? (
              <div role="img" aria-label="Bar chart showing top entities by connection count">
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={entityStats}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      className="stroke-border"
                    />
                    <XAxis
                      dataKey="entity"
                      fontSize={11}
                      tickLine={false}
                      angle={-45}
                      textAnchor="end"
                      height={80}
                    />
                    <YAxis
                      fontSize={12}
                      tickLine={false}
                      axisLine={false}
                      allowDecimals={false}
                    />
                    <Tooltip />
                    <Bar
                      dataKey="connections"
                      fill="var(--color-chart-3)"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="flex items-center justify-center h-[300px] text-muted-foreground">
                No entity graph data available
              </div>
            )}
          </CardContent>
        </Card>

        {/* Access Level Distribution Pie */}
        <Card>
          <CardHeader>
            <CardTitle>Access Level Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            {loadingAudit ? (
              <Skeleton className="h-[300px] w-full" />
            ) : accessDistData.length > 0 ? (
              <div role="img" aria-label="Pie chart showing query distribution by access level">
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={accessDistData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={100}
                      label={({ name }) => name}
                      fontSize={12}
                    >
                      {accessDistData.map((_, i) => (
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
              <div className="flex items-center justify-center h-[300px] text-muted-foreground">
                No access level data available
              </div>
            )}
          </CardContent>
        </Card>

        {/* Chunks Returned Histogram */}
        <Card>
          <CardHeader>
            <CardTitle>Chunks Returned Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            {loadingAudit ? (
              <Skeleton className="h-[300px] w-full" />
            ) : chunksHistData.length > 0 ? (
              <div role="img" aria-label="Bar chart showing distribution of chunks returned per query">
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={chunksHistData}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      className="stroke-border"
                    />
                    <XAxis
                      dataKey="name"
                      fontSize={12}
                      tickLine={false}
                    />
                    <YAxis
                      fontSize={12}
                      tickLine={false}
                      axisLine={false}
                      allowDecimals={false}
                    />
                    <Tooltip />
                    <Bar
                      dataKey="count"
                      fill="var(--color-chart-4)"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="flex items-center justify-center h-[300px] text-muted-foreground">
                No chunk data available
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Slow Query Log — full width */}
      <Card>
        <CardHeader>
          <CardTitle>
            Slow Queries (above P95: {p95}ms)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loadingAudit ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : slowQueries.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Tool</TableHead>
                    <TableHead className="hidden lg:table-cell">Query</TableHead>
                    <TableHead className="text-right">Latency</TableHead>
                    <TableHead className="text-right">Chunks</TableHead>
                    <TableHead>Timestamp</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {slowQueries.map((row, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-sm">
                        {row.user_id ?? 'unknown'}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">
                          {row.tool_name ?? 'unknown'}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden lg:table-cell max-w-[300px] truncate text-sm text-muted-foreground">
                        {row.query_text ?? '-'}
                      </TableCell>
                      <TableCell className="text-right text-sm font-medium">
                        {row.query_time_ms}ms
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {row.chunks_returned ?? '-'}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm">
                        {format(new Date(row.created_at), 'MMM d, HH:mm:ss')}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="flex items-center justify-center h-32 text-muted-foreground">
              No slow queries detected
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
