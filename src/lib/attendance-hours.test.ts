import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clippedSessionSeconds,
  currentJerusalemYearMonth,
  estimatedPayFromSeconds,
  formatAttendanceHoursFromSeconds,
  jerusalemInclusiveDateRange,
  jerusalemMonthRange,
  previousYearMonth,
  secondsToHours,
  secondsToMinutes,
  sessionOverlapsRange,
  yearMonthEndDate,
} from "./attendance-hours.ts";

test("month helpers use calendar dates", () => {
  assert.equal(yearMonthEndDate("2026-09"), "2026-09-30");
  assert.equal(yearMonthEndDate("2026-02"), "2026-02-28");
  assert.equal(previousYearMonth("2026-01"), "2025-12");
  assert.equal(previousYearMonth("2026-09"), "2026-08");
});

test("Jerusalem inclusive range is [from 00:00, to+1 00:00)", () => {
  const range = jerusalemInclusiveDateRange("2026-09-01", "2026-09-01");
  assert.ok(range);
  // 2026-09-01 00:00 IDT = 2026-08-31 21:00 UTC (UTC+3 in September)
  assert.equal(range.start.toISOString(), "2026-08-31T21:00:00.000Z");
  assert.equal(range.end.toISOString(), "2026-09-01T21:00:00.000Z");
});

test("closed session fully inside the range counts exact duration", () => {
  const range = jerusalemInclusiveDateRange("2026-09-01", "2026-09-01")!;
  const seconds = clippedSessionSeconds({
    clockInAt: "2026-09-01T07:00:00.000Z", // 10:00 Jerusalem
    clockOutAt: "2026-09-01T15:00:00.000Z", // 18:00 Jerusalem
    rangeStart: range.start,
    rangeEnd: range.end,
  });
  assert.equal(seconds, 8 * 3600);
  assert.equal(secondsToMinutes(seconds), 480);
  assert.equal(secondsToHours(seconds), 8);
  assert.equal(formatAttendanceHoursFromSeconds(seconds), "8:00");
});

test("open sessions do not count toward totals", () => {
  const range = jerusalemInclusiveDateRange("2026-09-01", "2026-09-30")!;
  const seconds = clippedSessionSeconds({
    clockInAt: "2026-09-01T07:00:00.000Z",
    clockOutAt: null,
    rangeStart: range.start,
    rangeEnd: range.end,
  });
  assert.equal(seconds, 0);
});

test("sessions spanning midnight are clipped to the selected day", () => {
  const range = jerusalemInclusiveDateRange("2026-09-01", "2026-09-01")!;
  // 23:00 Sep 1 IDT → 01:00 Sep 2 IDT = 21:00–23:00 UTC
  const seconds = clippedSessionSeconds({
    clockInAt: "2026-09-01T20:00:00.000Z",
    clockOutAt: "2026-09-01T22:00:00.000Z",
    rangeStart: range.start,
    rangeEnd: range.end,
  });
  // Range ends 2026-09-01T21:00:00Z, so only 1 hour on Sep 1
  assert.equal(seconds, 3600);
  assert.equal(secondsToHours(seconds), 1);
});

test("month-boundary session is split: only the in-range part counts", () => {
  const september = jerusalemMonthRange("2026-09")!;
  const august = jerusalemMonthRange("2026-08")!;
  const clockIn = "2026-08-31T20:00:00.000Z"; // 23:00 Aug 31 IDT
  const clockOut = "2026-08-31T22:30:00.000Z"; // 01:30 Sep 1 IDT
  const augSeconds = clippedSessionSeconds({
    clockInAt: clockIn,
    clockOutAt: clockOut,
    rangeStart: august.start,
    rangeEnd: august.end,
  });
  const sepSeconds = clippedSessionSeconds({
    clockInAt: clockIn,
    clockOutAt: clockOut,
    rangeStart: september.start,
    rangeEnd: september.end,
  });
  assert.equal(augSeconds, 3600); // 23:00–00:00
  assert.equal(sepSeconds, 90 * 60); // 00:00–01:30
  assert.equal(augSeconds + sepSeconds, 2.5 * 3600);
});

test("year_month equality would miss the next-month tail — overlap includes it", () => {
  const september = jerusalemMonthRange("2026-09")!;
  const clockIn = "2026-08-31T20:00:00.000Z";
  const clockOut = "2026-08-31T22:30:00.000Z";
  assert.equal(
    sessionOverlapsRange({
      clockInAt: clockIn,
      clockOutAt: clockOut,
      rangeStart: september.start,
      rangeEnd: september.end,
    }),
    true,
  );
});

test("session entirely outside the range is excluded", () => {
  const range = jerusalemInclusiveDateRange("2026-09-10", "2026-09-20")!;
  assert.equal(
    sessionOverlapsRange({
      clockInAt: "2026-09-01T07:00:00.000Z",
      clockOutAt: "2026-09-01T15:00:00.000Z",
      rangeStart: range.start,
      rangeEnd: range.end,
    }),
    false,
  );
  assert.equal(
    clippedSessionSeconds({
      clockInAt: "2026-09-01T07:00:00.000Z",
      clockOutAt: "2026-09-01T15:00:00.000Z",
      rangeStart: range.start,
      rangeEnd: range.end,
    }),
    0,
  );
});

test("mid-period from/to works (not forced monthly)", () => {
  const range = jerusalemInclusiveDateRange("2026-09-12", "2026-09-18")!;
  const seconds = clippedSessionSeconds({
    clockInAt: "2026-09-12T07:00:00.000Z",
    clockOutAt: "2026-09-12T11:30:00.000Z",
    rangeStart: range.start,
    rangeEnd: range.end,
  });
  assert.equal(secondsToHours(seconds), 4.5);
});

test("per-employee pay uses that employee's hourly rate", () => {
  const fourHours = 4 * 3600;
  assert.equal(estimatedPayFromSeconds(fourHours, 30), 120);
  assert.equal(estimatedPayFromSeconds(fourHours, 34), 136);
  assert.equal(estimatedPayFromSeconds(fourHours, null), null);
});

test("fractional hours round to 2 decimals before pay", () => {
  // 1 hour 10 minutes = 1.1666... → 1.17 hours
  const seconds = 70 * 60;
  assert.equal(secondsToHours(seconds), 1.17);
  assert.equal(estimatedPayFromSeconds(seconds, 30), 35.1);
});

test("current Jerusalem year-month is YYYY-MM", () => {
  const ym = currentJerusalemYearMonth(new Date("2026-09-17T22:00:00.000Z"));
  assert.match(ym, /^\d{4}-\d{2}$/);
  assert.equal(ym, "2026-09");
});
