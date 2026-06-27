import { supabase } from "@/integrations/supabase/client";

// ---------------- Types ----------------
export type CommPriority = "low" | "normal" | "high" | "urgent";
export type CommTargetType = "user" | "department" | "all";

export interface MessageTargetsInput {
  users?: string[];
  departments?: string[];
  all?: boolean;
}

export interface SendMessageInput {
  title: string;
  body: string;
  priority: CommPriority;
  requires_acknowledgment: boolean;
  targets: MessageTargetsInput;
  file?: File | null;
}

export interface CreateAnnouncementInput {
  title: string;
  body: string;
  priority: CommPriority;
  image_url?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  targets: MessageTargetsInput;
  file?: File | null;
}

// ---------------- Helpers ----------------
async function resolveTargetUserIds(
  targets: MessageTargetsInput,
  excludeUserId?: string | null,
): Promise<string[]> {
  const ids = new Set<string>();
  if (targets.all) {
    const { data, error } = await supabase
      .from("profiles")
      .select("id")
      .eq("is_active", true);
    if (error) throw error;
    (data ?? []).forEach((r: any) => ids.add(r.id));
  }
  if (targets.departments?.length) {
    const { data, error } = await supabase
      .from("profiles")
      .select("id")
      .in("department_id", targets.departments)
      .eq("is_active", true);
    if (error) throw error;
    (data ?? []).forEach((r: any) => ids.add(r.id));
  }
  (targets.users ?? []).forEach((u) => ids.add(u));
  if (excludeUserId) ids.delete(excludeUserId);
  return [...ids];
}

async function uploadAttachment(
  file: File,
  userId: string,
): Promise<{ path: string; name: string; size: number; mime: string }> {
  const safeName = file.name.replace(/[^\w.\-]+/g, "_");
  const path = `${userId}/${Date.now()}_${safeName}`;
  const { error } = await supabase.storage
    .from("communications")
    .upload(path, file, { upsert: false, contentType: file.type || undefined });
  if (error) throw error;
  return { path, name: file.name, size: file.size, mime: file.type || "application/octet-stream" };
}

export async function getAttachmentUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from("communications")
    .createSignedUrl(path, 60 * 10);
  if (error) return null;
  return data?.signedUrl ?? null;
}

async function logAudit(
  entity_type: "message" | "announcement",
  entity_id: string,
  action: "created" | "edited" | "deleted" | "sent" | "read" | "acknowledged" | "restored",
  payload?: any,
) {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return;
  await supabase.from("communications_audit_log").insert({
    actor_id: u.user.id,
    entity_type,
    entity_id,
    action,
    payload: payload ?? null,
  });
}

// ---------------- Send / Create ----------------
export async function sendMessage(input: SendMessageInput) {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("לא מחובר");
  const senderId = u.user.id;

  const recipientIds = await resolveTargetUserIds(input.targets);
  if (recipientIds.length === 0) throw new Error("בחר לפחות נמען אחד");

  const { data: msg, error: msgErr } = await supabase
    .from("messages")
    .insert({
      title: input.title.trim(),
      body: input.body.trim(),
      priority: input.priority,
      sender_id: senderId,
      requires_acknowledgment: input.requires_acknowledgment,
    })
    .select("id")
    .single();
  if (msgErr) throw msgErr;
  const messageId = msg.id;

  // Targets metadata (for display)
  const tgtRows: any[] = [];
  if (input.targets.all) tgtRows.push({ message_id: messageId, target_type: "all" });
  (input.targets.departments ?? []).forEach((d) =>
    tgtRows.push({ message_id: messageId, target_type: "department", target_id: d }),
  );
  (input.targets.users ?? []).forEach((uId) =>
    tgtRows.push({ message_id: messageId, target_type: "user", target_id: uId }),
  );
  if (tgtRows.length) {
    const { error } = await supabase.from("message_targets").insert(tgtRows);
    if (error) throw error;
  }

  // Expanded recipients
  const recipRows = recipientIds.map((uid) => ({
    message_id: messageId,
    user_id: uid,
    delivered_at: new Date().toISOString(),
  }));
  const { error: recErr } = await supabase.from("message_recipients").insert(recipRows);
  if (recErr) throw recErr;

  // Optional attachment
  if (input.file) {
    const up = await uploadAttachment(input.file, senderId);
    await supabase.from("message_attachments").insert({
      message_id: messageId,
      file_name: up.name,
      storage_path: up.path,
      mime_type: up.mime,
      file_size: up.size,
    });
  }

  await logAudit("message", messageId, "sent", { recipients: recipientIds.length });
  return { id: messageId };
}

export async function createAnnouncement(input: CreateAnnouncementInput) {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("לא מחובר");
  const senderId = u.user.id;

  const { data: ann, error } = await supabase
    .from("announcements")
    .insert({
      title: input.title.trim(),
      body: input.body.trim(),
      priority: input.priority,
      image_url: input.image_url ?? null,
      starts_at: input.starts_at ?? new Date().toISOString(),
      ends_at: input.ends_at ?? null,
      sender_id: senderId,
    })
    .select("id")
    .single();
  if (error) throw error;
  const annId = ann.id;

  const tgtRows: any[] = [];
  if (input.targets.all) tgtRows.push({ announcement_id: annId, target_type: "all" });
  (input.targets.departments ?? []).forEach((d) =>
    tgtRows.push({ announcement_id: annId, target_type: "department", target_id: d }),
  );
  (input.targets.users ?? []).forEach((uid) =>
    tgtRows.push({ announcement_id: annId, target_type: "user", target_id: uid }),
  );
  if (!tgtRows.length) tgtRows.push({ announcement_id: annId, target_type: "all" });
  const { error: tErr } = await supabase.from("announcement_targets").insert(tgtRows);
  if (tErr) throw tErr;

  if (input.file) {
    const up = await uploadAttachment(input.file, senderId);
    await supabase.from("announcement_attachments").insert({
      announcement_id: annId,
      file_name: up.name,
      storage_path: up.path,
      mime_type: up.mime,
      file_size: up.size,
    });
  }

  await logAudit("announcement", annId, "created");
  return { id: annId };
}

// ---------------- Read / Ack / Archive ----------------
export async function markMessageRead(messageId: string) {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return;
  const { error } = await supabase
    .from("message_recipients")
    .update({ read_at: new Date().toISOString() })
    .eq("message_id", messageId)
    .eq("user_id", u.user.id)
    .is("read_at", null);
  if (!error) await logAudit("message", messageId, "read");
}

export async function markMessageUnread(messageId: string) {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return;
  await supabase
    .from("message_recipients")
    .update({ read_at: null, acknowledged_at: null })
    .eq("message_id", messageId)
    .eq("user_id", u.user.id);
}

export async function acknowledgeMessage(messageId: string) {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return;
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("message_recipients")
    .update({ acknowledged_at: now, read_at: now })
    .eq("message_id", messageId)
    .eq("user_id", u.user.id);
  if (error) throw error;
  await logAudit("message", messageId, "acknowledged");
}

export async function archiveMessage(messageId: string, archived = true) {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return;
  await supabase
    .from("message_recipients")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("message_id", messageId)
    .eq("user_id", u.user.id);
}

export async function deleteMessage(messageId: string) {
  const { error } = await supabase
    .from("messages")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", messageId);
  if (error) throw error;
  await logAudit("message", messageId, "deleted");
}

export async function restoreMessage(messageId: string) {
  const { error } = await supabase
    .from("messages")
    .update({ deleted_at: null })
    .eq("id", messageId);
  if (error) throw error;
  await logAudit("message", messageId, "restored");
}

export async function markAnnouncementRead(annId: string) {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return;
  const { error } = await supabase
    .from("announcement_reads")
    .upsert(
      { announcement_id: annId, user_id: u.user.id, read_at: new Date().toISOString() },
      { onConflict: "announcement_id,user_id", ignoreDuplicates: false },
    );
  if (!error) await logAudit("announcement", annId, "read");
}

export async function deleteAnnouncement(annId: string) {
  const { error } = await supabase
    .from("announcements")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", annId);
  if (error) throw error;
  await logAudit("announcement", annId, "deleted");
}

export async function restoreAnnouncement(annId: string) {
  const { error } = await supabase
    .from("announcements")
    .update({ deleted_at: null })
    .eq("id", annId);
  if (error) throw error;
  await logAudit("announcement", annId, "restored");
}
