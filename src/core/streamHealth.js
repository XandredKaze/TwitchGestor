// Salute della diretta (bitrate, fotogrammi persi, connessione) dai dati di OBS.
// Non dipende da Node: lo usa anche la versione demo nel browser.

/**
 * Qualità della connessione della diretta, dai dati degli ultimi secondi:
 * fotogrammi persi per la rete e congestione (0..1) calcolata da OBS.
 * 4 ottima · 3 buona · 2 instabile · 1 pessima · 0 in riconnessione.
 */
export function connectionQuality({ active, reconnecting, congestion = 0, droppedPct = 0 }) {
  if (!active) return null;
  if (reconnecting) return { level: 0, label: 'riconnessione…' };
  if (congestion < 0.1 && droppedPct < 0.5) return { level: 4, label: 'ottima' };
  if (congestion < 0.25 && droppedPct < 2) return { level: 3, label: 'buona' };
  if (droppedPct < 5) return { level: 2, label: 'instabile' };
  return { level: 1, label: 'pessima' };
}

/**
 * Riassume i campioni di GetStreamStatus/GetStats (uno ogni ~2 s) in quello che mostra la dashboard.
 * samples: [{ t, active, reconnecting, bytes, skipped, total, congestion, durationMs, fps, cpu, renderSkipped, renderTotal }]
 */
export function summarizeStream(samples, history = []) {
  const last = samples.at(-1);
  if (!last) return null;
  const prev = samples.at(-2);
  const old = samples[Math.max(0, samples.length - 6)]; // ~10 secondi fa
  let bitrateKbps = 0;
  if (last.active && prev?.active && last.t > prev.t && last.bytes >= prev.bytes) {
    bitrateKbps = Math.round(((last.bytes - prev.bytes) * 8) / (last.t - prev.t)); // byte/ms → kbit/s
  }
  const recent = (a, b, key, tot) => {
    const dTot = (b?.[tot] ?? 0) - (a?.[tot] ?? 0);
    const d = (b?.[key] ?? 0) - (a?.[key] ?? 0);
    return dTot > 0 && d >= 0 ? (d / dTot) * 100 : 0;
  };
  const droppedPct = old && old !== last ? recent(old, last, 'skipped', 'total') : 0;
  const stream = {
    active: Boolean(last.active),
    reconnecting: Boolean(last.reconnecting),
    durationMs: last.durationMs ?? 0,
    bitrateKbps,
    congestion: last.congestion ?? 0,
    droppedPct, // ultimi ~10 secondi
    dropped: last.skipped ?? 0, // dall'inizio della diretta
    total: last.total ?? 0,
    fps: last.fps ?? 0,
    cpu: last.cpu ?? 0,
    renderMissedPct: old && old !== last ? recent(old, last, 'renderSkipped', 'renderTotal') : 0,
    history,
  };
  stream.quality = connectionQuality(stream);
  return stream;
}
