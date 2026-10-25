class NearbyBluetoothPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._renderQueued = false;
  }

  set hass(hass) {
    this._hass = hass;
    this._scheduleRender();
  }

  set narrow(narrow) {
    this._narrow = narrow;
    this._scheduleRender();
  }

  set panel(panel) {
    this._panel = panel;
    this._scheduleRender();
  }

  _scheduleRender() {
    if (this._renderQueued) return;
    this._renderQueued = true;
    requestAnimationFrame(() => {
      this._renderQueued = false;
      this._render();
    });
  }

  _devices() {
    const devices = new Map();
    for (const state of Object.values(this._hass?.states ?? {})) {
      const attributes = state.attributes ?? {};
      if (attributes.nearby_bluetooth_domain !== "nearby_bluetooth") continue;
      if (!attributes.address) continue;
      const lastSeen = Date.parse(attributes.last_seen ?? state.last_changed);
      const current = devices.get(attributes.address);
      if (!current || lastSeen > current.lastSeen) {
        devices.set(attributes.address, {
          address: attributes.address,
          name: attributes.device_name || attributes.address,
          manufacturer: attributes.manufacturer || "Unknown",
          rssi: Number(attributes.rssi),
          distance: Number(attributes.distance),
          lastSeen: Number.isNaN(lastSeen) ? 0 : lastSeen,
        });
      }
    }
    return [...devices.values()].sort((a, b) => b.lastSeen - a.lastSeen);
  }

  _render() {
    if (!this._hass || !this.shadowRoot) return;
    const allDevices = this._devices();
    const latest = allDevices.slice(0, 10);
    const maxDistance = latest.reduce((max, device) => Math.max(max, device.distance || 0), 0);
    const radarRange = this._niceRange(Math.max(maxDistance, 5));
    const listRows = allDevices.length
      ? allDevices.map((device) => this._deviceRow(device)).join("")
      : `<div class="empty-list">Inga Bluetooth-enheter har hittats ännu.</div>`;
    const radarPoints = latest.map((device, index) => this._radarPoint(device, index, radarRange)).join("");

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          min-height: 100%;
          color: var(--primary-text-color);
          background: var(--primary-background-color);
          font-family: var(--paper-font-body1_-_font-family, Roboto, sans-serif);
          --radar-accent: #62f3d3;
          --radar-line: rgba(98, 243, 211, .22);
          --surface: var(--ha-card-background, var(--card-background-color, #18222b));
        }
        * { box-sizing: border-box; }
        .page { max-width: 1440px; margin: 0 auto; padding: 30px clamp(16px, 3vw, 42px) 48px; }
        .heading { display: flex; align-items: center; gap: 15px; margin-bottom: 8px; }
        .heading-icon { display: grid; place-items: center; width: 48px; height: 48px; border-radius: 15px; color: var(--radar-accent); background: rgba(98,243,211,.12); font-size: 25px; }
        h1 { font-size: clamp(25px, 3vw, 34px); margin: 0; font-weight: 650; letter-spacing: -.025em; }
        .subtitle { color: var(--secondary-text-color); margin: 0 0 25px 63px; }
        .layout { display: grid; grid-template-columns: minmax(340px, .95fr) minmax(360px, 1.05fr); gap: 20px; align-items: start; }
        .card { overflow: hidden; border-radius: 22px; background: var(--surface); border: 1px solid var(--divider-color, rgba(255,255,255,.09)); box-shadow: 0 16px 42px rgba(0,0,0,.12); }
        .card-head { display: flex; align-items: center; justify-content: space-between; padding: 21px 23px 16px; }
        .card-head h2 { margin: 0; font-size: 17px; font-weight: 650; }
        .count { border-radius: 20px; padding: 5px 10px; color: var(--radar-accent); background: rgba(98,243,211,.1); font-size: 12px; font-weight: 700; }
        .radar-card { padding-bottom: 18px; }
        .radar-area { position: relative; max-width: 530px; margin: 0 auto; padding: 7px 20px 16px; aspect-ratio: 1 / 1; }
        .radar-disc { position: absolute; inset: 7% 7% 7%; border-radius: 50%; overflow: hidden; border: 1px solid var(--radar-line); background: radial-gradient(circle, rgba(98,243,211,.12) 0%, rgba(19,61,60,.3) 38%, rgba(8,25,34,.95) 100%); box-shadow: inset 0 0 38px rgba(58,255,210,.08), 0 0 35px rgba(33,210,180,.06); }
        .grid { position: absolute; inset: 0; width: 100%; height: 100%; }
        .grid circle, .grid line { fill: none; stroke: var(--radar-line); stroke-width: 1; }
        .grid .outer { stroke: rgba(98,243,211,.52); }
        .sweep { position: absolute; inset: 0; border-radius: 50%; background: conic-gradient(from 0deg, transparent 0deg, transparent 300deg, rgba(98,243,211,.02) 325deg, rgba(98,243,211,.31) 359deg, transparent 360deg); animation: rotate 7s linear infinite; }
        @keyframes rotate { to { transform: rotate(360deg); } }
        .points { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
        .point { fill: #7bffe0; stroke: #062b2a; stroke-width: 2; filter: drop-shadow(0 0 6px rgba(98,243,211,.9)); }
        .point-latest { fill: #ffd37a; filter: drop-shadow(0 0 7px rgba(255,211,122,.9)); }
        .point-label { fill: #eafef9; font: 600 9px Roboto, sans-serif; paint-order: stroke; stroke: rgba(5,20,24,.82); stroke-width: 3px; stroke-linejoin: round; }
        .source { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: 15px; height: 15px; border: 3px solid #eafff8; border-radius: 50%; background: #24d2b2; box-shadow: 0 0 0 7px rgba(98,243,211,.16), 0 0 24px rgba(98,243,211,.9); z-index: 2; }
        .range-label { position: absolute; right: 10%; bottom: 8%; padding: 5px 8px; border-radius: 9px; color: var(--radar-accent); background: rgba(7,21,28,.75); font-size: 11px; }
        .legend { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 0 22px 3px; color: var(--secondary-text-color); font-size: 12px; text-align: center; }
        .legend-dot { flex: 0 0 auto; width: 8px; height: 8px; border-radius: 50%; background: #ffd37a; box-shadow: 0 0 8px #ffd37a; }
        .device-list { max-height: min(720px, 75vh); overflow: auto; padding: 0 12px 12px; }
        .device { display: grid; grid-template-columns: 38px minmax(0,1fr) auto; gap: 12px; align-items: center; padding: 14px 11px; border-top: 1px solid var(--divider-color, rgba(255,255,255,.07)); }
        .device-icon { display: grid; place-items: center; width: 37px; height: 37px; border-radius: 12px; background: rgba(98,243,211,.1); color: var(--radar-accent); font-size: 17px; }
        .device-main { min-width: 0; }
        .device-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
        .device-meta { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 4px; color: var(--secondary-text-color); font-size: 12px; }
        .device-reading { text-align: right; white-space: nowrap; }
        .distance { color: var(--radar-accent); font-size: 14px; font-weight: 700; }
        .rssi { margin-top: 4px; color: var(--secondary-text-color); font-size: 11px; }
        .empty-list { padding: 38px 20px 48px; color: var(--secondary-text-color); text-align: center; }
        .footnote { margin: 17px 6px 0; color: var(--secondary-text-color); font-size: 12px; line-height: 1.55; }
        @media (max-width: 850px) { .layout { grid-template-columns: 1fr; } .device-list { max-height: none; } }
        @media (max-width: 520px) { .page { padding: 22px 12px 32px; } .subtitle { margin-left: 0; } .heading-icon { width: 42px; height: 42px; } .device { grid-template-columns: 34px minmax(0,1fr) auto; gap: 8px; padding-inline: 6px; } .device-icon { width: 33px; height: 33px; } .radar-area { padding-inline: 4px; } }
        @media (prefers-reduced-motion: reduce) { .sweep { animation: none; } }
      </style>
      <main class="page">
        <header class="heading">
          <div class="heading-icon" aria-hidden="true">◉</div>
          <h1>Bluetooth Radar</h1>
        </header>
        <p class="subtitle">En överblick över Bluetooth-enheter som Home Assistant har hört.</p>
        <section class="layout">
          <article class="card radar-card">
            <div class="card-head"><h2>Radar · 10 senast hittade</h2><span class="count">${latest.length} / 10</span></div>
            <div class="radar-area">
              <div class="radar-disc">
                <div class="sweep"></div>
                <svg class="grid" viewBox="0 0 420 420" aria-hidden="true">
                  <circle class="outer" cx="210" cy="210" r="195"></circle>
                  <circle cx="210" cy="210" r="146"></circle>
                  <circle cx="210" cy="210" r="98"></circle>
                  <circle cx="210" cy="210" r="49"></circle>
                  <line x1="15" y1="210" x2="405" y2="210"></line>
                  <line x1="210" y1="15" x2="210" y2="405"></line>
                  <line x1="72" y1="72" x2="348" y2="348"></line>
                  <line x1="348" y1="72" x2="72" y2="348"></line>
                </svg>
                <svg class="points" viewBox="0 0 420 420" role="img" aria-label="Enhetspositioner baserade på uppskattat avstånd">
                  ${radarPoints}
                </svg>
                <div class="source" title="Bluetooth-mottagare"></div>
              </div>
              <span class="range-label">Skala: ${this._formatDistance(radarRange)}</span>
            </div>
            <div class="legend"><span class="legend-dot"></span> Senast upptäckt enhet <span>·</span> avstånd uppskattat med RSSI</div>
            <p class="footnote">Avståndet är en uppskattning. Vinkeln används bara för att skilja punkterna åt; en enskild Bluetooth-mottagare kan inte avgöra riktning.</p>
          </article>
          <article class="card">
            <div class="card-head"><h2>Hittade enheter</h2><span class="count">${allDevices.length}</span></div>
            <div class="device-list">${listRows}</div>
          </article>
        </section>
      </main>`;
  }

  _deviceRow(device) {
    const name = this._escape(device.name);
    const manufacturer = this._escape(device.manufacturer);
    const address = this._escape(device.address);
    const distance = this._formatDistance(device.distance);
    const rssi = Number.isFinite(device.rssi) ? `${Math.round(device.rssi)} dBm` : "RSSI saknas";
    return `<div class="device">
      <div class="device-icon" aria-hidden="true">⌁</div>
      <div class="device-main">
        <div class="device-name" title="${name}">${name}</div>
        <div class="device-meta" title="${address}">${manufacturer} · ${address}</div>
        <div class="device-meta">Senast hittad ${this._relativeTime(device.lastSeen)}</div>
      </div>
      <div class="device-reading"><div class="distance">${distance}</div><div class="rssi">${rssi}</div></div>
    </div>`;
  }

  _radarPoint(device, index, range) {
    const angle = (this._hash(device.address) / 0xffffffff) * Math.PI * 2 - Math.PI / 2;
    const distance = Math.max(0, Number.isFinite(device.distance) ? device.distance : range);
    const radius = Math.min(distance / range, 1) * 182;
    const x = 210 + Math.cos(angle) * radius;
    const y = 210 + Math.sin(angle) * radius;
    const label = this._escape(this._shortName(device.name));
    const anchor = x > 310 ? "end" : "start";
    const labelX = x + (anchor === "end" ? -10 : 10);
    const pointClass = index === 0 ? "point point-latest" : "point";
    return `<g><title>${this._escape(device.name)} · ${this._formatDistance(device.distance)} · ${this._relativeTime(device.lastSeen)}</title>
      <circle class="${pointClass}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${index === 0 ? 6 : 4.5}"></circle>
      <text class="point-label" x="${labelX.toFixed(1)}" y="${(y - 7).toFixed(1)}" text-anchor="${anchor}">${label}</text>
    </g>`;
  }

  _hash(value) {
    let hash = 2166136261;
    for (const character of value) {
      hash ^= character.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  _niceRange(value) {
    const power = 10 ** Math.floor(Math.log10(Math.max(value, 1)));
    const scaled = value / power;
    const step = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
    return step * power;
  }

  _formatDistance(value) {
    return Number.isFinite(Number(value)) ? `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 1 })} m` : "— m";
  }

  _relativeTime(timestamp) {
    if (!timestamp) return "okänd tid";
    const seconds = Math.round((timestamp - Date.now()) / 1000);
    const formatter = new Intl.RelativeTimeFormat("sv", { numeric: "auto" });
    if (Math.abs(seconds) < 60) return formatter.format(seconds, "second");
    if (Math.abs(seconds) < 3600) return formatter.format(Math.round(seconds / 60), "minute");
    if (Math.abs(seconds) < 86400) return formatter.format(Math.round(seconds / 3600), "hour");
    return formatter.format(Math.round(seconds / 86400), "day");
  }

  _shortName(value) {
    return value.length > 12 ? `${value.slice(0, 11)}…` : value;
  }

  _escape(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
    })[character]);
  }
}

if (!customElements.get("nearby-bluetooth-panel")) {
  customElements.define("nearby-bluetooth-panel", NearbyBluetoothPanel);
}
