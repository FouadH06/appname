// Payload of public.get_business_page (M8). Public data only: no internal-only staff ever.

export type PriceType = 'fixed' | 'from' | 'range' | 'on_consultation';
export type Named = { en: string; ar: string };

export interface PublicService {
  id: string;
  name: string;
  description: string | null;
  group: string | null;
  group_sort: number | null;
  price_type: PriceType;
  price_min: number | null;
  price_max: number | null;
  currency: string;
  duration_min: number;
  audience: 'women' | 'men' | 'everyone';
  is_combo: boolean;
  /** bookable online (online-bookable and performed by at least one public staff member) */
  online: boolean;
  popular_rank: number | null;
  staff_ids: string[];
}

export interface PublicStaff {
  id: string;
  name: string;
  role_title: string | null;
  bio: string | null;
  photo_path: string | null;
  accepts_any: boolean;
  specialties: string[];
}

export interface BusinessPage {
  state: 'ok';
  accepting: boolean;
  business: {
    id: string;
    slug: string;
    name: string;
    description: string | null;
    audience: 'women' | 'men' | 'everyone';
    price_level: number | null;
    instagram: string | null;
    category: Named | null;
    cover_path: string | null;
    portfolio: string[];
  };
  location: {
    id: string;
    area: Named | null;
    address_line: string | null;
    floor: string | null;
    landmark: string | null;
    lat: number;
    lng: number;
    phone: string | null;
    whatsapp: string | null;
    timezone: string;
  };
  hours: { weekday: number; start: number; end: number }[];
  closures: { start: string; end: string }[];
  rules: {
    booking_mode: 'instant' | 'request';
    staff_choice_mode: 'any_or_choose' | 'any_only' | 'choose_only';
    min_notice_minutes: number;
    max_advance_days: number;
    cancellation_window_minutes: number;
    show_staff_price_differences: boolean;
    request_expiry_minutes: number;
  };
  services: PublicService[];
  staff: PublicStaff[];
  rating: null;
  price_from: number | null;
}

export type BusinessPageResult =
  | BusinessPage
  | { state: 'not_found' | 'unavailable' }
  | { redirect_to: string; state?: undefined };

export interface StaffOptions {
  choice_mode: BusinessPage['rules']['staff_choice_mode'];
  any_next: string | null;
  rebook: { staff_id: string; name: string; last_visit_at: string; same_service: boolean } | null;
  staff: (PublicStaff & {
    next_available: string | null;
    price_type: PriceType;
    price_min: number | null;
    price_max: number | null;
    duration_min: number;
    differs: boolean;
    appointments: number | null;
  })[];
}

export interface Hold {
  booking_id: string;
  hold_token: string;
  expires_at: string;
  staff_id: string;
  staff_first_name: string;
  starts_at: string;
  ends_at: string;
  price_type: PriceType;
  price_min: number | null;
  price_max: number | null;
  selection_mode: 'any' | 'specific' | 'rebook' | 'business';
}

export interface MyBooking {
  id: string;
  ref: string;
  status: 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'no_show';
  starts_at: string;
  ends_at: string;
  is_request: boolean;
  expires_at: string | null;
  source: string;
  booked_by_business: boolean;
  price_type: PriceType;
  price_min: number | null;
  price_max: number | null;
  currency: string;
  service_id: string;
  service_name: string;
  duration_min: number;
  staff_id: string | null;
  staff_first_name: string;
  staff_changed: boolean;
  customer_note: string | null;
  cancel_reason: string | null;
  cancelled_by: string | null;
  is_late_cancel: boolean;
  customer_confirmed: boolean;
  no_show_disputed: boolean;
  cancellation_window_minutes: number;
  can_cancel: boolean;
  can_reschedule: boolean;
  can_contest: boolean;
  business: { id: string; name: string; slug: string; live: boolean };
  location: {
    id: string;
    address_line: string | null;
    landmark: string | null;
    area: string | null;
    lat: number;
    lng: number;
    phone: string | null;
    whatsapp: string | null;
  };
}

export type MyBookingDetail = MyBooking & {
  timeline: { event: string; actor_kind: string; created_at: string; new_start: string | null }[];
  reminders_sent: number;
  messages_failed: boolean;
};
