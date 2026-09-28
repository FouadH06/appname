-- M7 · New message type: acknowledgement to a customer after their own cancellation succeeds.
-- (Own migration: a new enum value can't be used in the transaction that adds it.)
alter type public.notification_type add value if not exists 'booking_cancelled_by_customer' after 'booking_cancelled_by_business';
