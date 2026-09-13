-- Every administrator can always record a cash payment.
INSERT OR IGNORE INTO administrator_payment_methods (email, method)
SELECT email, 'CASH' FROM admin_profiles;

-- Preserve an explicitly recorded method; fill only historical blanks.
UPDATE student_payments SET received_method = 'CASH'
WHERE trim(received_method) = '';
UPDATE practice_attendance
SET donation_received_method = 'CASH'
WHERE donation_amount_minor IS NOT NULL
  AND trim(donation_received_method) = '';

CREATE TRIGGER ensure_administrator_cash_payment_method
AFTER INSERT ON admin_profiles
BEGIN
  INSERT OR IGNORE INTO administrator_payment_methods (email, method)
  VALUES (NEW.email, 'CASH');
END;
