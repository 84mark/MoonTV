import type { PlayRecord } from './db.client';

type Identity = Pick<PlayRecord, 'title' | 'year' | 'total_episodes'>;

// Keep remakes and film/series adaptations separate, while ignoring source IDs.
export function playRecordIdentity(record: Identity): string {
  return JSON.stringify([
    record.title.normalize('NFKC').replace(/\s/g, '').toLowerCase(),
    String(record.year || '').trim(),
    record.total_episodes > 1 ? 'tv' : 'movie',
  ]);
}

/** Preserve the newest complete record, including its source key and progress. */
export function mergePlayRecords(
  records: Record<string, PlayRecord>
): Record<string, PlayRecord> {
  const latest = new Map<string, [string, PlayRecord]>();
  for (const [key, record] of Object.entries(records)) {
    const identity = record.title ? playRecordIdentity(record) : key;
    const previous = latest.get(identity);
    if (!previous || record.save_time >= previous[1].save_time)
      latest.set(identity, [key, record]);
  }
  return Object.fromEntries(latest.values());
}

export function findPlayRecord(
  records: Record<string, PlayRecord>,
  identity: Identity
): PlayRecord | undefined {
  const key = playRecordIdentity(identity);
  return Object.values(records)
    .filter((record) => record.title && playRecordIdentity(record) === key)
    .sort((a, b) => b.save_time - a.save_time)[0];
}
