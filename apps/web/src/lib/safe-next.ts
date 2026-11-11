/** N'accepte qu'un chemin interne (évite les redirections ouvertes après connexion). */
export function safeNext(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/';
  return value;
}
