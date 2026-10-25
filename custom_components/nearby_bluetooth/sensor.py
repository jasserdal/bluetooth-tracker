"""Sensors for observed Bluetooth devices."""
from __future__ import annotations

from homeassistant.components.sensor import SensorEntity, SensorDeviceClass
from homeassistant.const import UnitOfLength
from homeassistant.core import callback
from homeassistant.helpers.entity import DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import EntityCategory
from homeassistant import core

from . import NearbyBluetoothData
from .const import DOMAIN


async def async_setup_entry(hass: core.HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback) -> None:
    data: NearbyBluetoothData = hass.data[DOMAIN][entry.entry_id]
    entities: dict[str, list[SensorEntity]] = {}

    @callback
    def add_for_address(address: str) -> None:
        if address in entities:
            return
        group = [BluetoothDeviceSensor(data, address, "rssi"), BluetoothDeviceSensor(data, address, "distance"),
                 BluetoothDeviceSensor(data, address, "manufacturer"), BluetoothDeviceSensor(data, address, "last_seen")]
        entities[address] = group
        async_add_entities(group)

    data.add_entities = add_for_address
    for address in data.devices:
        add_for_address(address)


class BluetoothDeviceSensor(SensorEntity):
    _attr_has_entity_name = True
    _attr_entity_category = EntityCategory.DIAGNOSTIC

    def __init__(self, data: NearbyBluetoothData, address: str, kind: str) -> None:
        self.data = data
        self.address = address
        self.kind = kind
        self._attr_unique_id = f"{address.lower()}_{kind}"
        self._attr_translation_key = kind
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, address)}, name=data.devices[address].name,
            manufacturer=data.devices[address].manufacturer,
            connections={("bluetooth", address)},
        )
        if kind == "rssi":
            # Use the literal to support HA builds that do not export this enum.
            self._attr_native_unit_of_measurement = "dBm"
            self._attr_icon = "mdi:bluetooth"
        elif kind == "distance":
            self._attr_native_unit_of_measurement = UnitOfLength.METERS
            self._attr_device_class = SensorDeviceClass.DISTANCE
            self._attr_suggested_display_precision = 2
        elif kind == "last_seen":
            self._attr_device_class = SensorDeviceClass.TIMESTAMP
        else:
            self._attr_entity_category = EntityCategory.DIAGNOSTIC
            self._attr_icon = "mdi:factory"

    @property
    def native_value(self):
        device = self.data.devices[self.address]
        if self.kind == "rssi":
            return device.rssi
        if self.kind == "distance":
            return device.distance
        if self.kind == "manufacturer":
            return device.manufacturer
        return device.last_seen

    @property
    def extra_state_attributes(self) -> dict[str, str | int | float]:
        """Expose one normalized device record for the sidebar radar."""
        device = self.data.devices[self.address]
        return {
            "nearby_bluetooth_domain": DOMAIN,
            "address": device.address,
            "device_name": device.name,
            "manufacturer": device.manufacturer,
            "rssi": device.rssi,
            "distance": device.distance,
            "last_seen": device.last_seen.isoformat(),
        }

    @callback
    def _handle_update(self) -> None:
        device = self.data.devices[self.address]
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, self.address)}, name=device.name,
            manufacturer=device.manufacturer, connections={("bluetooth", self.address)},
        )
        self.async_write_ha_state()

    async def async_added_to_hass(self) -> None:
        self.data.async_add_listener(self._handle_update)
        self.async_on_remove(lambda: self.data.listeners.remove(self._handle_update)
                             if self._handle_update in self.data.listeners else None)
