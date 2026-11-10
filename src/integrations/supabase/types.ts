export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      business_entities: {
        Row: {
          display_name: string
          id: string
          referred_type: string
          status_label: string | null
          tenant_id: string
        }
        Insert: {
          display_name: string
          id: string
          referred_type: string
          status_label?: string | null
          tenant_id: string
        }
        Update: {
          display_name?: string
          id?: string
          referred_type?: string
          status_label?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_entities_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      cross_tenant_grants: {
        Row: {
          document_id: string
          expires_at: string | null
          granted_by: string | null
          level: Database["public"]["Enums"]["access_level"]
          revoked_at: string | null
          to_tenant: string
        }
        Insert: {
          document_id: string
          expires_at?: string | null
          granted_by?: string | null
          level?: Database["public"]["Enums"]["access_level"]
          revoked_at?: string | null
          to_tenant: string
        }
        Update: {
          document_id?: string
          expires_at?: string | null
          granted_by?: string | null
          level?: Database["public"]["Enums"]["access_level"]
          revoked_at?: string | null
          to_tenant?: string
        }
        Relationships: [
          {
            foreignKeyName: "cross_tenant_grants_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cross_tenant_grants_to_tenant_fkey"
            columns: ["to_tenant"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      document_access_exceptions: {
        Row: {
          document_id: string
          expires_at: string | null
          granted_by: string | null
          level: Database["public"]["Enums"]["access_level"]
          user_id: string
        }
        Insert: {
          document_id: string
          expires_at?: string | null
          granted_by?: string | null
          level: Database["public"]["Enums"]["access_level"]
          user_id: string
        }
        Update: {
          document_id?: string
          expires_at?: string | null
          granted_by?: string | null
          level?: Database["public"]["Enums"]["access_level"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_access_exceptions_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      document_events: {
        Row: {
          action: string
          actor: string | null
          created_at: string
          detail: string | null
          document_id: string | null
          id: number
          tenant_id: string
          version_id: string | null
        }
        Insert: {
          action: string
          actor?: string | null
          created_at?: string
          detail?: string | null
          document_id?: string | null
          id?: never
          tenant_id: string
          version_id?: string | null
        }
        Update: {
          action?: string
          actor?: string | null
          created_at?: string
          detail?: string | null
          document_id?: string | null
          id?: never
          tenant_id?: string
          version_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "document_events_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      document_relations: {
        Row: {
          attached_on: string
          document_id: string
          entity_id: string
          role: string
        }
        Insert: {
          attached_on?: string
          document_id: string
          entity_id: string
          role: string
        }
        Update: {
          attached_on?: string
          document_id?: string
          entity_id?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_relations_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_relations_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "business_entities"
            referencedColumns: ["id"]
          },
        ]
      }
      document_specifications: {
        Row: {
          code: string
          definition: Json
          id: string
          lifecycle_status: string
          locked: boolean
          name: string
          tenant_id: string
          version: string
        }
        Insert: {
          code: string
          definition?: Json
          id: string
          lifecycle_status?: string
          locked?: boolean
          name: string
          tenant_id: string
          version?: string
        }
        Update: {
          code?: string
          definition?: Json
          id?: string
          lifecycle_status?: string
          locked?: boolean
          name?: string
          tenant_id?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_specifications_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      document_versions: {
        Row: {
          attachment_type: string
          content_hash: string
          created_at: string
          created_by: string | null
          document_id: string
          id: string
          is_named: boolean
          label: string
          mime_type: string
          note: string | null
          sample_pages: Json | null
          size_bytes: number | null
          storage_path: string | null
          supersedes: string | null
          tenant_id: string
        }
        Insert: {
          attachment_type?: string
          content_hash: string
          created_at?: string
          created_by?: string | null
          document_id: string
          id?: string
          is_named?: boolean
          label: string
          mime_type: string
          note?: string | null
          sample_pages?: Json | null
          size_bytes?: number | null
          storage_path?: string | null
          supersedes?: string | null
          tenant_id: string
        }
        Update: {
          attachment_type?: string
          content_hash?: string
          created_at?: string
          created_by?: string | null
          document_id?: string
          id?: string
          is_named?: boolean
          label?: string
          mime_type?: string
          note?: string | null
          sample_pages?: Json | null
          size_bytes?: number | null
          storage_path?: string | null
          supersedes?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_versions_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_versions_supersedes_fkey"
            columns: ["supersedes"]
            isOneToOne: false
            referencedRelation: "document_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_versions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          bundle_id: string | null
          bundle_role: string | null
          characteristic: Json
          created_at: string
          created_by: string | null
          current_version_id: string | null
          deleted_at: string | null
          description: string | null
          document_type: string
          effective_date: string | null
          expiry_date: string | null
          generated_from_spec: string | null
          hold_reason: string | null
          hold_set_by: string | null
          id: string
          legal_hold: boolean
          name: string
          origin: string
          pipeline_detail: Json | null
          pipeline_state: Database["public"]["Enums"]["pipeline_state"]
          retain_until: string | null
          retention_policy_id: string | null
          sensitivity: Database["public"]["Enums"]["sensitivity"]
          signature_level: Database["public"]["Enums"]["signature_level"]
          status: Database["public"]["Enums"]["doc_status"]
          tenant_id: string
          updated_at: string
          valid_to: string | null
        }
        Insert: {
          bundle_id?: string | null
          bundle_role?: string | null
          characteristic?: Json
          created_at?: string
          created_by?: string | null
          current_version_id?: string | null
          deleted_at?: string | null
          description?: string | null
          document_type: string
          effective_date?: string | null
          expiry_date?: string | null
          generated_from_spec?: string | null
          hold_reason?: string | null
          hold_set_by?: string | null
          id?: string
          legal_hold?: boolean
          name: string
          origin?: string
          pipeline_detail?: Json | null
          pipeline_state?: Database["public"]["Enums"]["pipeline_state"]
          retain_until?: string | null
          retention_policy_id?: string | null
          sensitivity?: Database["public"]["Enums"]["sensitivity"]
          signature_level?: Database["public"]["Enums"]["signature_level"]
          status?: Database["public"]["Enums"]["doc_status"]
          tenant_id: string
          updated_at?: string
          valid_to?: string | null
        }
        Update: {
          bundle_id?: string | null
          bundle_role?: string | null
          characteristic?: Json
          created_at?: string
          created_by?: string | null
          current_version_id?: string | null
          deleted_at?: string | null
          description?: string | null
          document_type?: string
          effective_date?: string | null
          expiry_date?: string | null
          generated_from_spec?: string | null
          hold_reason?: string | null
          hold_set_by?: string | null
          id?: string
          legal_hold?: boolean
          name?: string
          origin?: string
          pipeline_detail?: Json | null
          pipeline_state?: Database["public"]["Enums"]["pipeline_state"]
          retain_until?: string | null
          retention_policy_id?: string | null
          sensitivity?: Database["public"]["Enums"]["sensitivity"]
          signature_level?: Database["public"]["Enums"]["signature_level"]
          status?: Database["public"]["Enums"]["doc_status"]
          tenant_id?: string
          updated_at?: string
          valid_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "documents_current_version_fk"
            columns: ["current_version_id"]
            isOneToOne: false
            referencedRelation: "document_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_retention_policy_id_fkey"
            columns: ["retention_policy_id"]
            isOneToOne: false
            referencedRelation: "retention_policies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      entity_access: {
        Row: {
          entity_id: string
          level: Database["public"]["Enums"]["access_level"]
          user_id: string
        }
        Insert: {
          entity_id: string
          level?: Database["public"]["Enums"]["access_level"]
          user_id: string
        }
        Update: {
          entity_id?: string
          level?: Database["public"]["Enums"]["access_level"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "entity_access_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "business_entities"
            referencedColumns: ["id"]
          },
        ]
      }
      extraction_fields: {
        Row: {
          band: string | null
          confidence: number | null
          document_id: string
          id: string
          name: string
          original_value: Json | null
          reviewed_at: string | null
          reviewed_by: string | null
          source: Json | null
          spot_check: boolean
          status: Database["public"]["Enums"]["extraction_status"]
          tenant_id: string
          value: Json | null
          version_id: string
        }
        Insert: {
          band?: string | null
          confidence?: number | null
          document_id: string
          id?: string
          name: string
          original_value?: Json | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source?: Json | null
          spot_check?: boolean
          status?: Database["public"]["Enums"]["extraction_status"]
          tenant_id: string
          value?: Json | null
          version_id: string
        }
        Update: {
          band?: string | null
          confidence?: number | null
          document_id?: string
          id?: string
          name?: string
          original_value?: Json | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source?: Json | null
          spot_check?: boolean
          status?: Database["public"]["Enums"]["extraction_status"]
          tenant_id?: string
          value?: Json | null
          version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "extraction_fields_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extraction_fields_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extraction_fields_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "document_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      idempotency_keys: {
        Row: {
          actor: string
          created_at: string
          key: string
          operation: string
          request_hash: string
          response: Json | null
          tenant_id: string
        }
        Insert: {
          actor?: string
          created_at?: string
          key: string
          operation: string
          request_hash: string
          response?: Json | null
          tenant_id: string
        }
        Update: {
          actor?: string
          created_at?: string
          key?: string
          operation?: string
          request_hash?: string
          response?: Json | null
          tenant_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          display_name: string
          tenant_id: string
          user_id: string
        }
        Insert: {
          display_name: string
          tenant_id: string
          user_id: string
        }
        Update: {
          display_name?: string
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      retention_policies: {
        Row: {
          code: string
          id: string
          locked: boolean
          name: string
          retain_days: number
          tenant_id: string
        }
        Insert: {
          code: string
          id: string
          locked?: boolean
          name: string
          retain_days: number
          tenant_id: string
        }
        Update: {
          code?: string
          id?: string
          locked?: boolean
          name?: string
          retain_days?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "retention_policies_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          cross_tenant_share: string
          display_name: string
          frontend_strategy: string
          hard_floors: Json
          id: string
          inheritance: Json
          master_supervision: string
          parent_tenant_id: string | null
          role: string
        }
        Insert: {
          cross_tenant_share?: string
          display_name: string
          frontend_strategy?: string
          hard_floors?: Json
          id: string
          inheritance?: Json
          master_supervision?: string
          parent_tenant_id?: string | null
          role: string
        }
        Update: {
          cross_tenant_share?: string
          display_name?: string
          frontend_strategy?: string
          hard_floors?: Json
          id?: string
          inheritance?: Json
          master_supervision?: string
          parent_tenant_id?: string | null
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenants_parent_tenant_id_fkey"
            columns: ["parent_tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          display_name: string | null
          role: Database["public"]["Enums"]["app_role"]
          tenant_id: string
          user_id: string
        }
        Insert: {
          display_name?: string | null
          role: Database["public"]["Enums"]["app_role"]
          tenant_id: string
          user_id: string
        }
        Update: {
          display_name?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      master_document_stats: {
        Row: {
          document_type: string | null
          documents: number | null
          pipeline_state: Database["public"]["Enums"]["pipeline_state"] | null
          status: Database["public"]["Enums"]["doc_status"] | null
          tenant_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "documents_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      can_see_document: { Args: { _doc: string }; Returns: boolean }
      effective_specifications: {
        Args: { p_tenant?: string }
        Returns: {
          code: string
          defined_in: string
          definition: Json
          id: string
          lifecycle_status: string
          locked: boolean
          name: string
          overridden: boolean
          overridden_fields: string[]
          tenant_id: string
          version: string
        }[]
      }
      entity_in_my_tenant: { Args: { _entity_id: string }; Returns: boolean }
      has_role: {
        Args: { _role: Database["public"]["Enums"]["app_role"] }
        Returns: boolean
      }
      sample_pages_for: {
        Args: { _lines: string[]; _title: string }
        Returns: Json
      }
      seed_demo_access: {
        Args: {
          _all_entities?: boolean
          _name: string
          _role: Database["public"]["Enums"]["app_role"]
          _tenant: string
          _user: string
        }
        Returns: undefined
      }
      user_tenant: { Args: never; Returns: string }
    }
    Enums: {
      access_level: "view" | "edit" | "manage"
      app_role:
        | "viewer"
        | "contributor"
        | "reviewer"
        | "manager"
        | "tenant_admin"
        | "master_admin"
      doc_status:
        | "draft"
        | "in_review"
        | "approved"
        | "effective"
        | "superseded"
        | "expired"
        | "archived"
      extraction_status: "pending" | "accepted" | "edited" | "rejected"
      pipeline_state:
        | "uploading"
        | "scanning"
        | "reading"
        | "ready"
        | "failed"
        | "quarantined"
      sensitivity: "public" | "internal" | "confidential" | "restricted"
      signature_level: "none" | "simple" | "advanced" | "qualified"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      access_level: ["view", "edit", "manage"],
      app_role: [
        "viewer",
        "contributor",
        "reviewer",
        "manager",
        "tenant_admin",
        "master_admin",
      ],
      doc_status: [
        "draft",
        "in_review",
        "approved",
        "effective",
        "superseded",
        "expired",
        "archived",
      ],
      extraction_status: ["pending", "accepted", "edited", "rejected"],
      pipeline_state: [
        "uploading",
        "scanning",
        "reading",
        "ready",
        "failed",
        "quarantined",
      ],
      sensitivity: ["public", "internal", "confidential", "restricted"],
      signature_level: ["none", "simple", "advanced", "qualified"],
    },
  },
} as const
