/**
 * Startup readiness gate.
 *
 * app.listen() is deliberately called before the startup tasks finish, so the
 * deployment healthcheck can bind the port immediately. The consequence was
 * that real requests were served while those tasks were still running ALTER
 * TABLE / CREATE INDEX / backfill UPDATE statements against the same database.
 *
 * This flag lets both things be true: the port is bound and /api/healthz
 * answers straight away, while every other route returns 503 until the startup
 * chain has completed.
 */

let ready = false;

/** True once all startup tasks have completed successfully. */
export function isReady(): boolean {
  return ready;
}

/** Called by index.ts after the startup chain resolves. */
export function markReady(): void {
  ready = true;
}
