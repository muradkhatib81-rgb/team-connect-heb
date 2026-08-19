import { createFileRoute, useSearch, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/use-auth";
import { isAdmin, isPlatformOwner, type AppRole } from "@/lib/constants";
import { isNonEmployeeIdentity } from "@/lib/employee-identity";
import i18n from "@/i18n";
import { BilingualContent } from "@/components/bilingual-content";
import {
  SearchableMultiSelect,
  SearchableSingleSelect,
  type SearchablePickerOption,
} from "@/components/searchable-picker";
import { pickBilingualResult, useBilingualContentMap } from "@/lib/use-bilingual-content";
import {
  createTask,
  updateTask,
  deleteTask,
  addTaskImage,
  deleteTaskImage,
  createRecurrence,
  updateRecurrence,
  deleteRecurrence,
  markTaskPendingApproval,
  approveTask,
  rejectTask,
  closeTask,
  addRecurrenceImage,
  deleteRecurrenceImage,
  listTaskActivity,
  listTaskComments,
  addTaskComment,
  listTaskAssigneeIds,
  listTaskDepartmentIds,
  listTasks,
} from "@/lib/tasks.functions";
import { useActiveBranch } from "@/lib/use-active-branch";
import { formatHeDateTime, splitForInputs, combineToIso } from "@/lib/date-format";
import { canExecuteTask, canEditTaskContent, EXECUTABLE_TASK_STATUSES } from "@/lib/task-execution";
import { HebrewDateInput, HebrewTimeInput } from "@/components/hebrew-datetime";
import { ImageLightbox, type LightboxImage } from "@/components/image-lightbox";
import { TaskActivityComments } from "@/components/task-activity-comments";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Loader2,
  Plus,
  Pencil,
  Trash2,
  ImagePlus,
  X,
  Clock,
  CheckCircle2,
  AlertTriangle,
  ListTodo,
  Pause,
  Play,
  Repeat,
} from "lucide-react";
import { toast } from "sonner";

type TaskStatus = "new" | "in_progress" | "pending_approval" | "pending_closure" | "completed" | "closed";
type TaskPriority = "low" | "medium" | "high";

interface TaskRow {
  id: string;
  title: string;
  description: string | null;
  department_id: string;
  assignee_id: string | null;
  created_by: string | null;
  due_at: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  notes: string | null;
  employee_note: string | null;
  completed_at: string | null;
  completed_by: string | null;
  approved_at: string | null;
  approved_by: string | null;
  rejection_note: string | null;
  rejected_at: string | null;
  recurrence_id: string | null;
  requires_approval: boolean;
  created_at: string;
  updated_at: string;
}

interface RecRow {
  id: string;
  title: string;
  description: string | null;
  department_id: string;
  assignee_id: string | null;
  priority: TaskPriority;
  frequency: "daily" | "weekly" | "monthly";
  days_of_week: number[];
  day_of_month: number | null;
  time_of_day: string;
  is_active: boolean;
  next_run_at: string | null;
  last_generated_at: string | null;
}

interface DeptOption { id: string; name: string }
interface EmpOption { id: string; full_name: string; department_id: string | null; branch_id?: string | null }

const STATUS_LABEL: Record<TaskStatus, string> = {
  new: i18n.t("tasks.statusNew"),
  in_progress: i18n.t("tasks.statusInProgress"),
  pending_approval: i18n.t("tasks.statusPendingApproval"),
  pending_closure: i18n.t("tasks.statusPendingClosure"),
  completed: i18n.t("tasks.statusCompleted"),
  closed: i18n.t("tasks.statusClosed"),
};
function getStatusLabel(s: string): string {
  const map: Record<string, string> = {
    new: "tasks.statusNew",
    in_progress: "tasks.statusInProgress",
    pending_approval: "tasks.statusPendingApproval",
    pending_closure: "tasks.statusPendingClosure",
    completed: "tasks.statusCompleted",
    closed: "tasks.statusClosed",
  };
  return i18n.t(map[s] ?? s);
}
const PRIORITY_LABEL: Record<TaskPriority, string> = {
  low: i18n.t("tasks.priorityLow"),
  medium: i18n.t("tasks.priorityMedium"),
  high: i18n.t("tasks.priorityHigh"),
};
function getPriorityLabel(p: string): string {
  const map: Record<string, string> = {
    low: "tasks.priorityLow",
    medium: "tasks.priorityMedium",
    high: "tasks.priorityHigh",
  };
  return i18n.t(map[p] ?? p);
}
function getFreqLabel(f: string): string {
  const map: Record<string, string> = {
    daily: "tasks.freqDaily",
    weekly: "tasks.freqWeekly",
    monthly: "tasks.freqMonthly",
  };
  return i18n.t(map[f] ?? f);
}
const DOW_LABELS = ["א'", "ב'", "ג'", "ד'", "ה'", "ו'", "ש'"];

interface TasksSearch { status?: string; due?: string }

export const Route = createFileRoute("/_authenticated/tasks")({
  component: TasksPage,
  validateSearch: (s: Record<string, unknown>): TasksSearch => ({
    status: typeof s.status === "string" ? s.status : undefined,
    due: typeof s.due === "string" ? s.due : undefined,
  }),
});

function useTaskCaps() {
  const { data: profile } = useAuth();
  const roles: AppRole[] = profile?.roles ?? [];
  // Platform owners (system_admin + main_admin) — same as server getCallerCaps.
  const isOwner = isPlatformOwner(roles);
  const isMainAdmin = isOwner;
  const isAdm = isAdmin(roles);
  const isDeptMgr = roles.includes("department_manager");
  const permQuery = useQuery({
    enabled: !!profile,
    queryKey: ["task-perm", profile?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("user_task_permissions")
        .select("*")
        .eq("user_id", profile!.id)
        .maybeSingle();
      return data;
    },
  });
  const p: any = permQuery.data ?? {};
  const isBranchManager = roles.includes("branch_manager");
  const isAssistantManager = roles.includes("assistant_manager");
  const canCreateTasks = isMainAdmin || isBranchManager || (isAssistantManager && (!!p.can_manage_tasks || !!p.can_create_tasks));
  const canEditTasks = isMainAdmin || isBranchManager || (isAssistantManager && (!!p.can_manage_tasks || !!p.can_edit_tasks));
  const canDeleteTasks = isMainAdmin || isBranchManager || (isAssistantManager && (!!p.can_manage_tasks || !!p.can_delete_tasks));
  const canCloseTasks = isMainAdmin || isBranchManager || (isAssistantManager && (!!p.can_manage_tasks || !!p.can_approve_tasks));
  // Legacy alias
  const canManageTasks = canEditTasks;
  return {
    profile,
    isOwner,
    isMainAdmin,
    isAdm,
    isDeptMgr,
    canCreateTasks,
    canEditTasks,
    canDeleteTasks,
    canCloseTasks,
    canManageTasks,
  };
}

function TasksPage() {
  const search = useSearch({ from: "/_authenticated/tasks" }) as TasksSearch;
  const caps = useTaskCaps();
  const qc = useQueryClient();
  const fetchTasks = useServerFn(listTasks);
  const { activeBranchId } = useActiveBranch();

  const depsQuery = useQuery({
    queryKey: ["task-deps"],
    queryFn: async () => {
      const [{ data: depts }, { data: emps }] = await Promise.all([
        supabase.from("departments").select("id, name").order("name"),
        supabase.from("profiles").select("id, full_name, department_id, branch_id").order("full_name"),
      ]);
      return {
        departments: (depts ?? []) as DeptOption[],
        employees: ((emps ?? []) as EmpOption[]).filter((e) => !isNonEmployeeIdentity(e)),
      };
    },
  });

  const tasksQuery = useQuery({
    queryKey: ["tasks", activeBranchId ?? "none"],
    queryFn: () => fetchTasks(),
  });

  const [openCreate, setOpenCreate] = useState(false);
  const [editTask, setEditTask] = useState<TaskRow | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>(search.status ?? "all");
  const [search2, setSearch2] = useState("");

  useEffect(() => {
    if (search.status) setStatusFilter(search.status);
  }, [search.status]);

  const filtered = useMemo(() => {
    let list = tasksQuery.data ?? [];
    if (statusFilter !== "all" && statusFilter !== "overdue") {
      list = list.filter((t) => t.status === statusFilter);
    }
    if (statusFilter === "overdue") {
      const now = Date.now();
      list = list.filter(
        (t) =>
          t.due_at &&
          !["completed", "pending_closure", "closed"].includes(t.status) &&
          new Date(t.due_at).getTime() < now,
      );
    }
    if (search2.trim()) {
      const q = search2.trim().toLowerCase();
      list = list.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          (t.description ?? "").toLowerCase().includes(q),
      );
    }
    return list;
  }, [tasksQuery.data, statusFilter, search2]);

  const canCreateAny =
    caps.canManageTasks ||
    caps.isDeptMgr ||
    (depsQuery.data?.departments.some((d) => false) ?? false);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">{i18n.t("tasks.title")}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {i18n.t("tasks.subtitle")}
          </p>
        </div>
        {canCreateAny && (
          <Button onClick={() => setOpenCreate(true)} className="gap-2">
            <Plus className="size-4" /> {i18n.t("tasks.newTask")}
          </Button>
        )}
      </header>

      <Tabs defaultValue="tasks" className="w-full">
        <TabsList>
          <TabsTrigger value="tasks" className="gap-2">
            <ListTodo className="size-4" />
            {i18n.t("tasks.tabTasks")}
          </TabsTrigger>
          <TabsTrigger value="recurring" className="gap-2">
            <Repeat className="size-4" />
            {i18n.t("tasks.tabRecurring")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="tasks" className="space-y-4 mt-4">
          <div className="flex flex-wrap items-center gap-3">
            <Input
              placeholder={i18n.t("tasks.searchPlaceholder")}
              value={search2}
              onChange={(e) => setSearch2(e.target.value)}
              className="max-w-xs"
            />
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="max-w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{i18n.t("tasks.filterAll")}</SelectItem>
                <SelectItem value="new">{i18n.t("tasks.filterNew")}</SelectItem>
                <SelectItem value="in_progress">{i18n.t("tasks.filterInProgress")}</SelectItem>
                <SelectItem value="pending_approval">{i18n.t("tasks.filterPendingApproval")}</SelectItem>
                <SelectItem value="pending_closure">{i18n.t("tasks.filterPendingClosure")}</SelectItem>
                <SelectItem value="completed">{i18n.t("tasks.filterCompleted")}</SelectItem>
                <SelectItem value="closed">{i18n.t("tasks.filterClosed")}</SelectItem>
                <SelectItem value="overdue">{i18n.t("tasks.filterOverdue")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {tasksQuery.isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="size-6 animate-spin text-primary" />
            </div>
          ) : filtered.length === 0 ? (
            <Card className="card-elevated p-6 text-sm text-muted-foreground text-center">
              {i18n.t("tasks.noTasks")}
            </Card>
          ) : (
            <div className="space-y-3">
              {filtered.map((t) => (
                <TaskCard
                  key={t.id}
                  task={t}
                  deps={depsQuery.data}
                  caps={caps}
                  onEdit={() => setEditTask(t)}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="recurring" className="mt-4">
          <RecurringSection caps={caps} deps={depsQuery.data} />
        </TabsContent>
      </Tabs>

      {openCreate && depsQuery.data && (
        <TaskFormDialog
          mode="create"
          deps={depsQuery.data}
          caps={caps}
          onClose={() => setOpenCreate(false)}
        />
      )}
      {editTask && depsQuery.data && (
        <TaskFormDialog
          mode="edit"
          deps={depsQuery.data}
          caps={caps}
          task={editTask}
          onClose={() => setEditTask(null)}
        />
      )}
    </div>
  );
}

// ============ TASK CARD + DETAIL =============

function TaskCard({
  task,
  deps,
  caps,
  onEdit,
}: {
  task: TaskRow;
  deps?: { departments: DeptOption[]; employees: EmpOption[] };
  caps: ReturnType<typeof useTaskCaps>;
  onEdit: () => void;
}) {
  const [open, setOpen] = useState(false);
  const dept = deps?.departments.find((d) => d.id === task.department_id);
  const completedBy = deps?.employees.find((e) => e.id === task.completed_by);
  const overdue =
    task.due_at &&
    !["completed", "pending_closure", "closed"].includes(task.status) &&
    new Date(task.due_at).getTime() < Date.now();
  const canEdit = canEditTaskContent(task, caps.profile?.id ?? "");
  // Platform owners may delete any task; everyone else keeps the creator-scoped rule.
  const canDelete = caps.canDeleteTasks && (caps.isOwner || canEdit);

  return (
    <>
      <Card
        className="card-elevated p-4 cursor-pointer hover:bg-accent/30 transition-colors"
        onClick={() => setOpen(true)}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold truncate">{task.title}</h3>
              <Badge variant={priorityVariant(task.priority)} className="rounded-full text-xs">
                {getPriorityLabel(task.priority)}
              </Badge>
              <Badge variant={statusVariant(task.status)} className="rounded-full text-xs">
                {getStatusLabel(task.status)}
              </Badge>
              {overdue && (
                <Badge variant="destructive" className="rounded-full text-xs gap-1">
                  <AlertTriangle className="size-3" /> {i18n.t("tasks.overdue")}
                </Badge>
              )}
              {task.recurrence_id && (
                <Badge variant="outline" className="rounded-full text-xs gap-1">
                  <Repeat className="size-3" /> {i18n.t("tasks.recurring")}
                </Badge>
              )}
            </div>
            <div className="text-xs text-muted-foreground mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
              {dept && <span>{i18n.t("tasks.dept")} {dept.name}</span>}
              {task.due_at && (
                <span className="flex items-center gap-1">
                  <Clock className="size-3" />
                  {i18n.t("tasks.due")} {formatHeDateTime(task.due_at)}
                </span>
              )}
              {completedBy && <span>{i18n.t("tasks.completedBy")} {completedBy.full_name}</span>}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
            {canEdit && (
              <Button variant="ghost" size="icon" onClick={onEdit} aria-label={i18n.t("tasks.editAriaLabel")}>
                <Pencil className="size-4" />
              </Button>
            )}
            {canDelete && <DeleteTaskBtn id={task.id} />}
          </div>
        </div>
      </Card>
      {open && (
        <TaskDetailDialog
          task={task}
          deps={deps}
          caps={caps}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function priorityVariant(p: TaskPriority): "default" | "secondary" | "destructive" | "outline" {
  if (p === "high") return "destructive";
  if (p === "medium") return "default";
  return "secondary";
}
function statusVariant(s: TaskStatus): "default" | "secondary" | "destructive" | "outline" {
  if (s === "closed") return "outline";
  if (s === "pending_closure") return "secondary";
  if (s === "completed") return "secondary";
  if (s === "pending_approval") return "destructive";
  if (s === "in_progress") return "default";
  return "outline";
}

function DeleteTaskBtn({
  id,
  onDeleted,
  label,
}: {
  id: string;
  onDeleted?: () => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const del = useServerFn(deleteTask);
  const m = useMutation({
    mutationFn: () => del({ data: { id } }),
    onSuccess: () => {
      toast.success(i18n.t("tasks.taskDeleted"));
      qc.invalidateQueries({ queryKey: ["tasks"] });
      onDeleted?.();
    },
    onError: (e: any) => toast.error(e?.message ?? i18n.t("tasks.deleteError")),
  });
  return (
    <>
      {label ? (
        <Button
          variant="destructive"
          onClick={() => setOpen(true)}
          disabled={m.isPending}
        >
          <Trash2 className="size-4" />
          {label}
        </Button>
      ) : (
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setOpen(true)}
          aria-label={i18n.t("tasks.deleteAriaLabel")}
          className="text-destructive"
        >
          <Trash2 className="size-4" />
        </Button>
      )}
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{i18n.t("tasks.deleteConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{i18n.t("tasks.deleteConfirmDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{i18n.t("tasks.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => m.mutate()}>{i18n.t("tasks.delete")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ============ TASK DETAIL DIALOG ============

function TaskDetailDialog({
  task,
  deps,
  caps,
  onClose,
}: {
  task: TaskRow;
  deps?: { departments: DeptOption[]; employees: EmpOption[] };
  caps: ReturnType<typeof useTaskCaps>;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const upd = useServerFn(updateTask);
  const markPending = useServerFn(markTaskPendingApproval);
  const approve = useServerFn(approveTask);
  const reject = useServerFn(rejectTask);
  const close = useServerFn(closeTask);
  const loadAssignees = useServerFn(listTaskAssigneeIds);

  const multiAssigneeQuery = useQuery({
    queryKey: ["task-assignees", task.id],
    queryFn: () => loadAssignees({ data: { task_id: task.id } }),
  });
  const multiAssigneeIds = (multiAssigneeQuery.data ?? []) as string[];

  const canExecute =
    !!caps.profile &&
    canExecuteTask(task, caps.profile.id, caps.profile.department_id, multiAssigneeIds) &&
    EXECUTABLE_TASK_STATUSES.has(task.status);

  const approveRpc = useQuery({
    enabled: !!caps.profile && task.status === "pending_approval",
    queryKey: ["can-approve", task.id, caps.profile?.id],
    queryFn: async () => {
      const { data } = await supabase.rpc("can_approve_task", {
        _task_id: task.id,
        _approver_id: caps.profile!.id,
      });
      return !!data;
    },
  });
  const canApprove = !!approveRpc.data;
  const canMarkDone = canExecute;
  const submitLabel = task.requires_approval
    ? i18n.t("tasks.submitDoneApproval")
    : i18n.t("tasks.submitDoneClose");

  const [employeeNote, setEmployeeNote] = useState(task.employee_note ?? "");
  const [rejectNote, setRejectNote] = useState("");
  const [showReject, setShowReject] = useState(false);

  const startProgress = useMutation({
    mutationFn: () => upd({ data: { id: task.id, status: "in_progress" } }),
    onSuccess: () => {
      toast.success(i18n.t("tasks.taskMovedToProgress"));
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: (e: any) => toast.error(e?.message ?? i18n.t("tasks.genericError")),
  });

  const submitDone = useMutation({
    mutationFn: () =>
      markPending({ data: { id: task.id, employee_note: employeeNote || undefined } }),
    onSuccess: () => {
      toast.success(i18n.t("tasks.sentForApproval"));
      qc.invalidateQueries({ queryKey: ["tasks"] });
      onClose();
    },
    onError: (e: any) => toast.error(e?.message ?? i18n.t("tasks.genericError")),
  });

  const approveM = useMutation({
    mutationFn: () => approve({ data: { id: task.id } }),
    onSuccess: () => {
      toast.success(i18n.t("tasks.taskApproved"));
      qc.invalidateQueries({ queryKey: ["tasks"] });
      onClose();
    },
    onError: (e: any) => toast.error(e?.message ?? i18n.t("tasks.genericError")),
  });

  const rejectM = useMutation({
    mutationFn: () =>
      reject({ data: { id: task.id, rejection_note: rejectNote || undefined } }),
    onSuccess: () => {
      toast.success(i18n.t("tasks.taskReturnedToProgress"));
      qc.invalidateQueries({ queryKey: ["tasks"] });
      onClose();
    },
    onError: (e: any) => toast.error(e?.message ?? i18n.t("tasks.genericError")),
  });


  const closeM = useMutation({
    mutationFn: () => close({ data: { id: task.id } }),
    onSuccess: () => {
      toast.success(i18n.t("tasks.taskClosed"));
      qc.invalidateQueries({ queryKey: ["tasks"] });
      onClose();
    },
    onError: (e: any) => toast.error(e?.message ?? i18n.t("tasks.closeError")),
  });

  const dept = deps?.departments.find((d) => d.id === task.department_id);
  const completedBy = deps?.employees.find((e) => e.id === task.completed_by);
  const approvedBy = deps?.employees.find((e) => e.id === task.approved_by);
  const closedBy = deps?.employees.find((e) => e.id === (task as any).closed_by);

  const bilingualItems = useMemo(() => {
    if (!task.created_by) return [];
    const items = [
      {
        key: `${task.id}-title`,
        entityType: "task" as const,
        entityId: task.id,
        field: "title" as const,
        text: task.title,
        authorId: task.created_by,
      },
    ];
    if (task.description?.trim()) {
      items.push({
        key: `${task.id}-description`,
        entityType: "task" as const,
        entityId: task.id,
        field: "description" as const,
        text: task.description,
        authorId: task.created_by,
      });
    }
    return items;
  }, [task.id, task.title, task.description, task.created_by]);

  const { map: bilingualMap, isLoading: bilingualLoading } = useBilingualContentMap(
    bilingualItems,
    !!task.created_by,
  );

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            <BilingualContent
              inline
              text={task.title}
              result={pickBilingualResult(bilingualMap, `${task.id}-title`, task.title)}
              loading={bilingualLoading}
            />
            <Badge variant={statusVariant(task.status)} className="rounded-full text-xs">
              {getStatusLabel(task.status)}
            </Badge>
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {task.description && (
            <div>
              <Label className="text-xs text-muted-foreground">{i18n.t("tasks.description")}</Label>
              <BilingualContent
                className="text-sm mt-1"
                text={task.description}
                result={pickBilingualResult(bilingualMap, `${task.id}-description`, task.description)}
                loading={bilingualLoading}
              />
            </div>
          )}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <Label className="text-xs text-muted-foreground">{i18n.t("tasks.deptLabel")}</Label>
              <p>{dept?.name ?? "—"}</p>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">{i18n.t("tasks.priority")}</Label>
              <p>{getPriorityLabel(task.priority)}</p>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">{i18n.t("tasks.createdAt")}</Label>
              <p>{formatHeDateTime(task.created_at)}</p>
            </div>
            {task.due_at && (
              <div>
                <Label className="text-xs text-muted-foreground">{i18n.t("tasks.dueAt")}</Label>
                <p>{formatHeDateTime(task.due_at)}</p>
              </div>
            )}
            {task.completed_at && (
              <div>
                <Label className="text-xs text-muted-foreground">{i18n.t("tasks.completedAt")}</Label>
                <p>{formatHeDateTime(task.completed_at)}</p>
              </div>
            )}
            {completedBy && (
              <div>
                <Label className="text-xs text-muted-foreground">{i18n.t("tasks.completedByLabel")}</Label>
                <p>{completedBy.full_name}</p>
              </div>
            )}
            {task.approved_at && (
              <div>
                <Label className="text-xs text-muted-foreground">{i18n.t("tasks.approvedAt")}</Label>
                <p>{formatHeDateTime(task.approved_at)}</p>
              </div>
            )}
            {approvedBy && (
              <div>
                <Label className="text-xs text-muted-foreground">{i18n.t("tasks.approvedBy")}</Label>
                <p>{approvedBy.full_name}</p>
              </div>
            )}
            {(task as any).closed_at && (
              <div>
                <Label className="text-xs text-muted-foreground">{i18n.t("tasks.closedAt")}</Label>
                <p>{formatHeDateTime((task as any).closed_at)}</p>
              </div>
            )}
            {closedBy && (
              <div>
                <Label className="text-xs text-muted-foreground">{i18n.t("tasks.closedBy")}</Label>
                <p>{closedBy.full_name}</p>
              </div>
            )}
          </div>

          {task.employee_note && (
            <div className="border-t pt-3">
              <Label className="text-xs text-muted-foreground">{i18n.t("tasks.executorNote")}</Label>
              <p className="text-sm whitespace-pre-wrap mt-1">{task.employee_note}</p>
            </div>
          )}

          {task.rejection_note && (
            <div className="border-t pt-3">
              <Label className="text-xs text-destructive">{i18n.t("tasks.rejectedNote")}</Label>
              <p className="text-sm whitespace-pre-wrap mt-1">{task.rejection_note}</p>
              {task.rejected_at && (
                <p className="text-xs text-muted-foreground mt-1">
                  {formatHeDateTime(task.rejected_at)}
                </p>
              )}
            </div>
          )}

          {/* Mark-done input area: visible to dept members while task is active */}
          {canMarkDone && (
            <div className="border-t pt-4 space-y-3">
              <Label>{i18n.t("tasks.executionNoteLabel")}</Label>
              <Textarea
                value={employeeNote}
                onChange={(e) => setEmployeeNote(e.target.value)}
                rows={3}
                placeholder={i18n.t("tasks.executionNotePlaceholder")}
              />
              <Label className="text-xs text-muted-foreground">
                {i18n.t("tasks.attachInfo")}
              </Label>
              <TaskImagesSection
                taskId={task.id}
                canEdit={true}
                userId={caps.profile?.id}
              />
            </div>
          )}

          {/* Existing images for non-active states */}
          {!canMarkDone &&
            (task.status === "pending_approval" ||
              task.status === "pending_closure" ||
              task.status === "completed" ||
              task.status === "closed") && (
              <div className="border-t pt-4">
                <TaskImagesSection
                  taskId={task.id}
                  canEdit={false}
                  userId={caps.profile?.id}
                  title={i18n.t("tasks.taskImages")}
                />
              </div>
            )}

          {/* Approval section */}
          {task.status === "pending_approval" && canApprove && (
            <div className="border-t pt-4 space-y-3">
              {showReject ? (
                <>
                  <Label>{i18n.t("tasks.rejectNoteLabel")}</Label>
                  <Textarea
                    value={rejectNote}
                    onChange={(e) => setRejectNote(e.target.value)}
                    rows={3}
                    placeholder={i18n.t("tasks.rejectNotePlaceholder")}
                  />
                  <div className="flex gap-2">
                    <Button
                      variant="destructive"
                      onClick={() => rejectM.mutate()}
                      disabled={rejectM.isPending}
                    >
                      {rejectM.isPending && <Loader2 className="size-4 animate-spin ml-2" />}
                      {i18n.t("tasks.returnToProgress")}
                    </Button>
                    <Button variant="outline" onClick={() => setShowReject(false)}>
                      {i18n.t("tasks.cancel")}
                    </Button>
                  </div>
                </>
              ) : (
                <div className="flex gap-2 flex-wrap">
                  <Button
                    onClick={() => approveM.mutate()}
                    disabled={approveM.isPending}
                  >
                    {approveM.isPending && <Loader2 className="size-4 animate-spin ml-2" />}
                    {i18n.t("tasks.approveCompletion")}
                  </Button>
                  <Button variant="outline" onClick={() => setShowReject(true)}>
                    {i18n.t("tasks.returnToProgress")}
                  </Button>
                </div>
              )}
            </div>
          )}
          <div className="pt-2">
            <TaskActivityComments taskId={task.id} />
          </div>
        </div>
        <DialogFooter className="gap-2 flex-wrap">
          <Button variant="outline" onClick={onClose}>{i18n.t("tasks.close")}</Button>
          {caps.canDeleteTasks && (caps.isOwner || canEditTaskContent(task, caps.profile?.id ?? "")) && (
            <DeleteTaskBtn id={task.id} label={i18n.t("tasks.deleteTask")} onDeleted={onClose} />
          )}
          {canMarkDone && task.status === "new" && (
            <Button
              variant="secondary"
              onClick={() => startProgress.mutate()}
              disabled={startProgress.isPending}
            >
              {i18n.t("tasks.startProgress")}
            </Button>
          )}
          {canMarkDone && (
            <Button onClick={() => submitDone.mutate()} disabled={submitDone.isPending}>
              {submitDone.isPending && <Loader2 className="size-4 animate-spin ml-2" />}
              {submitLabel}
            </Button>
          )}
          {(task.status === "pending_closure" || task.status === "completed") && caps.canCloseTasks && (
            <Button
              variant="default"
              onClick={() => closeM.mutate()}
              disabled={closeM.isPending}
            >
              {closeM.isPending && <Loader2 className="size-4 animate-spin ml-2" />}
              {i18n.t("tasks.closeTask")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============ IMAGES ============

function TaskImagesSection({
  taskId,
  canEdit,
  userId,
  title = i18n.t("tasks.images"),
}: {
  taskId: string;
  canEdit: boolean;
  userId?: string;
  title?: string;
}) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const add = useServerFn(addTaskImage);
  const del = useServerFn(deleteTaskImage);
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);

  const imagesQuery = useQuery({
    queryKey: ["task-images", taskId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("task_images")
        .select("id, storage_path, uploaded_by, created_at")
        .eq("task_id", taskId)
        .order("created_at");
      if (error) throw error;
      const signed = await Promise.all(
        (data ?? []).map(async (img: any) => {
          const { data: s } = await supabase.storage
            .from("task-images")
            .createSignedUrl(img.storage_path, 60 * 60);
          return { ...img, url: s?.signedUrl ?? null };
        }),
      );
      return signed as { id: string; storage_path: string; url: string | null }[];
    },
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      if (!userId) throw new Error(i18n.t("tasks.missingUser"));
      if ((imagesQuery.data?.length ?? 0) >= 5)
        throw new Error(i18n.t("tasks.maxImagesTask"));
      const ext = file.name.split(".").pop() || "jpg";
      const path = `${userId}/${taskId}/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from("task-images").upload(path, file);
      if (error) throw error;
      await add({ data: { task_id: taskId, storage_path: path } });
    },
    onSuccess: () => {
      toast.success(i18n.t("tasks.imageAdded"));
      qc.invalidateQueries({ queryKey: ["task-images", taskId] });
    },
    onError: (e: any) => toast.error(e?.message ?? i18n.t("tasks.uploadError")),
  });

  const remove = useMutation({
    mutationFn: (id: string) => del({ data: { id } }),
    onSuccess: () => {
      toast.success(i18n.t("tasks.imageDeleted"));
      qc.invalidateQueries({ queryKey: ["task-images", taskId] });
    },
  });

  const lightboxImages: LightboxImage[] = (imagesQuery.data ?? [])
    .filter((i) => i.url)
    .map((i) => ({ url: i.url as string }));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>{title} ({imagesQuery.data?.length ?? 0}/5)</Label>
        {canEdit && (imagesQuery.data?.length ?? 0) < 5 && (
          <>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) upload.mutate(f);
                e.target.value = "";
              }}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileRef.current?.click()}
              disabled={upload.isPending}
              className="gap-2"
            >
              {upload.isPending ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
              {i18n.t("tasks.addImage")}
            </Button>
          </>
        )}
      </div>
      {imagesQuery.isLoading ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {imagesQuery.data?.map((img, idx) => (
            <div key={img.id} className="relative aspect-square rounded-lg overflow-hidden border bg-muted group">
              {img.url && (
                <img
                  src={img.url}
                  alt="task"
                  className="w-full h-full object-cover cursor-zoom-in"
                  onClick={() => setLightboxIdx(idx)}
                />
              )}
              {canEdit && (
                <button
                  type="button"
                  onClick={() => remove.mutate(img.id)}
                  className="absolute top-1 left-1 bg-destructive text-destructive-foreground rounded-full p-1"
                  aria-label={i18n.t("tasks.deleteImageAriaLabel")}
                >
                  <X className="size-3" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {lightboxIdx !== null && lightboxImages.length > 0 && (
        <ImageLightbox
          images={lightboxImages}
          initialIndex={lightboxIdx}
          onClose={() => setLightboxIdx(null)}
        />
      )}
    </div>
  );
}

// ----- Recurrence instruction images (edit mode) -----
function RecurrenceImagesSection({
  recurrenceId,
  canEdit,
  userId,
}: {
  recurrenceId: string;
  canEdit: boolean;
  userId?: string;
}) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const add = useServerFn(addRecurrenceImage);
  const del = useServerFn(deleteRecurrenceImage);
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);

  const imagesQuery = useQuery({
    queryKey: ["rec-images", recurrenceId],
    queryFn: async () => {
      const { data } = await supabase
        .from("task_recurrence_images")
        .select("id, storage_path")
        .eq("recurrence_id", recurrenceId)
        .order("created_at");
      const signed = await Promise.all(
        (data ?? []).map(async (img: any) => {
          const { data: s } = await supabase.storage
            .from("task-images")
            .createSignedUrl(img.storage_path, 60 * 60);
          return { ...img, url: s?.signedUrl ?? null };
        }),
      );
      return signed as { id: string; storage_path: string; url: string | null }[];
    },
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      if (!userId) throw new Error(i18n.t("tasks.missingUser"));
      if ((imagesQuery.data?.length ?? 0) >= 5)
        throw new Error(i18n.t("tasks.maxImagesInstr"));
      const ext = file.name.split(".").pop() || "jpg";
      const path = `${userId}/recurrences/${recurrenceId}/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from("task-images").upload(path, file);
      if (error) throw error;
      await add({ data: { recurrence_id: recurrenceId, storage_path: path } });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rec-images", recurrenceId] });
    },
    onError: (e: any) => toast.error(e?.message ?? i18n.t("tasks.uploadError")),
  });

  const remove = useMutation({
    mutationFn: (id: string) => del({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rec-images", recurrenceId] }),
  });

  const lightboxImages: LightboxImage[] = (imagesQuery.data ?? [])
    .filter((i) => i.url)
    .map((i) => ({ url: i.url as string }));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>{i18n.t("tasks.instrImages")} ({imagesQuery.data?.length ?? 0}/5)</Label>
        {canEdit && (imagesQuery.data?.length ?? 0) < 5 && (
          <>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) upload.mutate(f);
                e.target.value = "";
              }}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileRef.current?.click()}
              disabled={upload.isPending}
              className="gap-2"
            >
              {upload.isPending ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
              {i18n.t("tasks.addImage")}
            </Button>
          </>
        )}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {imagesQuery.data?.map((img, idx) => (
          <div key={img.id} className="relative aspect-square rounded-lg overflow-hidden border bg-muted">
            {img.url && (
              <img
                src={img.url}
                alt="instruction"
                className="w-full h-full object-cover cursor-zoom-in"
                onClick={() => setLightboxIdx(idx)}
              />
            )}
            {canEdit && (
              <button
                type="button"
                onClick={() => remove.mutate(img.id)}
                className="absolute top-1 left-1 bg-destructive text-destructive-foreground rounded-full p-1"
                aria-label={i18n.t("tasks.deleteImageAriaLabel")}
              >
                <X className="size-3" />
              </button>
            )}
          </div>
        ))}
      </div>
      {lightboxIdx !== null && lightboxImages.length > 0 && (
        <ImageLightbox
          images={lightboxImages}
          initialIndex={lightboxIdx}
          onClose={() => setLightboxIdx(null)}
        />
      )}
    </div>
  );
}

// Staged-files picker used in CREATE dialogs (before the parent record exists).
function StagedImagesPicker({
  files,
  onChange,
  max = 5,
}: {
  files: File[];
  onChange: (files: File[]) => void;
  max?: number;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>{i18n.t("tasks.instrImages")} ({files.length}/{max})</Label>
        {files.length < max && (
          <>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                if (f.size > 10 * 1024 * 1024) {
                  toast.error(i18n.t("tasks.fileTooLarge"));
                  return;
                }
                onChange([...files, f]);
                e.target.value = "";
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => fileRef.current?.click()}
            >
              <ImagePlus className="size-4" /> {i18n.t("tasks.addImage")}
            </Button>
          </>
        )}
      </div>
      {files.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {files.map((_, idx) => (
            <div key={idx} className="relative aspect-square rounded-lg overflow-hidden border bg-muted">
              <img
                src={previews[idx]}
                alt=""
                className="w-full h-full object-cover cursor-zoom-in"
                onClick={() => setLightboxIdx(idx)}
              />
              <button
                type="button"
                onClick={() => onChange(files.filter((_, i) => i !== idx))}
                className="absolute top-1 left-1 bg-destructive text-destructive-foreground rounded-full p-1"
                aria-label={i18n.t("tasks.removeAriaLabel")}
              >
                <X className="size-3" />
              </button>
            </div>
          ))}
        </div>
      )}
      {lightboxIdx !== null && previews.length > 0 && (
        <ImageLightbox
          images={previews.map((url) => ({ url }))}
          initialIndex={lightboxIdx}
          onClose={() => setLightboxIdx(null)}
        />
      )}
    </div>
  );
}

// ============ TASK CREATE/EDIT DIALOG ============

function TaskFormDialog({
  mode,
  deps,
  caps,
  task,
  onClose,
}: {
  mode: "create" | "edit";
  deps: { departments: DeptOption[]; employees: EmpOption[] };
  caps: ReturnType<typeof useTaskCaps>;
  task?: TaskRow;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const create = useServerFn(createTask);
  const update = useServerFn(updateTask);
  const addImg = useServerFn(addTaskImage);

  const canPickAnyDept = caps.canCreateTasks; // main_admin or branch/assistant manager with perm
  const allowedDepartments = canPickAnyDept
    ? deps.departments
    : deps.departments.filter((d) => d.id === caps.profile?.department_id);
  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [targetScope, setTargetScope] = useState<"all_departments" | "departments" | "single_department">(
    (task as any)?.target_scope ?? "single_department",
  );
  const [departmentId, setDepartmentId] = useState(
    task?.department_id ?? caps.profile?.department_id ?? allowedDepartments[0]?.id ?? "",
  );
  useEffect(() => {
    if (mode !== "create" || task?.department_id) return;
    const fallback =
      caps.profile?.department_id ?? allowedDepartments[0]?.id ?? "";
    if (fallback && fallback !== departmentId) setDepartmentId(fallback);
  }, [mode, task?.department_id, caps.profile?.department_id, allowedDepartments]);
  useEffect(() => {
    if (!canPickAnyDept) setTargetScope("single_department");
  }, [canPickAnyDept]);
  const [departmentIds, setDepartmentIds] = useState<string[]>([]);
  const [executorMode, setExecutorMode] = useState<"all" | "single" | "multi">("all");
  const [singleAssignee, setSingleAssignee] = useState<string>(task?.assignee_id ?? "");
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [requiresApproval, setRequiresApproval] = useState<boolean>(
    (task as any)?.requires_approval ?? true,
  );
  const initSplit = splitForInputs(task?.due_at ?? null);
  const [dueDate, setDueDate] = useState<string>(initSplit.date);
  const [dueTime, setDueTime] = useState<string>(initSplit.time);
  const [priority, setPriority] = useState<TaskPriority>(task?.priority ?? "medium");
  const [stagedImages, setStagedImages] = useState<File[]>([]);

  // Load existing multi-dept / multi-assignee on edit
  const loadAssignees = useServerFn(listTaskAssigneeIds);
  const loadDepts = useServerFn(listTaskDepartmentIds);
  useEffect(() => {
    if (mode !== "edit" || !task) return;
    loadAssignees({ data: { task_id: task.id } }).then((ids: any) => {
      if (Array.isArray(ids) && ids.length) {
        setAssigneeIds(ids);
        setExecutorMode(ids.length > 1 ? "multi" : task.assignee_id ? "single" : "multi");
      } else if (task.assignee_id) {
        setExecutorMode("single");
      } else {
        setExecutorMode("all");
      }
    });
    loadDepts({ data: { task_id: task.id } }).then((ids: any) => {
      if (Array.isArray(ids) && ids.length) setDepartmentIds(ids);
    });
  }, [mode, task?.id]);

  // Filter employees by chosen scope/depts
  const eligibleEmployees = useMemo(() => {
    if (targetScope === "all_departments") return deps.employees;
    if (targetScope === "departments") {
      if (!departmentIds.length) return [];
      return deps.employees.filter((e) => e.department_id && departmentIds.includes(e.department_id));
    }
    return deps.employees.filter((e) => e.department_id === departmentId);
  }, [targetScope, departmentId, departmentIds, deps.employees]);

  const deptNameById = useMemo(
    () => Object.fromEntries(deps.departments.map((d) => [d.id, d.name])),
    [deps.departments],
  );

  const deptPickerOptions = useMemo<SearchablePickerOption[]>(
    () => allowedDepartments.map((d) => ({ id: d.id, label: d.name })),
    [allowedDepartments],
  );

  const employeePickerOptions = useMemo<SearchablePickerOption[]>(
    () =>
      eligibleEmployees.map((e) => ({
        id: e.id,
        label: e.full_name,
        sublabel: e.department_id ? deptNameById[e.department_id] : undefined,
      })),
    [eligibleEmployees, deptNameById],
  );

  const submit = useMutation({
    mutationFn: async () => {
      if (!title.trim()) throw new Error(i18n.t("tasks.titleRequired"));
      if (
        targetScope === "single_department" &&
        !departmentId
      ) {
        throw new Error(i18n.t("tasks.noDeptError"));
      }
      const dueIso = dueDate && dueTime ? combineToIso(dueDate, dueTime) : null;
      const basePayload: any = {
        title,
        description: description || null,
        target_scope: targetScope,
        department_id: targetScope === "single_department" ? departmentId : null,
        department_ids: targetScope === "departments" ? departmentIds : [],
        assignee_id: executorMode === "single" ? singleAssignee || null : null,
        assignee_ids: executorMode === "multi" ? assigneeIds : [],
        requires_approval: requiresApproval,
        due_at: dueIso,
        priority,
      };
      if (mode === "create") {
        const created: any = await create({ data: basePayload });
        const newId = created?.id;
        if (newId && stagedImages.length && caps.profile?.id) {
          for (const file of stagedImages) {
            try {
              const ext = file.name.split(".").pop() || "jpg";
              const path = `${caps.profile.id}/${newId}/${crypto.randomUUID()}.${ext}`;
              const { error: upErr } = await supabase.storage
                .from("task-images")
                .upload(path, file);
              if (upErr) throw upErr;
              await addImg({ data: { task_id: newId, storage_path: path } });
            } catch (e: any) {
              toast.error(`${i18n.t("tasks.imageUploadError")} ${e?.message ?? ""}`);
            }
          }
        }
      } else if (task) {
        await update({ data: { id: task.id, ...basePayload } as any });
      }
    },
    onSuccess: () => {
      toast.success(mode === "create" ? i18n.t("tasks.taskCreated") : i18n.t("tasks.taskUpdated"));
      qc.invalidateQueries({ queryKey: ["tasks"] });
      onClose();
    },
    onError: (e: any) => toast.error(e?.message ?? i18n.t("tasks.genericError")),
  });

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? i18n.t("tasks.dialogCreateTitle") : i18n.t("tasks.dialogEditTitle")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>{i18n.t("tasks.formTitle")}</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <Label>{i18n.t("tasks.formDesc")}</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
          </div>
          {canPickAnyDept && (
            <div>
              <Label>{i18n.t("tasks.formTarget")}</Label>
              <Select
                value={targetScope}
                onValueChange={(v) => setTargetScope(v as any)}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all_departments">{i18n.t("tasks.targetAll")}</SelectItem>
                  <SelectItem value="departments">{i18n.t("tasks.targetMultiple")}</SelectItem>
                  <SelectItem value="single_department">{i18n.t("tasks.targetSingle")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          {targetScope === "single_department" && (
            <div>
              <Label>{i18n.t("tasks.formDept")}</Label>
              {canPickAnyDept ? (
                <SearchableSingleSelect
                  options={deptPickerOptions}
                  value={departmentId}
                  onChange={setDepartmentId}
                  placeholder={i18n.t("tasks.formDept")}
                />
              ) : (
                <div className="px-3 py-2 rounded-md border bg-muted text-sm">
                  {allowedDepartments.find((d) => d.id === departmentId)?.name ?? "—"}
                </div>
              )}
            </div>
          )}
          {targetScope === "departments" && (
            <div>
              <Label>{i18n.t("tasks.formMultiDept")}</Label>
              <SearchableMultiSelect
                options={deptPickerOptions}
                value={departmentIds}
                onChange={setDepartmentIds}
                placeholder={i18n.t("tasks.formMultiDept")}
              />
            </div>
          )}
          <div>
            <Label>{i18n.t("tasks.formExecutor")}</Label>
            <Select value={executorMode} onValueChange={(v) => setExecutorMode(v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{i18n.t("tasks.executorAll")}</SelectItem>
                <SelectItem value="single">{i18n.t("tasks.executorSingle")}</SelectItem>
                <SelectItem value="multi">{i18n.t("tasks.executorMulti")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {executorMode === "single" && (
            <div>
              <Label>{i18n.t("tasks.formSingleAssignee")}</Label>
              <SearchableSingleSelect
                options={employeePickerOptions}
                value={singleAssignee}
                onChange={setSingleAssignee}
                placeholder={i18n.t("tasks.selectEmployee")}
                disabled={employeePickerOptions.length === 0}
              />
            </div>
          )}
          {executorMode === "multi" && (
            <div>
              <Label>{i18n.t("tasks.formMultiAssignee")}</Label>
              {eligibleEmployees.length === 0 ? (
                <p className="text-xs text-muted-foreground mt-1">{i18n.t("tasks.selectDeptFirst")}</p>
              ) : (
                <SearchableMultiSelect
                  options={employeePickerOptions}
                  value={assigneeIds}
                  onChange={setAssigneeIds}
                  placeholder={i18n.t("tasks.formMultiAssignee")}
                />
              )}
            </div>
          )}
          <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
            <input
              type="checkbox"
              checked={requiresApproval}
              onChange={(e) => setRequiresApproval(e.target.checked)}
              className="size-4"
            />
            {i18n.t("tasks.requiresApproval")}
          </label>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>{i18n.t("tasks.formDueDate")}</Label>
              <HebrewDateInput value={dueDate} onChange={setDueDate} />
            </div>
            <div>
              <Label>{i18n.t("tasks.formTime")}</Label>
              <HebrewTimeInput value={dueTime || "08:00"} onChange={setDueTime} />
            </div>
            <div>
              <Label>{i18n.t("tasks.formPriority")}</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as TaskPriority)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">{i18n.t("tasks.priorityLow")}</SelectItem>
                  <SelectItem value="medium">{i18n.t("tasks.priorityMedium")}</SelectItem>
                  <SelectItem value="high">{i18n.t("tasks.priorityHigh")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {dueDate && dueTime && (
            <p className="text-xs text-muted-foreground">
              {i18n.t("tasks.displayDate")} {formatHeDateTime(combineToIso(dueDate, dueTime))}
            </p>
          )}
          <div className="border-t pt-3">
            {mode === "create" ? (
              <StagedImagesPicker files={stagedImages} onChange={setStagedImages} />
            ) : task ? (
              <TaskImagesSection
                taskId={task.id}
                canEdit={true}
                userId={caps.profile?.id}
                title={i18n.t("tasks.instrImages")}
              />
            ) : null}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{i18n.t("tasks.cancelBtn")}</Button>
          <Button
            onClick={() => submit.mutate()}
            disabled={
              !title.trim() ||
              submit.isPending ||
              (targetScope === "single_department" && !departmentId) ||
              (targetScope === "departments" && departmentIds.length === 0) ||
              (executorMode === "single" && !singleAssignee) ||
              (executorMode === "multi" && assigneeIds.length === 0)
            }
          >
            {submit.isPending && <Loader2 className="size-4 animate-spin ml-2" />}
            {mode === "create" ? i18n.t("tasks.createBtn") : i18n.t("tasks.updateBtn")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============ RECURRING SECTION ============

function RecurringSection({
  caps,
  deps,
}: {
  caps: ReturnType<typeof useTaskCaps>;
  deps?: { departments: DeptOption[]; employees: EmpOption[] };
}) {
  const qc = useQueryClient();
  const [openCreate, setOpenCreate] = useState(false);
  const [edit, setEdit] = useState<RecRow | null>(null);

  const recsQuery = useQuery({
    queryKey: ["recurrences"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("task_recurrences")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as RecRow[];
    },
  });

  const upd = useServerFn(updateRecurrence);
  const del = useServerFn(deleteRecurrence);

  const toggle = useMutation({
    mutationFn: (r: RecRow) => upd({ data: { id: r.id, is_active: !r.is_active } as any }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["recurrences"] }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => del({ data: { id } }),
    onSuccess: () => {
      toast.success(i18n.t("tasks.recurringDeleted"));
      qc.invalidateQueries({ queryKey: ["recurrences"] });
    },
    onError: (e: any) => toast.error(e?.message ?? i18n.t("tasks.genericError")),
  });

  const canCreate = caps.canManageTasks || caps.isDeptMgr;

  return (
    <div className="space-y-3">
      {canCreate && (
        <div className="flex justify-end">
          <Button onClick={() => setOpenCreate(true)} className="gap-2">
            <Plus className="size-4" /> {i18n.t("tasks.newRecurring")}
          </Button>
        </div>
      )}
      {recsQuery.isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      ) : !recsQuery.data?.length ? (
        <Card className="card-elevated p-6 text-sm text-muted-foreground text-center">
          {i18n.t("tasks.noRecurring")}
        </Card>
      ) : (
        recsQuery.data.map((r) => {
          const dept = deps?.departments.find((d) => d.id === r.department_id);
          return (
            <Card key={r.id} className="card-elevated p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold truncate">{r.title}</h3>
                    <Badge variant="outline" className="rounded-full text-xs">
                      {getFreqLabel(r.frequency)}
                    </Badge>
                    {!r.is_active && (
                      <Badge variant="secondary" className="rounded-full text-xs">{i18n.t("tasks.suspended")}</Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
                    {dept && <span>{i18n.t("tasks.dept")} {dept.name}</span>}
                    <span>{i18n.t("tasks.time")} {r.time_of_day}</span>
                    {r.frequency === "weekly" && r.days_of_week.length > 0 && (
                      <span>{i18n.t("tasks.days")} {r.days_of_week.map((d) => DOW_LABELS[d]).join(", ")}</span>
                    )}
                    {r.frequency === "monthly" && r.day_of_month && (
                      <span>{i18n.t("tasks.dayOfMonth")} {r.day_of_month}</span>
                    )}
                    {r.next_run_at && (
                      <span>{i18n.t("tasks.nextRun")} {formatHeDateTime(r.next_run_at)}</span>
                    )}
                  </div>
                </div>
                {canCreate && (
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => toggle.mutate(r)}
                      aria-label={r.is_active ? i18n.t("tasks.pauseAriaLabel") : i18n.t("tasks.resumeAriaLabel")}
                    >
                      {r.is_active ? <Pause className="size-4" /> : <Play className="size-4" />}
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => setEdit(r)} aria-label={i18n.t("tasks.editAriaLabel")}>
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => remove.mutate(r.id)}
                      aria-label={i18n.t("tasks.deleteAriaLabel")}
                      className="text-destructive"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                )}
              </div>
            </Card>
          );
        })
      )}

      {openCreate && deps && (
        <RecurrenceFormDialog
          mode="create"
          deps={deps}
          caps={caps}
          onClose={() => setOpenCreate(false)}
        />
      )}
      {edit && deps && (
        <RecurrenceFormDialog
          mode="edit"
          deps={deps}
          caps={caps}
          rec={edit}
          onClose={() => setEdit(null)}
        />
      )}
    </div>
  );
}

function RecurrenceFormDialog({
  mode,
  deps,
  caps,
  rec,
  onClose,
}: {
  mode: "create" | "edit";
  deps: { departments: DeptOption[]; employees: EmpOption[] };
  caps: ReturnType<typeof useTaskCaps>;
  rec?: RecRow;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const create = useServerFn(createRecurrence);
  const update = useServerFn(updateRecurrence);
  const addRecImg = useServerFn(addRecurrenceImage);

  const canPickAnyDept = caps.canCreateTasks;
  const allowedDepartments = canPickAnyDept
    ? deps.departments
    : deps.departments.filter((d) => d.id === caps.profile?.department_id);

  const [title, setTitle] = useState(rec?.title ?? "");
  const [description, setDescription] = useState(rec?.description ?? "");
  const [departmentId, setDepartmentId] = useState(rec?.department_id ?? allowedDepartments[0]?.id ?? "");
  const [priority, setPriority] = useState<TaskPriority>(rec?.priority ?? "medium");
  const [frequency, setFrequency] = useState<RecRow["frequency"]>(rec?.frequency ?? "daily");
  const [dows, setDows] = useState<number[]>(rec?.days_of_week ?? []);
  const [dom, setDom] = useState<number>(rec?.day_of_month ?? 1);
  const [time, setTime] = useState(rec?.time_of_day ?? "08:00");
  const [active, setActive] = useState(rec?.is_active ?? true);
  const [stagedImages, setStagedImages] = useState<File[]>([]);

  const submit = useMutation({
    mutationFn: async () => {
      const payload: any = {
        title,
        description: description || null,
        department_id: departmentId,
        assignee_id: null,
        priority,
        frequency,
        days_of_week: frequency === "weekly" ? dows : [],
        day_of_month: frequency === "monthly" ? dom : null,
        time_of_day: time,
        is_active: active,
      };
      if (mode === "create") {
        const created: any = await create({ data: payload });
        const newId = created?.id;
        if (newId && stagedImages.length && caps.profile?.id) {
          for (const file of stagedImages) {
            try {
              const ext = file.name.split(".").pop() || "jpg";
              const path = `${caps.profile.id}/recurrences/${newId}/${crypto.randomUUID()}.${ext}`;
              const { error: upErr } = await supabase.storage
                .from("task-images")
                .upload(path, file);
              if (upErr) throw upErr;
              await addRecImg({ data: { recurrence_id: newId, storage_path: path } });
            } catch (e: any) {
              toast.error(`${i18n.t("tasks.imageUploadError")} ${e?.message ?? ""}`);
            }
          }
        }
      } else if (rec) await update({ data: { id: rec.id, ...payload } });
    },
    onSuccess: () => {
      toast.success(mode === "create" ? i18n.t("tasks.recurringCreated") : i18n.t("tasks.recurringUpdated"));
      qc.invalidateQueries({ queryKey: ["recurrences"] });
      onClose();
    },
    onError: (e: any) => toast.error(e?.message ?? i18n.t("tasks.genericError")),
  });

  function toggleDow(d: number) {
    setDows((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort()));
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? i18n.t("tasks.recurringCreateTitle") : i18n.t("tasks.recurringEditTitle")}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>{i18n.t("tasks.formTitle")}</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <Label>{i18n.t("tasks.formDesc")}</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </div>
          <div>
            <Label>{i18n.t("tasks.formDept")}</Label>
            {canPickAnyDept ? (
              <Select value={departmentId} onValueChange={(v) => setDepartmentId(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {allowedDepartments.map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div className="px-3 py-2 rounded-md border bg-muted text-sm">
                {allowedDepartments.find((d) => d.id === departmentId)?.name ?? "—"}
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-1">
              {i18n.t("tasks.recurringDeptNote")}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{i18n.t("tasks.formPriority")}</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as TaskPriority)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">{i18n.t("tasks.priorityLow")}</SelectItem>
                  <SelectItem value="medium">{i18n.t("tasks.priorityMedium")}</SelectItem>
                  <SelectItem value="high">{i18n.t("tasks.priorityHigh")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{i18n.t("tasks.formFrequency")}</Label>
              <Select value={frequency} onValueChange={(v) => setFrequency(v as RecRow["frequency"])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">{i18n.t("tasks.freqDaily")}</SelectItem>
                  <SelectItem value="weekly">{i18n.t("tasks.freqWeekly")}</SelectItem>
                  <SelectItem value="monthly">{i18n.t("tasks.freqMonthly")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {frequency === "weekly" && (
            <div>
              <Label>{i18n.t("tasks.formWeekdays")}</Label>
              <div className="flex gap-2 mt-2 flex-wrap">
                {DOW_LABELS.map((lbl, i) => (
                  <Button
                    key={i}
                    type="button"
                    variant={dows.includes(i) ? "default" : "outline"}
                    size="sm"
                    onClick={() => toggleDow(i)}
                  >
                    {lbl}
                  </Button>
                ))}
              </div>
            </div>
          )}
          {frequency === "monthly" && (
            <div>
              <Label>{i18n.t("tasks.formDayOfMonth")}</Label>
              <Input
                type="number"
                min={1}
                max={28}
                value={dom}
                onChange={(e) => setDom(parseInt(e.target.value) || 1)}
              />
            </div>
          )}
          <div className="grid grid-cols-2 gap-3 items-end">
            <div>
              <Label>{i18n.t("tasks.formTime")}</Label>
              <HebrewTimeInput value={time || "08:00"} onChange={setTime} />
            </div>
          <div className="flex items-center gap-2">
              <Switch checked={active} onCheckedChange={setActive} />
              <Label>{i18n.t("tasks.formActive")}</Label>
            </div>
          </div>
          <div className="border-t pt-3">
            {mode === "create" ? (
              <StagedImagesPicker files={stagedImages} onChange={setStagedImages} />
            ) : rec ? (
              <RecurrenceImagesSection
                recurrenceId={rec.id}
                canEdit={true}
                userId={caps.profile?.id}
              />
            ) : null}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{i18n.t("tasks.cancelBtn")}</Button>
          <Button
            onClick={() => submit.mutate()}
            disabled={!title.trim() || !departmentId || submit.isPending}
          >
            {submit.isPending && <Loader2 className="size-4 animate-spin ml-2" />}
            {i18n.t("tasks.saveBtn")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
