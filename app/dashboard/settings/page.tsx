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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useSupabaseQuery } from '@/lib/hooks/use-supabase-query'
import { createClient } from '@/lib/supabase/client'
import { Shield, Database, FileText, UserPlus, Trash2, Loader2 } from 'lucide-react'

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
        </TabsContent>
      </Tabs>
    </div>
  )
}
