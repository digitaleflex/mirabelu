/** Indicatifs pris en charge pour compléter un numéro saisi sans « + » (Afrique de l'Ouest et centrale). */
export const CALLING_CODES: Record<string, string> = {
  BJ: '229', TG: '228', CI: '225', SN: '221', BF: '226', ML: '223', NE: '227', GN: '224',
  GH: '233', NG: '234', CM: '237', GA: '241', CG: '242', CD: '243', TD: '235', MA: '212',
  DZ: '213', TN: '216', FR: '33', BE: '32', CH: '41', CA: '1', US: '1',
};

/** Pays dont le « 0 » initial fait partie du numéro national (Bénin depuis 2024, Côte d'Ivoire depuis 2021). */
const KEEP_LEADING_ZERO = new Set(['BJ', 'CI']);

/** Pays déduit d'un numéro E.164 (plus long préfixe d'abord). Les indicatifs partagés (+1) renvoient le premier pays déclaré. */
export function countryOfPhone(e164: string): string | null {
  const digits = e164.replace(/^\+/, '');
  const entries = Object.entries(CALLING_CODES).sort((a, b) => b[1].length - a[1].length);
  for (const [country, code] of entries) {
    if (digits.startsWith(code)) return country;
  }
  return null;
}

/**
 * Normalise un numéro en E.164. Retourne null si invalide.
 * Bénin : depuis 2024 les numéros ont 10 chiffres (préfixe 01) ; les anciens numéros à 8 chiffres sont
 * convertis automatiquement.
 */
export function normalizePhone(input: string, defaultCountry = 'BJ'): string | null {
  let s = input.trim().replace(/[\s().-]/g, '');
  if (!/^\+?\d+$/.test(s)) return null;

  if (s.startsWith('+')) {
    s = s.slice(1);
  } else if (s.startsWith('00')) {
    s = s.slice(2);
  } else {
    const code = CALLING_CODES[defaultCountry.toUpperCase()];
    if (!code) return null;
    if (defaultCountry.toUpperCase() === 'BJ') {
      if (s.length === 8) s = `01${s}`;
    } else if (s.startsWith('0') && !KEEP_LEADING_ZERO.has(defaultCountry.toUpperCase())) {
      s = s.slice(1);
    }
    s = `${code}${s}`;
  }

  // Bénin : +229 suivi de 10 chiffres commençant par 01 (ou 8 chiffres hérités).
  if (s.startsWith('229')) {
    let rest = s.slice(3);
    if (rest.length === 8) rest = `01${rest}`;
    if (!/^01\d{8}$/.test(rest)) return null;
    s = `229${rest}`;
  }
  if (s.length < 8 || s.length > 15 || s.startsWith('0')) return null;
  return `+${s}`;
}
