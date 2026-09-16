import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canSeeCustomerPaymentNav,
  emptyCustomerBillingGate,
  isCustomerPaymentUiVisible,
  resolveCustomerBillingGate,
} from "./billing-visibility.ts";

test("customer payment UI is off unless both flags are on", () => {
  assert.equal(isCustomerPaymentUiVisible({ platformVisible: false, companyEnabled: false }), false);
  assert.equal(isCustomerPaymentUiVisible({ platformVisible: true, companyEnabled: false }), false);
  assert.equal(isCustomerPaymentUiVisible({ platformVisible: false, companyEnabled: true }), false);
  assert.equal(isCustomerPaymentUiVisible({ platformVisible: true, companyEnabled: true }), true);
});

test("resolveCustomerBillingGate defaults to hidden", () => {
  const gate = resolveCustomerBillingGate({
    platformVisible: false,
    companyEnabled: false,
    companyId: null,
    isPlatformOwner: false,
  });
  assert.equal(gate.customerPaymentUiVisible, false);
  assert.equal(emptyCustomerBillingGate().customerPaymentUiVisible, false);
});

test("non-owners see payment nav only when the gate is on and they manage the company", () => {
  assert.equal(
    canSeeCustomerPaymentNav({
      isPlatformOwner: false,
      isBranchManager: true,
      canManageCompanySettings: false,
      customerPaymentUiVisible: true,
    }),
    true,
  );
  assert.equal(
    canSeeCustomerPaymentNav({
      isPlatformOwner: false,
      isBranchManager: false,
      canManageCompanySettings: true,
      customerPaymentUiVisible: true,
    }),
    true,
  );
  assert.equal(
    canSeeCustomerPaymentNav({
      isPlatformOwner: false,
      isBranchManager: true,
      canManageCompanySettings: true,
      customerPaymentUiVisible: false,
    }),
    false,
  );
  assert.equal(
    canSeeCustomerPaymentNav({
      isPlatformOwner: true,
      isBranchManager: true,
      canManageCompanySettings: true,
      customerPaymentUiVisible: true,
    }),
    false,
  );
  assert.equal(
    canSeeCustomerPaymentNav({
      isPlatformOwner: false,
      isBranchManager: false,
      canManageCompanySettings: false,
      customerPaymentUiVisible: true,
    }),
    false,
  );
});
