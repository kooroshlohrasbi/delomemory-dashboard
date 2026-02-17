'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useSupabaseQuery } from '@/lib/hooks/use-supabase-query'
import { cn } from '@/lib/utils'
import { Search, Loader2, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react'

interface SearchResult {
  rank: number
  file_path: string
  domain: string
  content_type: string
  preview: string
  entity_codes: string[] | null
  access_level: number
}

const ACCESS_LEVEL_LABELS: Record<number, string> = {
  0: 'L0',
  1: 'L1',
  2: 'L2',
  3: 'L3',
  4: 'L4',
}

export default function PlaygroundPage() {
  const [query, setQuery] = useState('')
  const [tool, setTool] = useState('search_knowledge')
  const [domain, setDomain] = useState<string | null>(null)
  const [topK, setTopK] = useState(20)
  const [results, setResults] = useState<SearchResult[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [latencyMs, setLatencyMs] = useState<number | null>(null)
  const [expandedCards, setExpandedCards] = useState<Set<number>>(new Set())

  // Fetch available domains for the filter dropdown
  const { data: domains } = useSupabaseQuery(
    ['playground-domains'],
    async (supabase) => {
      const { data, error } = await supabase
        .schema('delomemory')
        .from('knowledge_chunks')
        .select('domain')
      if (error) throw error
      const unique = [...new Set(data.map((d: { domain: string }) => d.domain))].sort()
      return unique as string[]
    }
  )

  async function handleSearch() {
    if (!query.trim()) return
    setSearching(true)
    setError(null)
    setResults(null)
    setLatencyMs(null)
    setExpandedCards(new Set())
    const start = performance.now()
    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          tool,
          domain,
          top_k: topK,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Search failed')
      setResults(data.results)
      setLatencyMs(Math.round(performance.now() - start))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed')
    } finally {
      setSearching(false)
    }
  }

  function toggleCard(rank: number) {
    setExpandedCards((prev) => {
      const next = new Set(prev)
      if (next.has(rank)) {
        next.delete(rank)
      } else {
        next.add(rank)
      }
      return next
    })
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Knowledge Playground</h1>
        <p className="text-muted-foreground">
          Test search queries against the knowledge base
        </p>
      </div>

      {/* Search Form */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium">Search Query</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Query textarea */}
          <div>
            <label htmlFor="playground-query" className="text-sm font-medium">
              Query
            </label>
            <textarea
              id="playground-query"
              aria-label="Search query"
              className={cn(
                'mt-1 flex w-full rounded-md border border-input bg-background px-3 py-2',
                'text-sm ring-offset-background placeholder:text-muted-foreground',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                'focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
                'min-h-[80px] resize-y'
              )}
              placeholder="Enter your search query..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  handleSearch()
                }
              }}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Press Cmd+Enter / Ctrl+Enter to search
            </p>
          </div>

          {/* Controls row */}
          <div className="grid gap-4 sm:grid-cols-3">
            {/* Tool selector */}
            <div>
              <label htmlFor="playground-tool" className="text-sm font-medium">
                Tool
              </label>
              <select
                id="playground-tool"
                aria-label="Search tool"
                className={cn(
                  'mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2',
                  'text-sm ring-offset-background',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  'focus-visible:ring-offset-2'
                )}
                value={tool}
                onChange={(e) => setTool(e.target.value)}
              >
                <option value="search_knowledge">search_knowledge</option>
                <option value="deep_research">deep_research</option>
              </select>
            </div>

            {/* Domain filter */}
            <div>
              <label htmlFor="playground-domain" className="text-sm font-medium">
                Domain
              </label>
              <select
                id="playground-domain"
                aria-label="Domain filter"
                className={cn(
                  'mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2',
                  'text-sm ring-offset-background',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  'focus-visible:ring-offset-2'
                )}
                value={domain ?? ''}
                onChange={(e) => setDomain(e.target.value || null)}
              >
                <option value="">All domains</option>
                {domains?.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>

            {/* Top K slider */}
            <div>
              <label htmlFor="playground-topk" className="text-sm font-medium">
                Top K: {topK}
              </label>
              <input
                id="playground-topk"
                aria-label="Maximum number of results"
                type="range"
                min={5}
                max={50}
                step={5}
                value={topK}
                onChange={(e) => setTopK(Number(e.target.value))}
                className="mt-1 w-full h-10 accent-primary"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>5</span>
                <span>50</span>
              </div>
            </div>
          </div>

          {/* Search button */}
          <Button
            onClick={handleSearch}
            disabled={searching || !query.trim()}
            className="w-full sm:w-auto"
            aria-label="Execute search"
          >
            {searching ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Searching...
              </>
            ) : (
              <>
                <Search className="h-4 w-4 mr-2" />
                Search
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Error state */}
      {error && (
        <Card className="border-destructive">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-4 w-4" />
              <p className="text-sm font-medium">{error}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Loading skeleton */}
      {searching && (
        <div className="flex flex-col gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-5 w-3/4" />
              </CardHeader>
              <CardContent className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
                <Skeleton className="h-4 w-2/3" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Results section */}
      {!searching && results !== null && (
        <div className="space-y-4">
          {/* Result count + latency */}
          <div className="flex items-center gap-3" role="status">
            <p className="text-sm text-muted-foreground">
              {results.length} result{results.length !== 1 ? 's' : ''}
              {latencyMs !== null && ` in ${latencyMs}ms`}
            </p>
          </div>

          {results.length === 0 ? (
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-center h-32 text-muted-foreground">
                  No results found. Try a different query or broaden the domain filter.
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="flex flex-col gap-4">
              {results.map((result) => {
                const isExpanded = expandedCards.has(result.rank)
                return (
                  <Card key={result.rank}>
                    <CardHeader className="pb-2">
                      <button
                        className="flex w-full items-start justify-between text-left"
                        onClick={() => toggleCard(result.rank)}
                        aria-expanded={isExpanded}
                        aria-controls={`result-${result.rank}-content`}
                      >
                        <CardTitle className="text-sm font-medium">
                          <span className="text-muted-foreground">#{result.rank}</span>
                          {' '}
                          {result.file_path}
                        </CardTitle>
                        <div className="flex items-center gap-2 ml-2 shrink-0">
                          <Badge variant="secondary">{result.domain}</Badge>
                          <Badge variant="outline">{result.content_type}</Badge>
                          {isExpanded ? (
                            <ChevronUp className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                          )}
                        </div>
                      </button>
                    </CardHeader>
                    <CardContent id={`result-${result.rank}-content`}>
                      <p
                        className={cn(
                          'text-sm text-muted-foreground whitespace-pre-wrap',
                          !isExpanded && 'line-clamp-3'
                        )}
                      >
                        {result.preview}
                      </p>
                      {/* Footer: entity codes + access level */}
                      <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t">
                        {result.entity_codes?.map((code) => (
                          <Badge key={code} variant="outline" className="text-xs">
                            {code}
                          </Badge>
                        ))}
                        <Badge
                          variant="secondary"
                          className="ml-auto text-xs"
                        >
                          {ACCESS_LEVEL_LABELS[result.access_level] ?? `L${result.access_level}`}
                        </Badge>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Empty state before first search */}
      {!searching && results === null && !error && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
              <Search className="h-8 w-8 mb-2 opacity-50" />
              <p>Enter a query to search the knowledge base</p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
