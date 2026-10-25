# Nearby Bluetooth Radar for Home Assistant

A custom integration that listens to Bluetooth advertisements through Home Assistant's shared Bluetooth stack. It creates a device with signal strength, estimated distance, manufacturer, and last-seen sensors for each MAC address. New devices can generate a persistent notification and a `nearby_bluetooth_device_discovered` event for automations.

## Install

Copy `custom_components/nearby_bluetooth` into your Home Assistant `config/custom_components/` directory, restart Home Assistant, then add **Nearby Bluetooth Radar** from **Settings → Devices & services → Add integration**. A working Bluetooth adapter or ESPHome Bluetooth proxy is needed.

## Distance and manufacturer

Distance is estimated with `10 ** ((RSSI_at_1m - current_RSSI) / (10 * path_loss))`. The defaults (-59 dBm at one metre and path-loss 2) are starting points; walls, bodies, device orientation, and multipath can cause large errors. RSSI is not a precise ranging method.

Manufacturer is looked up from the MAC address using `api.macvendors.com`. This sends each observed MAC address to that service, is best-effort, and may not identify randomized/private addresses. Manufacturer lookups are cached in memory for the current run.

## Automation

Listen for `nearby_bluetooth_device_discovered`. Event data includes `address`, `name`, `rssi`, and estimated `distance`. The integration also creates a persistent notification when new-device alerts are enabled in setup.
