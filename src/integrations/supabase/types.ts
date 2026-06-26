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
          schedule_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          message: string
          read_at?: string | null
          schedule_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          message?: string
          read_at?: string | null
          schedule_id?: string
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
          status: Database["public"]["Enums"]["schedule_status"]
          submitted_at: string | null
          submitted_by: string | null
          updated_at: string
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
          status?: Database["public"]["Enums"]["schedule_status"]
          submitted_at?: string | null
          submitted_by?: string | null
          updated_at?: string
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
          status?: Database["public"]["Enums"]["schedule_status"]
          submitted_at?: string | null
          submitted_by?: string | null
          updated_at?: string
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
          department_id: string
          description: string | null
          due_at: string | null
          employee_note: string | null
          id: string
          notes: string | null
          priority: Database["public"]["Enums"]["task_priority"]
          recurrence_id: string | null
          rejected_at: string | null
          rejection_note: string | null
          status: Database["public"]["Enums"]["task_status"]
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
          department_id: string
          description?: string | null
          due_at?: string | null
          employee_note?: string | null
          id?: string
          notes?: string | null
          priority?: Database["public"]["Enums"]["task_priority"]
          recurrence_id?: string | null
          rejected_at?: string | null
          rejection_note?: string | null
          status?: Database["public"]["Enums"]["task_status"]
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
          department_id?: string
          description?: string | null
          due_at?: string | null
          employee_note?: string | null
          id?: string
          notes?: string | null
          priority?: Database["public"]["Enums"]["task_priority"]
          recurrence_id?: string | null
          rejected_at?: string | null
          rejection_note?: string | null
          status?: Database["public"]["Enums"]["task_status"]
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
          can_approve_leave: boolean
          can_approve_schedule: boolean
          can_approve_tasks: boolean
          can_create_schedule: boolean
          can_create_tasks: boolean
          can_delete_tasks: boolean
          can_edit_tasks: boolean
          can_manage_tasks: boolean
          can_publish_schedule: boolean
          can_send_messages: boolean
          can_view_breaks: boolean
          created_at: string
          granted_by: string | null
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          can_approve_leave?: boolean
          can_approve_schedule?: boolean
          can_approve_tasks?: boolean
          can_create_schedule?: boolean
          can_create_tasks?: boolean
          can_delete_tasks?: boolean
          can_edit_tasks?: boolean
          can_manage_tasks?: boolean
          can_publish_schedule?: boolean
          can_send_messages?: boolean
          can_view_breaks?: boolean
          created_at?: string
          granted_by?: string | null
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          can_approve_leave?: boolean
          can_approve_schedule?: boolean
          can_approve_tasks?: boolean
          can_create_schedule?: boolean
          can_create_tasks?: boolean
          can_delete_tasks?: boolean
          can_edit_tasks?: boolean
          can_manage_tasks?: boolean
          can_publish_schedule?: boolean
          can_send_messages?: boolean
          can_view_breaks?: boolean
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
      get_my_department_id: { Args: never; Returns: string }
      has_main_admin: { Args: never; Returns: boolean }
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
      has_schedule_publish_perm: {
        Args: { _user_id: string }
        Returns: boolean
      }
      has_task_approve_perm: { Args: { _user_id: string }; Returns: boolean }
      has_task_close_perm: { Args: { _user_id: string }; Returns: boolean }
      has_task_create_perm: { Args: { _user_id: string }; Returns: boolean }
      has_task_delete_perm: { Args: { _user_id: string }; Returns: boolean }
      has_task_edit_perm: { Args: { _user_id: string }; Returns: boolean }
      has_task_management_perm: { Args: { _user_id: string }; Returns: boolean }
      is_admin: { Args: { _user_id: string }; Returns: boolean }
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
    },
  },
} as const
