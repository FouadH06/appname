export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      admin_users: {
        Row: {
          created_at: string;
          created_by: string | null;
          is_active: boolean;
          role: Database['public']['Enums']['admin_role'];
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          is_active?: boolean;
          role: Database['public']['Enums']['admin_role'];
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          is_active?: boolean;
          role?: Database['public']['Enums']['admin_role'];
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      area_aliases: {
        Row: {
          alias: string;
          alias_normalized: string | null;
          area_id: string;
        };
        Insert: {
          alias: string;
          alias_normalized?: never;
          area_id: string;
        };
        Update: {
          alias?: string;
          alias_normalized?: never;
          area_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'area_aliases_area_id_fkey';
            columns: ['area_id'];
            isOneToOne: false;
            referencedRelation: 'areas';
            referencedColumns: ['id'];
          },
        ];
      };
      areas: {
        Row: {
          boundary: unknown;
          centroid: unknown;
          created_at: string;
          id: string;
          is_live: boolean;
          level: Database['public']['Enums']['area_level'];
          name_ar: string;
          name_en: string;
          name_fr: string | null;
          parent_id: string | null;
          slug: string;
          updated_at: string;
        };
        Insert: {
          boundary?: unknown;
          centroid?: unknown;
          created_at?: string;
          id?: string;
          is_live?: boolean;
          level: Database['public']['Enums']['area_level'];
          name_ar: string;
          name_en: string;
          name_fr?: string | null;
          parent_id?: string | null;
          slug: string;
          updated_at?: string;
        };
        Update: {
          boundary?: unknown;
          centroid?: unknown;
          created_at?: string;
          id?: string;
          is_live?: boolean;
          level?: Database['public']['Enums']['area_level'];
          name_ar?: string;
          name_en?: string;
          name_fr?: string | null;
          parent_id?: string | null;
          slug?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'areas_parent_id_fkey';
            columns: ['parent_id'];
            isOneToOne: false;
            referencedRelation: 'areas';
            referencedColumns: ['id'];
          },
        ];
      };
      canonical_services: {
        Row: {
          allows_before_after: boolean;
          category_id: string;
          created_at: string;
          id: string;
          is_active: boolean;
          name_ar: string;
          name_en: string;
          name_fr: string | null;
          relevance_hints: string[];
          slug: string;
          sort: number;
          typical_duration_min: number | null;
          updated_at: string;
        };
        Insert: {
          allows_before_after?: boolean;
          category_id: string;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          name_ar: string;
          name_en: string;
          name_fr?: string | null;
          relevance_hints?: string[];
          slug: string;
          sort?: number;
          typical_duration_min?: number | null;
          updated_at?: string;
        };
        Update: {
          allows_before_after?: boolean;
          category_id?: string;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          name_ar?: string;
          name_en?: string;
          name_fr?: string | null;
          relevance_hints?: string[];
          slug?: string;
          sort?: number;
          typical_duration_min?: number | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'canonical_services_category_id_fkey';
            columns: ['category_id'];
            isOneToOne: false;
            referencedRelation: 'categories';
            referencedColumns: ['id'];
          },
        ];
      };
      categories: {
        Row: {
          allows_before_after_default: boolean;
          created_at: string;
          icon: string | null;
          id: string;
          is_live: boolean;
          name_ar: string;
          name_en: string;
          name_fr: string | null;
          parent_id: string | null;
          requires_consultation_default: boolean;
          slug: string;
          sort: number;
          updated_at: string;
        };
        Insert: {
          allows_before_after_default?: boolean;
          created_at?: string;
          icon?: string | null;
          id?: string;
          is_live?: boolean;
          name_ar: string;
          name_en: string;
          name_fr?: string | null;
          parent_id?: string | null;
          requires_consultation_default?: boolean;
          slug: string;
          sort?: number;
          updated_at?: string;
        };
        Update: {
          allows_before_after_default?: boolean;
          created_at?: string;
          icon?: string | null;
          id?: string;
          is_live?: boolean;
          name_ar?: string;
          name_en?: string;
          name_fr?: string | null;
          parent_id?: string | null;
          requires_consultation_default?: boolean;
          slug?: string;
          sort?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'categories_parent_id_fkey';
            columns: ['parent_id'];
            isOneToOne: false;
            referencedRelation: 'categories';
            referencedColumns: ['id'];
          },
        ];
      };
      cluster_areas: {
        Row: {
          area_id: string;
          cluster_id: string;
        };
        Insert: {
          area_id: string;
          cluster_id: string;
        };
        Update: {
          area_id?: string;
          cluster_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'cluster_areas_area_id_fkey';
            columns: ['area_id'];
            isOneToOne: false;
            referencedRelation: 'areas';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'cluster_areas_cluster_id_fkey';
            columns: ['cluster_id'];
            isOneToOne: false;
            referencedRelation: 'clusters';
            referencedColumns: ['id'];
          },
        ];
      };
      clusters: {
        Row: {
          id: string;
          is_live: boolean;
          name_ar: string;
          name_en: string;
          slug: string;
          sort: number;
          target_businesses: number;
        };
        Insert: {
          id?: string;
          is_live?: boolean;
          name_ar: string;
          name_en: string;
          slug: string;
          sort?: number;
          target_businesses?: number;
        };
        Update: {
          id?: string;
          is_live?: boolean;
          name_ar?: string;
          name_en?: string;
          slug?: string;
          sort?: number;
          target_businesses?: number;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          created_at: string;
          default_area_id: string | null;
          deleted_at: string | null;
          email: string | null;
          first_name: string | null;
          id: string;
          last_name: string | null;
          locale: Database['public']['Enums']['app_locale'];
          phone_e164: string | null;
          phone_verified_at: string | null;
          status: Database['public']['Enums']['user_status'];
          status_reason: string | null;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          default_area_id?: string | null;
          deleted_at?: string | null;
          email?: string | null;
          first_name?: string | null;
          id: string;
          last_name?: string | null;
          locale?: Database['public']['Enums']['app_locale'];
          phone_e164?: string | null;
          phone_verified_at?: string | null;
          status?: Database['public']['Enums']['user_status'];
          status_reason?: string | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          default_area_id?: string | null;
          deleted_at?: string | null;
          email?: string | null;
          first_name?: string | null;
          id?: string;
          last_name?: string | null;
          locale?: Database['public']['Enums']['app_locale'];
          phone_e164?: string | null;
          phone_verified_at?: string | null;
          status?: Database['public']['Enums']['user_status'];
          status_reason?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'profiles_default_area_id_fkey';
            columns: ['default_area_id'];
            isOneToOne: false;
            referencedRelation: 'areas';
            referencedColumns: ['id'];
          },
        ];
      };
      rating_dimensions: {
        Row: {
          category_id: string;
          id: string;
          is_active: boolean;
          key: string;
          label_ar: string;
          label_en: string;
          label_fr: string | null;
          sort: number;
        };
        Insert: {
          category_id: string;
          id?: string;
          is_active?: boolean;
          key: string;
          label_ar: string;
          label_en: string;
          label_fr?: string | null;
          sort?: number;
        };
        Update: {
          category_id?: string;
          id?: string;
          is_active?: boolean;
          key?: string;
          label_ar?: string;
          label_en?: string;
          label_fr?: string | null;
          sort?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'rating_dimensions_category_id_fkey';
            columns: ['category_id'];
            isOneToOne: false;
            referencedRelation: 'categories';
            referencedColumns: ['id'];
          },
        ];
      };
      service_synonyms: {
        Row: {
          canonical_service_id: string;
          id: string;
          lang: Database['public']['Enums']['synonym_lang'];
          term: string;
          term_normalized: string | null;
          weight: number;
        };
        Insert: {
          canonical_service_id: string;
          id?: string;
          lang: Database['public']['Enums']['synonym_lang'];
          term: string;
          term_normalized?: never;
          weight?: number;
        };
        Update: {
          canonical_service_id?: string;
          id?: string;
          lang?: Database['public']['Enums']['synonym_lang'];
          term?: string;
          term_normalized?: never;
          weight?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'service_synonyms_canonical_service_id_fkey';
            columns: ['canonical_service_id'];
            isOneToOne: false;
            referencedRelation: 'canonical_services';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      acquisition_channel: 'marketplace' | 'business_link' | 'manual' | 'import';
      actor_kind: 'customer' | 'business' | 'admin' | 'system';
      admin_role: 'moderator' | 'support' | 'ops' | 'superadmin';
      app_locale: 'en' | 'ar' | 'fr';
      area_level: 'governorate' | 'district' | 'area';
      assignment_rule: 'least_booked' | 'priority' | 'round_robin' | 'minimize_gaps';
      audience: 'women' | 'men' | 'everyone';
      booking_event_type:
        | 'held'
        | 'confirmed'
        | 'requested'
        | 'accepted'
        | 'declined'
        | 'expired'
        | 'rescheduled'
        | 'staff_changed'
        | 'cancelled'
        | 'completed'
        | 'no_show_marked'
        | 'no_show_contested'
        | 'no_show_resolved'
        | 'note_changed'
        | 'price_changed'
        | 'reminder_sent'
        | 'customer_confirmed'
        | 'claimed';
      booking_mode: 'instant' | 'request';
      booking_source:
        | 'marketplace_search'
        | 'marketplace_home'
        | 'marketplace_other'
        | 'business_link'
        | 'rebook'
        | 'waitlist'
        | 'promotion'
        | 'manual'
        | 'walk_in';
      booking_status: 'held' | 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'no_show';
      business_media_kind: 'cover' | 'portfolio' | 'logo' | 'staff_photo';
      business_role: 'owner' | 'manager' | 'reception' | 'staff';
      business_status: 'draft' | 'live' | 'paused' | 'suspended' | 'closed';
      case_state: 'open' | 'claimed' | 'decided' | 'escalated';
      config_status: 'draft' | 'active' | 'archived';
      content_state:
        'pending' | 'approved' | 'approved_redacted' | 'manual_review' | 'rejected' | 'removed';
      delivery_status: 'queued' | 'sent' | 'delivered' | 'read' | 'failed';
      discovery_label:
        | 'top_rated'
        | 'top_cleanliness'
        | 'great_punctuality'
        | 'popular_near_you'
        | 'available_today'
        | 'best_value'
        | 'new';
      dispute_outcome:
        | 'no_show_upheld'
        | 'no_show_overturned'
        | 'voided'
        | 'review_kept'
        | 'review_text_removed'
        | 'review_media_removed'
        | 'review_removed'
        | 'legal_kept'
        | 'legal_removed'
        | 'ownership_transferred'
        | 'ownership_denied';
      dispute_status: 'open' | 'awaiting_info' | 'resolved' | 'void';
      dispute_type: 'no_show' | 'review_attendance' | 'legal' | 'ownership';
      fraud_signal_type:
        | 'new_account_review'
        | 'device_cluster'
        | 'ip_cluster'
        | 'review_burst'
        | 'member_self_review'
        | 'duplicate_text'
        | 'visit_tier_cap'
        | 'no_show_pattern'
        | 'report_abuse'
        | 'phone_cluster';
      lifecycle_status: 'active' | 'archived';
      location_status: 'draft' | 'live' | 'paused' | 'closed';
      media_kind: 'result' | 'before' | 'after';
      media_status:
        | 'uploaded'
        | 'processing'
        | 'approved'
        | 'manual_review'
        | 'rejected'
        | 'removed'
        | 'deleted';
      member_status: 'invited' | 'active' | 'revoked';
      moderation_decision:
        | 'approve'
        | 'approve_redacted'
        | 'reject'
        | 'remove_media'
        | 'remove_text'
        | 'remove_review'
        | 'escalate';
      moderation_stage:
        | 'validation'
        | 'sanitize'
        | 'hash'
        | 'safety'
        | 'ocr'
        | 'relevance'
        | 'text_rules'
        | 'text_normalize'
        | 'text_llm'
        | 'decision';
      moderation_subject:
        | 'review_text'
        | 'reply_text'
        | 'review_media'
        | 'business_media'
        | 'staff_bio'
        | 'business_text';
      notification_channel: 'push' | 'whatsapp' | 'sms' | 'email' | 'in_app';
      notification_status:
        'queued' | 'processing' | 'sent' | 'partially_failed' | 'failed' | 'cancelled';
      notification_type:
        | 'booking_confirmed'
        | 'booking_requested'
        | 'request_accepted'
        | 'request_declined'
        | 'request_expired'
        | 'booking_reminder_24h'
        | 'booking_reminder_2h'
        | 'booking_cancelled_by_business'
        | 'booking_rescheduled_by_business'
        | 'staff_changed'
        | 'booking_no_show_marked'
        | 'review_request'
        | 'review_published'
        | 'review_needs_changes'
        | 'result_published'
        | 'result_rejected'
        | 'waitlist_offer'
        | 'dispute_update'
        | 'otp'
        | 'biz_new_booking'
        | 'biz_new_request'
        | 'biz_booking_cancelled'
        | 'biz_new_review'
        | 'biz_report_resolved'
        | 'biz_waitlist_claimed'
        | 'biz_schedule_conflict'
        | 'biz_invite'
        | 'biz_daily_summary';
      offer_status: 'sent' | 'claimed' | 'expired' | 'superseded';
      payment_status: 'not_required' | 'pending' | 'paid' | 'refunded' | 'failed';
      price_type: 'fixed' | 'from' | 'range' | 'on_consultation';
      rating_state: 'pending_check' | 'active' | 'quarantined' | 'removed';
      reliability_label: 'new_customer' | 'reliable' | 'some_missed_appointments';
      reliability_tier: 'new' | 'reliable' | 'some_missed' | 'restricted' | 'blocked';
      report_reason:
        | 'never_attended'
        | 'abusive_language'
        | 'personal_information'
        | 'unrelated_image'
        | 'spam'
        | 'fake_review'
        | 'false_information'
        | 'inappropriate'
        | 'harassment'
        | 'my_photo'
        | 'other';
      report_status: 'open' | 'in_review' | 'resolved_action' | 'resolved_no_action' | 'rejected';
      report_subject: 'review' | 'review_media' | 'review_reply' | 'business' | 'staff' | 'user';
      review_status: 'pending' | 'published' | 'removed' | 'deleted_by_author';
      service_location_type: 'at_business' | 'at_customer' | 'both';
      staff_choice_mode: 'any_or_choose' | 'any_only' | 'choose_only';
      staff_selection_mode: 'any' | 'specific' | 'rebook' | 'business';
      subscription_status: 'free_launch' | 'trialing' | 'active' | 'past_due' | 'cancelled';
      synonym_lang: 'en' | 'ar' | 'fr' | 'arabizi';
      time_off_kind: 'vacation' | 'sick' | 'personal' | 'training' | 'other';
      trust_tier: 'verified_booking' | 'verified_visit';
      user_status: 'active' | 'warned' | 'suspended' | 'deleted';
      verification_status: 'unverified' | 'pending' | 'verified' | 'rejected';
      waitlist_status: 'active' | 'offered' | 'booked' | 'expired' | 'cancelled';
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema['CompositeTypes'] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      acquisition_channel: ['marketplace', 'business_link', 'manual', 'import'],
      actor_kind: ['customer', 'business', 'admin', 'system'],
      admin_role: ['moderator', 'support', 'ops', 'superadmin'],
      app_locale: ['en', 'ar', 'fr'],
      area_level: ['governorate', 'district', 'area'],
      assignment_rule: ['least_booked', 'priority', 'round_robin', 'minimize_gaps'],
      audience: ['women', 'men', 'everyone'],
      booking_event_type: [
        'held',
        'confirmed',
        'requested',
        'accepted',
        'declined',
        'expired',
        'rescheduled',
        'staff_changed',
        'cancelled',
        'completed',
        'no_show_marked',
        'no_show_contested',
        'no_show_resolved',
        'note_changed',
        'price_changed',
        'reminder_sent',
        'customer_confirmed',
        'claimed',
      ],
      booking_mode: ['instant', 'request'],
      booking_source: [
        'marketplace_search',
        'marketplace_home',
        'marketplace_other',
        'business_link',
        'rebook',
        'waitlist',
        'promotion',
        'manual',
        'walk_in',
      ],
      booking_status: ['held', 'pending', 'confirmed', 'completed', 'cancelled', 'no_show'],
      business_media_kind: ['cover', 'portfolio', 'logo', 'staff_photo'],
      business_role: ['owner', 'manager', 'reception', 'staff'],
      business_status: ['draft', 'live', 'paused', 'suspended', 'closed'],
      case_state: ['open', 'claimed', 'decided', 'escalated'],
      config_status: ['draft', 'active', 'archived'],
      content_state: [
        'pending',
        'approved',
        'approved_redacted',
        'manual_review',
        'rejected',
        'removed',
      ],
      delivery_status: ['queued', 'sent', 'delivered', 'read', 'failed'],
      discovery_label: [
        'top_rated',
        'top_cleanliness',
        'great_punctuality',
        'popular_near_you',
        'available_today',
        'best_value',
        'new',
      ],
      dispute_outcome: [
        'no_show_upheld',
        'no_show_overturned',
        'voided',
        'review_kept',
        'review_text_removed',
        'review_media_removed',
        'review_removed',
        'legal_kept',
        'legal_removed',
        'ownership_transferred',
        'ownership_denied',
      ],
      dispute_status: ['open', 'awaiting_info', 'resolved', 'void'],
      dispute_type: ['no_show', 'review_attendance', 'legal', 'ownership'],
      fraud_signal_type: [
        'new_account_review',
        'device_cluster',
        'ip_cluster',
        'review_burst',
        'member_self_review',
        'duplicate_text',
        'visit_tier_cap',
        'no_show_pattern',
        'report_abuse',
        'phone_cluster',
      ],
      lifecycle_status: ['active', 'archived'],
      location_status: ['draft', 'live', 'paused', 'closed'],
      media_kind: ['result', 'before', 'after'],
      media_status: [
        'uploaded',
        'processing',
        'approved',
        'manual_review',
        'rejected',
        'removed',
        'deleted',
      ],
      member_status: ['invited', 'active', 'revoked'],
      moderation_decision: [
        'approve',
        'approve_redacted',
        'reject',
        'remove_media',
        'remove_text',
        'remove_review',
        'escalate',
      ],
      moderation_stage: [
        'validation',
        'sanitize',
        'hash',
        'safety',
        'ocr',
        'relevance',
        'text_rules',
        'text_normalize',
        'text_llm',
        'decision',
      ],
      moderation_subject: [
        'review_text',
        'reply_text',
        'review_media',
        'business_media',
        'staff_bio',
        'business_text',
      ],
      notification_channel: ['push', 'whatsapp', 'sms', 'email', 'in_app'],
      notification_status: [
        'queued',
        'processing',
        'sent',
        'partially_failed',
        'failed',
        'cancelled',
      ],
      notification_type: [
        'booking_confirmed',
        'booking_requested',
        'request_accepted',
        'request_declined',
        'request_expired',
        'booking_reminder_24h',
        'booking_reminder_2h',
        'booking_cancelled_by_business',
        'booking_rescheduled_by_business',
        'staff_changed',
        'booking_no_show_marked',
        'review_request',
        'review_published',
        'review_needs_changes',
        'result_published',
        'result_rejected',
        'waitlist_offer',
        'dispute_update',
        'otp',
        'biz_new_booking',
        'biz_new_request',
        'biz_booking_cancelled',
        'biz_new_review',
        'biz_report_resolved',
        'biz_waitlist_claimed',
        'biz_schedule_conflict',
        'biz_invite',
        'biz_daily_summary',
      ],
      offer_status: ['sent', 'claimed', 'expired', 'superseded'],
      payment_status: ['not_required', 'pending', 'paid', 'refunded', 'failed'],
      price_type: ['fixed', 'from', 'range', 'on_consultation'],
      rating_state: ['pending_check', 'active', 'quarantined', 'removed'],
      reliability_label: ['new_customer', 'reliable', 'some_missed_appointments'],
      reliability_tier: ['new', 'reliable', 'some_missed', 'restricted', 'blocked'],
      report_reason: [
        'never_attended',
        'abusive_language',
        'personal_information',
        'unrelated_image',
        'spam',
        'fake_review',
        'false_information',
        'inappropriate',
        'harassment',
        'my_photo',
        'other',
      ],
      report_status: ['open', 'in_review', 'resolved_action', 'resolved_no_action', 'rejected'],
      report_subject: ['review', 'review_media', 'review_reply', 'business', 'staff', 'user'],
      review_status: ['pending', 'published', 'removed', 'deleted_by_author'],
      service_location_type: ['at_business', 'at_customer', 'both'],
      staff_choice_mode: ['any_or_choose', 'any_only', 'choose_only'],
      staff_selection_mode: ['any', 'specific', 'rebook', 'business'],
      subscription_status: ['free_launch', 'trialing', 'active', 'past_due', 'cancelled'],
      synonym_lang: ['en', 'ar', 'fr', 'arabizi'],
      time_off_kind: ['vacation', 'sick', 'personal', 'training', 'other'],
      trust_tier: ['verified_booking', 'verified_visit'],
      user_status: ['active', 'warned', 'suspended', 'deleted'],
      verification_status: ['unverified', 'pending', 'verified', 'rejected'],
      waitlist_status: ['active', 'offered', 'booked', 'expired', 'cancelled'],
    },
  },
} as const;
