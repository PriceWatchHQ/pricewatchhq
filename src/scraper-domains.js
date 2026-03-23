import db from './db.js';

/**
 * Extract root domain from URL (e.g. "www.homedepot.com" -> "homedepot.com")
 */
export function extractDomain(url) {
  try {
    const host = new URL(url).hostname;
    return host.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/**
 * Check if a domain has scraper support. If unknown, add it to pending queue.
 * Returns: 'supported' | 'pending' | 'researching' | 'unsupported' | 'unknown'
 */
export function checkDomain(url) {
  const domain = extractDomain(url);
  if (!domain) return 'unknown';

  const row = db.prepare('SELECT * FROM scraper_domains WHERE domain = ?').get(domain);
  if (row) return row.status;

  // Unknown domain — add to pending queue
  db.prepare('INSERT OR IGNORE INTO scraper_domains (domain, status) VALUES (?, ?)')
    .run(domain, 'pending');

  return 'pending';
}

/**
 * Get all domains with pending status (need scraper research)
 */
export function getPendingDomains() {
  return db.prepare('SELECT * FROM scraper_domains WHERE status = ?').all('pending');
}

/**
 * Mark a domain's status
 */
export function setDomainStatus(domain, status, scraperType = null, notes = null) {
  db.prepare("UPDATE scraper_domains SET status=?, scraper_type=?, notes=?, updated_at=datetime('now') WHERE domain=?")
    .run(status, scraperType, notes, domain);
}
