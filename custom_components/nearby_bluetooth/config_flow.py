"""Config flow for Nearby Bluetooth Radar."""
from __future__ import annotations

import voluptuous as vol
from homeassistant import config_entries
from homeassistant.const import CONF_NAME

from .const import CONF_ALERT_NEW, CONF_MIN_RSSI, CONF_PATH_LOSS, CONF_TX_POWER, DEFAULT_MIN_RSSI, DEFAULT_PATH_LOSS, DEFAULT_TX_POWER, DOMAIN


class NearbyBluetoothConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Set up a Bluetooth scanner and distance calibration."""

    VERSION = 1

    async def async_step_user(self, user_input=None):
        if user_input is not None:
            await self.async_set_unique_id(DOMAIN)
            self._abort_if_unique_id_configured()
            return self.async_create_entry(title=user_input[CONF_NAME], data=user_input)

        schema = vol.Schema(
            {
                vol.Required(CONF_NAME, default="Nearby Bluetooth"): str,
                vol.Required(CONF_TX_POWER, default=DEFAULT_TX_POWER): vol.Coerce(int),
                vol.Required(CONF_PATH_LOSS, default=DEFAULT_PATH_LOSS): vol.All(vol.Coerce(float), vol.Range(min=1, max=4)),
                vol.Required(CONF_ALERT_NEW, default=True): bool,
                vol.Required(CONF_MIN_RSSI, default=DEFAULT_MIN_RSSI): vol.All(vol.Coerce(int), vol.Range(min=-127, max=0)),
            }
        )
        return self.async_show_form(step_id="user", data_schema=schema)
