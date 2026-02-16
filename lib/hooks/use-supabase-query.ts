'use client'

import { useQuery, type UseQueryOptions } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'

type SupabaseQueryFn<T> = (supabase: ReturnType<typeof createClient>) => Promise<T>

export function useSupabaseQuery<T>(
  key: string[],
  queryFn: SupabaseQueryFn<T>,
  options?: Omit<UseQueryOptions<T, Error>, 'queryKey' | 'queryFn'>
) {
  return useQuery<T, Error>({
    queryKey: key,
    queryFn: () => {
      const supabase = createClient()
      return queryFn(supabase)
    },
    ...options,
  })
}
