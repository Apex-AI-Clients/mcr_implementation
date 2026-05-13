export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

