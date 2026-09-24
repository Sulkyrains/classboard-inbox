export const categories = ['作业', '活动', '事务', '课程'] as const;
export type Category = typeof categories[number];
export type NoticeStatus = 'pending' | 'published' | 'rejected' | 'archived';
export interface NoticeInput {
  title: string; body: string; category: Category; location: string; audience: string;
  event_at: string | null; deadline_at: string | null; pinned: boolean;
}
export interface Notice extends NoticeInput {
  id: string; status: NoticeStatus; source: 'manual' | 'text' | 'ocr' | 'llm';
  author_name: string; author_position?: string | null; created_at: string; updated_at: string; published_at: string | null;
  version: number; source_text?: string; warnings?: string[]; reviewed_at?: string | null;
}
export interface Admin { id: string; student_id: string; display_name: string; role: 'committee'|'student'; position?: string | null; must_change_password: boolean }
export interface Draft extends NoticeInput { source_text: string; warnings: string[] }
export const emptyNotice = (): NoticeInput => ({ title: '', body: '', category: '事务', location: '', audience: '', event_at: null, deadline_at: null, pinned: false });
