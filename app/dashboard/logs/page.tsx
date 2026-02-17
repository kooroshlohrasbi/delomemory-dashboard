'use client'

import { useState } from 'react'
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
import { ChevronLeft, ChevronRight } from 'lucide-react'

const PAGE_SIZE = 25

export default function LogsPage() {
  const [page, setPage] = useState(0)
  const [toolFilter, setToolFilter] = useState<string | null>(null)

  const { data, isLoading } = useSupabaseQuery(
    ['logs', String(page), toolFilter ?? 'all'],
    async (supabase) => {
      let query = supabase
        .schema('delomemory')
        .from('access_audit_log')
        .select('*', { count: 'exact' })
        .order('timestamp', { ascending: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

      if (toolFilter) {
        query = query.eq('tool_name', toolFilter)
      }

      const { data, count } = await query
      return { rows: data ?? [], total: count ?? 0 }
    }
  )

  // Fetch distinct tool names for filter
  const { data: tools } = useSupabaseQuery(['log-tools'], async (supabase) => {
    const { data } = await supabase
      .schema('delomemory')
      .from('access_audit_log')
      .select('tool_name')
    if (!data) return []
    return [...new Set(data.map((r) => r.tool_name).filter(Boolean))] as string[]
  })

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Query Logs</h1>
        <p className="text-muted-foreground">
          Audit trail of all MCP tool invocations
        </p>
      </div>

      {/* Tool filter */}
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
                            new Date(row.timestamp),
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
                          {row.duration_ms != null
                            ? `${row.duration_ms}ms`
                            : '-'}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              row.access_granted ? 'default' : 'destructive'
                            }
                          >
                            {row.access_granted ? 'OK' : 'DENIED'}
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
