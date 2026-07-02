import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertTriangle, Crown, Info, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  createPlatformOwner,
  updatePlatformOwnerProfile,
  deletePlatformOwner,
  transferPrimaryOwnership,
  type PlatformOwnerRow,
} from "@/lib/platform-owners.functions";
import {
  PLATFORM_AUDIT_KEY,
  PLATFORM_OWNERS_KEY,
} from "@/lib/platform-owners.hooks";

function useInvalidatePlatform() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: [...PLATFORM_OWNERS_KEY] });
    qc.invalidateQueries({ queryKey: [...PLATFORM_AUDIT_KEY] });
  };
}

// -------------------- Create --------------------

export function PlatformOwnerCreateDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const invalidate = useInvalidatePlatform();
  const createFn = useServerFn(createPlatformOwner);
  const [full_name, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [id_number, setIdNumber] = useState("");

  const mut = useMutation({
    mutationFn: () =>
      createFn({
        data: {
          full_name: full_name.trim(),
          email: email.trim(),
          password,
          phone: phone.trim() || null,
          id_number: id_number.trim() || null,
        },
      }),
    onSuccess: () => {
      toast.success("בעל המערכת נוצר");
      invalidate();
      onOpenChange(false);
      setFullName(""); setEmail(""); setPassword(""); setPhone(""); setIdNumber("");
    },
    onError: (e: Error) => toast.error(e.message ?? "יצירה נכשלה"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>הוספת בעל מערכת</DialogTitle>
          <DialogDescription>
            יצירת חשבון בעל מערכת חדש. זהו חשבון עצמאי — אינו קשור למשתמש
            המחובר או לזהות עובד כלשהי.
          </DialogDescription>
        </DialogHeader>
        {/* Hidden decoy fields deter aggressive browser autofill from populating
            the current user's identity into a form for creating a *different* person. */}
        <form
          autoComplete="off"
          onSubmit={(e) => { e.preventDefault(); mut.mutate(); }}
          className="space-y-3"
        >
          <input type="text" name="username" autoComplete="username" className="hidden" tabIndex={-1} aria-hidden />
          <input type="password" name="password" autoComplete="current-password" className="hidden" tabIndex={-1} aria-hidden />
          <Field label="שם מלא" value={full_name} onChange={setFullName} required autoComplete="off" name="po-full-name" />
          <Field label='דוא"ל' type="email" value={email} onChange={setEmail} required autoComplete="off" name="po-email" />
          <Field label="סיסמה (מינ' 8 תווים)" type="password" value={password} onChange={setPassword} required autoComplete="new-password" name="po-password" />
          <Field label="טלפון" value={phone} onChange={setPhone} autoComplete="off" name="po-phone" />
          <Field label="ת.ז" value={id_number} onChange={setIdNumber} autoComplete="off" name="po-id-number" />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>ביטול</Button>
            <Button
              type="submit"
              disabled={mut.isPending || full_name.trim().length < 2 || !email || password.length < 8}
              className="gap-2"
            >
              {mut.isPending && <Loader2 className="size-4 animate-spin" />}
              צור
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// -------------------- Edit profile --------------------

export function PlatformOwnerEditDialog({
  open,
  onOpenChange,
  owner,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  owner: PlatformOwnerRow;
}) {
  const invalidate = useInvalidatePlatform();
  const updateFn = useServerFn(updatePlatformOwnerProfile);
  const [full_name, setFullName] = useState(owner.full_name);
  const [phone, setPhone] = useState(owner.phone ?? "");
  const [id_number, setIdNumber] = useState(owner.id_number ?? "");

  const mut = useMutation({
    mutationFn: () =>
      updateFn({
        data: {
          user_id: owner.user_id,
          full_name: full_name.trim(),
          phone: phone.trim() || null,
          id_number: id_number.trim() || null,
        },
      }),
    onSuccess: () => {
      toast.success("הפרופיל עודכן");
      invalidate();
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message ?? "עדכון נכשל"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>עריכת פרופיל בעל מערכת</DialogTitle>
          <DialogDescription>עדכון פרטי זהות של בעל המערכת</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Field label="שם מלא" value={full_name} onChange={setFullName} required />
          <div className="space-y-1">
            <Label>דוא"ל</Label>
            <Input value={owner.email ?? ""} disabled readOnly dir="ltr" />
            <p className="text-[11px] text-muted-foreground flex items-center gap-1">
              <Info className="size-3" />
              שינוי דוא"ל הוא יכולת עתידית — יתווסף בגרסה הבאה של ניהול הפלטפורמה.
            </p>
          </div>
          <Field label="טלפון" value={phone} onChange={setPhone} />
          <Field label="ת.ז" value={id_number} onChange={setIdNumber} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>ביטול</Button>
          <Button
            onClick={() => mut.mutate()}
            disabled={mut.isPending || full_name.trim().length < 2}
            className="gap-2"
          >
            {mut.isPending && <Loader2 className="size-4 animate-spin" />}
            שמור
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// -------------------- Delete --------------------

export function PlatformOwnerDeleteDialog({
  open,
  onOpenChange,
  owner,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  owner: PlatformOwnerRow;
}) {
  const invalidate = useInvalidatePlatform();
  const deleteFn = useServerFn(deletePlatformOwner);
  const [confirm, setConfirm] = useState("");

  const mut = useMutation({
    mutationFn: () => deleteFn({ data: { user_id: owner.user_id } }),
    onSuccess: () => {
      toast.success("בעל המערכת נמחק");
      invalidate();
      onOpenChange(false);
      setConfirm("");
    },
    onError: (e: Error) => toast.error(e.message ?? "מחיקה נכשלה"),
  });

  const canConfirm = !!owner.email && confirm.trim().toLowerCase() === owner.email.toLowerCase();

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) setConfirm(""); onOpenChange(v); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>מחיקת בעל מערכת</DialogTitle>
          <DialogDescription>פעולה זו בלתי הפיכה</DialogDescription>
        </DialogHeader>
        <Alert variant="destructive">
          <AlertTriangle className="size-4" />
          <AlertTitle>אזהרה</AlertTitle>
          <AlertDescription>
            המחיקה תסיר את חשבון בעל המערכת מהמערכת לצמיתות. לא ניתן למחוק את בעל המערכת הראשי.
          </AlertDescription>
        </Alert>
        <div className="space-y-2">
          <p className="text-sm">
            לאישור, הקלד את כתובת הדוא"ל של בעל המערכת:{" "}
            <span className="font-mono" dir="ltr">{owner.email}</span>
          </p>
          <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} dir="ltr" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>ביטול</Button>
          <Button
            variant="destructive"
            disabled={!canConfirm || mut.isPending}
            onClick={() => mut.mutate()}
            className="gap-2"
          >
            {mut.isPending && <Loader2 className="size-4 animate-spin" />}
            מחק לצמיתות
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// -------------------- Transfer Primary Ownership --------------------

export function PlatformOwnerTransferDialog({
  open,
  onOpenChange,
  owners,
  currentPrimary,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  owners: PlatformOwnerRow[];
  currentPrimary: PlatformOwnerRow | null;
}) {
  const invalidate = useInvalidatePlatform();
  const transferFn = useServerFn(transferPrimaryOwnership);
  const [targetId, setTargetId] = useState<string>("");
  const [confirm, setConfirm] = useState("");

  const eligible = owners.filter((o) => o.level !== "primary" && o.is_active);
  const target = eligible.find((o) => o.user_id === targetId) ?? null;
  const canConfirm =
    !!target && !!target.email && confirm.trim().toLowerCase() === target.email.toLowerCase();

  const mut = useMutation({
    mutationFn: () => transferFn({ data: { user_id: targetId } }),
    onSuccess: () => {
      toast.success("הבעלות הראשית הועברה");
      invalidate();
      onOpenChange(false);
      setTargetId(""); setConfirm("");
    },
    onError: (e: Error) => toast.error(e.message ?? "העברה נכשלה"),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) { setTargetId(""); setConfirm(""); }
        onOpenChange(v);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Crown className="size-5 text-amber-500" />
            העברת בעלות ראשית
          </DialogTitle>
          <DialogDescription>
            העברת תפקיד "בעל המערכת הראשי" לבעל מערכת אחר
          </DialogDescription>
        </DialogHeader>
        <Alert variant="destructive">
          <AlertTriangle className="size-4" />
          <AlertTitle>פעולה בלתי הפיכה</AlertTitle>
          <AlertDescription>
            לאחר האישור, {currentPrimary?.full_name ?? "בעל המערכת הראשי הנוכחי"} יהפוך לבעל מערכת רגיל, ובעל המערכת שנבחר יהפוך לבעל המערכת הראשי בעל הסמכות המלאה בפלטפורמה.
          </AlertDescription>
        </Alert>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label>יעד ההעברה</Label>
            <Select value={targetId} onValueChange={(v) => { setTargetId(v); setConfirm(""); }}>
              <SelectTrigger><SelectValue placeholder="בחר בעל מערכת" /></SelectTrigger>
              <SelectContent>
                {eligible.length === 0 ? (
                  <div className="p-3 text-sm text-muted-foreground text-center">
                    אין בעלי מערכת פעילים נוספים
                  </div>
                ) : eligible.map((o) => (
                  <SelectItem key={o.user_id} value={o.user_id}>
                    {o.full_name}{o.email ? ` · ${o.email}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {target && (
            <div className="space-y-2 rounded-lg border p-3 bg-muted/30">
              <p className="text-sm">
                תוצאה: <span className="font-medium">{target.full_name}</span> יקבל בעלות ראשית.
                אתה תיהפך לבעל מערכת רגיל.
              </p>
              <div className="space-y-1">
                <Label className="text-xs">לאישור, הקלד את הדוא"ל של היעד:</Label>
                <p className="text-xs font-mono text-muted-foreground" dir="ltr">{target.email}</p>
                <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} dir="ltr" />
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>ביטול</Button>
          <Button
            variant="destructive"
            disabled={!canConfirm || mut.isPending}
            onClick={() => mut.mutate()}
            className="gap-2"
          >
            {mut.isPending && <Loader2 className="size-4 animate-spin" />}
            אשר והעבר בעלות
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// -------------------- Small helpers --------------------

function Field({
  label, value, onChange, type = "text", required, autoComplete, name,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  autoComplete?: string;
  name?: string;
}) {
  return (
    <div className="space-y-1">
      <Label>{label}{required ? " *" : ""}</Label>
      <Input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        name={name}
      />
    </div>
  );
}
