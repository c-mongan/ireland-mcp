export function describeEvidence(doc, { now = new Date().toISOString(), as_of } = {}) {
  const warnings = [...(doc.warnings ?? [])];
  let currentness = doc.source_type === 'guidance' ? 'guidance' : 'not_verified';
  if (doc.version_type === 'enacted' || doc.version_type === 'made') {
    currentness = 'as_enacted';
    warnings.push('Original published text; amendments and commencement have not been fully verified.');
  } else if (doc.version_type === 'revised') {
    currentness = warnings.some(w => /not.*(?:incorporated|implemented)/i.test(w)) ? 'unresolved_changes' : 'publisher_consolidation';
    warnings.push('Administrative consolidation; its cutoff does not establish that all operative changes are incorporated.');
  }
  if (doc.source_type === 'guidance') warnings.push('Explanatory guidance; consult the underlying legal provisions and their versions.');
  if (doc.stale) warnings.push('The latest refresh failed or this source was withdrawn; the stored snapshot may be stale.');
  if (as_of && (doc.consolidated_to ?? doc.publisher_updated_at) !== as_of) warnings.push(`Requested ${as_of}; actual publisher version date is ${doc.consolidated_to ?? doc.publisher_updated_at ?? 'unknown'}. Historical current law is not verified.`);
  const citation = { id: doc.id, version: doc.version, title: doc.title, url: doc.canonical_url, source_type: doc.source_type,
    publisher: doc.publisher, jurisdiction: doc.jurisdiction, section: doc.section, licence: doc.licence, attribution: doc.attribution };
  return { ...doc, served_at: now, requested_as_of: as_of ?? null, currentness, current_law_verified: false, warnings: [...new Set(warnings)], citation };
}
