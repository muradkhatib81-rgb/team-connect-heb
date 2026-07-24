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
      announcement_attachments: {
        Row: {
          announcement_id: string
          file_name: string
          file_size: number | null
          id: string
          mime_type: string | null
          storage_path: string
          uploaded_at: string
        }
        Insert: {
          announcement_id: string
          file_name: string
          file_size?: number | null
          id?: string
          mime_type?: string | null
          storage_path: string
          uploaded_at?: string
        }
        Update: {
          announcement_id?: string
          file_name?: string
          file_size?: number | null
          id?: string
          mime_type?: string | null
          storage_path?: string
          uploaded_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "announcement_attachments_announcement_id_fkey"
            columns: ["announcement_id"]
            isOneToOne: false
            referencedRelation: "announcements"
            referencedColumns: ["id"]
          },
        ]
      }
      announcement_reads: {
        Row: {
          announcement_id: string
          id: string
          read_at: string
          user_id: string
        }
        Insert: {
          announcement_id: string
          id?: string
          read_at?: string
          user_id: string
        }
        Update: {
          announcement_id?: string
          id?: string
          read_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "announcement_reads_announcement_id_fkey"
            columns: ["announcement_id"]
            isOneToOne: false
            referencedRelation: "announcements"
            referencedColumns: ["id"]
          },
        ]
      }
      announcement_targets: {
        Row: {
          announcement_id: string
          id: string
          target_id: string | null
          target_type: Database["public"]["Enums"]["comm_target_type"]
        }
        Insert: {
          announcement_id: string
          id?: string
          target_id?: string | null
          target_type: Database["public"]["Enums"]["comm_target_type"]
        }
        Update: {
          announcement_id?: string
          id?: string
          target_id?: string | null
          target_type?: Database["public"]["Enums"]["comm_target_type"]
        }
        Relationships: [
          {
            foreignKeyName: "announcement_targets_announcement_id_fkey"
            columns: ["announcement_id"]
            isOneToOne: false
            referencedRelation: "announcements"
            referencedColumns: ["id"]
          },
        ]
      }
      announcements: {
        Row: {
          body: string
          branch_id: string | null
          created_at: string
          deleted_at: string | null
          edit_count: number
          edited_at: string | null
          edited_by: string | null
          ends_at: string | null
          id: string
          image_url: string | null
          priority: Database["public"]["Enums"]["comm_priority"]
          sender_id: string
          starts_at: string
          title: string
          updated_at: string
        }
        Insert: {
          body: string
          branch_id?: string | null
          created_at?: string
          deleted_at?: string | null
          edit_count?: number
          edited_at?: string | null
          edited_by?: string | null
          ends_at?: string | null
          id?: string
          image_url?: string | null
          priority?: Database["public"]["Enums"]["comm_priority"]
          sender_id: string
          starts_at?: string
          title: string
          updated_at?: string
        }
        Update: {
          body?: string
          branch_id?: string | null
          created_at?: string
          deleted_at?: string | null
          edit_count?: number
          edited_at?: string | null
          edited_by?: string | null
          ends_at?: string | null
          id?: string
          image_url?: string | null
          priority?: Database["public"]["Enums"]["comm_priority"]
          sender_id?: string
          starts_at?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "announcements_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      branch_banners: {
        Row: {
          branch_id: string
          created_at: string
          created_by: string | null
          description: string | null
          expires_at: string | null
          id: string
          image_path: string
          starts_at: string | null
          title: string | null
          updated_at: string
        }
        Insert: {
          branch_id: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          expires_at?: string | null
          id?: string
          image_path: string
          starts_at?: string | null
          title?: string | null
          updated_at?: string
        }
        Update: {
          branch_id?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          expires_at?: string | null
          id?: string
          image_path?: string
          starts_at?: string | null
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "branch_banners_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: true
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      branches: {
        Row: {
          address: string | null
          code: string
          created_at: string
          id: string
          is_active: boolean
          manager_id: string | null
          name: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          manager_id?: string | null
          name: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          manager_id?: string | null
          name?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "branches_manager_id_fkey"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "department_coworkers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "branches_manager_id_fkey"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      break_audit_log: {
        Row: {
          action: string
          actor_id: string | null
          branch_id: string | null
          break_request_id: string
          id: string
          occurred_at: string
          payload: Json
          target_user_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          branch_id?: string | null
          break_request_id: string
          id?: string
          occurred_at?: string
          payload?: Json
          target_user_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          branch_id?: string | null
          break_request_id?: string
          id?: string
          occurred_at?: string
          payload?: Json
          target_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "break_audit_log_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "break_audit_log_break_request_id_fkey"
            columns: ["break_request_id"]
            isOneToOne: false
            referencedRelation: "break_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      break_policy: {
        Row: {
          approver_scope: string
          branch_id: string | null
          created_at: string
          dispatcher_scope: string
          id: string
          request_scope: string
          requires_approval: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          approver_scope?: string
          branch_id?: string | null
          created_at?: string
          dispatcher_scope?: string
          id?: string
          request_scope?: string
          requires_approval?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          approver_scope?: string
          branch_id?: string | null
          created_at?: string
          dispatcher_scope?: string
          id?: string
          request_scope?: string
          requires_approval?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "break_policy_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: true
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      break_requests: {
        Row: {
          actual_duration: number | null
          actual_end: string | null
          actual_start: string | null
          approval_decided_at: string | null
          approved_at_time: string | null
          approved_by: string | null
          branch_id: string | null
          break_setting_id: string
          cancelled_at: string | null
          cancelled_by: string | null
          cancellation_reason: string | null
          completed_at: string | null
          created_at: string
          department_id: string | null
          duration_minutes: number
          end_notified_at: string | null
          end_verified_by: string | null
          ended_by: string | null
          ended_by_manager_id: string | null
          ended_by_manager_name: string | null
          ending_notified_at: string | null
          ending_verified_at: string | null
          ends_at: string | null
          id: string
          last_modified_at: string | null
          note: string | null
          overtime_minutes: number | null
          planned_duration: number | null
          planned_start: string | null
          rejected_at: string | null
          rejected_by: string | null
          rejection_reason: string | null
          requested_at: string
          start_notified_at: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["break_request_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          actual_duration?: number | null
          actual_end?: string | null
          actual_start?: string | null
          approval_decided_at?: string | null
          approved_at_time?: string | null
          approved_by?: string | null
          branch_id?: string | null
          break_setting_id: string
          cancelled_at?: string | null
          cancelled_by?: string | null
          cancellation_reason?: string | null
          completed_at?: string | null
          created_at?: string
          department_id?: string | null
          duration_minutes: number
          end_notified_at?: string | null
          end_verified_by?: string | null
          ended_by?: string | null
          ended_by_manager_id?: string | null
          ended_by_manager_name?: string | null
          ending_notified_at?: string | null
          ending_verified_at?: string | null
          ends_at?: string | null
          id?: string
          last_modified_at?: string | null
          note?: string | null
          overtime_minutes?: number | null
          planned_duration?: number | null
          planned_start?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          requested_at: string
          start_notified_at?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["break_request_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          actual_duration?: number | null
          actual_end?: string | null
          actual_start?: string | null
          approval_decided_at?: string | null
          approved_at_time?: string | null
          approved_by?: string | null
          branch_id?: string | null
          break_setting_id?: string
          cancelled_at?: string | null
          cancelled_by?: string | null
          cancellation_reason?: string | null
          completed_at?: string | null
          created_at?: string
          department_id?: string | null
          duration_minutes?: number
          end_notified_at?: string | null
          end_verified_by?: string | null
          ended_by?: string | null
          ended_by_manager_id?: string | null
          ended_by_manager_name?: string | null
          ending_notified_at?: string | null
          ending_verified_at?: string | null
          ends_at?: string | null
          id?: string
          last_modified_at?: string | null
          note?: string | null
          overtime_minutes?: number | null
          planned_duration?: number | null
          planned_start?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          requested_at?: string
          start_notified_at?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["break_request_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "break_requests_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "break_requests_break_setting_id_fkey"
            columns: ["break_setting_id"]
            isOneToOne: false
            referencedRelation: "break_settings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "break_requests_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      break_settings: {
        Row: {
          branch_id: string | null
          created_at: string
          created_by: string | null
          duration_minutes: number
          id: string
          is_active: boolean
          name: string
          order_index: number
          updated_at: string
        }
        Insert: {
          branch_id?: string | null
          created_at?: string
          created_by?: string | null
          duration_minutes: number
          id?: string
          is_active?: boolean
          name: string
          order_index?: number
          updated_at?: string
        }
        Update: {
          branch_id?: string | null
          created_at?: string
          created_by?: string | null
          duration_minutes?: number
          id?: string
          is_active?: boolean
          name?: string
          order_index?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "break_settings_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      communications_audit_log: {
        Row: {
          action: Database["public"]["Enums"]["comm_audit_action"]
          actor_id: string | null
          branch_id: string | null
          created_at: string
          entity_id: string
          entity_type: Database["public"]["Enums"]["comm_entity_type"]
          id: string
          payload: Json | null
        }
        Insert: {
          action: Database["public"]["Enums"]["comm_audit_action"]
          actor_id?: string | null
          branch_id?: string | null
          created_at?: string
          entity_id: string
          entity_type: Database["public"]["Enums"]["comm_entity_type"]
          id?: string
          payload?: Json | null
        }
        Update: {
          action?: Database["public"]["Enums"]["comm_audit_action"]
          actor_id?: string | null
          branch_id?: string | null
          created_at?: string
          entity_id?: string
          entity_type?: Database["public"]["Enums"]["comm_entity_type"]
          id?: string
          payload?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "communications_audit_log_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      company_settings: {
        Row: {
          address: string | null
          branch_id: string | null
          company_name: string
          created_at: string
          email: string | null
          extra: Json
          id: string
          is_active: boolean
          logo_url: string | null
          phone: string | null
          primary_color: string | null
          schedule_type: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          branch_id?: string | null
          company_name?: string
          created_at?: string
          email?: string | null
          extra?: Json
          id?: string
          is_active?: boolean
          logo_url?: string | null
          phone?: string | null
          primary_color?: string | null
          schedule_type?: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          branch_id?: string | null
          company_name?: string
          created_at?: string
          email?: string | null
          extra?: Json
          id?: string
          is_active?: boolean
          logo_url?: string | null
          phone?: string | null
          primary_color?: string | null
          schedule_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_settings_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      departments: {
        Row: {
          branch_id: string | null
          code: string
          created_at: string
          id: string
          is_active: boolean
          manager_id: string | null
          name: string
          updated_at: string
        }
        Insert: {
          branch_id?: string | null
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          manager_id?: string | null
          name: string
          updated_at?: string
        }
        Update: {
          branch_id?: string | null
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          manager_id?: string | null
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "departments_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_archive: {
        Row: {
          archived_at: string
          archived_by: string | null
          avatar_url: string | null
          branch_id: string | null
          deactivated_at: string | null
          department_id: string | null
          department_name: string | null
          first_name: string | null
          full_name: string
          id: string
          id_number: string | null
          job_title: string | null
          last_name: string | null
          original_id: string
          phone: string | null
          reason: string | null
          snapshot: Json | null
        }
        Insert: {
          archived_at?: string
          archived_by?: string | null
          avatar_url?: string | null
          branch_id?: string | null
          deactivated_at?: string | null
          department_id?: string | null
          department_name?: string | null
          first_name?: string | null
          full_name: string
          id?: string
          id_number?: string | null
          job_title?: string | null
          last_name?: string | null
          original_id: string
          phone?: string | null
          reason?: string | null
          snapshot?: Json | null
        }
        Update: {
          archived_at?: string
          archived_by?: string | null
          avatar_url?: string | null
          branch_id?: string | null
          deactivated_at?: string | null
          department_id?: string | null
          department_name?: string | null
          first_name?: string | null
          full_name?: string
          id?: string
          id_number?: string | null
          job_title?: string | null
          last_name?: string | null
          original_id?: string
          phone?: string | null
          reason?: string | null
          snapshot?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "employee_archive_archived_by_fkey"
            columns: ["archived_by"]
            isOneToOne: false
            referencedRelation: "department_coworkers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_archive_archived_by_fkey"
            columns: ["archived_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_archive_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_of_month: {
        Row: {
          branch_id: string | null
          created_at: string
          created_by: string | null
          employee_id: string
          id: string
          image_url: string | null
          month: number
          reason: string | null
          updated_at: string
          year: number
        }
        Insert: {
          branch_id?: string | null
          created_at?: string
          created_by?: string | null
          employee_id: string
          id?: string
          image_url?: string | null
          month: number
          reason?: string | null
          updated_at?: string
          year: number
        }
        Update: {
          branch_id?: string | null
          created_at?: string
          created_by?: string | null
          employee_id?: string
          id?: string
          image_url?: string | null
          month?: number
          reason?: string | null
          updated_at?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "employee_of_month_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_of_month_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "department_coworkers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_of_month_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_of_month_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "department_coworkers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_of_month_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      job_titles: {
        Row: {
          branch_id: string | null
          can_request_break: boolean
          created_at: string
          excluded_from_headcount: boolean
          id: string
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          branch_id?: string | null
          can_request_break?: boolean
          created_at?: string
          excluded_from_headcount?: boolean
          id?: string
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          branch_id?: string | null
          can_request_break?: boolean
          created_at?: string
          excluded_from_headcount?: boolean
          id?: string
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_titles_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      management_on_shift: {
        Row: {
          branch_id: string
          created_at: string
          id: string
          started_at: string
          user_id: string
        }
        Insert: {
          branch_id: string
          created_at?: string
          id?: string
          started_at?: string
          user_id: string
        }
        Update: {
          branch_id?: string
          created_at?: string
          id?: string
          started_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "management_on_shift_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "management_on_shift_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "department_coworkers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "management_on_shift_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      message_attachments: {
        Row: {
          file_name: string
          file_size: number | null
          id: string
          message_id: string
          mime_type: string | null
          storage_path: string
          uploaded_at: string
        }
        Insert: {
          file_name: string
          file_size?: number | null
          id?: string
          message_id: string
          mime_type?: string | null
          storage_path: string
          uploaded_at?: string
        }
        Update: {
          file_name?: string
          file_size?: number | null
          id?: string
          message_id?: string
          mime_type?: string | null
          storage_path?: string
          uploaded_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_attachments_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      message_recipients: {
        Row: {
          acknowledged_at: string | null
          archived_at: string | null
          delivered_at: string
          id: string
          message_id: string
          read_at: string | null
          user_id: string
        }
        Insert: {
          acknowledged_at?: string | null
          archived_at?: string | null
          delivered_at?: string
          id?: string
          message_id: string
          read_at?: string | null
          user_id: string
        }
        Update: {
          acknowledged_at?: string | null
          archived_at?: string | null
          delivered_at?: string
          id?: string
          message_id?: string
          read_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_recipients_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      message_targets: {
        Row: {
          id: string
          message_id: string
          target_id: string | null
          target_type: Database["public"]["Enums"]["comm_target_type"]
        }
        Insert: {
          id?: string
          message_id: string
          target_id?: string | null
          target_type: Database["public"]["Enums"]["comm_target_type"]
        }
        Update: {
          id?: string
          message_id?: string
          target_id?: string | null
          target_type?: Database["public"]["Enums"]["comm_target_type"]
        }
        Relationships: [
          {
            foreignKeyName: "message_targets_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          body: string
          branch_id: string | null
          created_at: string
          deleted_at: string | null
          edit_count: number
          edited_at: string | null
          edited_by: string | null
          id: string
          priority: Database["public"]["Enums"]["comm_priority"]
          requires_acknowledgment: boolean
          sender_id: string
          title: string
          updated_at: string
        }
        Insert: {
          body: string
          branch_id?: string | null
          created_at?: string
          deleted_at?: string | null
          edit_count?: number
          edited_at?: string | null
          edited_by?: string | null
          id?: string
          priority?: Database["public"]["Enums"]["comm_priority"]
          requires_acknowledgment?: boolean
          sender_id: string
          title: string
          updated_at?: string
        }
        Update: {
          body?: string
          branch_id?: string | null
          created_at?: string
          deleted_at?: string | null
          edit_count?: number
          edited_at?: string | null
          edited_by?: string | null
          id?: string
          priority?: Database["public"]["Enums"]["comm_priority"]
          requires_acknowledgment?: boolean
          sender_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      morning_board_items: {
        Row: {
          branch_id: string
          created_at: string
          created_by: string | null
          description: string | null
          display_order: number
          expires_at: string | null
          file_size: number | null
          id: string
          is_pinned: boolean
          item_type: string
          mime_type: string | null
          priority: string
          starts_at: string | null
          storage_path: string | null
          style: Json
          title: string | null
          updated_at: string
        }
        Insert: {
          branch_id: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          display_order?: number
          expires_at?: string | null
          file_size?: number | null
          id?: string
          is_pinned?: boolean
          item_type: string
          mime_type?: string | null
          priority?: string
          starts_at?: string | null
          storage_path?: string | null
          style?: Json
          title?: string | null
          updated_at?: string
        }
        Update: {
          branch_id?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          display_order?: number
          expires_at?: string | null
          file_size?: number | null
          id?: string
          is_pinned?: boolean
          item_type?: string
          mime_type?: string | null
          priority?: string
          starts_at?: string | null
          storage_path?: string | null
          style?: Json
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "morning_board_items_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_owner_audit_log: {
        Row: {
          actor_id: string | null
          created_at: string
          event: string
          id: string
          payload: Json
          target_user_id: string | null
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          event: string
          id?: string
          payload?: Json
          target_user_id?: string | null
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          event?: string
          id?: string
          payload?: Json
          target_user_id?: string | null
        }
        Relationships: []
      }
      platform_settings: {
        Row: {
          created_at: string
          id: number
          updated_at: string
          whatsapp_number: string | null
        }
        Insert: {
          created_at?: string
          id?: number
          updated_at?: string
          whatsapp_number?: string | null
        }
        Update: {
          created_at?: string
          id?: number
          updated_at?: string
          whatsapp_number?: string | null
        }
        Relationships: []
      }
      profile_status_log: {
        Row: {
          action: string
          actor_id: string | null
          branch_id: string | null
          created_at: string
          id: string
          note: string | null
          profile_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          branch_id?: string | null
          created_at?: string
          id?: string
          note?: string | null
          profile_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          branch_id?: string | null
          created_at?: string
          id?: string
          note?: string | null
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_status_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "department_coworkers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_status_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_status_log_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_status_log_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "department_coworkers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_status_log_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          branch_id: string | null
          created_at: string
          deactivated_at: string | null
          department_id: string | null
          excluded_from_headcount: boolean
          excluded_from_schedule: boolean
          first_name: string
          full_name: string
          id: string
          last_name: string
          id_number: string | null
          is_active: boolean
          job_title: string | null
          leave_end_date: string | null
          leave_start_date: string | null
          must_change_password: boolean
          on_leave: boolean
          phone: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          branch_id?: string | null
          created_at?: string
          deactivated_at?: string | null
          department_id?: string | null
          excluded_from_headcount?: boolean
          excluded_from_schedule?: boolean
          first_name?: string
          full_name?: string
          id: string
          last_name?: string
          id_number?: string | null
          is_active?: boolean
          job_title?: string | null
          leave_end_date?: string | null
          leave_start_date?: string | null
          must_change_password?: boolean
          on_leave?: boolean
          phone?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          branch_id?: string | null
          created_at?: string
          deactivated_at?: string | null
          department_id?: string | null
          excluded_from_headcount?: boolean
          excluded_from_schedule?: boolean
          first_name?: string
          full_name?: string
          id?: string
          last_name?: string
          id_number?: string | null
          is_active?: boolean
          job_title?: string | null
          leave_end_date?: string | null
          leave_start_date?: string | null
          must_change_password?: boolean
          on_leave?: boolean
          phone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_audit_log: {
        Row: {
          action: Database["public"]["Enums"]["schedule_audit_action"]
          actor_id: string | null
          branch_id: string | null
          created_at: string
          id: string
          note: string | null
          schedule_id: string
        }
        Insert: {
          action: Database["public"]["Enums"]["schedule_audit_action"]
          actor_id?: string | null
          branch_id?: string | null
          created_at?: string
          id?: string
          note?: string | null
          schedule_id: string
        }
        Update: {
          action?: Database["public"]["Enums"]["schedule_audit_action"]
          actor_id?: string | null
          branch_id?: string | null
          created_at?: string
          id?: string
          note?: string | null
          schedule_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedule_audit_log_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_audit_log_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "schedules"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_notifications: {
        Row: {
          branch_id: string | null
          created_at: string
          id: string
          message: string
          read_at: string | null
          schedule_id: string | null
          user_id: string
        }
        Insert: {
          branch_id?: string | null
          created_at?: string
          id?: string
          message: string
          read_at?: string | null
          schedule_id?: string | null
          user_id: string
        }
        Update: {
          branch_id?: string | null
          created_at?: string
          id?: string
          message?: string
          read_at?: string | null
          schedule_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedule_notifications_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_notifications_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "schedules"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_shifts: {
        Row: {
          branch_id: string | null
          created_at: string
          day_date: string
          employee_id: string
          end_time: string | null
          id: string
          note: string | null
          published_shift: string | null
          published_note: string | null
          published_start_time: string | null
          published_end_time: string | null
          schedule_id: string
          shift: string
          start_time: string | null
          submitted_shift: string | null
          submitted_note: string | null
          submitted_start_time: string | null
          submitted_end_time: string | null
          updated_at: string
        }
        Insert: {
          branch_id?: string | null
          created_at?: string
          day_date: string
          employee_id: string
          end_time?: string | null
          id?: string
          note?: string | null
          published_shift?: string | null
          published_note?: string | null
          published_start_time?: string | null
          published_end_time?: string | null
          schedule_id: string
          shift: string
          start_time?: string | null
          submitted_shift?: string | null
          submitted_note?: string | null
          submitted_start_time?: string | null
          submitted_end_time?: string | null
          updated_at?: string
        }
        Update: {
          branch_id?: string | null
          created_at?: string
          day_date?: string
          employee_id?: string
          end_time?: string | null
          id?: string
          note?: string | null
          published_shift?: string | null
          published_note?: string | null
          published_start_time?: string | null
          published_end_time?: string | null
          schedule_id?: string
          submitted_shift?: string | null
          submitted_note?: string | null
          submitted_start_time?: string | null
          submitted_end_time?: string | null
          shift?: string
          start_time?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedule_shifts_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_shifts_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "department_coworkers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_shifts_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_shifts_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "schedules"
            referencedColumns: ["id"]
          },
        ]
      }
      schedules: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          branch_id: string | null
          created_at: string
          created_by: string | null
          department_id: string
          id: string
          published_at: string | null
          rejected_at: string | null
          rejected_by: string | null
          rejection_note: string | null
          schedule_type: string
          status: Database["public"]["Enums"]["schedule_status"]
          submitted_at: string | null
          submitted_by: string | null
          updated_at: string
          updated_by: string | null
          week_end: string
          week_start: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          branch_id?: string | null
          created_at?: string
          created_by?: string | null
          department_id: string
          id?: string
          published_at?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_note?: string | null
          schedule_type?: string
          status?: Database["public"]["Enums"]["schedule_status"]
          submitted_at?: string | null
          submitted_by?: string | null
          updated_at?: string
          updated_by?: string | null
          week_end: string
          week_start: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          branch_id?: string | null
          created_at?: string
          created_by?: string | null
          department_id?: string
          id?: string
          published_at?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_note?: string | null
          schedule_type?: string
          status?: Database["public"]["Enums"]["schedule_status"]
          submitted_at?: string | null
          submitted_by?: string | null
          updated_at?: string
          updated_by?: string | null
          week_end?: string
          week_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedules_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedules_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedules_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "department_coworkers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedules_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_definitions: {
        Row: {
          branch_id: string | null
          code: string
          color: string
          created_at: string
          created_by: string | null
          end_time: string | null
          id: string
          is_active: boolean
          is_system: boolean
          name: string
          sort_order: number
          start_time: string | null
          updated_at: string
        }
        Insert: {
          branch_id?: string | null
          code: string
          color?: string
          created_at?: string
          created_by?: string | null
          end_time?: string | null
          id?: string
          is_active?: boolean
          is_system?: boolean
          name: string
          sort_order?: number
          start_time?: string | null
          updated_at?: string
        }
        Update: {
          branch_id?: string | null
          code?: string
          color?: string
          created_at?: string
          created_by?: string | null
          end_time?: string | null
          id?: string
          is_active?: boolean
          is_system?: boolean
          name?: string
          sort_order?: number
          start_time?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_definitions_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      task_activity_log: {
        Row: {
          actor_id: string | null
          branch_id: string | null
          created_at: string
          event: string
          id: string
          payload: Json | null
          task_id: string
        }
        Insert: {
          actor_id?: string | null
          branch_id?: string | null
          created_at?: string
          event: string
          id?: string
          payload?: Json | null
          task_id: string
        }
        Update: {
          actor_id?: string | null
          branch_id?: string | null
          created_at?: string
          event?: string
          id?: string
          payload?: Json | null
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_activity_log_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_activity_log_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_assignees: {
        Row: {
          assigned_at: string
          task_id: string
          user_id: string
        }
        Insert: {
          assigned_at?: string
          task_id: string
          user_id: string
        }
        Update: {
          assigned_at?: string
          task_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_assignees_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_comments: {
        Row: {
          author_id: string
          body: string
          created_at: string
          id: string
          task_id: string
        }
        Insert: {
          author_id: string
          body: string
          created_at?: string
          id?: string
          task_id: string
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          id?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_comments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_departments: {
        Row: {
          department_id: string
          task_id: string
        }
        Insert: {
          department_id: string
          task_id: string
        }
        Update: {
          department_id?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_departments_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_departments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_images: {
        Row: {
          created_at: string
          id: string
          storage_path: string
          task_id: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          storage_path: string
          task_id: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          storage_path?: string
          task_id?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "task_images_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_recurrence_images: {
        Row: {
          created_at: string
          id: string
          recurrence_id: string
          storage_path: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          recurrence_id: string
          storage_path: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          recurrence_id?: string
          storage_path?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "task_recurrence_images_recurrence_id_fkey"
            columns: ["recurrence_id"]
            isOneToOne: false
            referencedRelation: "task_recurrences"
            referencedColumns: ["id"]
          },
        ]
      }
      task_recurrences: {
        Row: {
          assignee_id: string | null
          branch_id: string | null
          created_at: string
          created_by: string | null
          day_of_month: number | null
          days_of_week: number[]
          department_id: string
          description: string | null
          frequency: Database["public"]["Enums"]["task_recurrence_frequency"]
          id: string
          is_active: boolean
          last_generated_at: string | null
          next_run_at: string | null
          priority: Database["public"]["Enums"]["task_priority"]
          time_of_day: string
          title: string
          updated_at: string
        }
        Insert: {
          assignee_id?: string | null
          branch_id?: string | null
          created_at?: string
          created_by?: string | null
          day_of_month?: number | null
          days_of_week?: number[]
          department_id: string
          description?: string | null
          frequency: Database["public"]["Enums"]["task_recurrence_frequency"]
          id?: string
          is_active?: boolean
          last_generated_at?: string | null
          next_run_at?: string | null
          priority?: Database["public"]["Enums"]["task_priority"]
          time_of_day?: string
          title: string
          updated_at?: string
        }
        Update: {
          assignee_id?: string | null
          branch_id?: string | null
          created_at?: string
          created_by?: string | null
          day_of_month?: number | null
          days_of_week?: number[]
          department_id?: string
          description?: string | null
          frequency?: Database["public"]["Enums"]["task_recurrence_frequency"]
          id?: string
          is_active?: boolean
          last_generated_at?: string | null
          next_run_at?: string | null
          priority?: Database["public"]["Enums"]["task_priority"]
          time_of_day?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_recurrences_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_recurrences_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          assignee_id: string | null
          branch_id: string | null
          closed_at: string | null
          closed_by: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string
          created_by: string | null
          department_id: string | null
          description: string | null
          due_at: string | null
          employee_note: string | null
          id: string
          notes: string | null
          priority: Database["public"]["Enums"]["task_priority"]
          recurrence_id: string | null
          rejected_at: string | null
          rejection_note: string | null
          requires_approval: boolean
          status: Database["public"]["Enums"]["task_status"]
          target_scope: Database["public"]["Enums"]["task_target_scope"]
          title: string
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          assignee_id?: string | null
          branch_id?: string | null
          closed_at?: string | null
          closed_by?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string | null
          department_id?: string | null
          description?: string | null
          due_at?: string | null
          employee_note?: string | null
          id?: string
          notes?: string | null
          priority?: Database["public"]["Enums"]["task_priority"]
          recurrence_id?: string | null
          rejected_at?: string | null
          rejection_note?: string | null
          requires_approval?: boolean
          status?: Database["public"]["Enums"]["task_status"]
          target_scope?: Database["public"]["Enums"]["task_target_scope"]
          title: string
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          assignee_id?: string | null
          branch_id?: string | null
          closed_at?: string | null
          closed_by?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string | null
          department_id?: string | null
          description?: string | null
          due_at?: string | null
          employee_note?: string | null
          id?: string
          notes?: string | null
          priority?: Database["public"]["Enums"]["task_priority"]
          recurrence_id?: string | null
          rejected_at?: string | null
          rejection_note?: string | null
          requires_approval?: boolean
          status?: Database["public"]["Enums"]["task_status"]
          target_scope?: Database["public"]["Enums"]["task_target_scope"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_recurrence_id_fkey"
            columns: ["recurrence_id"]
            isOneToOne: false
            referencedRelation: "task_recurrences"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      user_task_permissions: {
        Row: {
          branch_id: string | null
          can_add_employee: boolean
          can_approve_leave: boolean
          can_approve_schedule: boolean
          can_approve_tasks: boolean
          can_create_schedule: boolean
          can_create_tasks: boolean
          can_delete_communications: boolean
          can_delete_employee: boolean
          can_delete_tasks: boolean
          can_edit_employee: boolean
          can_edit_leave_balance: boolean
          can_edit_schedule: boolean
          can_edit_tasks: boolean
          can_export_employees: boolean
          can_export_reports: boolean
          can_manage_breaks: boolean
          can_manage_communications: boolean
          can_manage_company_settings: boolean
          can_manage_departments: boolean
          can_manage_employee_of_month: boolean
          can_manage_morning_board: boolean
          can_manage_permissions: boolean
          can_manage_schedule: boolean
          can_manage_tasks: boolean
          can_manage_users: boolean
          can_publish_schedule: boolean
          can_reject_leave: boolean
          can_reset_employee_password: boolean
          can_send_announcements: boolean
          can_send_message_all: boolean
          can_send_message_department: boolean
          can_send_message_employee: boolean
          can_send_messages: boolean
          can_view_activity_log: boolean
          can_view_all_employees: boolean
          can_view_breaks: boolean
          can_view_dashboard: boolean
          can_view_employee_details: boolean
          can_view_leave: boolean
          can_view_messages: boolean
          can_view_read_receipts: boolean
          can_view_reports: boolean
          can_view_schedule: boolean
          can_view_tasks: boolean
          created_at: string
          granted_by: string | null
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          branch_id?: string | null
          can_add_employee?: boolean
          can_approve_leave?: boolean
          can_approve_schedule?: boolean
          can_approve_tasks?: boolean
          can_create_schedule?: boolean
          can_create_tasks?: boolean
          can_delete_communications?: boolean
          can_delete_employee?: boolean
          can_delete_tasks?: boolean
          can_edit_employee?: boolean
          can_edit_leave_balance?: boolean
          can_edit_schedule?: boolean
          can_edit_tasks?: boolean
          can_export_employees?: boolean
          can_export_reports?: boolean
          can_manage_breaks?: boolean
          can_manage_communications?: boolean
          can_manage_company_settings?: boolean
          can_manage_departments?: boolean
          can_manage_employee_of_month?: boolean
          can_manage_morning_board?: boolean
          can_manage_permissions?: boolean
          can_manage_schedule?: boolean
          can_manage_tasks?: boolean
          can_manage_users?: boolean
          can_publish_schedule?: boolean
          can_reject_leave?: boolean
          can_reset_employee_password?: boolean
          can_send_announcements?: boolean
          can_send_message_all?: boolean
          can_send_message_department?: boolean
          can_send_message_employee?: boolean
          can_send_messages?: boolean
          can_view_activity_log?: boolean
          can_view_all_employees?: boolean
          can_view_breaks?: boolean
          can_view_dashboard?: boolean
          can_view_employee_details?: boolean
          can_view_leave?: boolean
          can_view_messages?: boolean
          can_view_read_receipts?: boolean
          can_view_reports?: boolean
          can_view_schedule?: boolean
          can_view_tasks?: boolean
          created_at?: string
          granted_by?: string | null
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          branch_id?: string | null
          can_add_employee?: boolean
          can_approve_leave?: boolean
          can_approve_schedule?: boolean
          can_approve_tasks?: boolean
          can_create_schedule?: boolean
          can_create_tasks?: boolean
          can_delete_communications?: boolean
          can_delete_employee?: boolean
          can_delete_tasks?: boolean
          can_edit_employee?: boolean
          can_edit_leave_balance?: boolean
          can_edit_schedule?: boolean
          can_edit_tasks?: boolean
          can_export_employees?: boolean
          can_export_reports?: boolean
          can_manage_breaks?: boolean
          can_manage_communications?: boolean
          can_manage_company_settings?: boolean
          can_manage_departments?: boolean
          can_manage_employee_of_month?: boolean
          can_manage_morning_board?: boolean
          can_manage_permissions?: boolean
          can_manage_schedule?: boolean
          can_manage_tasks?: boolean
          can_manage_users?: boolean
          can_publish_schedule?: boolean
          can_reject_leave?: boolean
          can_reset_employee_password?: boolean
          can_send_announcements?: boolean
          can_send_message_all?: boolean
          can_send_message_department?: boolean
          can_send_message_employee?: boolean
          can_send_messages?: boolean
          can_view_activity_log?: boolean
          can_view_all_employees?: boolean
          can_view_breaks?: boolean
          can_view_dashboard?: boolean
          can_view_employee_details?: boolean
          can_view_leave?: boolean
          can_view_messages?: boolean
          can_view_read_receipts?: boolean
          can_view_reports?: boolean
          can_view_schedule?: boolean
          can_view_tasks?: boolean
          created_at?: string
          granted_by?: string | null
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_task_permissions_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      department_coworkers: {
        Row: {
          avatar_url: string | null
          department_id: string | null
          excluded_from_headcount: boolean | null
          excluded_from_schedule: boolean | null
          full_name: string | null
          id: string | null
          is_active: boolean | null
          job_title: string | null
          on_leave: boolean | null
        }
        Insert: {
          avatar_url?: string | null
          department_id?: string | null
          excluded_from_headcount?: boolean | null
          excluded_from_schedule?: boolean | null
          full_name?: string | null
          id?: string | null
          is_active?: boolean | null
          job_title?: string | null
          on_leave?: boolean | null
        }
        Update: {
          avatar_url?: string | null
          department_id?: string | null
          excluded_from_headcount?: boolean | null
          excluded_from_schedule?: boolean | null
          full_name?: string | null
          id?: string | null
          is_active?: boolean | null
          job_title?: string | null
          on_leave?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      activate_due_break_requests: { Args: never; Returns: number }
      approve_break_request: {
        Args: { _approved_at_time?: string; _id: string }
        Returns: undefined
      }
      archive_employee: {
        Args: { _reason?: string; _user_id: string }
        Returns: string
      }
      can_approve_break_by_policy: {
        Args: { _user_id: string }
        Returns: boolean
      }
      can_approve_task: {
        Args: { _approver_id: string; _task_id: string }
        Returns: boolean
      }
      can_dispatch_break_by_policy: {
        Args: { _user_id: string }
        Returns: boolean
      }
      can_manage_morning_board_for_branch: {
        Args: { _branch_id: string; _uid: string }
        Returns: boolean
      }
      can_manually_end_break: { Args: { _user_id: string }; Returns: boolean }
      can_request_break_by_policy: {
        Args: { _user_id: string }
        Returns: boolean
      }
      cancel_break_request: {
        Args: { _id: string; _reason?: string }
        Returns: undefined
      }
      reschedule_break_request: {
        Args: { _id: string; _new_duration?: number; _new_start: string }
        Returns: undefined
      }
      can_view_announcement: {
        Args: { _ann_id: string; _user_id: string }
        Returns: boolean
      }
      can_view_task: {
        Args: { _task_id: string; _user_id: string }
        Returns: boolean
      }
      current_active_branch: { Args: never; Returns: string }
      delete_branch_cascade: { Args: { _branch_id: string }; Returns: Json }
      end_break_by_manager: {
        Args: { _id: string; _reason?: string }
        Returns: undefined
      }
      end_my_break: { Args: { _id: string }; Returns: undefined }
      find_archived_by_id_number: {
        Args: { _id_number: string }
        Returns: {
          archived_at: string
          deactivated_at: string
          department_name: string
          full_name: string
          id: string
          job_title: string
          original_id: string
          snapshot: Json
        }[]
      }
      find_profile_by_id_number: {
        Args: { _id_number: string }
        Returns: {
          department_id: string
          full_name: string
          id: string
          is_active: boolean
        }[]
      }
      get_announcement_read_receipts: {
        Args: { _ann_id: string }
        Returns: {
          department_name: string
          full_name: string
          job_title: string
          read_at: string
          user_id: string
        }[]
      }
      get_branch_delete_blockers: {
        Args: { _branch_id: string }
        Returns: Json
      }
      get_branches_with_stats: { Args: never; Returns: Json }
      get_break_policy: {
        Args: never
        Returns: {
          approver_scope: string
          branch_id: string | null
          created_at: string
          dispatcher_scope: string
          id: string
          request_scope: string
          requires_approval: boolean
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "break_policy"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_communication_sender: {
        Args: { _user_id: string }
        Returns: {
          avatar_url: string
          department_name: string
          full_name: string
          job_title: string
          top_role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }[]
      }
      get_department_coworkers: {
        Args: never
        Returns: {
          avatar_url: string
          department_id: string
          full_name: string
          id: string
          is_active: boolean
          job_title: string
          on_leave: boolean
        }[]
      }
      get_employees_of_month: {
        Args: { _month: number; _year: number }
        Returns: {
          avatar_url: string
          created_at: string
          department_name: string
          employee_id: string
          full_name: string
          id: string
          image_url: string
          job_title: string
          month: number
          reason: string
          year: number
        }[]
      }
      get_management_on_shift: {
        Args: never
        Returns: {
          avatar_url: string
          full_name: string
          id: string
          job_title: string
          role: Database["public"]["Enums"]["app_role"]
          started_at: string
          user_id: string
        }[]
      }
      get_message_read_receipts: {
        Args: { _message_id: string }
        Returns: {
          acknowledged_at: string
          department_name: string
          full_name: string
          job_title: string
          read_at: string
          user_id: string
        }[]
      }
      get_my_department_id: { Args: never; Returns: string }
      get_profile_contact: {
        Args: { _id: string }
        Returns: {
          id_number: string
          must_change_password: boolean
          phone: string
        }[]
      }
      get_profiles_basic_info: {
        Args: { user_ids: string[] }
        Returns: {
          full_name: string
          id: string
          job_title: string
          role: string
          role_label: string
        }[]
      }
      get_task_assignees: {
        Args: { _task_id: string }
        Returns: {
          avatar_url: string
          full_name: string
          user_id: string
        }[]
      }
      has_break_manage_perm: { Args: { _user_id: string }; Returns: boolean }
      has_delete_communications_perm: {
        Args: { _user_id: string }
        Returns: boolean
      }
      has_main_admin: { Args: never; Returns: boolean }
      has_manage_communications_perm: {
        Args: { _user_id: string }
        Returns: boolean
      }
      has_manage_employee_of_month_perm: {
        Args: { _uid: string }
        Returns: boolean
      }
      has_manage_morning_board_perm: {
        Args: { _uid: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      has_schedule_approve_perm: {
        Args: { _user_id: string }
        Returns: boolean
      }
      has_schedule_create_perm: { Args: { _user_id: string }; Returns: boolean }
      has_schedule_manage_perm: { Args: { _user_id: string }; Returns: boolean }
      has_schedule_publish_perm: {
        Args: { _user_id: string }
        Returns: boolean
      }
      has_send_announcements_perm: {
        Args: { _user_id: string }
        Returns: boolean
      }
      has_send_messages_perm: { Args: { _user_id: string }; Returns: boolean }
      has_task_approve_perm: { Args: { _user_id: string }; Returns: boolean }
      has_task_close_perm: { Args: { _user_id: string }; Returns: boolean }
      has_task_create_perm: { Args: { _user_id: string }; Returns: boolean }
      has_task_delete_perm: { Args: { _user_id: string }; Returns: boolean }
      has_task_edit_perm: { Args: { _user_id: string }; Returns: boolean }
      has_task_management_perm: { Args: { _user_id: string }; Returns: boolean }
      has_view_all_employees_perm: {
        Args: { _user_id: string }
        Returns: boolean
      }
      has_view_employee_details_perm: {
        Args: { _user_id: string }
        Returns: boolean
      }
      has_view_read_receipts_perm: {
        Args: { _user_id: string }
        Returns: boolean
      }
      is_admin: { Args: { _user_id: string }; Returns: boolean }
      is_announcement_sender: {
        Args: { _ann_id: string; _user_id: string }
        Returns: boolean
      }
      is_message_recipient: {
        Args: { _msg_id: string; _user_id: string }
        Returns: boolean
      }
      is_message_sender: {
        Args: { _msg_id: string; _user_id: string }
        Returns: boolean
      }
      is_platform_owner: { Args: { _user_id: string }; Returns: boolean }
      is_system_admin: { Args: { _user_id: string }; Returns: boolean }
      list_profiles_contact: {
        Args: never
        Returns: {
          id: string
          id_number: string
          must_change_password: boolean
          phone: string
        }[]
      }
      list_visible_user_roles: {
        Args: never
        Returns: {
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }[]
      }
      log_platform_owner_event: {
        Args: { _event: string; _payload?: Json; _target_user_id?: string }
        Returns: string
      }
      manual_end_break: {
        Args: { _id: string; _reason?: string }
        Returns: undefined
      }
      notify_announcement_edited: {
        Args: { _ann_id: string; _title: string }
        Returns: undefined
      }
      notify_message_edited: {
        Args: { _message_id: string; _title: string }
        Returns: undefined
      }
      process_break_lifecycle: { Args: never; Returns: undefined }
      purge_announcement_global: {
        Args: { _ann_id: string }
        Returns: undefined
      }
      purge_message_global: {
        Args: { _message_id: string }
        Returns: undefined
      }
      reset_breaks_log_daily: { Args: never; Returns: undefined }
      reject_break_request: {
        Args: { _id: string; _reason?: string }
        Returns: undefined
      }
      set_department_manager: {
        Args: { _dept_id: string; _new_manager_id: string }
        Returns: undefined
      }
      set_employee_active: {
        Args: { _active: boolean; _note?: string; _user_id: string }
        Returns: undefined
      }
    }
    Enums: {
      app_role:
        | "main_admin"
        | "branch_manager"
        | "assistant_manager"
        | "department_manager"
        | "employee"
        | "system_admin"
      break_request_status:
        | "scheduled"
        | "pending_approval"
        | "approved"
        | "waiting_for_start"
        | "active"
        | "completed"
        | "rejected"
        | "ended_by_manager"
        | "cancelled"
        | "cancelled_by_employee"
        | "cancelled_by_manager"
      comm_audit_action:
        | "created"
        | "edited"
        | "deleted"
        | "sent"
        | "read"
        | "acknowledged"
        | "restored"
      comm_entity_type: "message" | "announcement"
      comm_priority: "low" | "normal" | "high" | "urgent"
      comm_target_type: "user" | "department" | "all"
      schedule_audit_action:
        | "created"
        | "updated"
        | "submitted"
        | "approved"
        | "rejected"
        | "copied"
        | "published"
      schedule_status: "draft" | "pending_approval" | "approved" | "rejected"
      shift_type: "morning" | "evening" | "off"
      task_priority: "low" | "medium" | "high"
      task_recurrence_frequency: "daily" | "weekly" | "monthly"
      task_status:
        | "new"
        | "in_progress"
        | "pending_approval"
        | "completed"
        | "pending_closure"
        | "closed"
      task_target_scope: "all_departments" | "departments" | "single_department"
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
  public: {
    Enums: {
      app_role: [
        "main_admin",
        "branch_manager",
        "assistant_manager",
        "department_manager",
        "employee",
        "system_admin",
      ],
      break_request_status: [
        "scheduled",
        "pending_approval",
        "approved",
        "waiting_for_start",
        "active",
        "completed",
        "rejected",
        "ended_by_manager",
        "cancelled",
        "cancelled_by_employee",
        "cancelled_by_manager",
      ],
      comm_audit_action: [
        "created",
        "edited",
        "deleted",
        "sent",
        "read",
        "acknowledged",
        "restored",
      ],
      comm_entity_type: ["message", "announcement"],
      comm_priority: ["low", "normal", "high", "urgent"],
      comm_target_type: ["user", "department", "all"],
      schedule_audit_action: [
        "created",
        "updated",
        "submitted",
        "approved",
        "rejected",
        "copied",
        "published",
      ],
      schedule_status: ["draft", "pending_approval", "approved", "rejected"],
      shift_type: ["morning", "evening", "off"],
      task_priority: ["low", "medium", "high"],
      task_recurrence_frequency: ["daily", "weekly", "monthly"],
      task_status: [
        "new",
        "in_progress",
        "pending_approval",
        "completed",
        "pending_closure",
        "closed",
      ],
      task_target_scope: [
        "all_departments",
        "departments",
        "single_department",
      ],
    },
  },
} as const
