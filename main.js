"use strict";

const utils = require("@iobroker/adapter-core");
const ZwiftClient = require("./lib/zwiftClient");

const INITIAL_RETRY_DELAY = 10000; // 10 seconds
const MAX_RETRY_DELAY = 300000; // 5 minutes
const RETRY_BACKOFF_FACTOR = 2;

class Zwift extends utils.Adapter {
	/**
	 * @param {Partial<utils.AdapterOptions>} [options]
	 */
	constructor(options) {
		super({
			...options,
			name: "zwift",
		});
		this.on("ready", this.onReady.bind(this));
		this.on("unload", this.onUnload.bind(this));

		this.zwiftClient = null;
		this.pollingTimeout = null;
		this.pollingInterval = 0;
		this.retryTimeout = null;
		this.retryDelay = INITIAL_RETRY_DELAY;
		this.ftp = 0;
	}

	async onReady() {
		if (!this.config.username || !this.config.password) {
			this.log.error("Zwift username and password must be configured");
			return;
		}

		await this.createStates();

		this.zwiftClient = new ZwiftClient(this.config.username, this.config.password, this.log);
		this.pollingInterval = Math.max(5, this.config.pollingInterval || 5) * 1000;

		await this.connectWithRetry();
	}

	async connectWithRetry() {
		if (!this.zwiftClient) {
			return;
		}
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
			this.retryDelay = INITIAL_RETRY_DELAY;
			await this.pollZwift();
			this.schedulePoll();
		} catch (error) {
			this.log.error(`Failed to connect to Zwift: ${error.message}`);
			await this.setStateAsync("info.connection", false, true);
			this.log.info(`Retrying in ${this.retryDelay / 1000} seconds...`);
			this.retryTimeout = this.setTimeout(() => this.connectWithRetry(), this.retryDelay);
			this.retryDelay = Math.min(this.retryDelay * RETRY_BACKOFF_FACTOR, MAX_RETRY_DELAY);
		}
	}

	schedulePoll() {
		this.pollingTimeout = this.setTimeout(async () => {
			try {
				await this.pollZwift();
			} catch (error) {
				this.log.error(`Unexpected polling error: ${error.message}`);
			}
			this.schedulePoll();
		}, this.pollingInterval);
	}

	async createStates() {
		// Profile channel
		await this.setObjectNotExistsAsync("profile", {
			type: "channel",
			common: { name: "Zwift Profile" },
			native: {},
		});

		// Rider states
		/** @type {Array<{id: string, name: string, type: ioBroker.CommonType, role: string, unit: string}>} */
		const riderStates = [
			{ id: "isRiding", name: "Currently Riding", type: "boolean", role: "indicator", unit: "" },
			{ id: "power", name: "Current Power", type: "number", role: "value.power", unit: "W" },
			{ id: "heartrate", name: "Heart Rate", type: "number", role: "value.health.bpm", unit: "bpm" },
			{ id: "cadence", name: "Cadence", type: "number", role: "value", unit: "rpm" },
			{ id: "speed", name: "Speed", type: "number", role: "value.speed", unit: "km/h" },
			{ id: "distance", name: "Distance", type: "number", role: "value.distance", unit: "km" },
			{ id: "altitude", name: "Altitude", type: "number", role: "value.gps.elevation", unit: "m" },
			{ id: "climbing", name: "Total Climbing", type: "number", role: "value", unit: "m" },
			{ id: "calories", name: "Calories", type: "number", role: "value", unit: "kJ" },
			{ id: "time", name: "Ride Time", type: "number", role: "value", unit: "s" },
			{ id: "laps", name: "Laps Completed", type: "number", role: "value", unit: "" },
			{ id: "progress", name: "Route Progress", type: "number", role: "value", unit: "" },
			{ id: "sport", name: "Sport Type", type: "number", role: "value", unit: "" },
			{ id: "groupId", name: "Group/Event ID", type: "number", role: "value", unit: "" },
			{ id: "x", name: "World Position X", type: "number", role: "value", unit: "" },
			{ id: "y", name: "World Position Y", type: "number", role: "value", unit: "" },
			{ id: "heading", name: "Heading", type: "number", role: "value", unit: "" },
			{ id: "lean", name: "Lean Angle", type: "number", role: "value", unit: "" },
			{ id: "watchingRiderId", name: "Watching Rider ID", type: "number", role: "value", unit: "" },
			{ id: "powerZone", name: "Power Zone", type: "number", role: "value", unit: "" },
			{ id: "rideOns", name: "Ride Ons", type: "number", role: "value", unit: "" },
			{ id: "courseId", name: "Course ID", type: "number", role: "value", unit: "" },
			{ id: "roadId", name: "Road ID", type: "number", role: "value", unit: "" },
		];

		for (const s of riderStates) {
			await this.extendObjectAsync(s.id, {
				type: "state",
				common: {
					name: s.name,
					type: s.type,
					role: s.role,
					unit: s.unit || undefined,
					read: true,
					write: false,
				},
				native: {},
			});
		}

		// Profile states
		/** @type {Array<{id: string, name: string, type: ioBroker.CommonType, role: string, unit?: string}>} */
		const profileStates = [
			{ id: "profile.id", name: "Player ID", type: "number", role: "value" },
			{ id: "profile.firstName", name: "First Name", type: "string", role: "text" },
			{ id: "profile.lastName", name: "Last Name", type: "string", role: "text" },
			{ id: "profile.weight", name: "Weight", type: "number", role: "value", unit: "kg" },
			{ id: "profile.height", name: "Height", type: "number", role: "value", unit: "cm" },
			{ id: "profile.age", name: "Age", type: "number", role: "value" },
			{ id: "profile.male", name: "Male", type: "boolean", role: "indicator" },
			{ id: "profile.countryCode", name: "Country Code", type: "number", role: "value" },
			{
				id: "profile.totalDistance",
				name: "Total Distance (all time)",
				type: "number",
				role: "value",
				unit: "km",
			},
			{
				id: "profile.totalDistanceClimbed",
				name: "Total Climbing (all time)",
				type: "number",
				role: "value",
				unit: "m",
			},
			{
				id: "profile.totalTimeInMinutes",
				name: "Total Time (all time)",
				type: "number",
				role: "value",
				unit: "min",
			},
			{
				id: "profile.totalWattHours",
				name: "Total Watt Hours (all time)",
				type: "number",
				role: "value",
				unit: "Wh",
			},
			{ id: "profile.ftp", name: "FTP", type: "number", role: "value", unit: "W" },
			{ id: "profile.totalExperiencePoints", name: "Total XP", type: "number", role: "value" },
			{ id: "profile.targetExperiencePoints", name: "Target XP", type: "number", role: "value" },
			{ id: "profile.achievementLevel", name: "Level", type: "number", role: "value" },
			{ id: "profile.totalGold", name: "Total Drops", type: "number", role: "value" },
			{ id: "profile.totalInKomJersey", name: "Total in KOM Jersey", type: "number", role: "value" },
			{ id: "profile.totalInSprintersJersey", name: "Total in Sprinters Jersey", type: "number", role: "value" },
			{ id: "profile.totalInOrangeJersey", name: "Total in Orange Jersey", type: "number", role: "value" },
			{ id: "profile.runAchievementLevel", name: "Run Level", type: "number", role: "value" },
			{ id: "profile.totalRunDistance", name: "Total Run Distance", type: "number", role: "value", unit: "km" },
			{ id: "profile.totalRunTimeInMinutes", name: "Total Run Time", type: "number", role: "value", unit: "min" },
			{ id: "profile.totalRunExperiencePoints", name: "Total Run XP", type: "number", role: "value" },
			{ id: "profile.targetRunExperiencePoints", name: "Target Run XP", type: "number", role: "value" },
			{ id: "profile.totalRunCalories", name: "Total Run Calories", type: "number", role: "value", unit: "kJ" },
			{ id: "profile.streaksCurrentLength", name: "Current Streak", type: "number", role: "value" },
			{ id: "profile.streaksMaxLength", name: "Max Streak", type: "number", role: "value" },
			{ id: "profile.streaksLastRideTimestamp", name: "Last Ride Timestamp", type: "string", role: "text" },
			{ id: "profile.currentActivityId", name: "Current Activity ID", type: "number", role: "value" },
			{ id: "profile.powerSource", name: "Power Source Type", type: "number", role: "value" },
		];

		for (const s of profileStates) {
			await this.extendObjectAsync(s.id, {
				type: "state",
				common: {
					name: s.name,
					type: s.type,
					role: s.role,
					unit: s.unit || undefined,
					read: true,
					write: false,
				},
				native: {},
			});
		}
	}

	async pollZwift() {
		if (!this.zwiftClient) {
			return;
		}
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

	/**
	 * @param {Record<string, any>} status
	 */
	async updateStates(status) {
		// Core performance metrics
		const power = status.power || 0;
		await this.setStateAsync("power", { val: power, ack: true });

		// Power zone calculation (Coggan 6-zone model)
		if (this.ftp > 0) {
			const pctFtp = (power / this.ftp) * 100;
			let zone = 1;
			if (pctFtp > 120) {
				zone = 6;
			} else if (pctFtp > 105) {
				zone = 5;
			} else if (pctFtp > 90) {
				zone = 4;
			} else if (pctFtp > 75) {
				zone = 3;
			} else if (pctFtp >= 55) {
				zone = 2;
			}
			await this.setStateAsync("powerZone", { val: zone, ack: true });
		}
		await this.setStateAsync("heartrate", { val: status.heartrate || 0, ack: true });
		await this.setStateAsync("cadence", { val: Math.round(((status.cadenceUHz || 0) * 60) / 1000000), ack: true });
		await this.setStateAsync("speed", { val: Math.round(((status.speed || 0) / 1000000) * 10) / 10, ack: true });

		// Distance and elevation
		await this.setStateAsync("distance", {
			val: Math.round(((status.distance || 0) / 1000) * 100) / 100,
			ack: true,
		});
		await this.setStateAsync("altitude", {
			val: Math.round((((status.altitude || 9000) - 9000) / 2) * 0.3048 * 10) / 10,
			ack: true,
		});
		await this.setStateAsync("climbing", { val: Math.round((status.climbing || 0) * 10) / 10, ack: true });

		// Session data
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

		// Decoded bitfields
		if (status.f19 !== undefined) {
			await this.setStateAsync("rideOns", { val: (status.f19 >> 24) & 0xfff, ack: true });
			await this.setStateAsync("courseId", { val: (status.f19 & 0xff0000) >> 16, ack: true });
		}
		if (status.f20 !== undefined) {
			await this.setStateAsync("roadId", { val: (status.f20 & 0xff00) >> 8, ack: true });
		}
	}

	/**
	 * @param {Record<string, any>} profile
	 */
	async updateProfileStates(profile) {
		await this.setStateAsync("profile.id", { val: profile.id, ack: true });
		await this.setStateAsync("profile.firstName", { val: profile.firstName || "", ack: true });
		await this.setStateAsync("profile.lastName", { val: profile.lastName || "", ack: true });
		await this.setStateAsync("profile.weight", { val: Math.round((profile.weight || 0) / 100) / 10, ack: true });
		await this.setStateAsync("profile.height", { val: Math.round((profile.height || 0) / 10), ack: true });
		await this.setStateAsync("profile.age", { val: profile.age || 0, ack: true });
		await this.setStateAsync("profile.male", { val: !!profile.male, ack: true });
		await this.setStateAsync("profile.countryCode", { val: profile.countryCode || 0, ack: true });
		await this.setStateAsync("profile.totalDistance", {
			val: Math.round((profile.totalDistance || 0) / 100) / 10,
			ack: true,
		});
		await this.setStateAsync("profile.totalDistanceClimbed", { val: profile.totalDistanceClimbed || 0, ack: true });
		await this.setStateAsync("profile.totalTimeInMinutes", { val: profile.totalTimeInMinutes || 0, ack: true });
		await this.setStateAsync("profile.totalWattHours", { val: profile.totalWattHours || 0, ack: true });
		await this.setStateAsync("profile.ftp", { val: profile.ftp || 0, ack: true });
		await this.setStateAsync("profile.totalExperiencePoints", {
			val: profile.totalExperiencePoints || 0,
			ack: true,
		});
		await this.setStateAsync("profile.targetExperiencePoints", {
			val: profile.targetExperiencePoints || 0,
			ack: true,
		});
		await this.setStateAsync("profile.achievementLevel", { val: profile.achievementLevel || 0, ack: true });
		await this.setStateAsync("profile.totalGold", { val: profile.totalGold || 0, ack: true });
		await this.setStateAsync("profile.totalInKomJersey", { val: profile.totalInKomJersey || 0, ack: true });
		await this.setStateAsync("profile.totalInSprintersJersey", {
			val: profile.totalInSprintersJersey || 0,
			ack: true,
		});
		await this.setStateAsync("profile.totalInOrangeJersey", { val: profile.totalInOrangeJersey || 0, ack: true });
		await this.setStateAsync("profile.runAchievementLevel", { val: profile.runAchievementLevel || 0, ack: true });
		await this.setStateAsync("profile.totalRunDistance", { val: profile.totalRunDistance || 0, ack: true });
		await this.setStateAsync("profile.totalRunTimeInMinutes", {
			val: profile.totalRunTimeInMinutes || 0,
			ack: true,
		});
		await this.setStateAsync("profile.totalRunExperiencePoints", {
			val: profile.totalRunExperiencePoints || 0,
			ack: true,
		});
		await this.setStateAsync("profile.targetRunExperiencePoints", {
			val: profile.targetRunExperiencePoints || 0,
			ack: true,
		});
		await this.setStateAsync("profile.totalRunCalories", { val: profile.totalRunCalories || 0, ack: true });
		await this.setStateAsync("profile.streaksCurrentLength", { val: profile.streaksCurrentLength || 0, ack: true });
		await this.setStateAsync("profile.streaksMaxLength", { val: profile.streaksMaxLength || 0, ack: true });
		await this.setStateAsync("profile.streaksLastRideTimestamp", {
			val: profile.streaksLastRideTimestamp || "",
			ack: true,
		});
		await this.setStateAsync("profile.currentActivityId", { val: profile.currentActivityId || 0, ack: true });
		await this.setStateAsync("profile.powerSource", { val: profile.powerSource || 0, ack: true });
	}

	/**
	 * @param {() => void} callback
	 */
	onUnload(callback) {
		try {
			if (this.pollingTimeout) {
				this.clearTimeout(this.pollingTimeout);
				this.pollingTimeout = null;
			}
			if (this.retryTimeout) {
				this.clearTimeout(this.retryTimeout);
				this.retryTimeout = null;
			}
			this.setState("info.connection", false, true);
			callback();
		} catch {
			callback();
		}
	}
}

if (require.main !== module) {
	/**
	 * @param {Partial<utils.AdapterOptions>} [options]
	 */
	module.exports = options => new Zwift(options);
} else {
	new Zwift();
}
