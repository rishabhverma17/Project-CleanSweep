import { useInfiniteQuery } from '@tanstack/react-query';
import { mediaApi } from '../api/mediaApi';

export function useMediaBrowse(pageSize = 50, type?: number, sort?: string) {
  return useInfiniteQuery({
    queryKey: ['media', { pageSize, type, sort }],
    queryFn: ({ pageParam = 1 }) => mediaApi.browse(pageParam, pageSize, type, undefined, undefined, sort),
    getNextPageParam: (lastPage) =>
      lastPage.hasNextPage ? lastPage.page + 1 : undefined,
    initialPageParam: 1,
  });
}
