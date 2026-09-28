import { supabase } from '@/lib/supabase';
import type { Calendar } from './calendar';

// Read models from the M6 RPCs (role-projected on the server: fields the caller may not see
// arrive as null) and the M3 write RPCs they drive.

export type BookingStatus =
  'held' | 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'no_show';

export interface CustomerCard {
  id: string;
  name: string;
  phone: string | null;
  is_new: boolean;
  visit_count: number;
  reliability: 'new_customer' | 'reliable' | 'some_missed_appointments' | null;
  pinned_note: string | null;
}

export interface BookingCard {
  item_id: string;
  booking_id: string;
  ref: string;
  location_id: string;
  staff_id: string;
  staff_name: string;
  service_id: string;
  service_name: string;
  starts_at: string;
  ends_at: string;
  duration_min: number;
  buffer_before: number;
  buffer_after: number;
  status: BookingStatus;
  source: string;
  is_request: boolean;
  expires_at: string | null;
  selection_mode: 'any' | 'specific' | 'rebook' | 'business';
  requested: boolean;
  requested_staff_id: string | null;
  price_type: 'fixed' | 'from' | 'range' | 'on_consultation' | null;
  price_min: number | null;
  price_max: number | null;
  currency: string;
  internal_note: string | null;
  customer_note: string | null;
  created_by_kind: 'customer' | 'business' | 'system' | 'admin';
  rescheduled_count: number;
  cancel_reason: string | null;
  cancelled_by_kind: string | null;
  no_show_disputed: boolean;
  updated_at: string;
  customer: CustomerCard | null;
}

export interface BookingEvent {
  event: string;
  actor_kind: string;
  actor_name: string;
  from_status: BookingStatus | null;
  to_status: BookingStatus | null;
  created_at: string;
  data: Record<string, unknown>;
}

export type BookingDetail = BookingCard & { events: BookingEvent[] };

export const STATUS_LABEL: Record<BookingStatus, string> = {
  held: 'Being booked online',
  pending: 'Request',
  confirmed: 'Confirmed',
  completed: 'Completed',
  cancelled: 'Cancelled',
  no_show: 'No-show',
};

export const SOURCE_LABEL: Record<string, string> = {
  marketplace_search: 'APP_NAME',
  marketplace_home: 'APP_NAME',
  marketplace_other: 'APP_NAME',
  business_link: 'Your link',
  rebook: 'Rebooked',
  waitlist: 'Waitlist',
  promotion: 'Promotion',
  manual: 'Added by you',
  walk_in: 'Walk-in',
};

/** Small source glyph for blocks and rows (online vs phone vs walk-in). */
export const SOURCE_ICON: Record<string, string> = {
  marketplace_search: '◎',
  marketplace_home: '◎',
  marketplace_other: '◎',
  business_link: '🔗',
  rebook: '↻',
  waitlist: '⌛',
  promotion: '✦',
  manual: '☎',
  walk_in: '🚶',
};

export const EVENT_LABEL: Record<string, string> = {
  held: 'Started booking online',
  requested: 'Requested',
  confirmed: 'Booked',
  accepted: 'Request accepted',
  declined: 'Request declined',
  cancelled: 'Cancelled',
  expired: 'Expired (no response)',
  rescheduled: 'Moved',
  staff_changed: 'Staff changed',
  completed: 'Completed',
  no_show_marked: 'Marked no-show',
  no_show_contested: 'No-show contested',
  no_show_resolved: 'No-show dispute resolved',
  price_changed: 'Price changed',
  reminder_sent: 'Reminder sent',
  note_changed: 'Note edited',
  customer_confirmed: 'Customer confirmed',
  claimed: 'Linked to customer account',
};

export const isOnline = (b: Pick<BookingCard, 'created_by_kind'>) =>
  b.created_by_kind === 'customer';

export function priceText(
  b: Pick<BookingCard, 'price_type' | 'price_min' | 'price_max' | 'currency'>,
) {
  if (b.price_type === null) return null;
  const cur = b.currency === 'USD' ? '$' : `${b.currency} `;
  const n = (v: number | null) =>
    v === null ? '' : `${cur}${Number(v).toFixed(Number(v) % 1 ? 2 : 0)}`;
  switch (b.price_type) {
    case 'from':
      return `from ${n(b.price_min)}`;
    case 'range':
      return `${n(b.price_min)}–${n(b.price_max)}`;
    case 'on_consultation':
      return 'On consultation';
    default:
      return n(b.price_min);
  }
}

// ─── Reads ────────────────────────────────────────────────────────────────
export async function loadCalendar(
  locationId: string,
  from: string,
  to: string,
  staffIds: string[] | null,
  includeCancelled: boolean,
): Promise<Calendar> {
  const { data, error } = await supabase().rpc('biz_get_calendar', {
    p_location_id: locationId,
    p_from: from,
    p_to: to,
    p_staff_ids: staffIds ?? undefined,
    p_include_cancelled: includeCancelled,
  });
  if (error) throw error;
  return data as unknown as Calendar;
}

export async function getBooking(bookingId: string): Promise<BookingDetail> {
  const { data, error } = await supabase().rpc('biz_get_booking', { p_booking_id: bookingId });
  if (error) throw error;
  return data as unknown as BookingDetail;
}

export interface BookingList {
  total: number;
  pending_count: number;
  rows: BookingCard[];
}

export async function listBookings(p: {
  businessId: string;
  tab: 'pending' | 'upcoming' | 'past' | 'cancelled' | 'all';
  staffId?: string | null;
  serviceId?: string | null;
  source?: string | null;
  from?: string | null;
  to?: string | null;
  q?: string | null;
  customerId?: string | null;
  limit?: number;
  offset?: number;
}): Promise<BookingList> {
  const { data, error } = await supabase().rpc('biz_list_bookings', {
    p_business_id: p.businessId,
    p_tab: p.tab,
    p_staff_id: p.staffId ?? undefined,
    p_service_id: p.serviceId ?? undefined,
    p_source: p.source ?? undefined,
    p_from: p.from ?? undefined,
    p_to: p.to ?? undefined,
    p_q: p.q ?? undefined,
    p_customer_id: p.customerId ?? undefined,
    p_limit: p.limit ?? 50,
    p_offset: p.offset ?? 0,
  });
  if (error) throw error;
  return data as unknown as BookingList;
}

export async function affectedBookings(staffId: string, from?: string, to?: string) {
  const { data, error } = await supabase().rpc('biz_affected_bookings', {
    p_staff_id: staffId,
    p_from: from,
    p_to: to,
  });
  if (error) throw error;
  return data as unknown as BookingCard[];
}

export interface ReassignOption {
  staff_id: string;
  display_name: string;
  is_free: boolean;
  in_hours: boolean;
}

export async function reassignOptions(itemId: string): Promise<ReassignOption[]> {
  const { data, error } = await supabase().rpc('biz_reassign_options', { p_item_id: itemId });
  if (error) throw error;
  return data ?? [];
}

// ─── Writes (M3 RPCs) ─────────────────────────────────────────────────────
async function call(fn: PromiseLike<{ error: unknown }>) {
  const { error } = await fn;
  if (error) throw error;
}

export const actions = {
  complete: (id: string) => call(supabase().rpc('mark_completed', { p_booking_id: id })),
  completeMany: async (ids: string[]) => {
    const { data, error } = await supabase().rpc('mark_completed_bulk', { p_booking_ids: ids });
    if (error) throw error;
    return data ?? 0;
  },
  noShow: (id: string) => call(supabase().rpc('mark_no_show', { p_booking_id: id })),
  undoNoShow: (id: string) => call(supabase().rpc('undo_no_show', { p_booking_id: id })),
  accept: (id: string) => call(supabase().rpc('accept_request', { p_booking_id: id })),
  decline: (id: string, reason: string) =>
    call(supabase().rpc('decline_request', { p_booking_id: id, p_reason: reason })),
  cancel: (id: string, reason: string, notify: boolean) =>
    call(
      supabase().rpc('biz_cancel_booking', {
        p_booking_id: id,
        p_reason: reason,
        p_notify: notify,
      }),
    ),
  reschedule: (
    id: string,
    startIso: string,
    staffId: string | null,
    notify: boolean,
    outsideHours = false,
  ) =>
    call(
      supabase().rpc('biz_reschedule_booking', {
        p_booking_id: id,
        p_new_start: startIso,
        p_staff_id: staffId ?? undefined,
        p_notify: notify,
        p_allow_outside_hours: outsideHours,
      }),
    ),
  reassign: (itemId: string, staffId: string, notify: boolean) =>
    call(
      supabase().rpc('reassign_booking_item', {
        p_item_id: itemId,
        p_new_staff_id: staffId,
        p_notify: notify,
      }),
    ),
  note: (id: string, note: string) =>
    call(supabase().rpc('update_booking_note', { p_booking_id: id, p_internal_note: note })),
  undoManual: (id: string) => call(supabase().rpc('biz_undo_manual_booking', { p_booking_id: id })),
};

/**
 * Must the customer be told about a staff change? Always when they chose that person
 * (Phase 2 B3 §13); for "Any" bookings it's optional.
 */
export const notifyMandatory = (b: Pick<BookingCard, 'selection_mode'>) =>
  b.selection_mode === 'specific' || b.selection_mode === 'rebook';
