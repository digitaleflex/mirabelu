import type { Db } from './client.js';

export const DEFAULT_CATEGORIES = [
  { slug: 'business-entrepreneuriat', name: 'Business & Entrepreneuriat' },
  { slug: 'finances-personnelles', name: 'Finances personnelles' },
  { slug: 'developpement-personnel', name: 'Développement personnel' },
  { slug: 'leadership-management', name: 'Leadership & Management' },
  { slug: 'productivite', name: 'Productivité' },
  { slug: 'communication', name: 'Communication' },
  { slug: 'sante-bien-etre', name: 'Santé & Bien-être' },
  { slug: 'histoire-societe', name: 'Histoire & Société' },
] as const;

/** Idempotent : crée les catégories manquantes sans toucher aux existantes. */
export async function seedCatalogBase(db: Db): Promise<void> {
  for (const [position, c] of DEFAULT_CATEGORIES.entries()) {
    await db.category.upsert({
      where: { slug: c.slug },
      create: { ...c, position },
      update: {},
    });
  }
}
