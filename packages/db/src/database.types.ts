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
      business_categories: {
        Row: {
          business_id: string;
          category_id: string;
          is_primary: boolean;
        };
        Insert: {
          business_id: string;
          category_id: string;
          is_primary?: boolean;
        };
        Update: {
          business_id?: string;
          category_id?: string;
          is_primary?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: 'business_categories_business_id_fkey';
            columns: ['business_id'];
            isOneToOne: false;
            referencedRelation: 'businesses';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'business_categories_category_id_fkey';
            columns: ['category_id'];
            isOneToOne: false;
            referencedRelation: 'categories';
            referencedColumns: ['id'];
          },
        ];
      };
      business_customers: {
        Row: {
          acquired_via: Database['public']['Enums']['acquisition_channel'];
          archived_at: string | null;
          business_id: string;
          cancel_count: number;
          claimed_at: string | null;
          created_at: string;
          display_name: string;
          favorite_service_id: string | null;
          first_booking_id: string | null;
          first_visit_at: string | null;
          id: string;
          is_blocked_online: boolean;
          last_visit_at: string | null;
          late_cancel_count: number;
          lifetime_spend: number;
          merged_into_id: string | null;
          no_show_count: number;
          phone_e164: string | null;
          preferred_staff_id: string | null;
          tags: string[];
          updated_at: string;
          user_id: string | null;
          visit_count: number;
        };
        Insert: {
          acquired_via: Database['public']['Enums']['acquisition_channel'];
          archived_at?: string | null;
          business_id: string;
          cancel_count?: number;
          claimed_at?: string | null;
          created_at?: string;
          display_name: string;
          favorite_service_id?: string | null;
          first_booking_id?: string | null;
          first_visit_at?: string | null;
          id?: string;
          is_blocked_online?: boolean;
          last_visit_at?: string | null;
          late_cancel_count?: number;
          lifetime_spend?: number;
          merged_into_id?: string | null;
          no_show_count?: number;
          phone_e164?: string | null;
          preferred_staff_id?: string | null;
          tags?: string[];
          updated_at?: string;
          user_id?: string | null;
          visit_count?: number;
        };
        Update: {
          acquired_via?: Database['public']['Enums']['acquisition_channel'];
          archived_at?: string | null;
          business_id?: string;
          cancel_count?: number;
          claimed_at?: string | null;
          created_at?: string;
          display_name?: string;
          favorite_service_id?: string | null;
          first_booking_id?: string | null;
          first_visit_at?: string | null;
          id?: string;
          is_blocked_online?: boolean;
          last_visit_at?: string | null;
          late_cancel_count?: number;
          lifetime_spend?: number;
          merged_into_id?: string | null;
          no_show_count?: number;
          phone_e164?: string | null;
          preferred_staff_id?: string | null;
          tags?: string[];
          updated_at?: string;
          user_id?: string | null;
          visit_count?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'business_customers_business_id_fkey';
            columns: ['business_id'];
            isOneToOne: false;
            referencedRelation: 'businesses';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'business_customers_favorite_service_id_business_id_fkey';
            columns: ['favorite_service_id', 'business_id'];
            isOneToOne: false;
            referencedRelation: 'services';
            referencedColumns: ['id', 'business_id'];
          },
          {
            foreignKeyName: 'business_customers_merged_into_id_business_id_fkey';
            columns: ['merged_into_id', 'business_id'];
            isOneToOne: false;
            referencedRelation: 'business_customers';
            referencedColumns: ['id', 'business_id'];
          },
          {
            foreignKeyName: 'business_customers_preferred_staff_id_business_id_fkey';
            columns: ['preferred_staff_id', 'business_id'];
            isOneToOne: false;
            referencedRelation: 'staff_members';
            referencedColumns: ['id', 'business_id'];
          },
        ];
      };
      business_locations: {
        Row: {
          address_line: string | null;
          area_id: string;
          building: string | null;
          business_id: string;
          created_at: string;
          floor: string | null;
          geo: unknown;
          id: string;
          is_primary: boolean;
          landmark: string | null;
          name: string | null;
          phone_e164: string | null;
          status: Database['public']['Enums']['location_status'];
          timezone: string;
          updated_at: string;
          whatsapp_e164: string | null;
        };
        Insert: {
          address_line?: string | null;
          area_id: string;
          building?: string | null;
          business_id: string;
          created_at?: string;
          floor?: string | null;
          geo: unknown;
          id?: string;
          is_primary?: boolean;
          landmark?: string | null;
          name?: string | null;
          phone_e164?: string | null;
          status?: Database['public']['Enums']['location_status'];
          timezone?: string;
          updated_at?: string;
          whatsapp_e164?: string | null;
        };
        Update: {
          address_line?: string | null;
          area_id?: string;
          building?: string | null;
          business_id?: string;
          created_at?: string;
          floor?: string | null;
          geo?: unknown;
          id?: string;
          is_primary?: boolean;
          landmark?: string | null;
          name?: string | null;
          phone_e164?: string | null;
          status?: Database['public']['Enums']['location_status'];
          timezone?: string;
          updated_at?: string;
          whatsapp_e164?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'business_locations_area_id_fkey';
            columns: ['area_id'];
            isOneToOne: false;
            referencedRelation: 'areas';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'business_locations_business_id_fkey';
            columns: ['business_id'];
            isOneToOne: false;
            referencedRelation: 'businesses';
            referencedColumns: ['id'];
          },
        ];
      };
      business_members: {
        Row: {
          business_id: string;
          created_at: string;
          invited_by: string | null;
          role: Database['public']['Enums']['business_role'];
          status: Database['public']['Enums']['member_status'];
          updated_at: string;
          user_id: string;
        };
        Insert: {
          business_id: string;
          created_at?: string;
          invited_by?: string | null;
          role: Database['public']['Enums']['business_role'];
          status?: Database['public']['Enums']['member_status'];
          updated_at?: string;
          user_id: string;
        };
        Update: {
          business_id?: string;
          created_at?: string;
          invited_by?: string | null;
          role?: Database['public']['Enums']['business_role'];
          status?: Database['public']['Enums']['member_status'];
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'business_members_business_id_fkey';
            columns: ['business_id'];
            isOneToOne: false;
            referencedRelation: 'businesses';
            referencedColumns: ['id'];
          },
        ];
      };
      business_settings: {
        Row: {
          allow_online_booking: boolean;
          assignment_rule: Database['public']['Enums']['assignment_rule'];
          auto_complete_after_minutes: number;
          booking_mode: Database['public']['Enums']['booking_mode'];
          business_id: string;
          cancellation_window_minutes: number;
          created_at: string;
          max_active_bookings_per_customer: number;
          max_advance_days: number;
          min_notice_minutes: number;
          notify_customer_on_any_reassign: boolean;
          reception_sees_revenue: boolean;
          request_expiry_minutes: number;
          show_staff_appointment_counts: boolean;
          show_staff_price_differences: boolean;
          slot_interval_minutes: number;
          staff_choice_mode: Database['public']['Enums']['staff_choice_mode'];
          staff_see_customer_phone: boolean;
          updated_at: string;
        };
        Insert: {
          allow_online_booking?: boolean;
          assignment_rule?: Database['public']['Enums']['assignment_rule'];
          auto_complete_after_minutes?: number;
          booking_mode?: Database['public']['Enums']['booking_mode'];
          business_id: string;
          cancellation_window_minutes?: number;
          created_at?: string;
          max_active_bookings_per_customer?: number;
          max_advance_days?: number;
          min_notice_minutes?: number;
          notify_customer_on_any_reassign?: boolean;
          reception_sees_revenue?: boolean;
          request_expiry_minutes?: number;
          show_staff_appointment_counts?: boolean;
          show_staff_price_differences?: boolean;
          slot_interval_minutes?: number;
          staff_choice_mode?: Database['public']['Enums']['staff_choice_mode'];
          staff_see_customer_phone?: boolean;
          updated_at?: string;
        };
        Update: {
          allow_online_booking?: boolean;
          assignment_rule?: Database['public']['Enums']['assignment_rule'];
          auto_complete_after_minutes?: number;
          booking_mode?: Database['public']['Enums']['booking_mode'];
          business_id?: string;
          cancellation_window_minutes?: number;
          created_at?: string;
          max_active_bookings_per_customer?: number;
          max_advance_days?: number;
          min_notice_minutes?: number;
          notify_customer_on_any_reassign?: boolean;
          reception_sees_revenue?: boolean;
          request_expiry_minutes?: number;
          show_staff_appointment_counts?: boolean;
          show_staff_price_differences?: boolean;
          slot_interval_minutes?: number;
          staff_choice_mode?: Database['public']['Enums']['staff_choice_mode'];
          staff_see_customer_phone?: boolean;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'business_settings_business_id_fkey';
            columns: ['business_id'];
            isOneToOne: true;
            referencedRelation: 'businesses';
            referencedColumns: ['id'];
          },
        ];
      };
      business_slug_history: {
        Row: {
          business_id: string;
          changed_at: string;
          old_slug: string;
        };
        Insert: {
          business_id: string;
          changed_at?: string;
          old_slug: string;
        };
        Update: {
          business_id?: string;
          changed_at?: string;
          old_slug?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'business_slug_history_business_id_fkey';
            columns: ['business_id'];
            isOneToOne: false;
            referencedRelation: 'businesses';
            referencedColumns: ['id'];
          },
        ];
      };
      business_subscriptions: {
        Row: {
          business_id: string;
          cancel_at: string | null;
          created_at: string;
          current_period_end: string | null;
          current_period_start: string | null;
          plan_id: string;
          provider: string | null;
          provider_customer_ref: string | null;
          provider_subscription_ref: string | null;
          status: Database['public']['Enums']['subscription_status'];
          updated_at: string;
        };
        Insert: {
          business_id: string;
          cancel_at?: string | null;
          created_at?: string;
          current_period_end?: string | null;
          current_period_start?: string | null;
          plan_id: string;
          provider?: string | null;
          provider_customer_ref?: string | null;
          provider_subscription_ref?: string | null;
          status?: Database['public']['Enums']['subscription_status'];
          updated_at?: string;
        };
        Update: {
          business_id?: string;
          cancel_at?: string | null;
          created_at?: string;
          current_period_end?: string | null;
          current_period_start?: string | null;
          plan_id?: string;
          provider?: string | null;
          provider_customer_ref?: string | null;
          provider_subscription_ref?: string | null;
          status?: Database['public']['Enums']['subscription_status'];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'business_subscriptions_business_id_fkey';
            columns: ['business_id'];
            isOneToOne: true;
            referencedRelation: 'businesses';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'business_subscriptions_plan_id_fkey';
            columns: ['plan_id'];
            isOneToOne: false;
            referencedRelation: 'plans';
            referencedColumns: ['id'];
          },
        ];
      };
      business_verifications: {
        Row: {
          business_id: string;
          checks: NonNullable<Json>;
          created_at: string;
          documents: NonNullable<Json>;
          id: string;
          note: string | null;
          reviewed_at: string | null;
          reviewed_by: string | null;
          status: Database['public']['Enums']['verification_status'];
          updated_at: string;
        };
        Insert: {
          business_id: string;
          checks?: NonNullable<Json>;
          created_at?: string;
          documents?: NonNullable<Json>;
          id?: string;
          note?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          status?: Database['public']['Enums']['verification_status'];
          updated_at?: string;
        };
        Update: {
          business_id?: string;
          checks?: NonNullable<Json>;
          created_at?: string;
          documents?: NonNullable<Json>;
          id?: string;
          note?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          status?: Database['public']['Enums']['verification_status'];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'business_verifications_business_id_fkey';
            columns: ['business_id'];
            isOneToOne: false;
            referencedRelation: 'businesses';
            referencedColumns: ['id'];
          },
        ];
      };
      businesses: {
        Row: {
          amenities: string[];
          audience: Database['public']['Enums']['audience'];
          claimed_at: string | null;
          created_at: string;
          created_by: string | null;
          description: string | null;
          id: string;
          instagram_handle: string | null;
          is_test: boolean;
          name: string;
          price_level: number | null;
          primary_category_id: string;
          published_at: string | null;
          slug: string;
          status: Database['public']['Enums']['business_status'];
          status_reason: string | null;
          updated_at: string;
          verification_status: Database['public']['Enums']['verification_status'];
          verified_at: string | null;
          website_url: string | null;
        };
        Insert: {
          amenities?: string[];
          audience?: Database['public']['Enums']['audience'];
          claimed_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          id?: string;
          instagram_handle?: string | null;
          is_test?: boolean;
          name: string;
          price_level?: number | null;
          primary_category_id: string;
          published_at?: string | null;
          slug: string;
          status?: Database['public']['Enums']['business_status'];
          status_reason?: string | null;
          updated_at?: string;
          verification_status?: Database['public']['Enums']['verification_status'];
          verified_at?: string | null;
          website_url?: string | null;
        };
        Update: {
          amenities?: string[];
          audience?: Database['public']['Enums']['audience'];
          claimed_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          id?: string;
          instagram_handle?: string | null;
          is_test?: boolean;
          name?: string;
          price_level?: number | null;
          primary_category_id?: string;
          published_at?: string | null;
          slug?: string;
          status?: Database['public']['Enums']['business_status'];
          status_reason?: string | null;
          updated_at?: string;
          verification_status?: Database['public']['Enums']['verification_status'];
          verified_at?: string | null;
          website_url?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'businesses_primary_category_id_fkey';
            columns: ['primary_category_id'];
            isOneToOne: false;
            referencedRelation: 'categories';
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
      catalog_suggestions: {
        Row: {
          business_id: string;
          created_at: string;
          id: string;
          proposed_name: string;
          resolved_by: string | null;
          resolved_canonical_service_id: string | null;
          service_id: string | null;
          status: string;
          updated_at: string;
        };
        Insert: {
          business_id: string;
          created_at?: string;
          id?: string;
          proposed_name: string;
          resolved_by?: string | null;
          resolved_canonical_service_id?: string | null;
          service_id?: string | null;
          status?: string;
          updated_at?: string;
        };
        Update: {
          business_id?: string;
          created_at?: string;
          id?: string;
          proposed_name?: string;
          resolved_by?: string | null;
          resolved_canonical_service_id?: string | null;
          service_id?: string | null;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'catalog_suggestions_business_id_fkey';
            columns: ['business_id'];
            isOneToOne: false;
            referencedRelation: 'businesses';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'catalog_suggestions_resolved_canonical_service_id_fkey';
            columns: ['resolved_canonical_service_id'];
            isOneToOne: false;
            referencedRelation: 'canonical_services';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'catalog_suggestions_service_id_business_id_fkey';
            columns: ['service_id', 'business_id'];
            isOneToOne: false;
            referencedRelation: 'services';
            referencedColumns: ['id', 'business_id'];
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
      customer_notes: {
        Row: {
          author_user_id: string;
          body: string;
          business_customer_id: string;
          business_id: string;
          created_at: string;
          deleted_at: string | null;
          id: string;
          is_pinned: boolean;
          updated_at: string;
          visible_to_staff: boolean;
        };
        Insert: {
          author_user_id: string;
          body: string;
          business_customer_id: string;
          business_id: string;
          created_at?: string;
          deleted_at?: string | null;
          id?: string;
          is_pinned?: boolean;
          updated_at?: string;
          visible_to_staff?: boolean;
        };
        Update: {
          author_user_id?: string;
          body?: string;
          business_customer_id?: string;
          business_id?: string;
          created_at?: string;
          deleted_at?: string | null;
          id?: string;
          is_pinned?: boolean;
          updated_at?: string;
          visible_to_staff?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: 'customer_notes_business_customer_id_business_id_fkey';
            columns: ['business_customer_id', 'business_id'];
            isOneToOne: false;
            referencedRelation: 'business_customers';
            referencedColumns: ['id', 'business_id'];
          },
        ];
      };
      location_closures: {
        Row: {
          business_id: string;
          created_at: string;
          created_by: string | null;
          id: string;
          label: string | null;
          location_id: string;
          period: unknown;
        };
        Insert: {
          business_id: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          label?: string | null;
          location_id: string;
          period: unknown;
        };
        Update: {
          business_id?: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          label?: string | null;
          location_id?: string;
          period?: unknown;
        };
        Relationships: [
          {
            foreignKeyName: 'location_closures_location_id_business_id_fkey';
            columns: ['location_id', 'business_id'];
            isOneToOne: false;
            referencedRelation: 'business_locations';
            referencedColumns: ['id', 'business_id'];
          },
        ];
      };
      location_hours: {
        Row: {
          business_id: string;
          end_minute: number;
          id: string;
          iso_weekday: number;
          location_id: string;
          start_minute: number;
        };
        Insert: {
          business_id: string;
          end_minute: number;
          id?: string;
          iso_weekday: number;
          location_id: string;
          start_minute: number;
        };
        Update: {
          business_id?: string;
          end_minute?: number;
          id?: string;
          iso_weekday?: number;
          location_id?: string;
          start_minute?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'location_hours_location_id_business_id_fkey';
            columns: ['location_id', 'business_id'];
            isOneToOne: false;
            referencedRelation: 'business_locations';
            referencedColumns: ['id', 'business_id'];
          },
        ];
      };
      plan_entitlements: {
        Row: {
          key: string;
          plan_id: string;
          value: NonNullable<Json>;
        };
        Insert: {
          key: string;
          plan_id: string;
          value: NonNullable<Json>;
        };
        Update: {
          key?: string;
          plan_id?: string;
          value?: NonNullable<Json>;
        };
        Relationships: [
          {
            foreignKeyName: 'plan_entitlements_plan_id_fkey';
            columns: ['plan_id'];
            isOneToOne: false;
            referencedRelation: 'plans';
            referencedColumns: ['id'];
          },
        ];
      };
      plans: {
        Row: {
          currency: string;
          id: string;
          is_active: boolean;
          is_public: boolean;
          key: string;
          name: string;
          price_monthly: number | null;
          sort: number;
        };
        Insert: {
          currency?: string;
          id?: string;
          is_active?: boolean;
          is_public?: boolean;
          key: string;
          name: string;
          price_monthly?: number | null;
          sort?: number;
        };
        Update: {
          currency?: string;
          id?: string;
          is_active?: boolean;
          is_public?: boolean;
          key?: string;
          name?: string;
          price_monthly?: number | null;
          sort?: number;
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
      reserved_slugs: {
        Row: {
          slug: string;
        };
        Insert: {
          slug: string;
        };
        Update: {
          slug?: string;
        };
        Relationships: [];
      };
      service_combo_items: {
        Row: {
          canonical_service_id: string;
          service_id: string;
        };
        Insert: {
          canonical_service_id: string;
          service_id: string;
        };
        Update: {
          canonical_service_id?: string;
          service_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'service_combo_items_canonical_service_id_fkey';
            columns: ['canonical_service_id'];
            isOneToOne: false;
            referencedRelation: 'canonical_services';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'service_combo_items_service_id_fkey';
            columns: ['service_id'];
            isOneToOne: false;
            referencedRelation: 'services';
            referencedColumns: ['id'];
          },
        ];
      };
      service_groups: {
        Row: {
          business_id: string;
          created_at: string;
          id: string;
          name: string;
          sort: number;
          updated_at: string;
        };
        Insert: {
          business_id: string;
          created_at?: string;
          id?: string;
          name: string;
          sort?: number;
          updated_at?: string;
        };
        Update: {
          business_id?: string;
          created_at?: string;
          id?: string;
          name?: string;
          sort?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'service_groups_business_id_fkey';
            columns: ['business_id'];
            isOneToOne: false;
            referencedRelation: 'businesses';
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
      services: {
        Row: {
          audience: Database['public']['Enums']['audience'];
          buffer_after_min: number;
          buffer_before_min: number;
          business_id: string;
          canonical_service_id: string;
          created_at: string;
          currency: string;
          description: string | null;
          duration_min: number;
          group_id: string | null;
          id: string;
          is_combo: boolean;
          is_online_bookable: boolean;
          location_type: Database['public']['Enums']['service_location_type'];
          name: string;
          price_max: number | null;
          price_min: number | null;
          price_type: Database['public']['Enums']['price_type'];
          sort: number;
          status: Database['public']['Enums']['lifecycle_status'];
          updated_at: string;
        };
        Insert: {
          audience?: Database['public']['Enums']['audience'];
          buffer_after_min?: number;
          buffer_before_min?: number;
          business_id: string;
          canonical_service_id: string;
          created_at?: string;
          currency?: string;
          description?: string | null;
          duration_min: number;
          group_id?: string | null;
          id?: string;
          is_combo?: boolean;
          is_online_bookable?: boolean;
          location_type?: Database['public']['Enums']['service_location_type'];
          name: string;
          price_max?: number | null;
          price_min?: number | null;
          price_type: Database['public']['Enums']['price_type'];
          sort?: number;
          status?: Database['public']['Enums']['lifecycle_status'];
          updated_at?: string;
        };
        Update: {
          audience?: Database['public']['Enums']['audience'];
          buffer_after_min?: number;
          buffer_before_min?: number;
          business_id?: string;
          canonical_service_id?: string;
          created_at?: string;
          currency?: string;
          description?: string | null;
          duration_min?: number;
          group_id?: string | null;
          id?: string;
          is_combo?: boolean;
          is_online_bookable?: boolean;
          location_type?: Database['public']['Enums']['service_location_type'];
          name?: string;
          price_max?: number | null;
          price_min?: number | null;
          price_type?: Database['public']['Enums']['price_type'];
          sort?: number;
          status?: Database['public']['Enums']['lifecycle_status'];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'services_business_id_fkey';
            columns: ['business_id'];
            isOneToOne: false;
            referencedRelation: 'businesses';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'services_canonical_service_id_fkey';
            columns: ['canonical_service_id'];
            isOneToOne: false;
            referencedRelation: 'canonical_services';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'services_group_id_business_id_fkey';
            columns: ['group_id', 'business_id'];
            isOneToOne: false;
            referencedRelation: 'service_groups';
            referencedColumns: ['id', 'business_id'];
          },
        ];
      };
      staff_locations: {
        Row: {
          business_id: string;
          is_primary: boolean;
          location_id: string;
          staff_id: string;
        };
        Insert: {
          business_id: string;
          is_primary?: boolean;
          location_id: string;
          staff_id: string;
        };
        Update: {
          business_id?: string;
          is_primary?: boolean;
          location_id?: string;
          staff_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'staff_locations_location_id_business_id_fkey';
            columns: ['location_id', 'business_id'];
            isOneToOne: false;
            referencedRelation: 'business_locations';
            referencedColumns: ['id', 'business_id'];
          },
          {
            foreignKeyName: 'staff_locations_staff_id_business_id_fkey';
            columns: ['staff_id', 'business_id'];
            isOneToOne: false;
            referencedRelation: 'staff_members';
            referencedColumns: ['id', 'business_id'];
          },
        ];
      };
      staff_members: {
        Row: {
          accepts_any_assignment: boolean;
          archived_at: string | null;
          assignment_priority: number;
          bio: string | null;
          business_id: string;
          created_at: string;
          display_name: string;
          display_order: number;
          gender: string | null;
          id: string;
          last_auto_assigned_at: string | null;
          photo_media_id: string | null;
          publicly_bookable: boolean;
          role_title: string | null;
          slug: string;
          status: Database['public']['Enums']['lifecycle_status'];
          updated_at: string;
          user_id: string | null;
        };
        Insert: {
          accepts_any_assignment?: boolean;
          archived_at?: string | null;
          assignment_priority?: number;
          bio?: string | null;
          business_id: string;
          created_at?: string;
          display_name: string;
          display_order?: number;
          gender?: string | null;
          id?: string;
          last_auto_assigned_at?: string | null;
          photo_media_id?: string | null;
          publicly_bookable?: boolean;
          role_title?: string | null;
          slug: string;
          status?: Database['public']['Enums']['lifecycle_status'];
          updated_at?: string;
          user_id?: string | null;
        };
        Update: {
          accepts_any_assignment?: boolean;
          archived_at?: string | null;
          assignment_priority?: number;
          bio?: string | null;
          business_id?: string;
          created_at?: string;
          display_name?: string;
          display_order?: number;
          gender?: string | null;
          id?: string;
          last_auto_assigned_at?: string | null;
          photo_media_id?: string | null;
          publicly_bookable?: boolean;
          role_title?: string | null;
          slug?: string;
          status?: Database['public']['Enums']['lifecycle_status'];
          updated_at?: string;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'staff_members_business_id_fkey';
            columns: ['business_id'];
            isOneToOne: false;
            referencedRelation: 'businesses';
            referencedColumns: ['id'];
          },
        ];
      };
      staff_schedule_overrides: {
        Row: {
          business_id: string;
          created_at: string;
          created_by: string | null;
          end_minute: number | null;
          id: string;
          is_working: boolean;
          location_id: string;
          note: string | null;
          on_date: string;
          staff_id: string;
          start_minute: number | null;
        };
        Insert: {
          business_id: string;
          created_at?: string;
          created_by?: string | null;
          end_minute?: number | null;
          id?: string;
          is_working: boolean;
          location_id: string;
          note?: string | null;
          on_date: string;
          staff_id: string;
          start_minute?: number | null;
        };
        Update: {
          business_id?: string;
          created_at?: string;
          created_by?: string | null;
          end_minute?: number | null;
          id?: string;
          is_working?: boolean;
          location_id?: string;
          note?: string | null;
          on_date?: string;
          staff_id?: string;
          start_minute?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'staff_schedule_overrides_staff_id_business_id_fkey';
            columns: ['staff_id', 'business_id'];
            isOneToOne: false;
            referencedRelation: 'staff_members';
            referencedColumns: ['id', 'business_id'];
          },
          {
            foreignKeyName: 'staff_schedule_overrides_staff_id_location_id_fkey';
            columns: ['staff_id', 'location_id'];
            isOneToOne: false;
            referencedRelation: 'staff_locations';
            referencedColumns: ['staff_id', 'location_id'];
          },
        ];
      };
      staff_services: {
        Row: {
          business_id: string;
          duration_min_override: number | null;
          is_specialty: boolean;
          price_max_override: number | null;
          price_min_override: number | null;
          price_type_override: Database['public']['Enums']['price_type'] | null;
          service_id: string;
          staff_id: string;
        };
        Insert: {
          business_id: string;
          duration_min_override?: number | null;
          is_specialty?: boolean;
          price_max_override?: number | null;
          price_min_override?: number | null;
          price_type_override?: Database['public']['Enums']['price_type'] | null;
          service_id: string;
          staff_id: string;
        };
        Update: {
          business_id?: string;
          duration_min_override?: number | null;
          is_specialty?: boolean;
          price_max_override?: number | null;
          price_min_override?: number | null;
          price_type_override?: Database['public']['Enums']['price_type'] | null;
          service_id?: string;
          staff_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'staff_services_service_id_business_id_fkey';
            columns: ['service_id', 'business_id'];
            isOneToOne: false;
            referencedRelation: 'services';
            referencedColumns: ['id', 'business_id'];
          },
          {
            foreignKeyName: 'staff_services_staff_id_business_id_fkey';
            columns: ['staff_id', 'business_id'];
            isOneToOne: false;
            referencedRelation: 'staff_members';
            referencedColumns: ['id', 'business_id'];
          },
        ];
      };
      staff_stats: {
        Row: {
          business_id: string;
          completed_count: number;
          completed_verified_appointments: number;
          favorites_count: number;
          next_available_at: string | null;
          rating_display: number | null;
          rating_sum: number;
          specifically_requested_count: number;
          staff_id: string;
          updated_at: string;
          verified_review_count: number;
        };
        Insert: {
          business_id: string;
          completed_count?: number;
          completed_verified_appointments?: number;
          favorites_count?: number;
          next_available_at?: string | null;
          rating_display?: number | null;
          rating_sum?: number;
          specifically_requested_count?: number;
          staff_id: string;
          updated_at?: string;
          verified_review_count?: number;
        };
        Update: {
          business_id?: string;
          completed_count?: number;
          completed_verified_appointments?: number;
          favorites_count?: number;
          next_available_at?: string | null;
          rating_display?: number | null;
          rating_sum?: number;
          specifically_requested_count?: number;
          staff_id?: string;
          updated_at?: string;
          verified_review_count?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'staff_stats_business_id_fkey';
            columns: ['business_id'];
            isOneToOne: false;
            referencedRelation: 'businesses';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'staff_stats_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: true;
            referencedRelation: 'staff_members';
            referencedColumns: ['id'];
          },
        ];
      };
      staff_time_off: {
        Row: {
          business_id: string;
          created_at: string;
          created_by: string;
          id: string;
          kind: Database['public']['Enums']['time_off_kind'];
          period: unknown;
          reason: string | null;
          staff_id: string;
        };
        Insert: {
          business_id: string;
          created_at?: string;
          created_by: string;
          id?: string;
          kind?: Database['public']['Enums']['time_off_kind'];
          period: unknown;
          reason?: string | null;
          staff_id: string;
        };
        Update: {
          business_id?: string;
          created_at?: string;
          created_by?: string;
          id?: string;
          kind?: Database['public']['Enums']['time_off_kind'];
          period?: unknown;
          reason?: string | null;
          staff_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'staff_time_off_staff_id_business_id_fkey';
            columns: ['staff_id', 'business_id'];
            isOneToOne: false;
            referencedRelation: 'staff_members';
            referencedColumns: ['id', 'business_id'];
          },
        ];
      };
      staff_weekly_hours: {
        Row: {
          business_id: string;
          effective_from: string;
          effective_to: string | null;
          end_minute: number;
          id: string;
          iso_weekday: number;
          location_id: string;
          staff_id: string;
          start_minute: number;
        };
        Insert: {
          business_id: string;
          effective_from?: string;
          effective_to?: string | null;
          end_minute: number;
          id?: string;
          iso_weekday: number;
          location_id: string;
          staff_id: string;
          start_minute: number;
        };
        Update: {
          business_id?: string;
          effective_from?: string;
          effective_to?: string | null;
          end_minute?: number;
          id?: string;
          iso_weekday?: number;
          location_id?: string;
          staff_id?: string;
          start_minute?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'staff_weekly_hours_staff_id_business_id_fkey';
            columns: ['staff_id', 'business_id'];
            isOneToOne: false;
            referencedRelation: 'staff_members';
            referencedColumns: ['id', 'business_id'];
          },
          {
            foreignKeyName: 'staff_weekly_hours_staff_id_location_id_fkey';
            columns: ['staff_id', 'location_id'];
            isOneToOne: false;
            referencedRelation: 'staff_locations';
            referencedColumns: ['staff_id', 'location_id'];
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
