""""Passive Bluetooth advertisement tracker."""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from homeassistant.components import bluetooth, frontend, panel_custom
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.storage import Store

from .const import CONF_ALERT_NEW, CONF_MIN_RSSI, CONF_PATH_LOSS, CONF_TX_POWER, DOMAIN, PLATFORMS

_LOGGER = logging.getLogger(__name__)
STORAGE_VERSION = 1
PANEL_VERSION = "0.2.1"


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    """Serve the integration's sidebar panel assets."""
    static_dir = Path(__file__).parent / "static"
    await hass.http.async_register_static_paths(
        [StaticPathConfig(f"/api/{DOMAIN}/static", str(static_dir), cache_headers=False)]
    )
    return True


@dataclass
class TrackedDevice:
    address: str
    name: str
    rssi: int
    manufacturer: str = "Unknown"
    last_seen: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    @property
    def distance(self) -> float:
        tx_power = self.tx_power
        return round(10 ** ((tx_power - self.rssi) / (10 * self.path_loss)), 2)

    tx_power: int = -59
    path_loss: float = 2.0


class NearbyBluetoothData:
    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        self.hass = hass
        self.entry = entry
        self.devices: dict[str, TrackedDevice] = {}
        self.listeners = []
        self.add_entities = None
        self.store = Store(hass, STORAGE_VERSION, f"{DOMAIN}_{entry.entry_id}")
        self.lookup_cache: dict[str, str] = {}

    async def async_load(self) -> None:
        saved = await self.store.async_load() or {}
        for address, record in saved.items():
            try:
                self.devices[address] = TrackedDevice(
                    address=address, name=record.get("name") or address,
                    rssi=int(record.get("rssi", -100)), manufacturer=record.get("manufacturer", "Unknown"),
                    last_seen=datetime.fromisoformat(record["last_seen"]),
                    tx_power=self.entry.data[CONF_TX_POWER], path_loss=self.entry.data[CONF_PATH_LOSS],
                )
            except (KeyError, TypeError, ValueError):
                _LOGGER.debug("Skipping malformed stored Bluetooth record %s", address)

    async def async_save(self) -> None:
        await self.store.async_save({address: {
            "name": device.name, "rssi": device.rssi, "manufacturer": device.manufacturer,
            "last_seen": device.last_seen.isoformat(),
        } for address, device in self.devices.items()})

    @callback
    def async_add_listener(self, listener) -> None:
        self.listeners.append(listener)

    @callback
    def notify(self) -> None:
        for listener in tuple(self.listeners):
            listener()

    async def async_lookup_manufacturer(self, address: str) -> str:
        if address in self.lookup_cache:
            return self.lookup_cache[address]
        # MAC address is sent to macvendors.com to resolve its registered OUI.
        session = async_get_clientsession(self.hass)
        try:
            async with session.get(f"https://api.macvendors.com/{address}", timeout=5) as response:
                result = (await response.text()).strip() if response.status == 200 else "Unknown"
        except Exception:  # Network lookup is best-effort; tracking remains local.
            _LOGGER.debug("Manufacturer lookup failed for %s", address)
            result = "Unknown"
        if len(result) > 120 or "Not Found" in result:
            result = "Unknown"
        self.lookup_cache[address] = result or "Unknown"
        if address in self.devices:
            self.devices[address].manufacturer = self.lookup_cache[address]
            self.notify()
            await self.async_save()
        return self.lookup_cache[address]

    @callback
    def handle_advertisement(self, info: bluetooth.BluetoothServiceInfoBleak, change: bluetooth.BluetoothChange) -> None:
        address = info.address.upper()
        is_new = address not in self.devices
        device = self.devices.get(address)
        name = info.name or getattr(info.device, "name", None) or address
        if device is None:
            device = self.devices[address] = TrackedDevice(
                address, name, info.rssi, tx_power=self.entry.data[CONF_TX_POWER],
                path_loss=self.entry.data[CONF_PATH_LOSS],
            )
            if self.add_entities:
                self.add_entities(address)
            if is_new and self.entry.data[CONF_ALERT_NEW] and info.rssi >= self.entry.data[CONF_MIN_RSSI]:
                self.hass.async_create_task(self._alert_new(device))
            self.hass.async_create_task(self.async_lookup_manufacturer(address))
        device.name = name
        device.rssi = info.rssi
        device.last_seen = datetime.now(timezone.utc)
        self.notify()
        self.hass.async_create_task(self.async_save())

    async def _alert_new(self, device: TrackedDevice) -> None:
        await self.hass.services.async_call("persistent_notification", "create", {
            "title": "New Bluetooth device nearby",
            "message": f"{device.name} ({device.address}) detected at about {device.distance} m. RSSI: {device.rssi} dBm.",
            "notification_id": f"{DOMAIN}_{device.address.replace(':', '')}",
        })
        self.hass.bus.async_fire(f"{DOMAIN}_device_discovered", {
            "address": device.address, "name": device.name, "rssi": device.rssi, "distance": device.distance,
        })


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    data = NearbyBluetoothData(hass, entry)
    await data.async_load()
    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = data

    @callback
    def handle(info, change):
        data.handle_advertisement(info, change)

    entry.async_on_unload(bluetooth.async_register_callback(
        hass, handle, {"connectable": False}, bluetooth.BluetoothScanningMode.PASSIVE
    ))
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    if DOMAIN not in hass.data.get("frontend_panels", {}):
        await panel_custom.async_register_panel(
            hass,
            webcomponent_name="nearby-bluetooth-panel",
            frontend_url_path=DOMAIN,
            sidebar_title="Bluetooth Radar",
            sidebar_icon="mdi:radar",
            module_url=f"/api/{DOMAIN}/static/panel.js?v={PANEL_VERSION}",
        )
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    if unload_ok := await hass.config_entries.async_unload_platforms(entry, PLATFORMS):
        hass.data[DOMAIN].pop(entry.entry_id)
        frontend.async_remove_panel(hass, DOMAIN, warn_if_unknown=False)
    return unload_ok
"