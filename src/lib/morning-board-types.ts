import i18n from "@/i18n";
export type MorningBoardItemType =
  | "image"
  | "video"
  | "audio"
  | "announcement"
  | "highlight";

export type MorningBoardPriority = "normal" | "important" | "urgent" | "critical";

export type MorningBoardFontSize = "sm" | "md" | "lg" | "xl";
export type MorningBoardFontWeight = "regular" | "bold";
export type MorningBoardAlign = "right" | "center";
export type MorningBoardAttention = "none" | "glow" | "pulse-title" | "icon";
export type MorningBoardIcon = "none" | "🚨" | "⚠️" | "📢" | "ℹ️";

export interface MorningBoardStyle {
  borderColor?: string;
  backgroundColor?: string;
  titleColor?: string;
  textColor?: string;
  borderWidth?: 1 | 2 | 3 | 4;
  radius?: "sm" | "md" | "lg" | "xl";
  fontSize?: MorningBoardFontSize;
  fontWeight?: MorningBoardFontWeight;
  align?: MorningBoardAlign;
  attention?: MorningBoardAttention;
  icon?: MorningBoardIcon;
}

export interface MorningBoardItem {
  id: string;
  branch_id: string;
  item_type: MorningBoardItemType;
  title: string | null;
  description: string | null;
  storage_path: string | null;
  mime_type: string | null;
  file_size: number | null;
  starts_at: string | null;
  expires_at: string | null;
  display_order: number;
  is_pinned: boolean;
  priority: MorningBoardPriority;
  style: MorningBoardStyle;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export const MORNING_BOARD_BUCKET = "morning-board";
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const VIDEO_MAX_BYTES = 100 * 1024 * 1024;
export const AUDIO_MAX_BYTES = 50 * 1024 * 1024;
export const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp";
export const VIDEO_ACCEPT = "video/mp4,video/webm";
export const AUDIO_ACCEPT = "audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a,audio/ogg,audio/webm";

export const DEFAULT_HIGHLIGHT_STYLE: MorningBoardStyle = {
  borderColor: "#dc2626",
  backgroundColor: "#fef2f2",
  titleColor: "#991b1b",
  textColor: "#450a0a",
  borderWidth: 2,
  radius: "lg",
  fontSize: "lg",
  fontWeight: "bold",
  align: "right",
  attention: "pulse-title",
  icon: "🚨",
};

export const TYPE_LABEL: Record<MorningBoardItemType, string> = {
  image: "🖼 תמונה",
  video: "🎥 סרטון",
  audio: "🔊 שמע",
  announcement: "📢 הודעה",
  highlight: "🚨 הודעה מודגשת",
};

export const PRIORITY_LABEL: Record<MorningBoardPriority, string> = {
  normal: "רגיל",
  important: "חשוב",
  urgent: "דחוף",
  critical: "קריטי",
};

export const FONT_SIZE_CLASS: Record<MorningBoardFontSize, string> = {
  sm: "text-sm",
  md: "text-base",
  lg: "text-lg",
  xl: "text-2xl",
};

export const RADIUS_CLASS: Record<NonNullable<MorningBoardStyle["radius"]>, string> = {
  sm: "rounded-md",
  md: "rounded-lg",
  lg: "rounded-xl",
  xl: "rounded-2xl",
};

export const PRIORITY_BADGE_CLASS: Record<MorningBoardPriority, string> = {
  normal: "bg-muted text-muted-foreground",
  important: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100",
  urgent: "bg-orange-100 text-orange-900 dark:bg-orange-900/40 dark:text-orange-100",
  critical: "bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-100",
};


const MORNING_BOARD_TYPE_I18N: Record<MorningBoardItemType, string> = {
  image: "libErrors.morningBoard.typeImage",
  video: "libErrors.morningBoard.typeVideo",
  audio: "libErrors.morningBoard.typeAudio",
  announcement: "libErrors.morningBoard.typeAnnouncement",
  highlight: "libErrors.morningBoard.typeHighlight",
};

const MORNING_BOARD_PRIORITY_I18N: Record<MorningBoardPriority, string> = {
  normal: "libErrors.morningBoard.priorityNormal",
  important: "libErrors.morningBoard.priorityImportant",
  urgent: "libErrors.morningBoard.priorityUrgent",
  critical: "libErrors.morningBoard.priorityCritical",
};

export function getMorningBoardTypeLabel(type: MorningBoardItemType): string {
  const key = MORNING_BOARD_TYPE_I18N[type];
  return key ? i18n.t(key) : type;
}

export function getMorningBoardPriorityLabel(priority: MorningBoardPriority): string {
  const key = MORNING_BOARD_PRIORITY_I18N[priority];
  return key ? i18n.t(key) : priority;
}
