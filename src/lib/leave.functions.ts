import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireBranchContext } from "@/integrations/supabase/active-branch.server";

const sb = (supabase: any) => supabase as any;

export type LeaveTypeRow = {
  id: string;
  code: "regular" | "sick";
  name: string;
  requires_attachment: boolean;
  is_active: boolean;
};

export type LeaveRequestRow = {
  id: string;
  user_id: string;
  branch_id: string;
  department_id: string | null;
  leave_type_id: string;
  kind: "leave" | "cancellation" | "extension";
  status: "pending_dept" | "pending_admin" | "approved" | "rejected" | "cancelled";
  start_date: string;
  end_date: string;
  days_count: number;
  note: string | null;
  cancels_request_id: string | null;
  extends_request_id: string | null;
  submitted_at: string;
  dept_decided_by: string | null;
  dept_decided_at: string | null;
  dept_note: string | null;
  admin_decided_by: string | null;
  admin_decided_at: string | null;
  admin_note: string | null;
  balance_warning: boolean;
  leave_types?: { code: string; name: string; requires_attachment: boolean } | null;
  profiles?: { full_name: string | null; first_name: string | null; last_name: string | null } | null;
  admin_decider?: { full_name: string | null; first_name: string | null; last_name: string | null } | null;
  dept_decider?: { full_name: string | null; first_name: string | null; last_name: string | null } | null;
  leave_request_attachments?: {
    id: string;
    file_name: string;
    storage_path: string;
    mime_type: string | null;
  }[];
};

export const LEAVE_STATUS_LABEL: Record<LeaveRequestRow["status"], string> = {
  pending_dept: "ממתין לאחראי מחלקה",
  pending_admin: "ממתין להנהלה",
  approved: "אושר",
  rejected: "נדחה",
  cancelled: "בוטל",
};

export const LEAVE_STATUS_TONE: Record<LeaveRequestRow["status"], string> = {
  pending_dept: "bg-amber-100 text-amber-900",
  pending_admin: "bg-sky-100 text-sky-900",
  approved: "bg-emerald-100 text-emerald-900",
  rejected: "bg-rose-100 text-rose-900",
  cancelled: "bg-muted text-muted-foreground",
};

/** Ensure default leave types exist for the active branch. */
export const ensureLeaveTypes = createServerFn({ method: "POST" })
  .middleware([requireBranchContext])
  .handler(async ({ context }) => {
    if (!context.branchId) throw new Error("יש לבחור סניף פעיל");
    const { error } = await sb(context.supabase).rpc("ensure_leave_types_for_branch", {
      _branch_id: context.branchId,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listLeaveTypes = createServerFn({ method: "GET" })
  .middleware([requireBranchContext])
  .handler(async ({ context }) => {
    if (!context.branchId) throw new Error("יש לבחור סניף פעיל");
    await sb(context.supabase).rpc("ensure_leave_types_for_branch", {
      _branch_id: context.branchId,
    });
    const { data, error } = await sb(context.supabase)
      .from("leave_types")
      .select("id, code, name, requires_attachment, is_active")
      .eq("branch_id", context.branchId)
      .eq("is_active", true)
      .order("code");
    if (error) throw new Error(error.message);
    return (data ?? []) as LeaveTypeRow[];
  });

const submitSchema = z.object({
  leave_type_id: z.string().uuid(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().max(2000).optional().nullable(),
  kind: z.enum(["leave", "cancellation", "extension"]).default("leave"),
  cancels_request_id: z.string().uuid().optional().nullable(),
  extends_request_id: z.string().uuid().optional().nullable(),
});

export const submitLeaveRequest = createServerFn({ method: "POST" })
  .middleware([requireBranchContext])
  .inputValidator((data: unknown) => submitSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { data: id, error } = await sb(context.supabase).rpc("submit_leave_request", {
      _leave_type_id: data.leave_type_id,
      _start_date: data.start_date,
      _end_date: data.end_date,
      _note: data.note ?? null,
      _kind: data.kind,
      _cancels_request_id: data.cancels_request_id ?? null,
      _extends_request_id: data.extends_request_id ?? null,
    });
    if (error) throw new Error(error.message);
    return { id: id as string };
  });

const decideSchema = z.object({
  id: z.string().uuid(),
  approve: z.boolean(),
  note: z.string().max(2000).optional().nullable(),
  stage: z.enum(["dept", "admin"]),
});

export const decideLeaveRequest = createServerFn({ method: "POST" })
  .middleware([requireBranchContext])
  .inputValidator((data: unknown) => decideSchema.parse(data))
  .handler(async ({ data, context }) => {
    const rpc = data.stage === "dept" ? "decide_leave_dept" : "decide_leave_admin";
    const { error } = await sb(context.supabase).rpc(rpc, {
      _id: data.id,
      _approve: data.approve,
      _note: data.note ?? null,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const adjustSchema = z.object({
  user_id: z.string().uuid(),
  leave_type_id: z.string().uuid(),
  delta: z.number(),
  reason: z.string().max(500).optional().nullable(),
});

export const adjustLeaveBalance = createServerFn({ method: "POST" })
  .middleware([requireBranchContext])
  .inputValidator((data: unknown) => adjustSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { error } = await sb(context.supabase).rpc("adjust_leave_balance", {
      _user_id: data.user_id,
      _leave_type_id: data.leave_type_id,
      _delta: data.delta,
      _reason: data.reason ?? null,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const accrualSchema = z.object({
  leave_type_id: z.string().uuid(),
  days_per_month: z.number().min(0).max(31),
  max_cap: z.number().min(0).nullable().optional(),
  is_active: z.boolean().default(true),
});

export const setLeaveAccrualRule = createServerFn({ method: "POST" })
  .middleware([requireBranchContext])
  .inputValidator((data: unknown) => accrualSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { error } = await sb(context.supabase).rpc("set_leave_accrual_rule", {
      _leave_type_id: data.leave_type_id,
      _days_per_month: data.days_per_month,
      _max_cap: data.max_cap ?? null,
      _is_active: data.is_active,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const employeeAccrualSchema = z.object({
  user_id: z.string().uuid(),
  leave_type_id: z.string().uuid(),
  days_per_month: z.number().min(0).max(31),
  max_cap: z.number().min(0).nullable().optional(),
  is_active: z.boolean().default(true),
});

/** Per-employee accrual override — requires can_edit_leave_balance (owner always). */
export const setLeaveEmployeeAccrualRate = createServerFn({ method: "POST" })
  .middleware([requireBranchContext])
  .inputValidator((data: unknown) => employeeAccrualSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { error } = await sb(context.supabase).rpc("set_leave_employee_accrual_rate", {
      _user_id: data.user_id,
      _leave_type_id: data.leave_type_id,
      _days_per_month: data.days_per_month,
      _max_cap: data.max_cap ?? null,
      _is_active: data.is_active,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const cancelSchema = z.object({
  user_id: z.string().uuid(),
  note: z.string().max(500).optional().nullable(),
});

export const adminCancelActiveLeave = createServerFn({ method: "POST" })
  .middleware([requireBranchContext])
  .inputValidator((data: unknown) => cancelSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { error } = await sb(context.supabase).rpc("admin_cancel_active_leave", {
      _user_id: data.user_id,
      _note: data.note ?? null,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const purgeLeaveSchema = z.object({
  request_id: z.string().uuid(),
});

/** Platform owner only — hard-delete a leave request from history. */
export const purgeLeaveRequest = createServerFn({ method: "POST" })
  .middleware([requireBranchContext])
  .inputValidator((data: unknown) => purgeLeaveSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { error } = await sb(context.supabase).rpc("purge_leave_request", {
      _request_id: data.request_id,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const attachMetaSchema = z.object({
  request_id: z.string().uuid(),
  storage_path: z.string().min(1),
  file_name: z.string().min(1),
  mime_type: z.string().optional().nullable(),
  file_size: z.number().int().optional().nullable(),
});

export const registerLeaveAttachment = createServerFn({ method: "POST" })
  .middleware([requireBranchContext])
  .inputValidator((data: unknown) => attachMetaSchema.parse(data))
  .handler(async ({ data, context }) => {
    if (!context.branchId) throw new Error("יש לבחור סניף פעיל");
    const { data: req, error: rErr } = await sb(context.supabase)
      .from("leave_requests")
      .select("id, user_id, branch_id")
      .eq("id", data.request_id)
      .maybeSingle();
    if (rErr) throw new Error(rErr.message);
    if (!req || req.user_id !== context.userId) {
      throw new Error("ניתן לצרף קבצים רק לבקשה שלך");
    }
    const { error } = await sb(context.supabase).from("leave_request_attachments").insert({
      request_id: data.request_id,
      branch_id: context.branchId,
      storage_path: data.storage_path,
      file_name: data.file_name,
      mime_type: data.mime_type ?? null,
      file_size: data.file_size ?? null,
      uploaded_by: context.userId,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Signed URL for medical leave attachment — owner or leave viewers/approvers. */
export const getLeaveAttachmentSignedUrl = createServerFn({ method: "POST" })
  .middleware([requireBranchContext])
  .inputValidator((data: unknown) =>
    z.object({ attachment_id: z.string().uuid() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { data: att, error: aErr } = await sb(context.supabase)
      .from("leave_request_attachments")
      .select("id, storage_path, request_id, uploaded_by, leave_requests(user_id)")
      .eq("id", data.attachment_id)
      .maybeSingle();
    if (aErr) throw new Error(aErr.message);
    if (!att?.storage_path) throw new Error("המסמך לא נמצא");

    const reqUser = (att as any).leave_requests?.user_id as string | undefined;
    const isOwner =
      att.uploaded_by === context.userId || reqUser === context.userId;
    if (!isOwner) {
      const { data: canView } = await sb(context.supabase).rpc("has_leave_perm", {
        _user_id: context.userId,
        _perm: "view",
      });
      const { data: canApprove } = await sb(context.supabase).rpc("has_leave_perm", {
        _user_id: context.userId,
        _perm: "approve",
      });
      if (!canView && !canApprove) {
        throw new Error("אין הרשאה לצפות במסמך");
      }
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: signed, error: sErr } = await supabaseAdmin.storage
      .from("leave-attachments")
      .createSignedUrl(att.storage_path, 60 * 30);
    if (sErr || !signed?.signedUrl) {
      throw new Error(sErr?.message ?? "לא ניתן לפתוח את המסמך");
    }
    return { url: signed.signedUrl };
  });

/** Audit trail entry for manual leave toggles from employee edit. */
export const auditManualLeaveChange = createServerFn({ method: "POST" })
  .middleware([requireBranchContext])
  .inputValidator((data: unknown) =>
    z
      .object({
        user_id: z.string().uuid(),
        on_leave: z.boolean(),
        leave_start_date: z.string().nullable().optional(),
        leave_end_date: z.string().nullable().optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { error } = await sb(context.supabase).rpc("write_leave_audit", {
      _action: data.on_leave ? "manual_leave_set" : "manual_leave_cleared",
      _request_id: null,
      _user_id: data.user_id,
      _payload: {
        on_leave: data.on_leave,
        leave_start_date: data.leave_start_date ?? null,
        leave_end_date: data.leave_end_date ?? null,
      },
      _branch_id: context.branchId,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
