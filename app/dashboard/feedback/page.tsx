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
import { Info, Activity, AlertTriangle, Timer, Filter } from 'lucide-react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'

interface AuditRow {
  user_id: string | null
  tool_name: string | null
  query_text: string | null
  query_time_ms: number | null
  chunks_returned: number | null
  chunks_filtered: number | null
  access_level: number
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

export default function FeedbackPage() {
  const { data: auditData, isLoading } = useSupabaseQuery(
    ['feedback-audit'],
    async (supabase) => {
      const { data, error } = await supabase
        .schema('delomemory')
        .from('access_audit_log')
        .select('user_id, tool_name, query_text, query_time_ms, chunks_returned, chunks_filtered, access_level, created_at')
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as AuditRow[]
    }
  )

  // P95 latency threshold for "high-latency" classification
  const p95 = useMemo(() => {
    if (!auditData) return 0
    const timings = auditData
      .filter((r) => r.query_time_ms != null)
      .map((r) => r.query_time_ms as number)
    return percentile(timings, 95)
  }, [auditData])

  // Panel 1: Quality stat cards
  const stats = useMemo(() => {
    if (!auditData || auditData.length === 0) {
      return { total: 0, zeroResultRate: '0%', avgLatency: '0ms', heavyFilterRate: '0%' }
    }

    const total = auditData.length
    const zeroResult = auditData.filter((r) => r.chunks_returned === 0).length
    const zeroResultRate = `${Math.round((zeroResult / total) * 100)}%`

    const timings = auditData.filter((r) => r.query_time_ms != null)
    const avgLatency = timings.length > 0
      ? `${Math.round(timings.reduce((s, r) => s + (r.query_time_ms as number), 0) / timings.length)}ms`
      : 'N/A'

    const heavyFilter = auditData.filter((r) => {
      const returned = r.chunks_returned ?? 0
      const filtered = r.chunks_filtered ?? 0
      const total = returned + filtered
      return total > 0 && filtered / total > 0.8
    }).length
    const heavyFilterRate = `${Math.round((heavyFilter / total) * 100)}%`

    return { total, zeroResultRate, avgLatency, heavyFilterRate }
  }, [auditData])

  // Panel 2: Quality trend — daily zero-result rate (30 days)
  const trendData = useMemo(() => {
    if (!auditData) return []
    const thirtyDaysAgo = subDays(new Date(), 30)
    const daily = new Map<string, { total: number; zeroResult: number }>()
    for (const row of auditData) {
      const created = new Date(row.created_at)
      if (created < thirtyDaysAgo) continue
      const date = format(created, 'yyyy-MM-dd')
      const entry = daily.get(date) ?? { total: 0, zeroResult: 0 }
      entry.total++
      if (row.chunks_returned === 0) entry.zeroResult++
      daily.set(date, entry)
    }
    return Array.from(daily.entries())
      .map(([date, { total, zeroResult }]) => ({
        date: format(new Date(date), 'MMM d'),
        rawDate: date,
        rate: total > 0 ? Math.round((zeroResult / total) * 100) : 0,
      }))
      .sort((a, b) => a.rawDate.localeCompare(b.rawDate))
  }, [auditData])

  // Panel 3: Problem queries — zero-result OR high-latency
  const problemQueries = useMemo(() => {
    if (!auditData) return []
    return auditData
      .map((row) => {
        const issues: string[] = []
        if (row.chunks_returned === 0) issues.push('Zero Results')
        if (row.query_time_ms != null && p95 > 0 && (row.query_time_ms as number) > p95) {
          issues.push('High Latency')
        }
        return issues.length > 0 ? { ...row, issues } : null
      })
      .filter((r): r is AuditRow & { issues: string[] } => r !== null)
      .slice(0, 30)
  }, [auditData, p95])

  // Panel 4: Per-user search quality
  const userQuality = useMemo(() => {
    if (!auditData) return []
    const grouped: Record<string, {
      total: number
      zeroResult: number
      totalChunks: number
      totalMs: number
      timingCount: number
    }> = {}

    for (const row of auditData) {
      const uid = row.user_id ?? 'unknown'
      if (!grouped[uid]) {
        grouped[uid] = { total: 0, zeroResult: 0, totalChunks: 0, totalMs: 0, timingCount: 0 }
      }
      grouped[uid].total++
      if (row.chunks_returned === 0) grouped[uid].zeroResult++
      grouped[uid].totalChunks += row.chunks_returned ?? 0
      if (row.query_time_ms != null) {
        grouped[uid].totalMs += row.query_time_ms as number
        grouped[uid].timingCount++
      }
    }

    return Object.entries(grouped)
      .map(([user, s]) => ({
        user,
        queries: s.total,
        zeroResult: s.zeroResult,
        zeroResultRate: s.total > 0 ? Math.round((s.zeroResult / s.total) * 100) : 0,
        avgChunks: s.total > 0 ? Math.round((s.totalChunks / s.total) * 10) / 10 : 0,
        avgLatency: s.timingCount > 0 ? Math.round(s.totalMs / s.timingCount) : 0,
      }))
      .sort((a, b) => b.zeroResultRate - a.zeroResultRate)
  }, [auditData])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Search Feedback Review
        </h1>
        <p className="text-muted-foreground">
          Search quality metrics and feedback trends
        </p>
      </div>

      {/* Migration Banner */}
      <Card className="border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/50">
        <CardContent className="p-4 flex items-start gap-3">
          <Info className="h-5 w-5 text-blue-500 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium">Feedback Collection Coming Soon</p>
            <p className="text-sm text-muted-foreground">
              Full feedback ratings and text comments require the <code className="text-xs bg-muted px-1 rounded">query_logs</code> table migration.
              Current data shows search quality proxies from the audit log.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Panel 1: Quality Stat Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Queries"
          value={stats.total}
          icon={Activity}
          description="All audit log entries"
          loading={isLoading}
        />
        <StatCard
          title="Zero-Result Rate"
          value={stats.zeroResultRate}
          icon={AlertTriangle}
          description="Queries returning no chunks"
          loading={isLoading}
        />
        <StatCard
          title="Avg Latency"
          value={stats.avgLatency}
          icon={Timer}
          description="Mean query duration"
          loading={isLoading}
        />
        <StatCard
          title="Heavy-Filter Rate"
          value={stats.heavyFilterRate}
          icon={Filter}
          description="Queries with >80% chunks filtered"
          loading={isLoading}
        />
      </div>

      {/* Panel 2: Quality Trend Chart */}
      <Card>
        <CardHeader>
          <CardTitle>Zero-Result Rate Trend (30 Days)</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-[300px] w-full" />
          ) : trendData.length > 0 ? (
            <div role="img" aria-label="Line chart showing daily zero-result rate over the last 30 days">
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={trendData}>
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
                    unit="%"
                    domain={[0, 100]}
                  />
                  <Tooltip formatter={(value: number) => `${value}%`} />
                  <Line
                    type="monotone"
                    dataKey="rate"
                    stroke="var(--color-chart-1)"
                    strokeWidth={2}
                    dot={false}
                    name="Zero-result rate"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex items-center justify-center h-[300px] text-muted-foreground">
              No trend data available
            </div>
          )}
        </CardContent>
      </Card>

      {/* Panel 3: Problem Queries Table */}
      <Card>
        <CardHeader>
          <CardTitle>
            Problem Queries
            {problemQueries.length > 0 && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                ({problemQueries.length} issues found)
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : problemQueries.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Tool</TableHead>
                    <TableHead className="hidden lg:table-cell">Query</TableHead>
                    <TableHead className="text-right">Chunks</TableHead>
                    <TableHead className="text-right">Latency</TableHead>
                    <TableHead>Issue</TableHead>
                    <TableHead>Timestamp</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {problemQueries.map((row, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-sm">
                        {row.user_id ?? 'unknown'}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">
                          {row.tool_name ?? 'unknown'}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden lg:table-cell max-w-[250px] truncate text-sm text-muted-foreground">
                        {row.query_text ?? '-'}
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {row.chunks_returned ?? '-'}
                      </TableCell>
                      <TableCell className="text-right text-sm font-medium">
                        {row.query_time_ms != null ? `${row.query_time_ms}ms` : '-'}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {row.issues.map((issue) => (
                            <Badge
                              key={issue}
                              variant={issue === 'Zero Results' ? 'destructive' : 'default'}
                            >
                              {issue}
                            </Badge>
                          ))}
                        </div>
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
              No problem queries detected
            </div>
          )}
        </CardContent>
      </Card>

      {/* Panel 4: Per-User Search Quality */}
      <Card>
        <CardHeader>
          <CardTitle>Per-User Search Quality</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : userQuality.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead className="text-right">Queries</TableHead>
                    <TableHead className="text-right">Zero-Result</TableHead>
                    <TableHead className="text-right">Zero-Result Rate</TableHead>
                    <TableHead className="text-right">Avg Chunks</TableHead>
                    <TableHead className="text-right">Avg Latency</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {userQuality.map((row) => (
                    <TableRow key={row.user}>
                      <TableCell className="text-sm font-medium">
                        {row.user}
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {row.queries}
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {row.zeroResult}
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        <Badge
                          variant={row.zeroResultRate > 50 ? 'destructive' : row.zeroResultRate > 20 ? 'default' : 'secondary'}
                        >
                          {row.zeroResultRate}%
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {row.avgChunks}
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {row.avgLatency}ms
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="flex items-center justify-center h-32 text-muted-foreground">
              No user data available
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
