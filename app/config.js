/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * config.js — deployment configuration set once by the app owner (not by
 * end users). Kept in its own file so it's easy to find and edit.
 */

/**
 * OAuth 2.0 Web Client ID for the GEE Data Collector's "Sign in with Google".
 *
 * This is PUBLIC by design — a web OAuth client ID is meant to be embedded in
 * front-end code; the security is the origin whitelist on the client, not
 * secrecy. Register ONE client ID in the app's Google Cloud project
 * (APIs & Services → Credentials → OAuth client ID → Web application), add
 * every origin the app is served from as an Authorized JavaScript origin
 * (e.g. http://localhost:8123 for local dev and https://dualkc.studio in
 * production), then paste it here. Once set, end users just sign in — no
 * per-user client ID, and the tool hides its client-ID input box.
 *
 * Leave '' during development to fall back to a manual client-ID field.
 */
export const GEE_OAUTH_CLIENT_ID = '653180373077-ivbc16iiohavm3rqudvmbln2vsfdeum4.apps.googleusercontent.com';
