import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clippedSessionSeconds,
  currentJerusalemYearMonth,
  estimatedPayFromSeconds,
  filterHoursReportPeople,
  formatAttendanceHoursFromSeconds,
  jerusalemInclusiveDateRange,
  jerusalemMonthRange,
  normalizeDepartmentIds,
  personMatchesDepartment,
  personMatchesDepartments,
  previousYearMonth,
  secondsToHours,
  secondsToMinutes,
  sessionOverlapsRange,
  sumHoursReportTotals,
  sumHoursReportTotalsByDepartment,
  yearMonthEndDate,
  type HoursReportPerson,
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

const MILK = "dept-milk";
const MEAT = "dept-meat";

function samplePeople(): HoursReportPerson[] {
  return [
    { userId: "a", departmentId: MILK, seconds: 8 * 3600, hourlyRate: 30 },
    { userId: "b", departmentId: MILK, seconds: 4 * 3600, hourlyRate: 34 },
    { userId: "c", departmentId: MILK, seconds: 0, hourlyRate: 20 },
    { userId: "d", departmentId: MEAT, seconds: 6 * 3600, hourlyRate: 25 },
    { userId: "e", departmentId: null, seconds: 2 * 3600, hourlyRate: 40 },
  ];
}

test("all departments is a no-op match", () => {
  assert.equal(personMatchesDepartment(MILK, null), true);
  assert.equal(personMatchesDepartment(MILK, ""), true);
  assert.equal(personMatchesDepartment(MILK, MILK), true);
  assert.equal(personMatchesDepartment(MEAT, MILK), false);
  assert.equal(personMatchesDepartment(null, MILK), false);
});

test("department + punchers keeps only that dept with hours", () => {
  const rows = filterHoursReportPeople({
    people: samplePeople(),
    filter: "punchers",
    departmentId: MILK,
  });
  assert.deepEqual(
    rows.map((r) => r.userId),
    ["a", "b"],
  );
});

test("department + all includes zero-hour employees in that dept", () => {
  const rows = filterHoursReportPeople({
    people: samplePeople(),
    filter: "all",
    departmentId: MILK,
  });
  assert.deepEqual(
    rows.map((r) => r.userId),
    ["a", "b", "c"],
  );
});

test("department + one employee only returns that person if they are in the dept", () => {
  const inDept = filterHoursReportPeople({
    people: samplePeople(),
    filter: "one",
    departmentId: MILK,
    employeeId: "b",
  });
  assert.deepEqual(
    inDept.map((r) => r.userId),
    ["b"],
  );
  const otherDept = filterHoursReportPeople({
    people: samplePeople(),
    filter: "one",
    departmentId: MILK,
    employeeId: "d",
  });
  assert.equal(otherDept.length, 0);
});

test("department totals sum hours and per-employee pay for that dept", () => {
  const rows = filterHoursReportPeople({
    people: samplePeople(),
    filter: "punchers",
    departmentId: MILK,
  });
  const totals = sumHoursReportTotals(rows);
  assert.equal(totals.total_hours, 12);
  assert.equal(totals.total_minutes, 12 * 60);
  // 8h × 30 + 4h × 34 = 240 + 136 = 376
  assert.equal(totals.estimated_pay, 376);
});

test("unfiltered punchers still include every department", () => {
  const rows = filterHoursReportPeople({
    people: samplePeople(),
    filter: "punchers",
  });
  assert.deepEqual(
    rows.map((r) => r.userId),
    ["a", "b", "d", "e"],
  );
});

test("normalizeDepartmentIds de-dupes and treats empty as all", () => {
  assert.deepEqual(normalizeDepartmentIds([]), []);
  assert.deepEqual(normalizeDepartmentIds(null, MILK), [MILK]);
  assert.deepEqual(normalizeDepartmentIds([MILK, MILK, MEAT]), [MILK, MEAT]);
});

test("multi-select departments is ANY-of (milk or meat), not only one", () => {
  assert.equal(personMatchesDepartments(MILK, [MILK, MEAT]), true);
  assert.equal(personMatchesDepartments(MEAT, [MILK, MEAT]), true);
  assert.equal(personMatchesDepartments(null, [MILK, MEAT]), false);
  const punchers = filterHoursReportPeople({
    people: samplePeople(),
    filter: "punchers",
    departmentIds: [MILK, MEAT],
  });
  assert.deepEqual(
    punchers.map((r) => r.userId),
    ["a", "b", "d"],
  );
  const all = filterHoursReportPeople({
    people: samplePeople(),
    filter: "all",
    departmentIds: [MILK, MEAT],
  });
  assert.deepEqual(
    all.map((r) => r.userId),
    ["a", "b", "c", "d"],
  );
});

test("multi-select + one employee only if they belong to a selected dept", () => {
  const inSet = filterHoursReportPeople({
    people: samplePeople(),
    filter: "one",
    departmentIds: [MILK, MEAT],
    employeeId: "d",
  });
  assert.deepEqual(
    inSet.map((r) => r.userId),
    ["d"],
  );
  const outside = filterHoursReportPeople({
    people: samplePeople(),
    filter: "one",
    departmentIds: [MILK, MEAT],
    employeeId: "e",
  });
  assert.equal(outside.length, 0);
});

test("selected-set totals cover all chosen departments; subtotals split by dept", () => {
  const rows = filterHoursReportPeople({
    people: samplePeople(),
    filter: "punchers",
    departmentIds: [MILK, MEAT],
  });
  const totals = sumHoursReportTotals(rows);
  assert.equal(totals.total_hours, 18);
  // 8×30 + 4×34 + 6×25 = 240 + 136 + 150 = 526
  assert.equal(totals.estimated_pay, 526);
  const sub = sumHoursReportTotalsByDepartment(rows);
  const milk = sub.find((s) => s.departmentId === MILK);
  const meat = sub.find((s) => s.departmentId === MEAT);
  assert.equal(milk?.total_hours, 12);
  assert.equal(milk?.estimated_pay, 376);
  assert.equal(meat?.total_hours, 6);
  assert.equal(meat?.estimated_pay, 150);
});
