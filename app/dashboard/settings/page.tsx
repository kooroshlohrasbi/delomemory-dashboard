'use client'

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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useSupabaseQuery } from '@/lib/hooks/use-supabase-query'
import { Shield, Database, FileText } from 'lucide-react'

const ACCESS_LEVEL_LABELS: Record<number, string> = {
  1: 'L1 - Read Only',
  2: 'L2 - Standard',
  3: 'L3 - Elevated',
  4: 'L4 - Admin',
}

export default function SettingsPage() {
  // API keys / user access
  const { data: apiKeys, isLoading: loadingKeys } = useSupabaseQuery(
    ['settings', 'api-keys'],
    async (supabase) => {
      const { data } = await supabase
        .schema('delomemory')
        .from('api_keys')
        .select('*')
        .order('access_level', { ascending: false })
      return data ?? []
    }
  )

  // Corpus health: file counts
  const { data: corpusHealth, isLoading: loadingCorpus } = useSupabaseQuery(
    ['settings', 'corpus-health'],
    async (supabase) => {
      const [files, chunks, entities, edges] = await Promise.all([
        supabase
          .schema('delomemory')
          .from('knowledge_files')
          .select('*', { count: 'exact', head: true }),
        supabase
          .schema('delomemory')
          .from('knowledge_chunks')
          .select('*', { count: 'exact', head: true }),
        supabase
          .schema('delomemory')
          .from('entity_descriptions')
          .select('*', { count: 'exact', head: true }),
        supabase
          .schema('delomemory')
          .from('entity_graph')
          .select('*', { count: 'exact', head: true }),
      ])
      return {
        files: files.count ?? 0,
        chunks: chunks.count ?? 0,
        entities: entities.count ?? 0,
        edges: edges.count ?? 0,
      }
    }
  )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">
          System administration (L4 access required)
        </p>
      </div>

      <Tabs defaultValue="users">
        <TabsList>
          <TabsTrigger value="users" className="gap-2">
            <Shield className="h-4 w-4" />
            Users
          </TabsTrigger>
          <TabsTrigger value="corpus" className="gap-2">
            <Database className="h-4 w-4" />
            Corpus Health
          </TabsTrigger>
        </TabsList>

        <TabsContent value="users" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>User Access Registry</CardTitle>
            </CardHeader>
            <CardContent>
              {loadingKeys ? (
                <div className="space-y-3">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : apiKeys && apiKeys.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>User</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Access Level</TableHead>
                      <TableHead>API Key</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {apiKeys.map((key) => (
                      <TableRow key={key.id}>
                        <TableCell className="font-medium">
                          {key.user_id}
                        </TableCell>
                        <TableCell className="text-sm">
                          {key.user_id}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              key.access_level >= 4
                                ? 'default'
                                : key.access_level >= 3
                                  ? 'secondary'
                                  : 'outline'
                            }
                          >
                            {ACCESS_LEVEL_LABELS[key.access_level] ??
                              `L${key.access_level}`}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {key.api_key
                            ? `${key.api_key.slice(0, 8)}...`
                            : '-'}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={key.is_active ? 'default' : 'destructive'}
                          >
                            {key.is_active ? 'Active' : 'Inactive'}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="flex items-center justify-center h-32 text-muted-foreground">
                  No API keys configured
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="corpus" className="mt-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">
                  Knowledge Files
                </CardTitle>
                <FileText className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                {loadingCorpus ? (
                  <Skeleton className="h-8 w-16" />
                ) : (
                  <div className="text-2xl font-bold">
                    {corpusHealth?.files}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">
                  Indexed Chunks
                </CardTitle>
                <Database className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                {loadingCorpus ? (
                  <Skeleton className="h-8 w-16" />
                ) : (
                  <div className="text-2xl font-bold">
                    {corpusHealth?.chunks}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">Entities</CardTitle>
                <Shield className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                {loadingCorpus ? (
                  <Skeleton className="h-8 w-16" />
                ) : (
                  <div className="text-2xl font-bold">
                    {corpusHealth?.entities}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">
                  Graph Edges
                </CardTitle>
                <Shield className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                {loadingCorpus ? (
                  <Skeleton className="h-8 w-16" />
                ) : (
                  <div className="text-2xl font-bold">
                    {corpusHealth?.edges}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
