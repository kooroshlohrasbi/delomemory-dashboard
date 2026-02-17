'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useSupabaseQuery } from '@/lib/hooks/use-supabase-query'
import { Activity, Users, Timer, Database } from 'lucide-react'
import { subDays, format } from 'date-fns'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'

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

export default function DashboardPage() {
  const sevenDaysAgo = subDays(new Date(), 7).toISOString()
  const thirtyDaysAgo = subDays(new Date(), 30).toISOString()

  // Total queries in last 7 days
  const { data: queryCount, isLoading: loadingQueries } = useSupabaseQuery(
    ['stats', 'query-count-7d'],
    async (supabase) => {
      const { count } = await supabase
        .schema('delomemory')
        .from('access_audit_log')
        .select('*', { count: 'exact', head: true })
        .gte('timestamp', sevenDaysAgo)
      return count ?? 0
    }
  )

  // Unique users in last 7 days
  const { data: uniqueUsers, isLoading: loadingUsers } = useSupabaseQuery(
    ['stats', 'unique-users-7d'],
    async (supabase) => {
      const { data } = await supabase
        .schema('delomemory')
        .from('access_audit_log')
        .select('user_id')
        .gte('timestamp', sevenDaysAgo)
      if (!data) return 0
      return new Set(data.map((r) => r.user_id)).size
    }
  )

  // Average response time
  const { data: avgTime, isLoading: loadingTime } = useSupabaseQuery(
    ['stats', 'avg-time-7d'],
    async (supabase) => {
      const { data } = await supabase
        .schema('delomemory')
        .from('access_audit_log')
        .select('duration_ms')
        .gte('timestamp', sevenDaysAgo)
        .not('duration_ms', 'is', null)
      if (!data || data.length === 0) return 'N/A'
      const avg =
        data.reduce((sum, r) => sum + (r.duration_ms ?? 0), 0) / data.length
      return `${Math.round(avg)}ms`
    }
  )

  // Corpus file count
  const { data: corpusCount, isLoading: loadingCorpus } = useSupabaseQuery(
    ['stats', 'corpus-count'],
    async (supabase) => {
      const { count } = await supabase
        .schema('delomemory')
        .from('knowledge_files')
        .select('*', { count: 'exact', head: true })
      return count ?? 0
    }
  )

  // Query trend (last 30 days, grouped by day)
  const { data: trendData, isLoading: loadingTrend } = useSupabaseQuery(
    ['stats', 'query-trend-30d'],
    async (supabase) => {
      const { data } = await supabase
        .schema('delomemory')
        .from('access_audit_log')
        .select('timestamp')
        .gte('timestamp', thirtyDaysAgo)
        .order('timestamp', { ascending: true })

      if (!data || data.length === 0) return []

      // Group by day
      const grouped: Record<string, number> = {}
      for (let i = 0; i < 30; i++) {
        const day = format(subDays(new Date(), 29 - i), 'yyyy-MM-dd')
        grouped[day] = 0
      }
      data.forEach((row) => {
        const day = format(new Date(row.timestamp), 'yyyy-MM-dd')
        if (grouped[day] !== undefined) grouped[day]++
      })

      return Object.entries(grouped).map(([date, count]) => ({
        date: format(new Date(date), 'MMM d'),
        queries: count,
      }))
    }
  )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">
          DeloMemory MCP usage overview
        </p>
      </div>

      {/* Stats grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Queries (7d)"
          value={queryCount ?? 0}
          icon={Activity}
          description="Total MCP queries"
          loading={loadingQueries}
        />
        <StatCard
          title="Unique Users (7d)"
          value={uniqueUsers ?? 0}
          icon={Users}
          description="Active Delos"
          loading={loadingUsers}
        />
        <StatCard
          title="Avg Response"
          value={avgTime ?? 'N/A'}
          icon={Timer}
          description="Mean query duration"
          loading={loadingTime}
        />
        <StatCard
          title="Corpus Files"
          value={corpusCount ?? 0}
          icon={Database}
          description="Knowledge files indexed"
          loading={loadingCorpus}
        />
      </div>

      {/* Query trend chart */}
      <Card>
        <CardHeader>
          <CardTitle>Query Volume (Last 30 Days)</CardTitle>
        </CardHeader>
        <CardContent>
          {loadingTrend ? (
            <Skeleton className="h-[300px] w-full" />
          ) : trendData && trendData.length > 0 ? (
            <div role="img" aria-label="Line chart showing query volume trend for the last 30 days">
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
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
                    allowDecimals={false}
                  />
                  <Tooltip />
                  <Line
                    type="monotone"
                    dataKey="queries"
                    stroke="var(--color-primary)"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex items-center justify-center h-[300px] text-muted-foreground">
              No query data available yet
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
