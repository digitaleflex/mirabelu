export type PlanCode = 'QUARTERLY' | 'ANNUAL';

export interface Plan {
  code: PlanCode;
  label: string;
  priceXof: number;
  durationMonths: number;
}

export const PLANS: Record<PlanCode, Plan> = {
  QUARTERLY: { code: 'QUARTERLY', label: 'Trimestrielle', priceXof: 7500, durationMonths: 3 },
  ANNUAL: { code: 'ANNUAL', label: 'Annuelle', priceXof: 25000, durationMonths: 12 },
};

export function getPlan(code: PlanCode): Plan {
  return PLANS[code];
}

/** Ajoute des mois calendaires sans déborder (31 janvier + 1 mois = 28/29 février). */
export function addMonths(date: Date, months: number): Date {
  const d = new Date(date.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}
