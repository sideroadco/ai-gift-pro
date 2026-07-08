export function getAmazonUrl(gift: { name: string; category: string; asin?: string; searchQuery?: string }, tag: string): string {
  const cleanAsin = (gift.asin || '').trim().toUpperCase();
  
  // Specific list of known bad/placeholder ASINs
  const isExcludedAsin = [
    'B000000000', '0123456789', 'ASINPLACEH', 'SEARCH_REQ', 'SEARCH', 'ERROR', 'NONE',
    'B0C5J29L5P' // Known 404 from recent testing
  ].some(p => cleanAsin.includes(p));
  
  // Suspicious repetitive patterns
  const isSuspicious = /(AAAAA|BBBBB|12345|00000)/.test(cleanAsin);
  
  const isLikelyValid = /^[A-Z0-9]{10}$/.test(cleanAsin) && !isExcludedAsin && !isSuspicious;

  if (isLikelyValid) {
    return `https://www.amazon.com/dp/${cleanAsin}/?tag=${tag}`;
  }

  // Fallback to search
  // Use a cleaner search term: Name + Brand (if available) - just name + category for now
  let query = (gift.searchQuery && gift.searchQuery.length > 3 && gift.searchQuery.toUpperCase() !== 'SEARCH')
    ? gift.searchQuery
    : `${gift.name}`;

  // If the query is really short, add the category to help Amazon
  if (query.split(' ').length < 2) {
    query = `${query} ${gift.category}`;
  }

  return `https://www.amazon.com/s?k=${encodeURIComponent(query)}&tag=${tag}`;
}

export function getGoogleUrl(gift: { name: string; category: string; searchQuery?: string }): string {
  const query = (gift.searchQuery && gift.searchQuery.length > 3 && gift.searchQuery.toUpperCase() !== 'SEARCH')
    ? gift.searchQuery
    : `${gift.name} ${gift.category}`;
    
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}
