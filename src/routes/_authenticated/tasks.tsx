import { createFileRoute, useSearch, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/use-auth";
import { isAdmin, type AppRole } from "@/lib/constants";
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
} from "@/lib/tasks.functions";
import { formatHeDateTime, splitForInputs, combineToIso } from "@/lib/date-format";
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

type TaskStatus = "new" | "in_progress" | "pending_approval" | "completed";
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
interface EmpOption { id: string; full_name: string; department_id: string | null }

const STATUS_LABEL: Record<TaskStatus, string> = {
  new: "חדש",
  in_progress: "בביצוע",
  pending_approval: "ממתין לאישור",
  completed: "הושלמה",
};
const PRIORITY_LABEL: Record<TaskPriority, string> = {
  low: "נמוכה",
  medium: "בינונית",
  high: "גבוהה",
};
const FREQ_LABEL = { daily: "יומי", weekly: "שבועי", monthly: "חודשי" } as const;
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
  const isMainAdmin = roles.includes("main_admin");
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
  const isManager = roles.includes("branch_manager") || roles.includes("assistant_manager");
  const canCreateTasks = isMainAdmin || (isManager && (!!p.can_manage_tasks || !!p.can_create_tasks));
  const canEditTasks = isMainAdmin || (isManager && (!!p.can_manage_tasks || !!p.can_edit_tasks));
  const canDeleteTasks = isMainAdmin || (isManager && (!!p.can_manage_tasks || !!p.can_delete_tasks));
  // Legacy alias
  const canManageTasks = canEditTasks;
  return {
    profile,
    isMainAdmin,
    isAdm,
    isDeptMgr,
    canCreateTasks,
    canEditTasks,
    canDeleteTasks,
    canManageTasks,
  };
}

function TasksPage() {
  const search = useSearch({ from: "/_authenticated/tasks" }) as TasksSearch;
  const caps = useTaskCaps();
  const qc = useQueryClient();

  // Realtime
  useEffect(() => {
    const ch = supabase
      .channel("tasks-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, () =>
        qc.invalidateQueries({ queryKey: ["tasks"] }),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "task_recurrences" }, () =>
        qc.invalidateQueries({ queryKey: ["recurrences"] }),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "task_images" }, () =>
        qc.invalidateQueries({ queryKey: ["task-images"] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [qc]);

  const depsQuery = useQuery({
    queryKey: ["task-deps"],
    queryFn: async () => {
      const [{ data: depts }, { data: emps }] = await Promise.all([
        supabase.from("departments").select("id, name").order("name"),
        supabase.from("profiles").select("id, full_name, department_id").order("full_name"),
      ]);
      return {
        departments: (depts ?? []) as DeptOption[],
        employees: (emps ?? []) as EmpOption[],
      };
    },
  });

  const tasksQuery = useQuery({
    queryKey: ["tasks"],
    refetchOnMount: "always",
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tasks")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as TaskRow[];
    },
  });

  const [openCreate, setOpenCreate] = useState(false);
  const [editTask, setEditTask] = useState<TaskRow | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>(search.status ?? "all");
  const [search2, setSearch2] = useState("");

  const filtered = useMemo(() => {
    let list = tasksQuery.data ?? [];
    if (statusFilter !== "all" && statusFilter !== "overdue") {
      list = list.filter((t) => t.status === statusFilter);
    }
    if (statusFilter === "overdue") {
      const now = Date.now();
      list = list.filter(
        (t) => t.due_at && t.status !== "completed" && new Date(t.due_at).getTime() < now,
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
          <h1 className="text-2xl sm:text-3xl font-bold">משימות</h1>
          <p className="text-sm text-muted-foreground mt-1">
            ניהול ומעקב משימות לעובדי הסניף
          </p>
        </div>
        {canCreateAny && (
          <Button onClick={() => setOpenCreate(true)} className="gap-2">
            <Plus className="size-4" /> משימה חדשה
          </Button>
        )}
      </header>

      <Tabs defaultValue="tasks" className="w-full">
        <TabsList>
          <TabsTrigger value="tasks" className="gap-2">
            <ListTodo className="size-4" />
            משימות
          </TabsTrigger>
          <TabsTrigger value="recurring" className="gap-2">
            <Repeat className="size-4" />
            משימות חוזרות
          </TabsTrigger>
        </TabsList>

        <TabsContent value="tasks" className="space-y-4 mt-4">
          <div className="flex flex-wrap items-center gap-3">
            <Input
              placeholder="חיפוש לפי כותרת או תיאור"
              value={search2}
              onChange={(e) => setSearch2(e.target.value)}
              className="max-w-xs"
            />
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="max-w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">הכול</SelectItem>
                <SelectItem value="new">חדש</SelectItem>
                <SelectItem value="in_progress">בביצוע</SelectItem>
                <SelectItem value="completed">הושלם</SelectItem>
                <SelectItem value="overdue">באיחור</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {tasksQuery.isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="size-6 animate-spin text-primary" />
            </div>
          ) : filtered.length === 0 ? (
            <Card className="card-elevated p-6 text-sm text-muted-foreground text-center">
              אין משימות להצגה
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
    task.due_at && task.status !== "completed" && new Date(task.due_at).getTime() < Date.now();
  const isDeptOfThis = caps.isDeptMgr && true;
  const canEdit = caps.canEditTasks || isDeptOfThis;
  const canDelete = caps.canDeleteTasks;

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
                {PRIORITY_LABEL[task.priority]}
              </Badge>
              <Badge variant={statusVariant(task.status)} className="rounded-full text-xs">
                {STATUS_LABEL[task.status]}
              </Badge>
              {overdue && (
                <Badge variant="destructive" className="rounded-full text-xs gap-1">
                  <AlertTriangle className="size-3" /> באיחור
                </Badge>
              )}
              {task.recurrence_id && (
                <Badge variant="outline" className="rounded-full text-xs gap-1">
                  <Repeat className="size-3" /> חוזרת
                </Badge>
              )}
            </div>
            <div className="text-xs text-muted-foreground mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
              {dept && <span>מחלקה: {dept.name}</span>}
              {task.due_at && (
                <span className="flex items-center gap-1">
                  <Clock className="size-3" />
                  יעד: {formatHeDateTime(task.due_at)}
                </span>
              )}
              {completedBy && <span>בוצע ע״י: {completedBy.full_name}</span>}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
            {canEdit && (
              <Button variant="ghost" size="icon" onClick={onEdit} aria-label="עריכה">
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
  if (s === "completed") return "secondary";
  if (s === "in_progress") return "default";
  return "outline";
}

function DeleteTaskBtn({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const del = useServerFn(deleteTask);
  const m = useMutation({
    mutationFn: () => del({ data: { id } }),
    onSuccess: () => {
      toast.success("המשימה נמחקה");
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "שגיאה במחיקה"),
  });
  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setOpen(true)}
        aria-label="מחיקה"
        className="text-destructive"
      >
        <Trash2 className="size-4" />
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>למחוק את המשימה?</AlertDialogTitle>
            <AlertDialogDescription>פעולה זו לא ניתנת לביטול.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ביטול</AlertDialogCancel>
            <AlertDialogAction onClick={() => m.mutate()}>מחק</AlertDialogAction>
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
  const [status, setStatus] = useState<TaskStatus>(task.status);
  const [notes, setNotes] = useState(task.notes ?? "");
  const isAssignee = caps.profile?.id === task.assignee_id;
  const canEditMeta = caps.canManageTasks || caps.isDeptMgr;
  const canUpdateStatus = canEditMeta || isAssignee;

  const saveStatus = useMutation({
    mutationFn: () => upd({ data: { id: task.id, status, notes } }),
    onSuccess: () => {
      toast.success("עודכן");
      qc.invalidateQueries({ queryKey: ["tasks"] });
      onClose();
    },
    onError: (e: any) => toast.error(e?.message ?? "שגיאה בעדכון"),
  });

  const dept = deps?.departments.find((d) => d.id === task.department_id);
  const assignee = deps?.employees.find((e) => e.id === task.assignee_id);

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{task.title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {task.description && (
            <div>
              <Label className="text-xs text-muted-foreground">תיאור</Label>
              <p className="text-sm whitespace-pre-wrap mt-1">{task.description}</p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <Label className="text-xs text-muted-foreground">מחלקה</Label>
              <p>{dept?.name ?? "—"}</p>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">אחראי</Label>
              <p>{assignee?.full_name ?? "ללא"}</p>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">עדיפות</Label>
              <p>{PRIORITY_LABEL[task.priority]}</p>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">תאריך יצירה</Label>
              <p>{new Date(task.created_at).toLocaleString("he-IL")}</p>
            </div>
            {task.due_at && (
              <div>
                <Label className="text-xs text-muted-foreground">תאריך יעד</Label>
                <p>{new Date(task.due_at).toLocaleString("he-IL")}</p>
              </div>
            )}
            {task.completed_at && (
              <div>
                <Label className="text-xs text-muted-foreground">הושלם בתאריך</Label>
                <p>{new Date(task.completed_at).toLocaleString("he-IL")}</p>
              </div>
            )}
          </div>

          <div className="border-t pt-4 space-y-3">
            <div>
              <Label>סטטוס</Label>
              <Select
                value={status}
                onValueChange={(v) => setStatus(v as TaskStatus)}
                disabled={!canUpdateStatus}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="new">חדש</SelectItem>
                  <SelectItem value="in_progress">בביצוע</SelectItem>
                  <SelectItem value="completed">הושלם</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>הערות</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                disabled={!canUpdateStatus}
                rows={3}
              />
            </div>
          </div>

          {/* Images: show only when completed; allow assignee/managers to upload */}
          {status === "completed" && (
            <TaskImagesSection taskId={task.id} canEdit={canUpdateStatus} userId={caps.profile?.id} />
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>סגירה</Button>
          {canUpdateStatus && (
            <Button onClick={() => saveStatus.mutate()} disabled={saveStatus.isPending}>
              {saveStatus.isPending && <Loader2 className="size-4 animate-spin ml-2" />}
              שמירה
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
}: {
  taskId: string;
  canEdit: boolean;
  userId?: string;
}) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const add = useServerFn(addTaskImage);
  const del = useServerFn(deleteTaskImage);

  const imagesQuery = useQuery({
    queryKey: ["task-images", taskId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("task_images")
        .select("id, storage_path, uploaded_by, created_at")
        .eq("task_id", taskId)
        .order("created_at");
      if (error) throw error;
      // sign urls
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
      if (!userId) throw new Error("חסר משתמש");
      if ((imagesQuery.data?.length ?? 0) >= 5)
        throw new Error("ניתן להעלות עד 5 תמונות לכל משימה");
      const ext = file.name.split(".").pop() || "jpg";
      const path = `${userId}/${taskId}/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from("task-images").upload(path, file);
      if (error) throw error;
      await add({ data: { task_id: taskId, storage_path: path } });
    },
    onSuccess: () => {
      toast.success("תמונה נוספה");
      qc.invalidateQueries({ queryKey: ["task-images", taskId] });
    },
    onError: (e: any) => toast.error(e?.message ?? "שגיאה בהעלאה"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => del({ data: { id } }),
    onSuccess: () => {
      toast.success("נמחק");
      qc.invalidateQueries({ queryKey: ["task-images", taskId] });
    },
  });

  return (
    <div className="border-t pt-4 space-y-2">
      <div className="flex items-center justify-between">
        <Label>תמונות ביצוע ({imagesQuery.data?.length ?? 0}/5)</Label>
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
              הוסף תמונה
            </Button>
          </>
        )}
      </div>
      {imagesQuery.isLoading ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {imagesQuery.data?.map((img) => (
            <div key={img.id} className="relative aspect-square rounded-lg overflow-hidden border bg-muted">
              {img.url && (
                <img src={img.url} alt="task" className="w-full h-full object-cover" />
              )}
              {canEdit && (
                <button
                  type="button"
                  onClick={() => remove.mutate(img.id)}
                  className="absolute top-1 left-1 bg-destructive text-destructive-foreground rounded-full p-1"
                  aria-label="מחק תמונה"
                >
                  <X className="size-3" />
                </button>
              )}
            </div>
          ))}
        </div>
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

  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [departmentId, setDepartmentId] = useState(
    task?.department_id ?? deps.departments[0]?.id ?? "",
  );
  const [assigneeId, setAssigneeId] = useState<string>(task?.assignee_id ?? "");
  const [dueAt, setDueAt] = useState<string>(task?.due_at ? task.due_at.slice(0, 16) : "");
  const [priority, setPriority] = useState<TaskPriority>(task?.priority ?? "medium");

  const empsForDept = deps.employees.filter(
    (e) => !departmentId || e.department_id === departmentId,
  );

  const submit = useMutation({
    mutationFn: async () => {
      const payload = {
        title,
        description: description || null,
        department_id: departmentId,
        assignee_id: assigneeId || null,
        due_at: dueAt ? new Date(dueAt).toISOString() : null,
        priority,
      };
      if (mode === "create") {
        await create({ data: payload as any });
      } else if (task) {
        await update({ data: { id: task.id, ...payload } as any });
      }
    },
    onSuccess: () => {
      toast.success(mode === "create" ? "משימה נוצרה" : "המשימה עודכנה");
      qc.invalidateQueries({ queryKey: ["tasks"] });
      onClose();
    },
    onError: (e: any) => toast.error(e?.message ?? "שגיאה"),
  });

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "משימה חדשה" : "עריכת משימה"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>כותרת</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <Label>תיאור</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
          </div>
          <div>
            <Label>מחלקה</Label>
            <Select value={departmentId} onValueChange={(v) => { setDepartmentId(v); setAssigneeId(""); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {deps.departments.map((d) => (
                  <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>עובד אחראי</Label>
            <Select value={assigneeId || "none"} onValueChange={(v) => setAssigneeId(v === "none" ? "" : v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">ללא</SelectItem>
                {empsForDept.map((e) => (
                  <SelectItem key={e.id} value={e.id}>{e.full_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>תאריך יעד</Label>
              <Input
                type="datetime-local"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
              />
            </div>
            <div>
              <Label>עדיפות</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as TaskPriority)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">נמוכה</SelectItem>
                  <SelectItem value="medium">בינונית</SelectItem>
                  <SelectItem value="high">גבוהה</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>ביטול</Button>
          <Button
            onClick={() => submit.mutate()}
            disabled={!title.trim() || !departmentId || submit.isPending}
          >
            {submit.isPending && <Loader2 className="size-4 animate-spin ml-2" />}
            {mode === "create" ? "צור" : "עדכן"}
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
      toast.success("נמחק");
      qc.invalidateQueries({ queryKey: ["recurrences"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "שגיאה"),
  });

  const canCreate = caps.canManageTasks || caps.isDeptMgr;

  return (
    <div className="space-y-3">
      {canCreate && (
        <div className="flex justify-end">
          <Button onClick={() => setOpenCreate(true)} className="gap-2">
            <Plus className="size-4" /> משימה חוזרת חדשה
          </Button>
        </div>
      )}
      {recsQuery.isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      ) : !recsQuery.data?.length ? (
        <Card className="card-elevated p-6 text-sm text-muted-foreground text-center">
          אין משימות חוזרות
        </Card>
      ) : (
        recsQuery.data.map((r) => {
          const dept = deps?.departments.find((d) => d.id === r.department_id);
          const assignee = deps?.employees.find((e) => e.id === r.assignee_id);
          return (
            <Card key={r.id} className="card-elevated p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold truncate">{r.title}</h3>
                    <Badge variant="outline" className="rounded-full text-xs">
                      {FREQ_LABEL[r.frequency]}
                    </Badge>
                    {!r.is_active && (
                      <Badge variant="secondary" className="rounded-full text-xs">מושהה</Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
                    {dept && <span>מחלקה: {dept.name}</span>}
                    {assignee && <span>אחראי: {assignee.full_name}</span>}
                    <span>שעה: {r.time_of_day}</span>
                    {r.frequency === "weekly" && r.days_of_week.length > 0 && (
                      <span>ימים: {r.days_of_week.map((d) => DOW_LABELS[d]).join(", ")}</span>
                    )}
                    {r.frequency === "monthly" && r.day_of_month && (
                      <span>יום בחודש: {r.day_of_month}</span>
                    )}
                    {r.next_run_at && (
                      <span>ריצה הבאה: {new Date(r.next_run_at).toLocaleString("he-IL")}</span>
                    )}
                  </div>
                </div>
                {canCreate && (
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => toggle.mutate(r)}
                      aria-label={r.is_active ? "השהה" : "הפעל"}
                    >
                      {r.is_active ? <Pause className="size-4" /> : <Play className="size-4" />}
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => setEdit(r)} aria-label="עריכה">
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => remove.mutate(r.id)}
                      aria-label="מחיקה"
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
          onClose={() => setOpenCreate(false)}
        />
      )}
      {edit && deps && (
        <RecurrenceFormDialog
          mode="edit"
          deps={deps}
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
  rec,
  onClose,
}: {
  mode: "create" | "edit";
  deps: { departments: DeptOption[]; employees: EmpOption[] };
  rec?: RecRow;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const create = useServerFn(createRecurrence);
  const update = useServerFn(updateRecurrence);

  const [title, setTitle] = useState(rec?.title ?? "");
  const [description, setDescription] = useState(rec?.description ?? "");
  const [departmentId, setDepartmentId] = useState(rec?.department_id ?? deps.departments[0]?.id ?? "");
  const [assigneeId, setAssigneeId] = useState(rec?.assignee_id ?? "");
  const [priority, setPriority] = useState<TaskPriority>(rec?.priority ?? "medium");
  const [frequency, setFrequency] = useState<RecRow["frequency"]>(rec?.frequency ?? "daily");
  const [dows, setDows] = useState<number[]>(rec?.days_of_week ?? []);
  const [dom, setDom] = useState<number>(rec?.day_of_month ?? 1);
  const [time, setTime] = useState(rec?.time_of_day ?? "08:00");
  const [active, setActive] = useState(rec?.is_active ?? true);

  const empsForDept = deps.employees.filter((e) => !departmentId || e.department_id === departmentId);

  const submit = useMutation({
    mutationFn: async () => {
      const payload: any = {
        title,
        description: description || null,
        department_id: departmentId,
        assignee_id: assigneeId || null,
        priority,
        frequency,
        days_of_week: frequency === "weekly" ? dows : [],
        day_of_month: frequency === "monthly" ? dom : null,
        time_of_day: time,
        is_active: active,
      };
      if (mode === "create") await create({ data: payload });
      else if (rec) await update({ data: { id: rec.id, ...payload } });
    },
    onSuccess: () => {
      toast.success(mode === "create" ? "משימה חוזרת נוצרה" : "עודכן");
      qc.invalidateQueries({ queryKey: ["recurrences"] });
      onClose();
    },
    onError: (e: any) => toast.error(e?.message ?? "שגיאה"),
  });

  function toggleDow(d: number) {
    setDows((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort()));
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? "משימה חוזרת חדשה" : "עריכת משימה חוזרת"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>כותרת</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <Label>תיאור</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>מחלקה</Label>
              <Select value={departmentId} onValueChange={(v) => { setDepartmentId(v); setAssigneeId(""); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {deps.departments.map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>עובד אחראי</Label>
              <Select value={assigneeId || "none"} onValueChange={(v) => setAssigneeId(v === "none" ? "" : v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">ללא</SelectItem>
                  {empsForDept.map((e) => (
                    <SelectItem key={e.id} value={e.id}>{e.full_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>עדיפות</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as TaskPriority)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">נמוכה</SelectItem>
                  <SelectItem value="medium">בינונית</SelectItem>
                  <SelectItem value="high">גבוהה</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>תדירות</Label>
              <Select value={frequency} onValueChange={(v) => setFrequency(v as RecRow["frequency"])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">יומי</SelectItem>
                  <SelectItem value="weekly">שבועי</SelectItem>
                  <SelectItem value="monthly">חודשי</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {frequency === "weekly" && (
            <div>
              <Label>ימים בשבוע</Label>
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
              <Label>יום בחודש (1-28)</Label>
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
              <Label>שעה</Label>
              <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={active} onCheckedChange={setActive} />
              <Label>פעיל</Label>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>ביטול</Button>
          <Button
            onClick={() => submit.mutate()}
            disabled={!title.trim() || !departmentId || submit.isPending}
          >
            {submit.isPending && <Loader2 className="size-4 animate-spin ml-2" />}
            שמירה
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
