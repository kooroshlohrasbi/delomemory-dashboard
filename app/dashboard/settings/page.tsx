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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useSupabaseQuery } from '@/lib/hooks/use-supabase-query'
import { createClient } from '@/lib/supabase/client'
import { Shield, Database, FileText, UserPlus, Trash2, Loader2, Flame, Snowflake, Unlink } from 'lucide-react'

// --- Corpus Health types ---

interface KnowledgeFileRow {
  domain: string
  file_modified: string | null
}

interface AuditLogRow {
  query_text: string | null
  tool_name: string | null
  created_at: string
}

interface EntityRow {
  code: string
  canonical_name: string
  entity_type: string
}

interface ChunkRow {
  entity_codes: string[] | null
}

type AgeBucket = '<7d' | '7-30d' | '30-90d' | '>90d'

const AGE_BUCKETS: AgeBucket[] = ['<7d', '7-30d', '30-90d', '>90d']
const AGE_BUCKET_LABELS: Record<AgeBucket, string> = {
  '<7d': 'Fresh (<7d)',
  '7-30d': 'Recent (7-30d)',
  '30-90d': 'Aging (30-90d)',
  '>90d': 'Stale (>90d)',
}
const AGE_BUCKET_COLORS: Record<AgeBucket, string> = {
  '<7d': 'bg-green-500',
  '7-30d': 'bg-yellow-500',
  '30-90d': 'bg-orange-500',
  '>90d': 'bg-red-500',
}

function getAgeBucket(fileModified: string | null): AgeBucket {
  if (!fileModified) return '>90d'
  const now = Date.now()
  const modified = new Date(fileModified).getTime()
  const daysDiff = (now - modified) / (1000 * 60 * 60 * 24)
  if (daysDiff < 7) return '<7d'
  if (daysDiff < 30) return '7-30d'
  if (daysDiff < 90) return '30-90d'
  return '>90d'
}

const ACCESS_LEVEL_LABELS: Record<number, string> = {
  1: 'L1 - Read Only',
  2: 'L2 - Standard',
  3: 'L3 - Elevated',
  4: 'L4 - Admin',
}

const ACCESS_LEVELS = [1, 2, 3, 4] as const

/** Generate a random hex string of given byte length */
function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes)
  crypto.getRandomValues(arr)
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('')
}

interface ApiKeyRow {
  id: number
  key_hash: string
  key_prefix: string
  user_id: string
  access_level: number
  display_name: string
  is_active: boolean
  created_at: string
  expires_at: string | null
  last_used_at: string | null
  revoked_at: string | null
  revoke_reason: string | null
  created_by: string
  description: string | null
}

export default function SettingsPage() {
  // --- Invite form state ---
  const [newUserId, setNewUserId] = useState('')
  const [newDisplayName, setNewDisplayName] = useState('')
  const [newAccessLevel, setNewAccessLevel] = useState(2)
  const [isInviting, setIsInviting] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)

  // --- Row-level mutation state ---
  const [mutatingRows, setMutatingRows] = useState<Set<string>>(new Set())

  // API keys / user access
  const { data: apiKeys, isLoading: loadingKeys, refetch: refetchKeys } = useSupabaseQuery<ApiKeyRow[]>(
    ['settings', 'api-keys'],
    async (supabase) => {
      const { data } = await supabase
        .schema('delomemory')
        .from('api_keys')
        .select('*')
        .order('access_level', { ascending: false })
      return (data as ApiKeyRow[]) ?? []
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

  // --- Corpus Health: Staleness heatmap data ---
  const { data: stalenessFiles, isLoading: loadingStaleness } = useSupabaseQuery<KnowledgeFileRow[]>(
    ['corpus-staleness'],
    async (supabase) => {
      const { data, error } = await supabase
        .schema('delomemory')
        .from('knowledge_files')
        .select('domain, file_modified')
      if (error) throw error
      return (data as KnowledgeFileRow[]) ?? []
    }
  )

  // --- Corpus Health: Hot files (audit log activity) ---
  const { data: auditData, isLoading: loadingAudit } = useSupabaseQuery<AuditLogRow[]>(
    ['corpus-hot'],
    async (supabase) => {
      const { data, error } = await supabase
        .schema('delomemory')
        .from('access_audit_log')
        .select('query_text, tool_name, created_at')
      if (error) throw error
      return (data as AuditLogRow[]) ?? []
    }
  )

  // --- Corpus Health: Orphan entities ---
  const { data: allEntities, isLoading: loadingEntities } = useSupabaseQuery<EntityRow[]>(
    ['corpus-orphans-entities'],
    async (supabase) => {
      const { data, error } = await supabase
        .schema('delomemory')
        .from('entity_descriptions')
        .select('code, canonical_name, entity_type')
      if (error) throw error
      return (data as EntityRow[]) ?? []
    }
  )

  const { data: allChunks, isLoading: loadingChunks } = useSupabaseQuery<ChunkRow[]>(
    ['corpus-orphans-chunks'],
    async (supabase) => {
      const { data, error } = await supabase
        .schema('delomemory')
        .from('knowledge_chunks')
        .select('entity_codes')
      if (error) throw error
      return (data as ChunkRow[]) ?? []
    }
  )

  // --- Derived data: staleness heatmap ---
  const stalenessGrid = useMemo(() => {
    if (!stalenessFiles) return null
    const grid: Record<string, Record<AgeBucket, number>> = {}
    for (const file of stalenessFiles) {
      const domain = file.domain || 'unknown'
      if (!grid[domain]) {
        grid[domain] = { '<7d': 0, '7-30d': 0, '30-90d': 0, '>90d': 0 }
      }
      grid[domain][getAgeBucket(file.file_modified)]++
    }
    const sorted = Object.entries(grid).sort((a, b) => a[0].localeCompare(b[0]))
    return sorted
  }, [stalenessFiles])

  // --- Derived data: hot files (top 20 tool+query combos) ---
  const hotFiles = useMemo(() => {
    if (!auditData) return null
    const counts: Record<string, number> = {}
    for (const row of auditData) {
      const tool = row.tool_name ?? 'unknown'
      counts[tool] = (counts[tool] ?? 0) + 1
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([tool, count]) => ({ tool, count }))
  }, [auditData])

  // --- Derived data: cold files (domains with zero audit log hits) ---
  const coldDomains = useMemo(() => {
    if (!stalenessFiles || !auditData) return null
    const allDomains = new Set(stalenessFiles.map((f) => f.domain || 'unknown'))
    const queriedTerms = new Set(
      auditData.map((r) => r.tool_name ?? '').filter(Boolean)
    )
    // A domain is "cold" if no tool_name references it
    const cold: Array<{ domain: string; fileCount: number }> = []
    const domainFileCounts: Record<string, number> = {}
    for (const file of stalenessFiles) {
      const d = file.domain || 'unknown'
      domainFileCounts[d] = (domainFileCounts[d] ?? 0) + 1
    }
    for (const domain of allDomains) {
      // Check if any audit log tool_name contains the domain name
      const isQueried = [...queriedTerms].some(
        (term) => term.toLowerCase().includes(domain.toLowerCase()) || domain.toLowerCase().includes(term.toLowerCase())
      )
      if (!isQueried) {
        cold.push({ domain, fileCount: domainFileCounts[domain] ?? 0 })
      }
    }
    return cold.sort((a, b) => b.fileCount - a.fileCount)
  }, [stalenessFiles, auditData])

  // --- Derived data: orphan entities ---
  const orphanEntities = useMemo(() => {
    if (!allEntities || !allChunks) return null
    const referencedCodes = new Set<string>()
    for (const chunk of allChunks) {
      if (chunk.entity_codes) {
        for (const code of chunk.entity_codes) {
          referencedCodes.add(code)
        }
      }
    }
    return allEntities.filter((e) => !referencedCodes.has(e.code))
  }, [allEntities, allChunks])

  // --- Mutations ---

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    const trimmedId = newUserId.trim().toLowerCase()
    const trimmedName = newDisplayName.trim()
    if (!trimmedId || !trimmedName) return

    // Check for duplicate user_id
    if (apiKeys?.some((k) => k.user_id === trimmedId)) {
      setInviteError(`User "${trimmedId}" already exists`)
      return
    }

    setIsInviting(true)
    setInviteError(null)

    try {
      const supabase = createClient()
      const keyBytes = randomHex(32)
      const prefix = `sk-dm-${keyBytes.slice(0, 2)}`

      const { error } = await supabase
        .schema('delomemory')
        .from('api_keys')
        .insert({
          key_hash: keyBytes,
          key_prefix: prefix,
          user_id: trimmedId,
          display_name: trimmedName,
          access_level: newAccessLevel,
          created_by: 'dashboard',
        })

      if (error) throw error

      setNewUserId('')
      setNewDisplayName('')
      setNewAccessLevel(2)
      await refetchKeys()
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : 'Failed to add user')
    } finally {
      setIsInviting(false)
    }
  }

  async function handleUpdateAccessLevel(userId: string, level: number) {
    setMutatingRows((prev) => new Set(prev).add(userId))
    try {
      const supabase = createClient()
      const { error } = await supabase
        .schema('delomemory')
        .from('api_keys')
        .update({ access_level: level })
        .eq('user_id', userId)
      if (error) throw error
      await refetchKeys()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update access level')
    } finally {
      setMutatingRows((prev) => {
        const next = new Set(prev)
        next.delete(userId)
        return next
      })
    }
  }

  async function handleRevoke(userId: string) {
    // Guard: prevent removing the last L4 admin
    const l4Count = apiKeys?.filter((k) => k.access_level === 4).length ?? 0
    const targetRow = apiKeys?.find((k) => k.user_id === userId)
    if (targetRow?.access_level === 4 && l4Count <= 1) {
      alert('Cannot remove the last L4 admin — this would lock everyone out.')
      return
    }

    if (!window.confirm(`Remove user "${userId}"? This action cannot be undone.`)) return

    setMutatingRows((prev) => new Set(prev).add(userId))
    try {
      const supabase = createClient()
      const { error } = await supabase
        .schema('delomemory')
        .from('api_keys')
        .delete()
        .eq('user_id', userId)
      if (error) throw error
      await refetchKeys()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to remove user')
    } finally {
      setMutatingRows((prev) => {
        const next = new Set(prev)
        next.delete(userId)
        return next
      })
    }
  }

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

        <TabsContent value="users" className="mt-4 space-y-4">
          {/* --- Invite Form --- */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <UserPlus className="h-4 w-4" />
                Add User
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleInvite} className="flex flex-wrap items-end gap-3">
                <div className="space-y-1">
                  <label htmlFor="invite-user-id" className="text-xs font-medium text-muted-foreground">
                    Username
                  </label>
                  <input
                    id="invite-user-id"
                    type="text"
                    value={newUserId}
                    onChange={(e) => setNewUserId(e.target.value)}
                    placeholder="e.g. shah"
                    required
                    disabled={isInviting}
                    className="flex h-9 w-40 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor="invite-display-name" className="text-xs font-medium text-muted-foreground">
                    Display Name
                  </label>
                  <input
                    id="invite-display-name"
                    type="text"
                    value={newDisplayName}
                    onChange={(e) => setNewDisplayName(e.target.value)}
                    placeholder="e.g. Shah Mahdi Hasan"
                    required
                    disabled={isInviting}
                    className="flex h-9 w-52 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor="invite-access-level" className="text-xs font-medium text-muted-foreground">
                    Access Level
                  </label>
                  <select
                    id="invite-access-level"
                    value={newAccessLevel}
                    onChange={(e) => setNewAccessLevel(Number(e.target.value))}
                    disabled={isInviting}
                    className="flex h-9 w-40 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
                  >
                    {ACCESS_LEVELS.map((lvl) => (
                      <option key={lvl} value={lvl}>
                        {ACCESS_LEVEL_LABELS[lvl]}
                      </option>
                    ))}
                  </select>
                </div>
                <Button type="submit" size="sm" disabled={isInviting || !newUserId.trim() || !newDisplayName.trim()}>
                  {isInviting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Adding...
                    </>
                  ) : (
                    <>
                      <UserPlus className="h-4 w-4" />
                      Add User
                    </>
                  )}
                </Button>
              </form>
              {inviteError && (
                <p className="mt-2 text-sm text-destructive">{inviteError}</p>
              )}
            </CardContent>
          </Card>

          {/* --- Users Table --- */}
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
                      <TableHead>Display Name</TableHead>
                      <TableHead>Access Level</TableHead>
                      <TableHead>Key Prefix</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="w-[80px]">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {apiKeys.map((key) => {
                      const isMutating = mutatingRows.has(key.user_id)
                      return (
                        <TableRow
                          key={key.id}
                          className={isMutating ? 'opacity-50 pointer-events-none' : ''}
                        >
                          <TableCell className="font-medium">
                            {key.user_id}
                          </TableCell>
                          <TableCell className="text-sm">
                            {key.display_name}
                          </TableCell>
                          <TableCell>
                            <select
                              value={key.access_level}
                              onChange={(e) =>
                                handleUpdateAccessLevel(key.user_id, Number(e.target.value))
                              }
                              disabled={isMutating}
                              className="h-8 rounded-md border border-input bg-background px-2 text-xs font-medium shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
                            >
                              {ACCESS_LEVELS.map((lvl) => (
                                <option key={lvl} value={lvl}>
                                  {ACCESS_LEVEL_LABELS[lvl]}
                                </option>
                              ))}
                            </select>
                          </TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">
                            {key.key_prefix || '-'}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={key.is_active ? 'default' : 'destructive'}
                            >
                              {key.is_active ? 'Active' : 'Inactive'}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              onClick={() => handleRevoke(key.user_id)}
                              disabled={isMutating}
                              title={`Remove ${key.user_id}`}
                            >
                              <Trash2 className="h-3.5 w-3.5 text-destructive" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      )
                    })}
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

          {/* --- Panel 1: Staleness Heatmap --- */}
          <Card className="mt-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Database className="h-4 w-4" />
                File Staleness by Domain
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loadingStaleness ? (
                <Skeleton className="h-[200px] w-full" />
              ) : stalenessGrid && stalenessGrid.length > 0 ? (
                <div role="img" aria-label="Heatmap grid showing file staleness across domains and age buckets">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr>
                          <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Domain</th>
                          {AGE_BUCKETS.map((bucket) => (
                            <th key={bucket} className="py-2 px-3 text-center font-medium text-muted-foreground">
                              {AGE_BUCKET_LABELS[bucket]}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {stalenessGrid.map(([domain, buckets]) => {
                          const maxCount = Math.max(...Object.values(buckets), 1)
                          return (
                            <tr key={domain} className="border-t border-border">
                              <td className="py-2 pr-4 font-mono text-xs">{domain}</td>
                              {AGE_BUCKETS.map((bucket) => {
                                const count = buckets[bucket]
                                const opacity = count > 0 ? Math.max(0.2, count / maxCount) : 0
                                return (
                                  <td key={bucket} className="py-2 px-3 text-center">
                                    <div
                                      className={`mx-auto flex h-8 w-12 items-center justify-center rounded text-xs font-medium ${
                                        count > 0 ? `${AGE_BUCKET_COLORS[bucket]} text-white` : 'bg-muted text-muted-foreground'
                                      }`}
                                      style={count > 0 ? { opacity } : undefined}
                                    >
                                      {count}
                                    </div>
                                  </td>
                                )
                              })}
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-center h-32 text-muted-foreground">
                  No file data available
                </div>
              )}
            </CardContent>
          </Card>

          {/* --- Panel 2 & 3: Hot Files + Cold Files --- */}
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            {/* Hot Files */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Flame className="h-4 w-4" />
                  Hot Tools (Top 20 Most-Queried)
                </CardTitle>
              </CardHeader>
              <CardContent>
                {loadingAudit ? (
                  <Skeleton className="h-[300px] w-full" />
                ) : hotFiles && hotFiles.length > 0 ? (
                  <div className="space-y-2 max-h-[400px] overflow-y-auto" role="list" aria-label="Ranked list of most queried tools">
                    {hotFiles.map((item, idx) => (
                      <div
                        key={item.tool}
                        className="flex items-center justify-between rounded-md border border-border px-3 py-2"
                        role="listitem"
                      >
                        <div className="flex items-center gap-3">
                          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                            {idx + 1}
                          </span>
                          <span className="font-mono text-sm">{item.tool}</span>
                        </div>
                        <Badge variant="secondary">{item.count} queries</Badge>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-32 text-muted-foreground">
                    No audit data available
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Cold Files */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Snowflake className="h-4 w-4" />
                  Cold Domains (Zero Audit Hits)
                </CardTitle>
              </CardHeader>
              <CardContent>
                {loadingStaleness || loadingAudit ? (
                  <Skeleton className="h-[300px] w-full" />
                ) : coldDomains && coldDomains.length > 0 ? (
                  <div className="space-y-2 max-h-[400px] overflow-y-auto" role="list" aria-label="List of domains with zero audit log activity">
                    {coldDomains.map((item) => (
                      <div
                        key={item.domain}
                        className="flex items-center justify-between rounded-md border border-border px-3 py-2"
                        role="listitem"
                      >
                        <span className="font-mono text-sm">{item.domain}</span>
                        <Badge variant="outline">{item.fileCount} files</Badge>
                      </div>
                    ))}
                  </div>
                ) : coldDomains && coldDomains.length === 0 ? (
                  <div className="flex items-center justify-center h-32 text-muted-foreground">
                    All domains have been queried
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-32 text-muted-foreground">
                    No data available
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* --- Panel 4: Orphan Entities --- */}
          <Card className="mt-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Unlink className="h-4 w-4" />
                Orphan Entities (No Matching Chunks)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loadingEntities || loadingChunks ? (
                <Skeleton className="h-[200px] w-full" />
              ) : orphanEntities && orphanEntities.length > 0 ? (
                <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Code</TableHead>
                        <TableHead>Name</TableHead>
                        <TableHead>Type</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {orphanEntities.map((entity) => (
                        <TableRow key={entity.code}>
                          <TableCell className="font-mono text-xs">{entity.code}</TableCell>
                          <TableCell className="text-sm">{entity.canonical_name}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{entity.entity_type}</Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : orphanEntities && orphanEntities.length === 0 ? (
                <div className="flex items-center justify-center h-32 text-muted-foreground">
                  No orphan entities found — all entities are referenced in chunks
                </div>
              ) : (
                <div className="flex items-center justify-center h-32 text-muted-foreground">
                  No entity data available
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
