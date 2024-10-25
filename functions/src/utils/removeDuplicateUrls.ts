export default function removeDuplicateUrls<T extends { url: string }>(items: T[]): T[] {
  const seenUrls = new Set<string>();

  return items.filter(item => {
    if (seenUrls.has(item.url)) {
      return false;  // It's a duplicate, so filter it out
    }
    seenUrls.add(item.url);
    return true;  // It's not a duplicate, so keep it
  });
}