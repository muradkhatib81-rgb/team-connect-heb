import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canShowCustomerPaymentUi,
  isCompanyPaymentOperator,
  parseCustomerPaymentVisible,
} from "./billing-visibility.ts";

test("parseCustomerPaymentVisible fails closed", () => {
  assert.equal(parseCustomerPaymentVisible(null), false);
  assert.equal(parseCustomerPaymentVisible({}), false);
  assert.equal(parseCustomerPaymentVisible({ customer_payment_visible: false }), false);
  assert.equal(parseCustomerPaymentVisible({ customer_payment_visible: true }), true);
  assert.equal(parseCustomerPaymentVisible({ customer_payment_visible: "true" }), false);
});

test("customer payment UI is hidden for everyone when the flag is off", () => {
  assert.equal(
    canShowCustomerPaymentUi({
      customerPaymentVisible: false,
      isPlatformOwner: false,
      isCompanyOperator: true,
    }),
    false,
  );
  assert.equal(
    canShowCustomerPaymentUi({
      customerPaymentVisible: false,
      isPlatformOwner: true,
      isCompanyOperator: false,
    }),
    false,
  );
});

test("when on, only non–platform-owner company operators see customer payment UI", () => {
  assert.equal(
    canShowCustomerPaymentUi({
      customerPaymentVisible: true,
      isPlatformOwner: false,
      isCompanyOperator: true,
    }),
    true,
  );
  assert.equal(
    canShowCustomerPaymentUi({
      customerPaymentVisible: true,
      isPlatformOwner: true,
      isCompanyOperator: false,
    }),
    false,
  );
  assert.equal(
    canShowCustomerPaymentUi({
      customerPaymentVisible: true,
      isPlatformOwner: false,
      isCompanyOperator: false,
    }),
    false,
  );
});

test("company payment operators are branch/assistant managers, not platform owners", () => {
  assert.equal(isCompanyPaymentOperator(["branch_manager"]), true);
  assert.equal(isCompanyPaymentOperator(["assistant_manager", "employee"]), true);
  assert.equal(isCompanyPaymentOperator(["system_admin"]), false);
  assert.equal(isCompanyPaymentOperator(["main_admin"]), false);
  assert.equal(isCompanyPaymentOperator(["employee"]), false);
});
