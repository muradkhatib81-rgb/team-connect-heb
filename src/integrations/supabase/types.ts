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
        Relationships: []
      }
      break_requests: {
        Row: {
          approval_decided_at: string | null
          approved_at_time: string | null
          approved_by: string | null
          break_setting_id: string
          completed_at: string | null
          created_at: string
          department_id: string | null
          duration_minutes: number
          end_notified_at: string | null
          ending_notified_at: string | null
          ends_at: string | null
          id: string
          note: string | null
          requested_at: string
          start_notified_at: string | null
          started_at: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          approval_decided_at?: string | null
          approved_at_time?: string | null
          approved_by?: string | null
          break_setting_id: string
          completed_at?: string | null
          created_at?: string
          department_id?: string | null
          duration_minutes: number
          end_notified_at?: string | null
          ending_notified_at?: string | null
          ends_at?: string | null
          id?: string
          note?: string | null
          requested_at: string
          start_notified_at?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          approval_decided_at?: string | null
          approved_at_time?: string | null
          approved_by?: string | null
          break_setting_id?: string
          completed_at?: string | null
          created_at?: string
          department_id?: string | null
          duration_minutes?: number
          end_notified_at?: string | null
          ending_notified_at?: string | null
          ends_at?: string | null
          id?: string
          note?: string | null
          requested_at?: string
          start_notified_at?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
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
          created_at?: string
          created_by?: string | null
          duration_minutes?: number
          id?: string
          is_active?: boolean
          name?: string
          order_index?: number
          updated_at?: string
        }
        Relationships: []
      }
      communications_audit_log: {
        Row: {
          action: Database["public"]["Enums"]["comm_audit_action"]
          actor_id: string | null
          created_at: string
          entity_id: string
          entity_type: Database["public"]["Enums"]["comm_entity_type"]
          id: string
          payload: Json | null
        }
        Insert: {
          action: Database["public"]["Enums"]["comm_audit_action"]
          actor_id?: string | null
          created_at?: string
          entity_id: string
          entity_type: Database["public"]["Enums"]["comm_entity_type"]
          id?: string
          payload?: Json | null
        }
        Update: {
          action?: Database["public"]["Enums"]["comm_audit_action"]
          actor_id?: string | null
          created_at?: string
          entity_id?: string
          entity_type?: Database["public"]["Enums"]["comm_entity_type"]
          id?: string
          payload?: Json | null
        }
        Relationships: []
      }
      company_settings: {
        Row: {
          address: string | null
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
        Relationships: []
      }
      departments: {
        Row: {
          code: string
          created_at: string
          id: string
          is_active: boolean
          manager_id: string | null
          name: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          manager_id?: string | null
          name: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          manager_id?: string | null
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      employee_of_month: {
        Row: {
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
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          department_id: string
          full_name: string
          id: string
          id_number: string | null
          is_active: boolean
          job_title: string | null
          must_change_password: boolean
          on_leave: boolean
          phone: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          department_id: string
          full_name?: string
          id: string
          id_number?: string | null
          is_active?: boolean
          job_title?: string | null
          must_change_password?: boolean
          on_leave?: boolean
          phone?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          department_id?: string
          full_name?: string
          id?: string
          id_number?: string | null
          is_active?: boolean
          job_title?: string | null
          must_change_password?: boolean
          on_leave?: boolean
          phone?: string | null
          updated_at?: string
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
      schedule_audit_log: {
        Row: {
          action: Database["public"]["Enums"]["schedule_audit_action"]
          actor_id: string | null
          created_at: string
          id: string
          note: string | null
          schedule_id: string
        }
        Insert: {
          action: Database["public"]["Enums"]["schedule_audit_action"]
          actor_id?: string | null
          created_at?: string
          id?: string
          note?: string | null
          schedule_id: string
        }
        Update: {
          action?: Database["public"]["Enums"]["schedule_audit_action"]
          actor_id?: string | null
          created_at?: string
          id?: string
          note?: string | null
          schedule_id?: string
        }
        Relationships: [
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
          created_at: string
          id: string
          message: string
          read_at: string | null
          schedule_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          message: string
          read_at?: string | null
          schedule_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          message?: string
          read_at?: string | null
          schedule_id?: string | null
          user_id?: string
        }
        Relationships: [
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
          created_at: string
          day_date: string
          employee_id: string
          id: string
          published_shift: string | null
          schedule_id: string
          shift: Database["public"]["Enums"]["shift_type"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          day_date: string
          employee_id: string
          id?: string
          published_shift?: string | null
          schedule_id: string
          shift: Database["public"]["Enums"]["shift_type"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          day_date?: string
          employee_id?: string
          id?: string
          published_shift?: string | null
          schedule_id?: string
          shift?: Database["public"]["Enums"]["shift_type"]
          updated_at?: string
        }
        Relationships: [
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
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      task_activity_log: {
        Row: {
          actor_id: string | null
          created_at: string
          event: string
          id: string
          payload: Json | null
          task_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          event: string
          id?: string
          payload?: Json | null
          task_id: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          event?: string
          id?: string
          payload?: Json | null
          task_id?: string
        }
        Relationships: [
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
        Relationships: []
      }
    }
    Views: {
      department_coworkers: {
        Row: {
          avatar_url: string | null
          department_id: string | null
          full_name: string | null
          id: string | null
          is_active: boolean | null
          job_title: string | null
          on_leave: boolean | null
        }
        Relationships: []
      }
    }
    Functions: {
      can_approve_task: {
        Args: { _approver_id: string; _task_id: string }
        Returns: boolean
      }
      can_view_announcement: {
        Args: { _ann_id: string; _user_id: string }
        Returns: boolean
      }
      can_view_task: {
        Args: { _task_id: string; _user_id: string }
        Returns: boolean
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
      list_profiles_contact: {
        Args: never
        Returns: {
          id: string
          id_number: string
          must_change_password: boolean
          phone: string
        }[]
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
      set_department_manager: {
        Args: { _dept_id: string; _new_manager_id: string }
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
