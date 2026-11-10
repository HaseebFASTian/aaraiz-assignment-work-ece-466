import { useCallback, useEffect, useRef, useState } from 'react';
import { snapshotIsStale } from '../lib/data.js';

const currentClock = () => ({wall: Date.now(), monotonic: performance.now()});

export function useResearchStatus() {
  const [snapshot, setSnapshot] = useState(null);
  const [evidence, setEvidence] = useState(null);
  const [statusError, setStatusError] = useState(false);
  const [evidenceError, setEvidenceError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [clock, setClock] = useState(currentClock);
  const mounted = useRef(true);
  const active = useRef(null);
  const snapshotReceivedAt = useRef(null);

  const refresh = useCallback(async () => {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    if (mounted.current) setRefreshing(true);
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const [statusResult, evidenceResult] = await Promise.allSettled([
        fetch('/api/status', {cache: 'no-store', signal: controller.signal}).then(async response => {
          if (!response.ok) throw new Error('Status unavailable');
          const next = await response.json();
          if (next.schema_version !== 1 || !Array.isArray(next.sentiment_runs) || !Array.isArray(next.caption_runs)) {
            throw new Error('Unsupported public snapshot');
          }
          return {snapshot: next, receivedAt: performance.now()};
        }),
        fetch('/evidence.json', {cache: 'no-store', signal: controller.signal}).then(async response => {
          if (!response.ok) throw new Error('Evidence unavailable');
          return response.json();
        }),
      ]);
      if (mounted.current && active.current === controller) {
        if (statusResult.status === 'fulfilled') {
          snapshotReceivedAt.current = statusResult.value.receivedAt;
          setClock(currentClock()); setSnapshot(statusResult.value.snapshot); setStatusError(false);
        }
        else setStatusError(true);
        if (evidenceResult.status === 'fulfilled') {setEvidence(evidenceResult.value); setEvidenceError(false);}
        else setEvidenceError(true);
      }
    } catch (error) {
      if (mounted.current && active.current === controller) setStatusError(true);
    } finally {
      clearTimeout(timeout);
      if (mounted.current && active.current === controller) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    refresh();
    const interval = setInterval(() => {if (!document.hidden) refresh();}, 15000);
    const clockInterval = setInterval(() => setClock(currentClock()), 5000);
    const visibility = () => {setClock(currentClock()); if (!document.hidden) refresh();};
    document.addEventListener('visibilitychange', visibility);
    return () => {
      mounted.current = false;
      active.current?.abort(); clearInterval(interval); clearInterval(clockInterval);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [refresh]);

  const sinceFetch = snapshotReceivedAt.current === null ? null : Math.max(0, clock.monotonic - snapshotReceivedAt.current) / 1000;
  const stale = statusError || snapshotIsStale(snapshot, clock.wall, sinceFetch);
  return {snapshot, evidence, refreshing, refresh, stale, statusError, evidenceError};
}
