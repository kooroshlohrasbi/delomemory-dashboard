'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useSupabaseQuery } from '@/lib/hooks/use-supabase-query'
import { subDays, format } from 'date-fns'
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

export default function AnalyticsPage() {
  const thirtyDaysAgo = subDays(new Date(), 30).toISOString()

  // Queries by user (top 10)
  const { data: userStats, isLoading: loadingUsers } = useSupabaseQuery(
    ['analytics', 'by-user'],
    async (supabase) => {
      const { data } = await supabase
        .schema('delomemory')
        .from('access_audit_log')
        .select('user_id')
        .gte('timestamp', thirtyDaysAgo)

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
        .gte('timestamp', thirtyDaysAgo)

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
        .select('timestamp, duration_ms')
        .gte('timestamp', thirtyDaysAgo)
        .not('duration_ms', 'is', null)
        .order('timestamp', { ascending: true })

      if (!data || data.length === 0) return []

      const grouped: Record<string, { sum: number; count: number }> = {}
      for (let i = 0; i < 30; i++) {
        const day = format(subDays(new Date(), 29 - i), 'yyyy-MM-dd')
        grouped[day] = { sum: 0, count: 0 }
      }
      data.forEach((row) => {
        const day = format(new Date(row.timestamp), 'yyyy-MM-dd')
        if (grouped[day]) {
          grouped[day].sum += row.duration_ms ?? 0
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
      </div>
    </div>
  )
}
