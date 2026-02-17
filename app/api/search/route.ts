import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

interface SearchRequestBody {
  query: string
  tool: string
  domain?: string
  top_k?: number
}

export async function POST(request: NextRequest) {
  try {
    // 1. Verify user is authenticated
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // 2. Get user's access level from api_keys
    const userId = (user.email ?? '').split('@')[0]
    const { data: keyData } = await supabase
      .schema('delomemory')
      .from('api_keys')
      .select('key_prefix, access_level')
      .eq('user_id', userId)
      .eq('is_active', true)
      .order('access_level', { ascending: false })
      .limit(1)
      .single()

    if (!keyData) {
      return NextResponse.json({ error: 'No active API key found' }, { status: 403 })
    }

    // 3. Parse request body
    const body = (await request.json()) as SearchRequestBody
    const { query, tool, domain, top_k } = body

    if (!query || !tool) {
      return NextResponse.json({ error: 'query and tool are required' }, { status: 400 })
    }

    // 4. Query knowledge_chunks with access-level filtering
    let chunksQuery = supabase
      .schema('delomemory')
      .from('knowledge_chunks')
      .select('id, file_path, domain, content_type, chunk_text, entity_codes, access_level, metadata')
      .lte('access_level', keyData.access_level)

    if (domain) {
      chunksQuery = chunksQuery.eq('domain', domain)
    }

    // Text search using ilike (the MCP server uses embeddings,
    // but for the playground we provide a basic text-match preview)
    chunksQuery = chunksQuery.ilike('chunk_text', `%${query}%`)
    chunksQuery = chunksQuery.limit(top_k || 20)

    const { data: results, error: searchError } = await chunksQuery

    if (searchError) {
      return NextResponse.json({ error: searchError.message }, { status: 500 })
    }

    return NextResponse.json({
      query,
      tool,
      results_count: results?.length ?? 0,
      access_level: keyData.access_level,
      results: results?.map((r, i) => ({
        rank: i + 1,
        file_path: r.file_path,
        domain: r.domain,
        content_type: r.content_type,
        preview: r.chunk_text?.substring(0, 300) + (r.chunk_text && r.chunk_text.length > 300 ? '...' : ''),
        entity_codes: r.entity_codes,
        access_level: r.access_level,
      })) ?? [],
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
