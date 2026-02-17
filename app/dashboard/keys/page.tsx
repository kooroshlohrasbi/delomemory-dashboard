'use client'

import { useState, useMemo, useCallback } from 'react'
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
import { useUser } from '@/lib/hooks/use-user'
import { createClient } from '@/lib/supabase/client'
import { format, formatDistanceToNow } from 'date-fns'
import {
  Key,
  Plus,
  Copy,
  Check,
  Loader2,
  ShieldAlert,
  Clock,
  AlertTriangle,
} from 'lucide-react'

// --- Types ---

interface ApiKeyRow {
  id: number
  key_prefix: string
  display_name: string
  access_level: number
  is_active: boolean
  created_at: string
  last_used_at: string | null
  revoked_at: string | null
  description: string | null
}

const ACCESS_LEVEL_LABELS: Record<number, string> = {
  1: 'L1',
  2: 'L2',
  3: 'L3',
  4: 'L4',
}

// --- Crypto Utilities ---

function generateApiKey(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  const key = Array.from(crypto.getRandomValues(new Uint8Array(40)),
    (b) => chars[b % chars.length]).join('')
  return `dm_${key}`
}

async function hashKey(key: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(key)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// --- Component ---

export default function KeysPage() {
  const { user } = useUser()
  const userId = user?.email ? user.email.split('@')[0] : null

  // --- Create key form state ---
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [displayName, setDisplayName] = useState('')
  const [description, setDescription] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  // --- Newly created key (show once) ---
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // --- Row-level mutation state ---
  const [mutatingRows, setMutatingRows] = useState<Set<string>>(new Set())

  // --- Error state ---
  const [actionError, setActionError] = useState<string | null>(null)

  // --- Fetch my keys ---
  const { data: myKeys, isLoading, refetch } = useSupabaseQuery<ApiKeyRow[]>(
    ['my-keys', userId ?? ''],
    async (supabase) => {
      if (!userId) return []
      const { data, error } = await supabase
        .schema('delomemory')
        .from('api_keys')
        .select('id, key_prefix, display_name, access_level, is_active, created_at, last_used_at, revoked_at, description')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data as ApiKeyRow[]) ?? []
    },
    { enabled: !!userId }
  )

  // --- Derived: user's current access level ---
  const currentUserLevel = useMemo(() => {
    if (!myKeys?.length) return null
    return Math.max(...myKeys.filter((k) => k.is_active).map((k) => k.access_level))
  }, [myKeys])

  // --- Derived: summary stats ---
  const stats = useMemo(() => {
    if (!myKeys) return null
    const activeKeys = myKeys.filter((k) => k.is_active)
    const lastUsed = myKeys
      .map((k) => k.last_used_at)
      .filter(Boolean)
      .sort()
      .reverse()[0]
    return {
      active: activeKeys.length,
      total: myKeys.length,
      lastUsed: lastUsed ?? null,
    }
  }, [myKeys])

  // --- Create key ---
  const handleCreate = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmedName = displayName.trim()
    if (!trimmedName || !userId || currentUserLevel === null) return

    setIsCreating(true)
    setCreateError(null)

    try {
      const supabase = createClient()
      const fullKey = generateApiKey()
      const keyHash = await hashKey(fullKey)
      const keyPrefix = fullKey.substring(0, 7) // "dm_XXXX"

      const { error } = await supabase
        .schema('delomemory')
        .from('api_keys')
        .insert({
          key_hash: keyHash,
          key_prefix: keyPrefix,
          user_id: userId,
          access_level: currentUserLevel,
          display_name: trimmedName,
          description: description.trim() || null,
          is_active: true,
          created_by: userId,
        })

      if (error) throw error

      setNewlyCreatedKey(fullKey)
      setDisplayName('')
      setDescription('')
      setShowCreateForm(false)
      await refetch()
    } catch (err) {
      setCreateError(
        err instanceof Error && err.message.includes('row-level security')
          ? 'Key creation requires admin setup. Contact your L4 admin.'
          : err instanceof Error
            ? err.message
            : 'Failed to create key'
      )
    } finally {
      setIsCreating(false)
    }
  }, [displayName, description, userId, currentUserLevel, refetch])

  // --- Revoke key ---
  const handleRevoke = useCallback(async (keyId: number) => {
    if (!userId) return
    const keyIdStr = String(keyId)

    setMutatingRows((prev) => new Set(prev).add(keyIdStr))
    setActionError(null)

    try {
      const supabase = createClient()
      const { error } = await supabase
        .schema('delomemory')
        .from('api_keys')
        .update({ is_active: false, revoked_at: new Date().toISOString() })
        .eq('id', keyId)
        .eq('user_id', userId)

      if (error) {
        setActionError('Unable to revoke key. Contact your L4 admin.')
        return
      }
      await refetch()
    } catch {
      setActionError('Unable to revoke key. Contact your L4 admin.')
    } finally {
      setMutatingRows((prev) => {
        const next = new Set(prev)
        next.delete(keyIdStr)
        return next
      })
    }
  }, [userId, refetch])

  // --- Copy key ---
  const handleCopy = useCallback(async () => {
    if (!newlyCreatedKey) return
    await navigator.clipboard.writeText(newlyCreatedKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [newlyCreatedKey])

  // --- Dismiss new key banner ---
  const handleDismissNewKey = useCallback(() => {
    setNewlyCreatedKey(null)
    setCopied(false)
  }, [])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">API Keys</h1>
        <p className="text-muted-foreground">
          Manage your personal API keys for DeloMemory MCP access
        </p>
      </div>

      {/* Summary Stats */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Active Keys</CardTitle>
            <Key className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-12" />
            ) : (
              <div className="text-2xl font-bold">{stats?.active ?? 0}</div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Total Keys</CardTitle>
            <ShieldAlert className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-12" />
            ) : (
              <div className="text-2xl font-bold">{stats?.total ?? 0}</div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Last Used</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-12" />
            ) : (
              <div className="text-sm font-medium">
                {stats?.lastUsed
                  ? formatDistanceToNow(new Date(stats.lastUsed), { addSuffix: true })
                  : 'Never'}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Newly Created Key Banner */}
      {newlyCreatedKey && (
        <Card className="border-yellow-500/50 bg-yellow-50 dark:bg-yellow-950/20">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 shrink-0 text-yellow-600 dark:text-yellow-400" />
              <div className="flex-1 space-y-3">
                <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
                  Copy this key now -- it will not be shown again
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 rounded-md border bg-background px-3 py-2 font-mono text-sm select-all">
                    {newlyCreatedKey}
                  </code>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCopy}
                    aria-label="Copy API key to clipboard"
                  >
                    {copied ? (
                      <Check className="h-4 w-4 text-green-600" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleDismissNewKey}
                  aria-label="Dismiss key display"
                >
                  I have copied my key
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Create Key Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <Key className="h-4 w-4" />
              Your Keys
            </CardTitle>
            {!showCreateForm && (
              <Button
                size="sm"
                onClick={() => {
                  setShowCreateForm(true)
                  setCreateError(null)
                }}
                disabled={currentUserLevel === null && !isLoading}
                aria-label="Create a new API key"
              >
                <Plus className="h-4 w-4" />
                Create Key
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Create Key Form */}
          {showCreateForm && (
            <form
              onSubmit={handleCreate}
              className="rounded-md border border-border p-4 space-y-3"
            >
              <div className="space-y-1">
                <label
                  htmlFor="key-display-name"
                  className="text-xs font-medium text-muted-foreground"
                >
                  Key Name <span className="text-destructive">*</span>
                </label>
                <input
                  id="key-display-name"
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="e.g. Claude Desktop, CI Pipeline"
                  required
                  disabled={isCreating}
                  className="flex h-9 w-full max-w-sm rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
                />
              </div>
              <div className="space-y-1">
                <label
                  htmlFor="key-description"
                  className="text-xs font-medium text-muted-foreground"
                >
                  Description (optional)
                </label>
                <input
                  id="key-description"
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What will this key be used for?"
                  disabled={isCreating}
                  className="flex h-9 w-full max-w-sm rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
                />
              </div>
              {currentUserLevel !== null && (
                <p className="text-xs text-muted-foreground">
                  New key will inherit your current access level:{' '}
                  <Badge variant="secondary">
                    {ACCESS_LEVEL_LABELS[currentUserLevel] ?? `L${currentUserLevel}`}
                  </Badge>
                </p>
              )}
              {createError && (
                <p className="text-sm text-destructive" role="alert">
                  {createError}
                </p>
              )}
              <div className="flex items-center gap-2">
                <Button
                  type="submit"
                  size="sm"
                  disabled={isCreating || !displayName.trim()}
                >
                  {isCreating ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    <>
                      <Plus className="h-4 w-4" />
                      Create
                    </>
                  )}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setShowCreateForm(false)
                    setCreateError(null)
                  }}
                  disabled={isCreating}
                >
                  Cancel
                </Button>
              </div>
            </form>
          )}

          {/* Action Error */}
          {actionError && (
            <p className="text-sm text-destructive" role="alert" aria-live="assertive">
              {actionError}
            </p>
          )}

          {/* Keys Table */}
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : myKeys && myKeys.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Prefix</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Level</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Last Used</TableHead>
                  <TableHead className="w-[80px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {myKeys.map((key) => {
                  const keyIdStr = String(key.id)
                  const isMutating = mutatingRows.has(keyIdStr)
                  return (
                    <TableRow
                      key={key.id}
                      className={isMutating ? 'opacity-50 pointer-events-none' : ''}
                    >
                      <TableCell className="font-mono text-xs">
                        {key.key_prefix}
                      </TableCell>
                      <TableCell>
                        <div>
                          <span className="text-sm">{key.display_name}</span>
                          {key.description && (
                            <p className="text-xs text-muted-foreground truncate max-w-[200px]">
                              {key.description}
                            </p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">
                          {ACCESS_LEVEL_LABELS[key.access_level] ?? `L${key.access_level}`}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={key.is_active ? 'default' : 'destructive'}
                        >
                          {key.is_active ? 'Active' : 'Revoked'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {format(new Date(key.created_at), 'MMM d, yyyy')}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {key.last_used_at
                          ? formatDistanceToNow(new Date(key.last_used_at), {
                              addSuffix: true,
                            })
                          : 'Never'}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => handleRevoke(key.id)}
                          disabled={!key.is_active || isMutating}
                          aria-label={`Revoke key ${key.display_name}`}
                          title={
                            key.is_active
                              ? `Revoke ${key.display_name}`
                              : 'Already revoked'
                          }
                        >
                          {isMutating ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <ShieldAlert className="h-3.5 w-3.5 text-destructive" />
                          )}
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          ) : (
            <div className="flex flex-col items-center justify-center h-32 text-muted-foreground gap-2">
              <Key className="h-8 w-8" />
              <p>No API keys found. Create your first key to get started.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
