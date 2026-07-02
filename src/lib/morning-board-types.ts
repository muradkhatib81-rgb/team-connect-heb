export type MorningBoardItemType = "image" | "video" | "announcement";

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
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export const MORNING_BOARD_BUCKET = "morning-board";
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const VIDEO_MAX_BYTES = 100 * 1024 * 1024;
export const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp";
export const VIDEO_ACCEPT = "video/mp4,video/webm";
