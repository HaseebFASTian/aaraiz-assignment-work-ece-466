// Freshness is derived at read time; a healthy HTTP response is not proof of a live training feed.
export function withCurrentFreshness(snapshot, now = Date.now(), receivedAt = null) {
  const timestamp = Date.parse(snapshot.snapshot_utc);
  const valid = Number.isFinite(timestamp) && timestamp <= now + 120000;
  const checked = Date.parse(snapshot.freshness?.monitor_checked_utc);
  // Receipt elapsed time is in the same clock domain as this server. Do not
  // compare a workstation's wall clock with the edge server's wall clock.
  const received = Number.isFinite(receivedAt);
  const measuredAge = snapshot.freshness?.age_seconds;
  const age = received
    ? (Number.isFinite(measuredAge) ? measuredAge + Math.max(0, (now - receivedAt) / 1000) : null)
    : valid ? Math.max(0, (now - timestamp) / 1000, Number.isFinite(checked) ? (now - checked) / 1000 : 0) : null;
  const threshold = snapshot.freshness?.stale_after_seconds ?? 120;
  const expired = age === null || age > threshold;
  const stale = snapshot.stale || expired;
  const warnings = [...new Set([...(snapshot.warnings ?? []), ...(expired ? ['SNAPSHOT_STALE'] : [])])];
  return {...snapshot, stale, connected: Boolean(snapshot.connected && !stale), warnings,
    freshness: {...snapshot.freshness, age_seconds: age, served_utc:new Date(now).toISOString(),
      server_received_utc:received ? new Date(receivedAt).toISOString() : null}};
}
