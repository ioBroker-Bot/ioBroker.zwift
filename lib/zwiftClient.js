"use strict";

const axios = require("axios");
const path = require("node:path");
const protobuf = require("protobufjs");

const AUTH_URL = "https://secure.zwift.com/auth/realms/zwift/tokens/access/codes";
const BASE_URL = "https://us-or-rly101.zwift.com";
const CLIENT_ID = "Zwift_Mobile_Link";
const USER_AGENT = "Zwift/115 CFNetwork/758.0.2 Darwin/15.0.0";

class ZwiftClient {
	/**
	 * @param {string} username
	 * @param {string} password
	 * @param {ioBroker.Logger} log
	 */
	constructor(username, password, log) {
		this.username = username;
		this.password = password;
		this.log = log;
		this.accessToken = null;
		this.refreshToken = null;
		this.tokenExpiry = 0;
		this.playerId = null;
		/** @type {protobuf.Type | null} */
		this.PlayerState = null;
	}

	/**
	 * Load protobuf definitions
	 */
	async loadProto() {
		const root = await protobuf.load(path.join(__dirname, "zwiftMessages.proto"));
		this.PlayerState = root.lookupType("PlayerState");
	}

	/**
	 * Authenticate with Zwift using username/password
	 */
	async authenticate() {
		const response = await axios.post(
			AUTH_URL,
			new URLSearchParams({
				client_id: CLIENT_ID,
				grant_type: "password",
				username: this.username,
				password: this.password,
			}).toString(),
			{
				headers: {
					"Content-Type": "application/x-www-form-urlencoded",
					"User-Agent": USER_AGENT,
				},
				timeout: 10000,
			},
		);

		this.accessToken = response.data.access_token;
		this.refreshToken = response.data.refresh_token;
		// Refresh 60 seconds before actual expiry
		this.tokenExpiry = Date.now() + (response.data.expires_in - 60) * 1000;
	}

	/**
	 * Refresh the access token using the refresh token
	 */
	async refreshAccessToken() {
		const response = await axios.post(
			AUTH_URL,
			new URLSearchParams({
				client_id: CLIENT_ID,
				grant_type: "refresh_token",
				refresh_token: this.refreshToken,
			}).toString(),
			{
				headers: {
					"Content-Type": "application/x-www-form-urlencoded",
					"User-Agent": USER_AGENT,
				},
				timeout: 10000,
			},
		);

		this.accessToken = response.data.access_token;
		this.refreshToken = response.data.refresh_token;
		this.tokenExpiry = Date.now() + (response.data.expires_in - 60) * 1000;
	}

	/**
	 * Ensure the access token is valid, refreshing if needed
	 */
	async ensureValidToken() {
		if (Date.now() >= this.tokenExpiry) {
			this.log.debug("Token expired, refreshing...");
			try {
				await this.refreshAccessToken();
			} catch {
				this.log.warn("Token refresh failed, re-authenticating...");
				await this.authenticate();
			}
		}
	}

	/**
	 * Get the authenticated user's profile
	 *
	 * @returns {Promise<object>} Profile data
	 */
	async getProfile() {
		const response = await axios.get(`${BASE_URL}/api/profiles/me`, {
			headers: {
				Authorization: `Bearer ${this.accessToken}`,
				Accept: "application/json",
				"User-Agent": USER_AGENT,
			},
			timeout: 10000,
		});

		this.playerId = response.data.id;
		return response.data;
	}

	/**
	 * Get live rider status for the authenticated player
	 *
	 * @returns {Promise<object|null>} Rider status or null if not riding
	 */
	async getRiderStatus() {
		if (!this.PlayerState) {
			await this.loadProto();
		}
		const playerStateType = /** @type {protobuf.Type} */ (this.PlayerState);
		try {
			const response = await axios.get(`${BASE_URL}/relay/worlds/1/players/${this.playerId}`, {
				headers: {
					Authorization: `Bearer ${this.accessToken}`,
					Accept: "application/x-protobuf-lite",
					"Accept-Encoding": "gzip",
					"User-Agent": USER_AGENT,
				},
				responseType: "arraybuffer",
				timeout: 10000,
			});
			const decoded = playerStateType.decode(new Uint8Array(response.data));
			return playerStateType.toObject(decoded, { longs: Number });
		} catch (error) {
			if (error.response && error.response.status === 404) {
				return null;
			}
			throw error;
		}
	}
}

module.exports = ZwiftClient;
