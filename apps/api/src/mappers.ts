import type { BookSummaryDto } from '@mirabelu/contracts';

interface BookRow {
  id: string;
  slug: string;
  title: string;
  language: string;
  durationSec: number;
  coverUrl: string | null;
  author: { id: string; slug: string; name: string };
  category: { id: string; slug: string; name: string };
  essentials: { published: boolean } | null;
}

export const bookInclude = {
  author: true,
  category: true,
  essentials: { select: { published: true } },
} as const;

export function toBookSummary(b: BookRow): BookSummaryDto {
  return {
    id: b.id,
    slug: b.slug,
    title: b.title,
    author: { id: b.author.id, slug: b.author.slug, name: b.author.name },
    category: { id: b.category.id, slug: b.category.slug, name: b.category.name },
    language: b.language,
    durationSec: b.durationSec,
    coverUrl: b.coverUrl,
    hasEssentials: b.essentials?.published ?? false,
  };
}

export { slugify } from '@mirabelu/contracts';
