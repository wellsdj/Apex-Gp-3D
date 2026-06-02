// Apex GP 3D — PartyKit multiplayer server
// Each party (5-char code) is its own Durable Object room.
// Two roles: host (creator) and joiner. Max 2 players per room.
// Game messages are JSON; server inspects a few for state (track/weather),
// then relays everything else to the other connection.

export default class Server {
  constructor(party) {
    this.party = party;
    this.hostId = null;
    this.track = 0;
    this.weather = 'dry';
    this.admitted = new Set();
  }

  liveHost() {
    if (!this.hostId) return null;
    for (const c of this.party.getConnections()) {
      if (c.id === this.hostId) return c;
    }
    return null;
  }

  connCount() {
    let n = 0;
    for (const _ of this.party.getConnections()) n++;
    return n;
  }

  send(conn, obj) {
    try { conn.send(JSON.stringify(obj)); } catch (_) {}
  }

  reject(conn, code) {
    this.send(conn, { type: 'error', code });
    try { conn.close(1000, code); } catch (_) {}
  }

  onConnect(conn, ctx) {
    const url = new URL(ctx.request.url);
    const role = url.searchParams.get('role');

    if (role === 'host') {
      if (this.liveHost()) return this.reject(conn, 'PARTY_EXISTS');
      this.hostId = conn.id;
      this.admitted.add(conn.id);
      this.send(conn, { type: 'welcome', role: 'host' });
      return;
    }

    if (role === 'join') {
      if (!this.liveHost()) return this.reject(conn, 'PARTY_NOT_FOUND');
      if (this.admitted.size >= 2) return this.reject(conn, 'PARTY_FULL');
      this.admitted.add(conn.id);
      this.send(conn, {
        type: 'welcome',
        role: 'joiner',
        track: this.track,
        weather: this.weather,
      });
      const host = this.liveHost();
      if (host) this.send(host, { type: 'peerJoined' });
      return;
    }

    return this.reject(conn, 'BAD_ROLE');
  }

  onClose(conn) {
    const wasAdmitted = this.admitted.delete(conn.id);
    if (this.hostId === conn.id) this.hostId = null;
    if (!wasAdmitted) return;
    for (const c of this.party.getConnections()) {
      if (c.id !== conn.id && this.admitted.has(c.id)) {
        this.send(c, { type: 'peerLeft' });
      }
    }
  }

  onMessage(message, sender) {
    let d;
    try { d = JSON.parse(message); } catch (_) { return; }

    if (d && typeof d.t === 'string') {
      if ((d.t === 'track' || d.t === 'trackReq') && typeof d.track === 'number') {
        this.track = d.track;
      } else if (d.t === 'start' && typeof d.weather === 'string') {
        this.weather = d.weather;
      }
    }

    if (!this.admitted.has(sender.id)) return;
    for (const c of this.party.getConnections()) {
      if (c.id !== sender.id && this.admitted.has(c.id)) {
        try { c.send(message); } catch (_) {}
      }
    }
  }
}
