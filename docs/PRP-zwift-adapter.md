# PRP: ioBroker.zwift — Zwift Live Workout Data Adapter

**Created:** 2026-03-02
**Updated:** 2026-03-03
**Status:** Implemented
**Confidence Score:** 8/10

---

## Goal

### Feature Goal
Build an ioBroker adapter that authenticates against the Zwift API, polls live workout data at a configurable interval, and updates the ioBroker object tree with real-time cycling metrics (power, heart rate, cadence, speed, distance, altitude, calories).

### Deliverable
A fully functional ioBroker adapter (`ioBroker.zwift`) that:
1. Authenticates with Zwift using username/password credentials (stored encrypted)
2. Polls the Zwift API at a user-defined interval (default: 5 seconds)
3. Creates and maintains an ioBroker state tree with live workout data
4. Shows connection status via `info.connection`
5. Handles token refresh, errors, and graceful shutdown

### Success Definition
- Adapter starts, authenticates with Zwift, and sets `info.connection` to `true`
- During an active Zwift ride, states update every polling interval with live data
- When not riding, adapter continues polling without errors (states show last known or null values)
- Admin UI allows configuring credentials and polling interval
- `npm run test:package` passes
- `npm run check` (TypeScript type-check) passes
- `npm run lint` passes

---

## Context

### Zwift API

#### Authentication
```
POST https://secure.zwift.com/auth/realms/zwift/tokens/access/codes
Content-Type: application/x-www-form-urlencoded

client_id=Zwift_Mobile_Link
grant_type=password
username=<zwift_email>
password=<zwift_password>
```

Response:
```json
{
  "access_token": "...",
  "expires_in": 21600,
  "refresh_token": "...",
  "refresh_expires_in": 691200,
  "token_type": "Bearer"
}
```

Token refresh:
```
POST https://secure.zwift.com/auth/realms/zwift/tokens/access/codes
Content-Type: application/x-www-form-urlencoded

client_id=Zwift_Mobile_Link
grant_type=refresh_token
refresh_token=<refresh_token>
```

**Important:** Use `client_id=Zwift_Mobile_Link` — this works with regular Zwift accounts. The newer `Developer Client` requires a special developer account that Zwift does not grant to hobby developers.

#### API Endpoints

**Base URL:** `https://us-or-rly101.zwift.com`

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/profiles/me` | GET | Get authenticated user's profile (contains `id` = playerId) |
| `/relay/worlds/1/players/{playerId}` | GET | Get live rider status (power, HR, cadence, speed, etc.) |

**Request headers for all API calls:**
```
Authorization: Bearer <access_token>
Accept: application/json
User-Agent: Zwift/115 CFNetwork/758.0.2 Darwin/15.0.0
```

#### Profile Response (key fields)
```json
{
  "id": 123456,
  "firstName": "John",
  "lastName": "Doe",
  "weight": 75000,
  "height": 180,
  "currentActivityId": 789012
}
```

#### Rider Status Response (PlayerState — key fields)

**Important:** The relay endpoint can return either protobuf or JSON depending on the `Accept` header.
Use `Accept: application/json` to get JSON (confirmed from [zwift-mobile-api source](https://github.com/Ogadai/zwift-mobile-api/blob/master/src/Request.js)).

The protobuf schema defines these fields (from [zwiftMessages.proto](https://github.com/Ogadai/zwift-mobile-api/blob/master/src/zwiftMessages.proto)):
```protobuf
message PlayerState {
    int32 id = 1;
    int64 worldTime = 2;
    int32 distance = 3;
    int32 laps = 5;
    int32 speed = 6;
    int32 cadenceUHz = 9;
    int32 heartrate = 11;
    int32 power = 12;
    int32 climbing = 15;
    int32 time = 16;
    int32 calories = 24;
    float x = 25;
    float altitude = 26;
    float y = 27;
    int64 sport = 31;
}
```

Example JSON response:
```json
{
  "id": 123456,
  "power": 250,
  "heartrate": 145,
  "cadenceUHz": 1500000,
  "speed": 7070934,
  "distance": 1500000,
  "altitude": 15050,
  "climbing": 50000,
  "calories": 450,
  "time": 3600,
  "sport": 0
}
```

**Unit conversions required:**

Sources: [zwift_hass sensor.py](https://github.com/snicker/zwift_hass/blob/master/custom_components/zwift/sensor.py), [zwift-mobile-api riderStatus.js](https://github.com/Ogadai/zwift-mobile-api/blob/master/src/riderStatus.js), [Speed units issue #23](https://github.com/Ogadai/zwift-mobile-api/issues/23)

| Field | Raw Unit | Target Unit | Conversion | Status |
|-------|----------|-------------|------------|--------|
| `speed` | internal | km/h | `raw / 1000000` | confirmed |
| `cadenceUHz` | µHz | rpm | `raw * 60 / 1000000` | confirmed |
| `altitude` | internal | m | `(raw - 9000) / 2 * 0.3048` | confirmed |
| `distance` | internal | km | `raw / 1000` | confirmed (was off by 100x in initial PRP) |
| `climbing` | internal | m | `raw` direct (already in meters) | confirmed (was off by 100x in initial PRP) |
| `power` | W | W | direct | confirmed |
| `heartrate` | bpm | bpm | direct | confirmed |
| `calories` | kJ | kJ | direct (matches Zwift in-game display) | confirmed (was labeled kcal in initial PRP) |
| `time` | s | s | direct | confirmed |
| `progress` | raw | raw | direct (no % unit, raw value exposed) | confirmed |

**Implementation note:** The initial PRP had uncertainty around distance, climbing, and calorie conversions. After testing against the Zwift in-game display, the correct conversions are documented above. Distance uses `raw / 1000` (not `/100000`), climbing is already in meters (no division needed), and calories are in kJ (not kcal).

#### Rate Limits
No official rate limits documented. Community consensus: polling every 5 seconds is safe. Use a single request per poll cycle (no concurrency needed).

#### Edge Cases
- When rider is NOT in a world (not riding): the rider status endpoint returns 404 or empty. Handle gracefully — set `isRiding` to `false`, keep last known values or set to `null`.
- Token expiry: access_token expires after ~6 hours (`expires_in`). Check before each request, refresh proactively.
- World ID: All riders currently appear in world `1`. Hardcode this.

### Codebase Structure

```
ioBroker.zwift/
├── main.js                    # Adapter entry point — MAIN FILE TO MODIFY
├── io-package.json            # Adapter metadata, native config, instanceObjects
├── package.json               # Dependencies
├── admin/
│   ├── jsonConfig.json        # Admin UI configuration panel
│   └── i18n/                  # Translations (en.json, de.json, etc.)
├── lib/
│   └── adapter-config.d.ts    # Auto-derived TypeScript types from io-package.json native
└── test/
    └── integration.js         # Integration tests (uses @iobroker/testing)
```

### Existing Configuration (to be replaced)

**io-package.json `native` section** currently has placeholder `option1`/`option2`. These map directly to `this.config.*` at runtime. The `lib/adapter-config.d.ts` auto-derives types from this section.

**admin/jsonConfig.json** currently has placeholder checkbox and text fields.

### ioBroker Adapter Patterns

#### State Creation
```javascript
// Using extendObjectAsync so metadata changes (units, names) are applied on restart
await this.extendObjectAsync("power", {
  type: "state",
  common: {
    name: "Current Power",
    type: "number",
    role: "value.power",
    unit: "W",
    read: true,
    write: false,
  },
  native: {},
});
```

**Note:** The implementation uses `extendObjectAsync` instead of `setObjectNotExistsAsync`. This ensures that when units or names are corrected in a new adapter version, the changes are applied automatically on restart without requiring users to delete and recreate objects.

#### State Update (always use `ack: true` for values from API)
```javascript
await this.setStateAsync("power", { val: 250, ack: true });
```

#### Polling (use adapter-core built-in)
```javascript
this.pollingTimer = this.setInterval(() => this.fetchData(), interval);
// Automatically cleaned up on adapter stop — but also clear in onUnload for safety
```

#### Connection State
```javascript
await this.setStateAsync("info.connection", true, true);  // connected
await this.setStateAsync("info.connection", false, true);  // disconnected
```

#### Encrypted Config
In `io-package.json`, add `encryptedNative` and `protectedNative` arrays to auto-encrypt/protect the password field. At runtime, `this.config.password` is automatically decrypted.

---

## Implementation Tasks

### Task 1: Update adapter configuration files

**Files:** `io-package.json`, `admin/jsonConfig.json`, `admin/i18n/en.json`, `admin/i18n/de.json`

**io-package.json changes:**

1. Replace `native` section:
```json
"native": {
  "username": "",
  "password": "",
  "pollingInterval": 5
}
```

2. Add after `"native"`:
```json
"encryptedNative": ["password"],
"protectedNative": ["password"],
```

3. Replace `instanceObjects` with:
```json
"instanceObjects": [
  {
    "_id": "info",
    "type": "channel",
    "common": { "name": "Information" },
    "native": {}
  },
  {
    "_id": "info.connection",
    "type": "state",
    "common": {
      "role": "indicator.connected",
      "name": "Device or service connected",
      "type": "boolean",
      "read": true,
      "write": false,
      "def": false
    },
    "native": {}
  }
]
```

**admin/jsonConfig.json** — replace entirely:
```json
{
  "i18n": true,
  "type": "panel",
  "items": {
    "username": {
      "type": "text",
      "label": "username",
      "newLine": true,
      "xs": 12,
      "sm": 12,
      "md": 6,
      "lg": 4,
      "xl": 4
    },
    "password": {
      "type": "password",
      "label": "password",
      "newLine": true,
      "xs": 12,
      "sm": 12,
      "md": 6,
      "lg": 4,
      "xl": 4
    },
    "pollingInterval": {
      "type": "number",
      "label": "pollingInterval",
      "min": 3,
      "max": 300,
      "newLine": true,
      "xs": 12,
      "sm": 12,
      "md": 6,
      "lg": 4,
      "xl": 4
    }
  }
}
```

**admin/i18n/en.json** — replace:
```json
{
  "username": "Zwift Email",
  "password": "Zwift Password",
  "pollingInterval": "Polling Interval (seconds)"
}
```

**admin/i18n/de.json** — replace:
```json
{
  "username": "Zwift E-Mail",
  "password": "Zwift Passwort",
  "pollingInterval": "Abfrageintervall (Sekunden)"
}
```

Update other i18n files similarly (or copy en.json as fallback).

### Task 2: Add axios dependency

**Command:** `npm install axios`

This adds the HTTP client used for all Zwift API calls.

### Task 3: Implement the Zwift API client module

**File:** `lib/zwiftClient.js` (NEW)

Create a lightweight Zwift API client class:

```javascript
"use strict";

const axios = require("axios");

const AUTH_URL = "https://secure.zwift.com/auth/realms/zwift/tokens/access/codes";
const BASE_URL = "https://us-or-rly101.zwift.com";
const CLIENT_ID = "Zwift_Mobile_Link";
const USER_AGENT = "Zwift/115 CFNetwork/758.0.2 Darwin/15.0.0";

class ZwiftClient {
  constructor(username, password, log) {
    this.username = username;
    this.password = password;
    this.log = log;
    this.accessToken = null;
    this.refreshToken = null;
    this.tokenExpiry = 0;
    this.playerId = null;
  }

  async authenticate() { ... }       // POST password grant, store tokens
  async refreshAccessToken() { ... } // POST refresh_token grant
  async ensureValidToken() { ... }   // Check expiry, refresh if needed
  async getProfile() { ... }         // GET /api/profiles/me → store playerId
  async getRiderStatus() { ... }     // GET /relay/worlds/1/players/{playerId}
}
```

**Key implementation details:**
- `authenticate()`: POST to AUTH_URL with `grant_type=password`, store `access_token`, `refresh_token`, calculate `tokenExpiry = Date.now() + (expires_in - 60) * 1000` (refresh 60s early)
- `ensureValidToken()`: If `Date.now() >= tokenExpiry`, call `refreshAccessToken()`. If refresh fails, call `authenticate()` again.
- `getProfile()`: GET `${BASE_URL}/api/profiles/me` with auth header. Store `this.playerId = response.data.id`. Return the full profile object (needed for profile states).
- `getRiderStatus()`: GET `${BASE_URL}/relay/worlds/1/players/${this.playerId}` with auth header. Return player state JSON. Return `null` if 404 (not riding).
- All requests use `axios` with `timeout: 10000`, `User-Agent` header, `Accept: application/json`.
- All methods propagate errors (let the adapter handle them).

### Task 4: Implement the main adapter logic

**File:** `main.js` — REPLACE the adapter body entirely.

**Structure:**

```javascript
"use strict";

const utils = require("@iobroker/adapter-core");
const ZwiftClient = require("./lib/zwiftClient");

class Zwift extends utils.Adapter {
  constructor(options) {
    super({ ...options, name: "zwift" });
    this.on("ready", this.onReady.bind(this));
    this.on("unload", this.onUnload.bind(this));
    this.zwiftClient = null;
    this.pollingTimer = null;
    this.ftp = 0; // FTP from Zwift profile, used for power zone calculation
  }

  async onReady() {
    // 1. Validate config
    if (!this.config.username || !this.config.password) {
      this.log.error("Zwift username and password must be configured");
      return;
    }

    // 2. Create state objects
    await this.createStates();

    // 3. Initialize Zwift client
    this.zwiftClient = new ZwiftClient(this.config.username, this.config.password, this.log);

    // 4. Authenticate, get profile, and read FTP for power zones
    try {
      await this.zwiftClient.authenticate();
      const profile = await this.zwiftClient.getProfile();
      await this.setStateAsync("info.connection", true, true);
      this.log.info(`Connected to Zwift as player ${this.zwiftClient.playerId}`);
      this.ftp = profile.ftp || 0;
      if (this.ftp > 0) {
        this.log.info(`FTP from Zwift profile: ${this.ftp} W`);
      } else {
        this.log.warn("No FTP found in Zwift profile, power zones will not be calculated");
      }
      await this.updateProfileStates(profile);
    } catch (error) {
      this.log.error(`Failed to connect to Zwift: ${error.message}`);
      await this.setStateAsync("info.connection", false, true);
      return;
    }

    // 5. Initial fetch + start polling
    await this.pollZwift();
    const interval = Math.max(3, this.config.pollingInterval || 5) * 1000;
    this.pollingTimer = this.setInterval(() => this.pollZwift(), interval);
  }

  async createStates() {
    // Create all state objects using extendObjectAsync (so metadata updates are applied on restart)
    // See full state definition tables above for all states
    // Create a "profile" channel for profile.* states:
    //   await this.setObjectNotExistsAsync("profile", { type: "channel", common: { name: "Zwift Profile" }, native: {} });
    // Then create each state as per the tables above
  }

  async pollZwift() {
    try {
      await this.zwiftClient.ensureValidToken();
      const status = await this.zwiftClient.getRiderStatus();
      if (status) {
        await this.updateStates(status);
        await this.setStateAsync("isRiding", true, true);
        await this.setStateAsync("info.connection", true, true);
      } else {
        await this.setStateAsync("isRiding", false, true);
      }
    } catch (error) {
      this.log.warn(`Polling failed: ${error.message}`);
      await this.setStateAsync("info.connection", false, true);
    }
  }

  async updateStates(status) {
    // Convert units and update each state

    // Core performance metrics
    const power = status.power || 0;
    await this.setStateAsync("power", { val: power, ack: true });

    // Power zone calculation (Coggan 6-zone model, FTP from profile)
    if (this.ftp > 0) {
      const pctFtp = (power / this.ftp) * 100;
      let zone = 1;
      if (pctFtp > 120) zone = 6;
      else if (pctFtp > 105) zone = 5;
      else if (pctFtp > 90) zone = 4;
      else if (pctFtp > 75) zone = 3;
      else if (pctFtp >= 55) zone = 2;
      await this.setStateAsync("powerZone", { val: zone, ack: true });
    }

    await this.setStateAsync("heartrate", { val: status.heartrate || 0, ack: true });
    await this.setStateAsync("cadence", { val: Math.round((status.cadenceUHz || 0) * 60 / 1000000), ack: true });
    await this.setStateAsync("speed", { val: Math.round((status.speed || 0) / 1000000 * 10) / 10, ack: true });

    // Distance and elevation
    await this.setStateAsync("distance", { val: Math.round((status.distance || 0) / 1000 * 100) / 100, ack: true });
    await this.setStateAsync("altitude", { val: Math.round(((status.altitude || 9000) - 9000) / 2 * 0.3048 * 10) / 10, ack: true });
    await this.setStateAsync("climbing", { val: Math.round((status.climbing || 0) * 10) / 10, ack: true });

    // Session data (calories are kJ, matching Zwift in-game display)
    await this.setStateAsync("calories", { val: status.calories || 0, ack: true });
    await this.setStateAsync("time", { val: status.time || 0, ack: true });
    await this.setStateAsync("laps", { val: status.laps || 0, ack: true });
    await this.setStateAsync("progress", { val: status.progress || 0, ack: true });
    await this.setStateAsync("sport", { val: status.sport || 0, ack: true });

    // World/group data
    await this.setStateAsync("groupId", { val: status.groupId || 0, ack: true });
    await this.setStateAsync("x", { val: status.x || 0, ack: true });
    await this.setStateAsync("y", { val: status.y || 0, ack: true });
    await this.setStateAsync("heading", { val: status.heading || 0, ack: true });
    await this.setStateAsync("lean", { val: status.lean || 0, ack: true });
    await this.setStateAsync("watchingRiderId", { val: status.watchingRiderId || 0, ack: true });

    // Decoded bitfields (from f19/f20)
    if (status.f19 !== undefined) {
      await this.setStateAsync("rideOns", { val: (status.f19 >> 24) & 0xfff, ack: true });
      await this.setStateAsync("courseId", { val: (status.f19 & 0xff0000) >> 16, ack: true });
    }
    if (status.f20 !== undefined) {
      await this.setStateAsync("roadId", { val: (status.f20 & 0xff00) >> 8, ack: true });
    }
  }

  async updateProfileStates(profile) {
    await this.setStateAsync("profile.id", { val: profile.id, ack: true });
    await this.setStateAsync("profile.firstName", { val: profile.firstName || "", ack: true });
    await this.setStateAsync("profile.lastName", { val: profile.lastName || "", ack: true });
    await this.setStateAsync("profile.weight", { val: Math.round((profile.weight || 0) / 100) / 10, ack: true });
    await this.setStateAsync("profile.height", { val: Math.round((profile.height || 0) / 10), ack: true });
    await this.setStateAsync("profile.age", { val: profile.age || 0, ack: true });
    await this.setStateAsync("profile.male", { val: !!profile.male, ack: true });
    await this.setStateAsync("profile.countryCode", { val: profile.countryCode || 0, ack: true });
    await this.setStateAsync("profile.ftp", { val: profile.ftp || 0, ack: true });
    await this.setStateAsync("profile.totalDistance", { val: Math.round((profile.totalDistance || 0) / 100) / 10, ack: true });
    await this.setStateAsync("profile.totalDistanceClimbed", { val: profile.totalDistanceClimbed || 0, ack: true });
    await this.setStateAsync("profile.totalTimeInMinutes", { val: profile.totalTimeInMinutes || 0, ack: true });
    await this.setStateAsync("profile.totalWattHours", { val: profile.totalWattHours || 0, ack: true });
    await this.setStateAsync("profile.totalExperiencePoints", { val: profile.totalExperiencePoints || 0, ack: true });
    await this.setStateAsync("profile.targetExperiencePoints", { val: profile.targetExperiencePoints || 0, ack: true });
    await this.setStateAsync("profile.achievementLevel", { val: profile.achievementLevel || 0, ack: true });
    await this.setStateAsync("profile.totalGold", { val: profile.totalGold || 0, ack: true });
    await this.setStateAsync("profile.totalInKomJersey", { val: profile.totalInKomJersey || 0, ack: true });
    await this.setStateAsync("profile.totalInSprintersJersey", { val: profile.totalInSprintersJersey || 0, ack: true });
    await this.setStateAsync("profile.totalInOrangeJersey", { val: profile.totalInOrangeJersey || 0, ack: true });
    await this.setStateAsync("profile.runAchievementLevel", { val: profile.runAchievementLevel || 0, ack: true });
    await this.setStateAsync("profile.totalRunDistance", { val: profile.totalRunDistance || 0, ack: true });
    await this.setStateAsync("profile.totalRunTimeInMinutes", { val: profile.totalRunTimeInMinutes || 0, ack: true });
    await this.setStateAsync("profile.totalRunExperiencePoints", { val: profile.totalRunExperiencePoints || 0, ack: true });
    await this.setStateAsync("profile.targetRunExperiencePoints", { val: profile.targetRunExperiencePoints || 0, ack: true });
    await this.setStateAsync("profile.totalRunCalories", { val: profile.totalRunCalories || 0, ack: true });
    await this.setStateAsync("profile.streaksCurrentLength", { val: profile.streaksCurrentLength || 0, ack: true });
    await this.setStateAsync("profile.streaksMaxLength", { val: profile.streaksMaxLength || 0, ack: true });
    await this.setStateAsync("profile.streaksLastRideTimestamp", { val: profile.streaksLastRideTimestamp || "", ack: true });
    await this.setStateAsync("profile.currentActivityId", { val: profile.currentActivityId || 0, ack: true });
    await this.setStateAsync("profile.powerSource", { val: profile.powerSource || 0, ack: true });
  }

  onUnload(callback) {
    try {
      if (this.pollingTimer) {
        this.clearInterval(this.pollingTimer);
        this.pollingTimer = null;
      }
      this.setState("info.connection", false, true);
      callback();
    } catch (e) {
      callback();
    }
  }
}

if (require.main !== module) {
  module.exports = (options) => new Zwift(options);
} else {
  new Zwift();
}
```

**State definitions for `createStates()`:**

All states: `read: true`, `write: false`.

**Rider data** (from PlayerState, updated every poll cycle):

| State ID | Type | Role | Unit | Name | Source / Conversion |
|----------|------|------|------|------|---------------------|
| `isRiding` | boolean | `indicator` | — | Currently Riding | derived: `true` if status returned, `false` if 404 |
| `power` | number | `value.power` | W | Current Power | `status.power` direct |
| `powerZone` | number | `value` | — | Power Zone | Coggan 6-zone model based on FTP from profile (1-6) |
| `heartrate` | number | `value.health.bpm` | bpm | Heart Rate | `status.heartrate` direct |
| `cadence` | number | `value` | rpm | Cadence | `status.cadenceUHz * 60 / 1000000` |
| `speed` | number | `value.speed` | km/h | Speed | `status.speed / 1000000` |
| `distance` | number | `value.distance` | km | Distance | `status.distance / 1000` |
| `altitude` | number | `value.gps.elevation` | m | Altitude | `(status.altitude - 9000) / 2 * 0.3048` |
| `climbing` | number | `value` | m | Total Climbing | `status.climbing` direct (already in meters) |
| `calories` | number | `value` | kJ | Calories | `status.calories` direct (kJ, matches Zwift display) |
| `time` | number | `value` | s | Ride Time | `status.time` direct |
| `laps` | number | `value` | — | Laps Completed | `status.laps` direct |
| `progress` | number | `value` | — | Route Progress | `status.progress` direct (raw value) |
| `sport` | number | `value` | — | Sport Type | `status.sport` direct (0=cycling) |
| `groupId` | number | `value` | — | Group/Event ID | `status.groupId` direct (0=no group) |
| `x` | number | `value` | — | World Position X | `status.x` direct (float) |
| `y` | number | `value` | — | World Position Y | `status.y` direct (float) |
| `heading` | number | `value` | — | Heading | `status.heading` direct |
| `lean` | number | `value` | — | Lean Angle | `status.lean` direct |
| `watchingRiderId` | number | `value` | — | Watching Rider ID | `status.watchingRiderId` direct |
| `rideOns` | number | `value` | — | Ride Ons | `(status.f19 >> 24) & 0xfff` (decoded from bitfield) |
| `courseId` | number | `value` | — | Course ID | `(status.f19 & 0xff0000) >> 16` (decoded from bitfield) |
| `roadId` | number | `value` | — | Road ID | `(status.f20 & 0xff00) >> 8` (decoded from bitfield) |

**Profile data** (from `/api/profiles/me`, fetched once on connect):

| State ID | Type | Role | Unit | Name | Source |
|----------|------|------|------|------|--------|
| `profile.id` | number | `value` | — | Player ID | `profile.id` |
| `profile.firstName` | string | `text` | — | First Name | `profile.firstName` |
| `profile.lastName` | string | `text` | — | Last Name | `profile.lastName` |
| `profile.weight` | number | `value` | kg | Weight | `profile.weight / 1000` (stored as grams) |
| `profile.height` | number | `value` | cm | Height | `profile.height / 10` (stored as mm) |
| `profile.age` | number | `value` | — | Age | `profile.age` direct |
| `profile.male` | boolean | `indicator` | — | Male | `profile.male` direct |
| `profile.countryCode` | number | `value` | — | Country Code | `profile.countryCode` direct |
| `profile.ftp` | number | `value` | W | FTP | `profile.ftp` direct (used for power zone calculation) |
| `profile.totalDistance` | number | `value` | km | Total Distance (all time) | `profile.totalDistance / 1000` (stored as m) |
| `profile.totalDistanceClimbed` | number | `value` | m | Total Climbing (all time) | `profile.totalDistanceClimbed` direct |
| `profile.totalTimeInMinutes` | number | `value` | min | Total Time (all time) | `profile.totalTimeInMinutes` direct |
| `profile.totalWattHours` | number | `value` | Wh | Total Watt Hours (all time) | `profile.totalWattHours` direct |
| `profile.totalExperiencePoints` | number | `value` | — | Total XP | `profile.totalExperiencePoints` direct |
| `profile.targetExperiencePoints` | number | `value` | — | Target XP | `profile.targetExperiencePoints` direct |
| `profile.achievementLevel` | number | `value` | — | Level | `profile.achievementLevel` direct |
| `profile.totalGold` | number | `value` | — | Total Drops | `profile.totalGold` direct |
| `profile.totalInKomJersey` | number | `value` | — | Total in KOM Jersey | `profile.totalInKomJersey` direct |
| `profile.totalInSprintersJersey` | number | `value` | — | Total in Sprinters Jersey | `profile.totalInSprintersJersey` direct |
| `profile.totalInOrangeJersey` | number | `value` | — | Total in Orange Jersey | `profile.totalInOrangeJersey` direct |
| `profile.runAchievementLevel` | number | `value` | — | Run Level | `profile.runAchievementLevel` direct |
| `profile.totalRunDistance` | number | `value` | km | Total Run Distance | `profile.totalRunDistance` direct |
| `profile.totalRunTimeInMinutes` | number | `value` | min | Total Run Time | `profile.totalRunTimeInMinutes` direct |
| `profile.totalRunExperiencePoints` | number | `value` | — | Total Run XP | `profile.totalRunExperiencePoints` direct |
| `profile.targetRunExperiencePoints` | number | `value` | — | Target Run XP | `profile.targetRunExperiencePoints` direct |
| `profile.totalRunCalories` | number | `value` | kJ | Total Run Calories | `profile.totalRunCalories` direct |
| `profile.streaksCurrentLength` | number | `value` | — | Current Streak | `profile.streaksCurrentLength` direct |
| `profile.streaksMaxLength` | number | `value` | — | Max Streak | `profile.streaksMaxLength` direct |
| `profile.streaksLastRideTimestamp` | string | `text` | — | Last Ride Timestamp | `profile.streaksLastRideTimestamp` direct |
| `profile.currentActivityId` | number | `value` | — | Current Activity ID | `profile.currentActivityId` direct |
| `profile.powerSource` | number | `value` | — | Power Source Type | `profile.powerSource` direct |

### Task 5: Remove unnecessary code

**File:** `main.js`

Remove from the final implementation:
- The `onStateChange` handler (we don't need it — all states are read-only from the API)
- The `this.on("stateChange", ...)` line from the constructor
- The `subscribeStates` call
- All the example/template code comments

**File:** `io-package.json`

Remove `testVariable` from `objects` array (should already be empty).

### Task 6: Update translations

**Files:** All `admin/i18n/*.json` files

Ensure all locale files have at least the English keys as fallback:
```json
{
  "username": "Zwift Email",
  "password": "Zwift Password",
  "pollingInterval": "Polling Interval (seconds)"
}
```

For `de.json`:
```json
{
  "username": "Zwift E-Mail",
  "password": "Zwift Passwort",
  "pollingInterval": "Abfrageintervall (Sekunden)"
}
```

### Task 7: Validate

Run these commands and ensure they pass:
```bash
npm install
npm run check          # TypeScript type checking
npm run lint           # ESLint
npm run test:package   # Package structure tests
```

---

## Final Validation Checklist

- [ ] `io-package.json` has correct native config (username, password, pollingInterval)
- [ ] `io-package.json` has `encryptedNative` and `protectedNative` for password
- [ ] `io-package.json` has `instanceObjects` with `info.connection`
- [ ] `admin/jsonConfig.json` has text, password, and number fields
- [ ] `admin/i18n/en.json` has labels for all config fields
- [ ] `lib/zwiftClient.js` implements auth, token refresh, profile, and rider status
- [ ] `main.js` validates config, creates states, authenticates, stores profile data, polls, updates rider + profile states, handles unload
- [x] All PlayerState fields mapped (power, powerZone, HR, cadence, speed, distance, altitude, climbing, calories, time, laps, progress, sport, groupId, x, y, heading, lean, watchingRiderId, rideOns, courseId, roadId)
- [x] Profile channel with all profile states (id, name, weight, height, age, ftp, cycling stats, running stats, jerseys, Drops, streaks, currentActivityId, powerSource)
- [ ] All states use `ack: true` for API-sourced values
- [ ] `info.connection` is set to true/false based on API connectivity
- [ ] Polling timer is cleared in `onUnload`
- [ ] `package.json` has `axios` as a dependency
- [ ] `npm run check` passes
- [ ] `npm run lint` passes
- [ ] `npm run test:package` passes
- [ ] No hardcoded credentials anywhere
- [ ] Password is never logged

---

## Architecture Notes

### Why build our own API client?
Existing npm packages (`zwift-mobile-api`, etc.) are either:
- Tied to the Developer API (requires special account Zwift won't grant)
- Unmaintained or overly complex for our needs

We only need 3 endpoints: auth token, profile, rider status. A ~100-line `axios`-based client is simpler, more maintainable, and works with regular Zwift accounts.

### Why `Zwift_Mobile_Link` client_id?
This is the client_id used by the Zwift Companion app. It works with regular Zwift accounts (no developer account needed). The newer `Developer Client` requires contacting developers@zwift.com which "is not available to hobby developers."

### Why world ID `1`?
All Zwift riders currently appear in world `1` regardless of which map/route they're riding. This is a Zwift implementation detail that has been stable for years.

### Why no `onStateChange`?
All adapter states are read-only (sourced from the Zwift API). There are no writable states that need command handling.

### Polling vs. WebSocket
Zwift does not expose a public WebSocket/streaming API. Polling the REST endpoint is the only option for external integrations. A 5-second interval provides near-real-time data while being conservative on API usage.
