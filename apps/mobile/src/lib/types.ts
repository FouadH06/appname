// Payload shapes of the RPCs the app uses (same contracts as the web, see apps/web/src/lib/public/types.ts).
import type { PriceType } from './format';

export type Named = { en: string; ar: string };

export interface PublicService {
  id: string;
  name: string;
  description: string | null;
  group: string | null;
  price_type: PriceType;
  price_min: number | null;
  price_max: number | null;
  currency: string;
  duration_min: number;
  online: boolean;
  staff_ids: string[];
}
export interface PublicStaff {
  id: string;
  name: string;
  role_title: string | null;
  photo_path: string | null;
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
    category: Named | null;
    cover_path: string | null;
    portfolio: string[];
  };
  location: {
    id: string;
    area: Named | null;
    address_line: string | null;
    landmark: string | null;
    lat: number;
    lng: number;
    phone: string | null;
    whatsapp: string | null;
  };
  hours: { weekday: number; start: number; end: number }[];
  rules: {
    booking_mode: 'instant' | 'request';
    staff_choice_mode: 'any_or_choose' | 'any_only' | 'choose_only';
    cancellation_window_minutes: number;
  };
  services: PublicService[];
  staff: PublicStaff[];
  rating: { review_count: number; display_rating: number | null };
}
export type BusinessPageResult = BusinessPage | { state: 'not_found' | 'unavailable' } | { redirect_to: string; state?: undefined };

export interface StaffOptions {
  choice_mode: BusinessPage['rules']['staff_choice_mode'];
  any_next: string | null;
  rebook: { staff_id: string; name: string; last_visit_at: string; same_service: boolean } | null;
  staff: (PublicStaff & { next_available: string | null; price_type: PriceType; price_min: number | null; price_max: number | null })[];
}
export interface Hold {
  booking_id: string;
  hold_token: string;
  expires_at: string;
  staff_id: string;
  staff_first_name: string;
  starts_at: string;
  price_type: PriceType;
  price_min: number | null;
  price_max: number | null;
}

export interface SearchCard {
  location_id: string;
  business_id: string;
  slug: string;
  name: string;
  area: string | null;
  km: number | null;
  display_rating: number | null;
  review_count: number;
  price_level: number | null;
  cover_path: string | null;
  next_available_at: string | null;
  labels: string[];
  service: { service_id: string; name: string; type: PriceType; min: number | null; max: number | null; duration: number; next: string | null } | null;
}
export interface SearchResult {
  total: number;
  results: SearchCard[];
  nearby?: SearchCard[];
  intent: { not_offered: boolean };
}
export interface Home {
  clusters: { id: string; slug: string; name: string }[];
  categories: { id: string; slug: string; name: string }[];
  available_today: SearchCard[];
  top_rated: SearchCard[];
  new: SearchCard[];
  popular_services: { id: string; name: string; places: number }[];
}
export interface Rebook {
  booking_id: string;
  slug: string;
  business: string;
  service_id: string;
  service: string;
  staff_id: string | null;
  staff: string | null;
  last_staff: string | null;
  last_visit_at: string;
  cover_path: string | null;
  next_available_at: string | null;
}
export interface Favorite {
  business_id: string;
  slug: string;
  name: string;
  state: 'ok' | 'unavailable';
  area: string | null;
  display_rating: number | null;
  review_count: number;
  cover_path: string | null;
  next_available_at: string | null;
}

export interface MyBooking {
  id: string;
  ref: string;
  status: 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'no_show';
  starts_at: string;
  is_request: boolean;
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
  cancel_reason: string | null;
  cancelled_by: string | null;
  no_show_disputed: boolean;
  cancellation_window_minutes: number;
  can_cancel: boolean;
  can_reschedule: boolean;
  can_contest: boolean;
  business: { id: string; name: string; slug: string; live: boolean };
  location: { id: string; address_line: string | null; landmark: string | null; area: string | null; lat: number; lng: number; phone: string | null; whatsapp: string | null };
  review?: { id: string; can_review: boolean; days_left: number | null } | null;
}
export type MyBookingDetail = MyBooking & {
  timeline: { event: string; actor_kind: string; created_at: string; new_start: string | null }[];
};

export interface InboxItem {
  id: string;
  type: string;
  booking_id: string | null;
  payload: Record<string, unknown>;
  created_at: string;
  read_at: string | null;
}
