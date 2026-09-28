import type { AppSupabaseClient } from './client';

/** Server errors carry a stable code in the message (Part 3 §1.6); the UI maps codes to copy. */
export class RpcError extends Error {
  constructor(
    readonly code: string,
    readonly detail: unknown,
  ) {
    super(code);
    this.name = 'RpcError';
  }
}

interface PostgrestErrorLike {
  code?: string;
  message?: string;
  details?: string | null;
}

export function toRpcError(e: PostgrestErrorLike): RpcError {
  // P0001 = our raise_code; 42501 = no grant (e.g. logged out) → treat as AUTH_REQUIRED
  if (e.code === 'P0001' && e.message) {
    let detail: unknown;
    try {
      detail = e.details ? JSON.parse(e.details) : null;
    } catch {
      detail = e.details;
    }
    return new RpcError(e.message, detail);
  }
  if (e.code === '42501') return new RpcError('AUTH_REQUIRED', null);
  return new RpcError('UNKNOWN', e);
}

async function call<T>(
  client: AppSupabaseClient,
  fn: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  // Function names are checked by the generated Database type at the call sites that use it;
  // this helper stays untyped so M4 wrappers don't depend on a regenerated type file.
  const { data, error } = await (
    client.rpc as unknown as (
      f: string,
      a: Record<string, unknown>,
    ) => Promise<{ data: T; error: PostgrestErrorLike | null }>
  )(fn, args);
  if (error) throw toRpcError(error);
  return data;
}

// ─── Who am I ──────────────────────────────────────────────────────────────
export interface Membership {
  business_id: string;
  business_name: string;
  slug: string;
  business_status: string;
  role: 'owner' | 'manager' | 'reception' | 'staff';
}

export interface MyAccess {
  user_id: string;
  is_anonymous: boolean;
  phone_verified: boolean;
  phone_hint: string | null;
  first_name: string | null;
  status: string | null;
  aal: 'aal1' | 'aal2';
  admin_role: 'moderator' | 'support' | 'ops' | 'superadmin' | null;
  admin_mfa_ok: boolean;
  memberships: Membership[];
}

export const getMyAccess = (c: AppSupabaseClient) => call<MyAccess>(c, 'get_my_access');

// ─── WhatsApp links & claims (Part 2 §2.3) ─────────────────────────────────
export interface TokenSummary {
  purpose: 'claim_visit' | 'manage_booking' | 'review';
  booking_id: string;
  state: 'valid' | 'used';
  expires_at: string;
  phone_hint: string | null;
  claimable: boolean;
  booking: {
    ref: string;
    status: string;
    starts_at: string;
    ends_at: string;
    business_name: string;
    business_slug: string;
    area_name: string | null;
    services: string[];
    staff_first_name: string | null;
  };
}

export interface ClaimOffer {
  business_id: string;
  business_name: string;
  area_name: string | null;
  visit_count: number;
  latest_month: string;
}

export const resolveAccessToken = (c: AppSupabaseClient, token: string) =>
  call<TokenSummary>(c, 'resolve_access_token', { p_token: token });

export const claimBooking = (c: AppSupabaseClient, token: string) =>
  call<{
    booking_id: string;
    business_id: string;
    already_claimed: boolean;
    offers?: ClaimOffer[];
  }>(c, 'claim_booking', {
    p_token: token,
  });

export const getClaimableVisits = (c: AppSupabaseClient) =>
  call<ClaimOffer[]>(c, 'get_claimable_visits');

export const claimVisits = (c: AppSupabaseClient, businessIds: string[]) =>
  call<{ claimed: Record<string, number> }>(c, 'claim_visits', { p_business_ids: businessIds });

export const dismissClaimableVisits = (c: AppSupabaseClient, businessIds: string[]) =>
  call<null>(c, 'dismiss_claimable_visits', { p_business_ids: businessIds });

// ─── Team invitations (Part 2 §5.2) ────────────────────────────────────────
export interface InvitationPreview {
  business_name: string;
  role: Membership['role'];
  phone_hint: string;
  expires_at: string;
  state: 'valid' | 'expired' | 'accepted' | 'revoked';
}

export const getInvitation = (c: AppSupabaseClient, token: string) =>
  call<InvitationPreview>(c, 'get_invitation', { p_token: token });

export const acceptInvitation = (c: AppSupabaseClient, token: string) =>
  call<{ business_id: string; role: Membership['role']; already_accepted: boolean }>(
    c,
    'accept_invitation',
    {
      p_token: token,
    },
  );

export const inviteMember = (
  c: AppSupabaseClient,
  businessId: string,
  phone: string,
  role: Exclude<Membership['role'], 'owner'> | 'owner',
  staffId?: string,
) =>
  call<{
    invitation_id: string;
    token: string;
    expires_at: string;
    phone_e164: string;
    role: string;
  }>(c, 'invite_member', {
    p_business_id: businessId,
    p_phone: phone,
    p_role: role,
    p_staff_id: staffId ?? null,
  });

export const deleteMyAccount = (c: AppSupabaseClient) =>
  call<{ status: string }>(c, 'delete_my_account');
