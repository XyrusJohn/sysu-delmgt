import { describe, expect, it } from "vitest";
import {
  acceptLocationUpdate as accept,
  GPS_STALE_MS,
  savedLocationStatus,
  validLocation,
} from "./locationState.js";

const now = 1_790_000_000_000;
const fix = {
  driverId: "synthetic-driver",
  lat: 14.5,
  lng: 121,
  timestamp: now,
  sapDocId: "synthetic-trip",
};
const options = { now };
const live = () => accept(null, fix, options);

describe("Phone-to-web location ordering and lifecycle", () => {
  it("accepts genuine zero coordinates", () =>
    expect(validLocation(0, 0)).toBe(true));
  it.each([
    [NaN, 121],
    [14, Infinity],
    [91, 121],
    [14, 181],
    [null, null],
    ["14", 121],
  ])("rejects malformed coordinates %s %s", (lat, lng) => {
    expect(accept(null, { ...fix, lat, lng }, options)).toBeNull();
  });
  it("does not invent a location for an online heartbeat", () => {
    expect(
      accept(
        null,
        { driverId: fix.driverId, status: "online" },
        { ...options, kind: "status" },
      ),
    ).toBeNull();
  });
  it("rejects an older socket fix", () =>
    expect(accept(live(), { ...fix, timestamp: now - 1 }, options)).toBeNull());
  it("rejects malformed and future timestamps", () => {
    for (const timestamp of [NaN, "tomorrow", now + 5001])
      expect(accept(null, { ...fix, timestamp }, options)).toBeNull();
  });
  it("does not let a saved snapshot rewind fresh GPS", () => {
    expect(
      accept(
        live(),
        { ...fix, lat: 15, timestamp: now + 1 },
        { ...options, source: "mysql" },
      ),
    ).toBeNull();
  });
  it("labels a saved reload position awaiting GPS and preserves its age", () => {
    const saved = accept(
      null,
      { ...fix, timestamp: now - 60000 },
      { ...options, source: "mysql" },
    );
    expect(saved.status).toBe("pending");
    expect(saved.lastSeen).toBe(now - 60000);
  });
  it("keeps a saved return-to-base position blue while other saved active positions await GPS", () => {
    expect(savedLocationStatus("returning_to_base")).toBe("returning_to_base");
    expect(savedLocationStatus("in_transit")).toBe("pending");
    expect(savedLocationStatus("loading")).toBe("pending");
  });
  it("heartbeat never refreshes the GPS age", () => {
    const next = accept(
      live(),
      {
        driverId: fix.driverId,
        status: "online",
        timestamp: now + GPS_STALE_MS + 1,
      },
      { now: now + GPS_STALE_MS + 1, kind: "status" },
    );
    expect(next.lastSeen).toBe(now);
    expect(next.status).toBe("stale");
  });
  it("keeps the last real coordinate while offline", () => {
    const next = accept(
      live(),
      { driverId: fix.driverId, status: "offline_in_transit" },
      { ...options, kind: "status" },
    );
    expect(next.status).toBe("offline");
    expect(next.lat).toBe(fix.lat);
    expect(next.lastSeen).toBe(now);
    expect(next.tripStatus).toBe("in_transit");
  });
  it("preserves transit state through GPS updates and clears it on an explicit status transition", () => {
    const transit = accept(
      live(),
      { driverId: fix.driverId, status: "in_transit" },
      { ...options, kind: "status" },
    );
    expect(transit.status).toBe("online");
    expect(transit.tripStatus).toBe("in_transit");

    const moving = accept(
      transit,
      { ...fix, timestamp: now + 1, status: "online" },
      { ...options, now: now + 1 },
    );
    expect(moving.tripStatus).toBe("in_transit");

    const available = accept(
      moving,
      { driverId: fix.driverId, status: "online" },
      { ...options, now: now + 2, kind: "status" },
    );
    expect(available.tripStatus).toBeNull();
  });
  it("a fresh GPS packet restores online after an offline event", () => {
    const offline = accept(
      live(),
      { driverId: fix.driverId, status: "offline" },
      { ...options, kind: "status" },
    );
    expect(
      accept(offline, { ...fix, timestamp: now + 1 }, options).status,
    ).toBe("online");
  });
  it("moving packet preserves an ongoing return to base", () => {
    const returning = accept(
      live(),
      { driverId: fix.driverId, status: "returning_to_base" },
      { ...options, kind: "status" },
    );
    expect(
      accept(returning, { ...fix, status: "online" }, options).status,
    ).toBe("returning_to_base");
  });
  it("explicitly clears a completed assignment link", () =>
    expect(
      accept(live(), { ...fix, sapDocId: null }, options).sapDocId,
    ).toBeNull());
  it("removes completion and prevents its old fix from reappearing", () => {
    expect(
      accept(
        live(),
        { driverId: fix.driverId, status: "completed" },
        { ...options, kind: "status" },
      ).removed,
    ).toBe(true);
    expect(accept(null, fix, { ...options, closedAt: now })).toBeNull();
  });
  it("does not let a later online status recreate a completed trip marker", () => {
    expect(
      accept(
        null,
        { ...fix, status: "online", timestamp: now + 1 },
        { ...options, kind: "status", closedAt: now },
      ),
    ).toBeNull();
  });
  it("allows a newer trip after closure", () => {
    expect(
      accept(
        null,
        { ...fix, timestamp: now + 1, sapDocId: "next-trip" },
        { ...options, closedAt: now },
      ).sapDocId,
    ).toBe("next-trip");
  });
});
