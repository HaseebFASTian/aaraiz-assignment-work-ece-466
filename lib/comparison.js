// JSON Schema checks each row; this checks relationships between those rows.
export function consistentComparison(snapshot) {
  const rows = snapshot.predictions;
  if (rows.length === 0) return true;
  if (rows.length !== 4 || snapshot.counts.caption_completed !== 3) return false;
  const runs = snapshot.caption_runs;
  const required = ['baseline', 'alternate_encoder', 'simple_rnn'];
  if (!required.every(id => runs.some(run => run.id === id && run.completed === true))) return false;
  const first = rows[0];
  return rows.every(row => row.predictions_sha256 === first.predictions_sha256 &&
    row.observations_sha256 === first.observations_sha256);
}
