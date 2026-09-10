-- Payment events belong to the student's purchase, not the subscription option.
CREATE TABLE subscription_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_subscription_id INTEGER NOT NULL REFERENCES student_subscriptions(id),
  paid_at TEXT NOT NULL,
  amount_minor INTEGER CHECK (amount_minor IS NULL OR (typeof(amount_minor) = 'integer' AND amount_minor > 0))
);
CREATE INDEX subscription_payments_purchase_idx ON subscription_payments (student_subscription_id, paid_at);

-- Previous records contain a payment date but no historical amount.
-- Preserve those dates without guessing the amount from today's option price.
INSERT INTO subscription_payments (student_subscription_id, paid_at)
SELECT id, paid_at FROM student_subscriptions WHERE paid_at IS NOT NULL;

ALTER TABLE student_subscriptions DROP COLUMN paid_at;
