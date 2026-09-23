const DEFAULT_PAGE_SIZE = 25
const MAX_PAGE_SIZE = 100

export function parseModerationPagination(url: URL) {
  const requestedSize = Number(url.searchParams.get('limit'))
  const numItems = Number.isInteger(requestedSize) && requestedSize > 0
    ? Math.min(requestedSize, MAX_PAGE_SIZE)
    : DEFAULT_PAGE_SIZE
  const cursor = (key: string) => {
    const value = url.searchParams.get(key)
    return value && value.length <= 2_000 ? value : null
  }

  return {
    openReportsPagination: { numItems, cursor: cursor('openCursor') },
    takedownListingsPagination: { numItems, cursor: cursor('takedownCursor') },
  }
}
