'use client'

import { useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useSupabaseQuery } from '@/lib/hooks/use-supabase-query'
import { subDays, format } from 'date-fns'
import { AlertTriangle, DollarSign, TrendingDown, Activity, Cpu } from 'lucide-react'
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'

// ---------------------------------------------------------------------------
// Cost estimation model — based on OpenAI text-embedding-3-small pricing
// Update these constants when MCP server token instrumentation is deployed
// ---------------------------------------------------------------------------
const COST_MODEL = {
  avgTokensPerQuery: 200,
  avgTokensPerChunk: 150,
  embeddingCostPer1MTokens: 0.02,
  avgChunksProcessedPerQuery: 50,
}

function estimateQueryCost(model: typeof COST_MODEL): number {
  const queryTokens = model.avgTokensPerQuery
  const chunkTokens = model.avgChunksProcessedPerQuery * model.avgTokensPerChunk
  const totalTokens = queryTokens + chunkTokens
  return (totalTokens / 1_000_000) * model.embeddingCostPer1MTokens
}

const COST_PER_QUERY = estimateQueryCost(COST_MODEL)
const TOKENS_PER_QUERY =
  COST_MODEL.avgTokensPerQuery +
  COST_MODEL.avgChunksProcessedPerQuery * COST_MODEL.avgTokensPerChunk

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------
function formatCost(amount: number): string {
  if (amount < 0.01) return `$${amount.toFixed(4)}`
  return `$${amount.toFixed(2)}`
}

function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`
  return String(count)
}

// ---------------------------------------------------------------------------
// Stat card (same pattern as overview + analytics pages)
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Audit row type
// ---------------------------------------------------------------------------
interface AuditRow {
  user_id: string | null
  tool_name: string | null
  query_time_ms: number | null
  chunks_returned: number | null
  created_at: string
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------
export default function CostsPage() {
  const thirtyDaysAgo = subDays(new Date(), 30).toISOString()

  // Fetch audit data (same pattern as analytics page)
  const { data: auditData, isLoading } = useSupabaseQuery(
    ['costs-audit'],
    async (supabase) => {
      const { data, error } = await supabase
        .schema('delomemory')
        .from('access_audit_log')
        .select('user_id, tool_name, query_time_ms, chunks_returned, created_at')
        .gte('created_at', thirtyDaysAgo)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as AuditRow[]
    }
  )

  // -------------------------------------------------------------------------
  // Aggregated metrics
  // -------------------------------------------------------------------------
  const totalQueries30d = auditData?.length ?? 0

  const monthlyCost = useMemo(
    () => totalQueries30d * COST_PER_QUERY,
    [totalQueries30d]
  )

  const dailyCost = useMemo(
    () => (totalQueries30d > 0 ? monthlyCost / 30 : 0),
    [monthlyCost, totalQueries30d]
  )

  const totalTokens = useMemo(
    () => totalQueries30d * TOKENS_PER_QUERY,
    [totalQueries30d]
  )

  // Cache savings estimate (30% cache hit rate assumption)
  const cacheHitRate = 0.3
  const potentialSavings = useMemo(
    () => monthlyCost * cacheHitRate,
    [monthlyCost]
  )

  // -------------------------------------------------------------------------
  // Daily cost trend — group by day, 30-day window
  // -------------------------------------------------------------------------
  const dailyCostTrend = useMemo(() => {
    // Initialise all 30 days to 0
    const grouped: Record<string, number> = {}
    for (let i = 0; i < 30; i++) {
      const day = format(subDays(new Date(), 29 - i), 'yyyy-MM-dd')
      grouped[day] = 0
    }
    if (auditData) {
      auditData.forEach((row) => {
        const day = format(new Date(row.created_at), 'yyyy-MM-dd')
        if (grouped[day] !== undefined) grouped[day]++
      })
    }
    return Object.entries(grouped).map(([date, count]) => ({
      date: format(new Date(date), 'MMM d'),
      cost: Number((count * COST_PER_QUERY).toFixed(4)),
    }))
  }, [auditData])

  // -------------------------------------------------------------------------
  // Cost by tool — horizontal bar chart
  // -------------------------------------------------------------------------
  const costByTool = useMemo(() => {
    if (!auditData) return []
    const counts: Record<string, number> = {}
    auditData.forEach((r) => {
      const tool = r.tool_name ?? 'unknown'
      counts[tool] = (counts[tool] ?? 0) + 1
    })
    return Object.entries(counts)
      .map(([tool, count]) => ({
        tool,
        cost: Number((count * COST_PER_QUERY).toFixed(4)),
      }))
      .sort((a, b) => b.cost - a.cost)
  }, [auditData])

  // -------------------------------------------------------------------------
  // Cost by user — horizontal bar chart
  // -------------------------------------------------------------------------
  const costByUser = useMemo(() => {
    if (!auditData) return []
    const counts: Record<string, number> = {}
    auditData.forEach((r) => {
      const user = r.user_id ?? 'unknown'
      counts[user] = (counts[user] ?? 0) + 1
    })
    return Object.entries(counts)
      .map(([user, count]) => ({
        user,
        cost: Number((count * COST_PER_QUERY).toFixed(4)),
      }))
      .sort((a, b) => b.cost - a.cost)
  }, [auditData])

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <div className="space-y-6">
      {/* Page heading */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Cost & Token Tracker
        </h1>
        <p className="text-muted-foreground">
          Estimated embedding costs and token usage (last 30 days)
        </p>
      </div>

      {/* Estimation banner */}
      <Card className="border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/50">
        <CardContent className="p-4 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium">Estimated Costs</p>
            <p className="text-sm text-muted-foreground">
              Token counts are estimated using heuristics (~200 tokens/query,
              ~150 tokens/chunk). Actual costs will be available after MCP
              server token instrumentation is deployed.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Summary stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Est. Monthly Cost"
          value={formatCost(monthlyCost)}
          icon={DollarSign}
          description="Based on 30-day query volume"
          loading={isLoading}
        />
        <StatCard
          title="Est. Daily Cost"
          value={formatCost(dailyCost)}
          icon={DollarSign}
          description="Average over last 30 days"
          loading={isLoading}
        />
        <StatCard
          title="Total Queries (30d)"
          value={totalQueries30d}
          icon={Activity}
          description="Queries in the last 30 days"
          loading={isLoading}
        />
        <StatCard
          title="Est. Tokens Used"
          value={formatTokens(totalTokens)}
          icon={Cpu}
          description={`~${TOKENS_PER_QUERY.toLocaleString()} tokens/query`}
          loading={isLoading}
        />
      </div>

      {/* Daily cost trend — line chart */}
      <Card>
        <CardHeader>
          <CardTitle>Daily Cost Trend</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-[300px] w-full" />
          ) : dailyCostTrend.length > 0 ? (
            <div
              role="img"
              aria-label="Line chart showing estimated daily embedding cost over the last 30 days"
            >
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={dailyCostTrend}>
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
                    tickFormatter={(v: number) => `$${v}`}
                  />
                  <Tooltip
                    formatter={(value: number) => [`$${value.toFixed(4)}`, 'Est. Cost']}
                  />
                  <Line
                    type="monotone"
                    dataKey="cost"
                    stroke="var(--color-chart-1)"
                    strokeWidth={2}
                    dot={false}
                    name="Est. Cost"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex items-center justify-center h-[300px] text-muted-foreground">
              No cost data available
            </div>
          )}
        </CardContent>
      </Card>

      {/* Cost by Tool + Cost by User — 2-column grid */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Cost by Tool */}
        <Card>
          <CardHeader>
            <CardTitle>Cost by Tool</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-[300px] w-full" />
            ) : costByTool.length > 0 ? (
              <div
                role="img"
                aria-label="Horizontal bar chart showing estimated cost by MCP tool"
              >
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={costByTool} layout="vertical">
                    <CartesianGrid
                      strokeDasharray="3 3"
                      className="stroke-border"
                      horizontal={false}
                    />
                    <XAxis
                      type="number"
                      fontSize={12}
                      tickFormatter={(v: number) => `$${v}`}
                    />
                    <YAxis
                      dataKey="tool"
                      type="category"
                      fontSize={12}
                      width={120}
                      tickLine={false}
                    />
                    <Tooltip
                      formatter={(value: number) => [`$${value.toFixed(4)}`, 'Est. Cost']}
                    />
                    <Bar
                      dataKey="cost"
                      fill="var(--color-chart-2)"
                      radius={[0, 4, 4, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="flex items-center justify-center h-[300px] text-muted-foreground">
                No tool cost data available
              </div>
            )}
          </CardContent>
        </Card>

        {/* Cost by User */}
        <Card>
          <CardHeader>
            <CardTitle>Cost by User</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-[300px] w-full" />
            ) : costByUser.length > 0 ? (
              <div
                role="img"
                aria-label="Horizontal bar chart showing estimated cost by user"
              >
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={costByUser} layout="vertical">
                    <CartesianGrid
                      strokeDasharray="3 3"
                      className="stroke-border"
                      horizontal={false}
                    />
                    <XAxis
                      type="number"
                      fontSize={12}
                      tickFormatter={(v: number) => `$${v}`}
                    />
                    <YAxis
                      dataKey="user"
                      type="category"
                      fontSize={12}
                      width={80}
                      tickLine={false}
                    />
                    <Tooltip
                      formatter={(value: number) => [`$${value.toFixed(4)}`, 'Est. Cost']}
                    />
                    <Bar
                      dataKey="cost"
                      fill="var(--color-chart-3)"
                      radius={[0, 4, 4, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="flex items-center justify-center h-[300px] text-muted-foreground">
                No user cost data available
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Cache savings estimate */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle>Cache Savings Estimate</CardTitle>
          <TrendingDown className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                If 30% of queries were cached, estimated monthly savings:
              </p>
              <p className="text-3xl font-bold text-green-600 dark:text-green-400">
                {formatCost(potentialSavings)}
              </p>
              <p className="text-xs text-muted-foreground">
                Based on a {Math.round(cacheHitRate * 100)}% estimated cache
                hit rate applied to {totalQueries30d.toLocaleString()} queries
                at {formatCost(COST_PER_QUERY)}/query
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
