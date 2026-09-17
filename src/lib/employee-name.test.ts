import assert from "node:assert/strict";
import { test } from "node:test";
import { employeeMatchesSearch, filterEmployeesByNameOrId } from "./employee-name.ts";

const lina = { full_name: "Lina Haddad", id_number: "123456789" };
const ahmad = { first_name: "أحمد", last_name: "حسن", full_name: "أحمد حسن", id_number: "987654321" };
const noam = { full_name: "נועם כהן", id_number: "112233445" };

test("empty search matches every employee", () => {
  assert.equal(employeeMatchesSearch(lina, ""), true);
  assert.equal(employeeMatchesSearch(lina, "   "), true);
});

test("matches Latin / Arabic / Hebrew names (partial, case-insensitive)", () => {
  assert.equal(employeeMatchesSearch(lina, "lina"), true);
  assert.equal(employeeMatchesSearch(lina, "HADDAD"), true);
  assert.equal(employeeMatchesSearch(ahmad, "أحمد"), true);
  assert.equal(employeeMatchesSearch(ahmad, "حسن"), true);
  assert.equal(employeeMatchesSearch(noam, "כהן"), true);
  assert.equal(employeeMatchesSearch(lina, "milk"), false);
});

test("matches national ID digits (partial)", () => {
  assert.equal(employeeMatchesSearch(lina, "123456"), true);
  assert.equal(employeeMatchesSearch(lina, "6789"), true);
  assert.equal(employeeMatchesSearch(lina, "000"), false);
});

test("treats Eastern Arabic digits as the same ID digits", () => {
  assert.equal(employeeMatchesSearch(lina, "١٢٣٤٥"), true);
});

test("filterEmployeesByNameOrId keeps the full list when the query is empty", () => {
  const rows = [lina, ahmad, noam];
  assert.deepEqual(filterEmployeesByNameOrId(rows, ""), rows);
  assert.equal(filterEmployeesByNameOrId(rows, "כהן").length, 1);
  assert.equal(filterEmployeesByNameOrId(rows, "98765")[0], ahmad);
  assert.deepEqual(filterEmployeesByNameOrId(rows, "zzz"), []);
});
