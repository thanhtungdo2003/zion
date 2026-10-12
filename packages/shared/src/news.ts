import { z } from 'zod';

export const NEWS_CATEGORIES = { update: 'Cập nhật', event: 'Sự kiện', notice: 'Thông báo' } as const;
export const newsContentSchema = z.object({
  title: z.string().trim().min(3, 'Tiêu đề cần ít nhất 3 ký tự.').max(160),
  version: z.string().trim().max(40).default(''),
  summary: z.string().trim().min(3, 'Hãy viết phần giới thiệu ngắn.').max(400),
  body: z.string().trim().min(10, 'Nội dung cần ít nhất 10 ký tự.').max(30_000),
  category: z.enum(['update', 'event', 'notice']),
  pinned: z.boolean(),
}).strict();
export type NewsContent = z.infer<typeof newsContentSchema>;

const identity = { id: z.string().uuid(), revision: z.number().int().min(1) };
export const newsActionSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('save'), id: identity.id, revision: z.number().int().min(0), content: newsContentSchema }).strict(),
  z.object({ op: z.literal('publish'), ...identity }).strict(),
  z.object({ op: z.literal('unpublish'), ...identity }).strict(),
  z.object({ op: z.literal('delete'), ...identity }).strict(),
]);
export type NewsAction = z.infer<typeof newsActionSchema>;
export interface NewsPost extends NewsContent { id: string; revision: number; publishedAt: string }
export interface NewsDraft {
  id: string;
  revision: number;
  content: NewsContent;
  published: NewsPost | null;
  updatedAt: string;
}
export type NewsReadState = Record<string, number>;
export function isNewsUnread(post: Pick<NewsPost, 'id' | 'revision'>, read: NewsReadState): boolean {
  return (read[post.id] ?? 0) < post.revision;
}
export function sortNews(posts: NewsPost[]): NewsPost[] {
  return [...posts].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.publishedAt.localeCompare(a.publishedAt) || a.id.localeCompare(b.id));
}
