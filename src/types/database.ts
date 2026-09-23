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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      accountant_details: {
        Row: {
          client_id: string
          company_name: string
          contact_person: string
          created_at: string
          email_address: string
          id: string
          phone_number: string
          updated_at: string
        }
        Insert: {
          client_id: string
          company_name: string
          contact_person: string
          created_at?: string
          email_address: string
          id?: string
          phone_number: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          company_name?: string
          contact_person?: string
          created_at?: string
          email_address?: string
          id?: string
          phone_number?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "accountant_details_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          ato_admin_confirmed: boolean
          ato_admin_confirmed_at: string | null
          auth_user_id: string | null
          created_at: string
          email: string
          id: string
          name: string
          phone: string | null
          status: string
          updated_at: string
        }
        Insert: {
          ato_admin_confirmed?: boolean
          ato_admin_confirmed_at?: string | null
          auth_user_id?: string | null
          created_at?: string
          email: string
          id?: string
          name: string
          phone?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          ato_admin_confirmed?: boolean
          ato_admin_confirmed_at?: string | null
          auth_user_id?: string | null
          created_at?: string
          email?: string
          id?: string
          name?: string
          phone?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      company_details: {
        Row: {
          abn_number: string | null
          acn_number: string | null
          client_id: string
          company_name: string | null
          created_at: string
          email_address: string | null
          id: string
          phone_number: string | null
          trust_name: string | null
          updated_at: string
        }
        Insert: {
          abn_number?: string | null
          acn_number?: string | null
          client_id: string
          company_name?: string | null
          created_at?: string
          email_address?: string | null
          id?: string
          phone_number?: string | null
          trust_name?: string | null
          updated_at?: string
        }
        Update: {
          abn_number?: string | null
          acn_number?: string | null
          client_id?: string
          company_name?: string | null
          created_at?: string
          email_address?: string | null
          id?: string
          phone_number?: string | null
          trust_name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_details_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      document_chunks: {
        Row: {
          chunk_index: number
          chunk_text: string
          client_id: string
          created_at: string
          document_id: string
          embedding: string | null
          id: string
          metadata: Json
        }
        Insert: {
          chunk_index: number
          chunk_text: string
          client_id: string
          created_at?: string
          document_id: string
          embedding?: string | null
          id?: string
          metadata?: Json
        }
        Update: {
          chunk_index?: number
          chunk_text?: string
          client_id?: string
          created_at?: string
          document_id?: string
          embedding?: string | null
          id?: string
          metadata?: Json
        }
        Relationships: [
          {
            foreignKeyName: "document_chunks_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_chunks_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          ai_confidence: number | null
          ai_doc_type: string | null
          ai_financial_years: string[] | null
          ai_raw_response: Json | null
          client_id: string
          doc_category: string
          extracted_text: string | null
          file_path: string
          file_size_bytes: number
          file_type: string
          id: string
          original_filename: string
          reupload_reason: string | null
          reupload_requested: boolean
          status: string
          uploaded_at: string
        }
        Insert: {
          ai_confidence?: number | null
          ai_doc_type?: string | null
          ai_financial_years?: string[] | null
          ai_raw_response?: Json | null
          client_id: string
          doc_category: string
          extracted_text?: string | null
          file_path: string
          file_size_bytes?: number
          file_type: string
          id?: string
          original_filename: string
          reupload_reason?: string | null
          reupload_requested?: boolean
          status?: string
          uploaded_at?: string
        }
        Update: {
          ai_confidence?: number | null
          ai_doc_type?: string | null
          ai_financial_years?: string[] | null
          ai_raw_response?: Json | null
          client_id?: string
          doc_category?: string
          extracted_text?: string | null
          file_path?: string
          file_size_bytes?: number
          file_type?: string
          id?: string
          original_filename?: string
          reupload_reason?: string | null
          reupload_requested?: boolean
          status?: string
          uploaded_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "documents_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      financial_comparison_jobs: {
        Row: {
          client_id: string
          created_at: string
          error: string | null
          extract_errors: Json
          finished_at: string | null
          id: string
          mode: string
          result: Json | null
          started_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          error?: string | null
          extract_errors?: Json
          finished_at?: string | null
          id?: string
          mode?: string
          result?: Json | null
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          error?: string | null
          extract_errors?: Json
          finished_at?: string | null
          id?: string
          mode?: string
          result?: Json | null
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "financial_comparison_jobs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      financial_comparisons: {
        Row: {
          ai_summary: string | null
          ai_summary_generated_at: string | null
          ai_summary_model: string | null
          client_id: string
          computed: Json
          financial_years: number[]
          generated_at: string
          id: string
        }
        Insert: {
          ai_summary?: string | null
          ai_summary_generated_at?: string | null
          ai_summary_model?: string | null
          client_id: string
          computed: Json
          financial_years: number[]
          generated_at?: string
          id?: string
        }
        Update: {
          ai_summary?: string | null
          ai_summary_generated_at?: string | null
          ai_summary_model?: string | null
          client_id?: string
          computed?: Json
          financial_years?: number[]
          generated_at?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "financial_comparisons_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      financial_statements: {
        Row: {
          balance_sheet: Json
          client_id: string
          document_id: string
          extracted_at: string
          extraction_model: string | null
          extraction_warnings: Json
          financial_year: number
          id: string
          income_statement: Json
          period_end_date: string
          period_label: string | null
          period_start_date: string | null
          raw_extraction: Json | null
          source_column: string
          source_filename: string
        }
        Insert: {
          balance_sheet: Json
          client_id: string
          document_id: string
          extracted_at?: string
          extraction_model?: string | null
          extraction_warnings?: Json
          financial_year: number
          id?: string
          income_statement: Json
          period_end_date: string
          period_label?: string | null
          period_start_date?: string | null
          raw_extraction?: Json | null
          source_column: string
          source_filename: string
        }
        Update: {
          balance_sheet?: Json
          client_id?: string
          document_id?: string
          extracted_at?: string
          extraction_model?: string | null
          extraction_warnings?: Json
          financial_year?: number
          id?: string
          income_statement?: Json
          period_end_date?: string
          period_label?: string | null
          period_start_date?: string | null
          raw_extraction?: Json | null
          source_column?: string
          source_filename?: string
        }
        Relationships: [
          {
            foreignKeyName: "financial_statements_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_statements_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_activities: {
        Row: {
          author: string
          body: string
          created_at: string
          id: string
          lead_id: string
          type: string
        }
        Insert: {
          author: string
          body: string
          created_at?: string
          id?: string
          lead_id: string
          type: string
        }
        Update: {
          author?: string
          body?: string
          created_at?: string
          id?: string
          lead_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_activities_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_intake_log: {
        Row: {
          created_at: string
          error: string | null
          external_id: string | null
          id: string
          outcome: string
          raw_body: Json | null
          source: string
        }
        Insert: {
          created_at?: string
          error?: string | null
          external_id?: string | null
          id?: string
          outcome: string
          raw_body?: Json | null
          source: string
        }
        Update: {
          created_at?: string
          error?: string | null
          external_id?: string | null
          id?: string
          outcome?: string
          raw_body?: Json | null
          source?: string
        }
        Relationships: []
      }
      leads: {
        Row: {
          company: string | null
          converted_client_id: string | null
          created_at: string
          debt_max: number | null
          debt_min: number | null
          email: string
          entity_type: string | null
          external_id: string | null
          id: string
          last_action_at: string
          message: string | null
          meta_account_id: string | null
          meta_ad_id: string | null
          meta_ad_name: string | null
          meta_adgroup_id: string | null
          meta_campaign_id: string | null
          meta_campaign_name: string | null
          meta_form_id: string | null
          meta_page_id: string | null
          meta_state_options: string[] | null
          meta_state_raw: string | null
          name: string
          next_step: string | null
          phone: string
          preferred_call_time: string | null
          source: string
          stage: string
          stage_since: string
          state: string | null
          updated_at: string
        }
        Insert: {
          company?: string | null
          converted_client_id?: string | null
          created_at?: string
          debt_max?: number | null
          debt_min?: number | null
          email: string
          entity_type?: string | null
          external_id?: string | null
          id?: string
          last_action_at?: string
          message?: string | null
          meta_account_id?: string | null
          meta_ad_id?: string | null
          meta_ad_name?: string | null
          meta_adgroup_id?: string | null
          meta_campaign_id?: string | null
          meta_campaign_name?: string | null
          meta_form_id?: string | null
          meta_page_id?: string | null
          meta_state_options?: string[] | null
          meta_state_raw?: string | null
          name: string
          next_step?: string | null
          phone: string
          preferred_call_time?: string | null
          source: string
          stage?: string
          stage_since?: string
          state?: string | null
          updated_at?: string
        }
        Update: {
          company?: string | null
          converted_client_id?: string | null
          created_at?: string
          debt_max?: number | null
          debt_min?: number | null
          email?: string
          entity_type?: string | null
          external_id?: string | null
          id?: string
          last_action_at?: string
          message?: string | null
          meta_account_id?: string | null
          meta_ad_id?: string | null
          meta_ad_name?: string | null
          meta_adgroup_id?: string | null
          meta_campaign_id?: string | null
          meta_campaign_name?: string | null
          meta_form_id?: string | null
          meta_page_id?: string | null
          meta_state_options?: string[] | null
          meta_state_raw?: string | null
          name?: string
          next_step?: string | null
          phone?: string
          preferred_call_time?: string | null
          source?: string
          stage?: string
          stage_since?: string
          state?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "leads_converted_client_id_fkey"
            columns: ["converted_client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      lodgement_analyses: {
        Row: {
          ai_summary: string | null
          ai_summary_generated_at: string | null
          ai_summary_model: string | null
          analysed_at: string
          client_id: string
          company_name_in_csv: string | null
          cumulative_days_late: number
          debt_breakdown: Json | null
          document_id: string
          dpn_risk: Json | null
          id: string
          number_of_late_lodgements: number
          row_count: number
          rows: Json
          source_filename: string
          statement_label: string | null
          warnings: Json
        }
        Insert: {
          ai_summary?: string | null
          ai_summary_generated_at?: string | null
          ai_summary_model?: string | null
          analysed_at?: string
          client_id: string
          company_name_in_csv?: string | null
          cumulative_days_late: number
          debt_breakdown?: Json | null
          document_id: string
          dpn_risk?: Json | null
          id?: string
          number_of_late_lodgements: number
          row_count: number
          rows: Json
          source_filename: string
          statement_label?: string | null
          warnings?: Json
        }
        Update: {
          ai_summary?: string | null
          ai_summary_generated_at?: string | null
          ai_summary_model?: string | null
          analysed_at?: string
          client_id?: string
          company_name_in_csv?: string | null
          cumulative_days_late?: number
          debt_breakdown?: Json | null
          document_id?: string
          dpn_risk?: Json | null
          id?: string
          number_of_late_lodgements?: number
          row_count?: number
          rows?: Json
          source_filename?: string
          statement_label?: string | null
          warnings?: Json
        }
        Relationships: [
          {
            foreignKeyName: "lodgement_analyses_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lodgement_analyses_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: true
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      sbr_historical_cases: {
        Row: {
          accepted: boolean
          added_at: string
          client_name: string
          creditor_amount: number
          cumulative_days_late: number
          days_since_last_payment: number
          director_loan_at_appointment: boolean
          director_loan_receivable_amount: number
          dpn: boolean
          id: string
          number_of_late_lodgements: number
          outcome_percent: number
          payment_plan_type: string
          sbr_payment: number
        }
        Insert: {
          accepted: boolean
          added_at?: string
          client_name: string
          creditor_amount: number
          cumulative_days_late: number
          days_since_last_payment: number
          director_loan_at_appointment: boolean
          director_loan_receivable_amount?: number
          dpn: boolean
          id?: string
          number_of_late_lodgements: number
          outcome_percent: number
          payment_plan_type: string
          sbr_payment: number
        }
        Update: {
          accepted?: boolean
          added_at?: string
          client_name?: string
          creditor_amount?: number
          cumulative_days_late?: number
          days_since_last_payment?: number
          director_loan_at_appointment?: boolean
          director_loan_receivable_amount?: number
          dpn?: boolean
          id?: string
          number_of_late_lodgements?: number
          outcome_percent?: number
          payment_plan_type?: string
          sbr_payment?: number
        }
        Relationships: []
      }
      sbr_outcome_predictions: {
        Row: {
          client_id: string
          comparable_case_ids: string[]
          computed_at: string
          id: string
          input_features: Json
          predicted_high_percent: number
          predicted_low_percent: number
          predicted_outcome_percent: number
          training_set_size: number
        }
        Insert: {
          client_id: string
          comparable_case_ids: string[]
          computed_at?: string
          id?: string
          input_features: Json
          predicted_high_percent: number
          predicted_low_percent: number
          predicted_outcome_percent: number
          training_set_size: number
        }
        Update: {
          client_id?: string
          comparable_case_ids?: string[]
          computed_at?: string
          id?: string
          input_features?: Json
          predicted_high_percent?: number
          predicted_low_percent?: number
          predicted_outcome_percent?: number
          training_set_size?: number
        }
        Relationships: [
          {
            foreignKeyName: "sbr_outcome_predictions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      match_document_chunks: {
        Args: {
          match_client_id: string
          match_count?: number
          match_threshold?: number
          query_embedding: string
        }
        Returns: {
          chunk_text: string
          id: string
          metadata: Json
          similarity: number
        }[]
      }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
