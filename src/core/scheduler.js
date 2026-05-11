// PeerModGroove/src/core/scheduler.js
// Converts wall-clock transport dueAt timestamps into WebAudio scheduling times.

export function packetAudioTime(context, packet, lookaheadSeconds = 0.015) {
  if (!context) return 0;
  if (Number.isFinite(packet?.audioTime)) return Math.max(context.currentTime, packet.audioTime);
  if (Number.isFinite(packet?.dueAt)) {
    const deltaSeconds = (Number(packet.dueAt) - Date.now()) / 1000;
    return Math.max(context.currentTime + lookaheadSeconds, context.currentTime + deltaSeconds);
  }
  if (Number.isFinite(packet?.at)) return Math.max(context.currentTime, packet.at);
  return context.currentTime + lookaheadSeconds;
}
