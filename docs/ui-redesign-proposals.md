# Refonte UI — Propositions pour Mirabelu

> Document de proposition (pas d'implémentation). Cible : `apps/web` (Next.js 16 PWA).
> Auteur : audit + propositions inspirées de l'existant et des bonnes pratiques mobile-first.

---

## 1. Audit rapide de l'UI actuelle

### Forces
- Identité de marque déjà forte : palette prune/mirabelle (`--mirabelle #f2b33d`, `--ink #1f1633`), serif pour les titres, sans-serif pour le corps.
- Mobile-first réel : tabbar bas, safe areas, mini-lecteur fixe, PWA.
- Accessibilité présente : skip-link, focus-visible, aria-current, aria-pressed.
- Concept différenciant : la « mirabelle » qui se remplit d'or pendant l'écoute.
- Couvertures de remplacement déterministes (initiale + couleur) : pas d'image cassée.

### Faiblesses
- **Hiérarchie visuelle plate** : tout est empilé en `.page` avec `gap: 28px`, peu de contrastes de taille/poids.
- **Couvertures trop petites** : tuiles 148 px, rangées 64 px ; l'audio est un média visuel, les covers devraient dominer.
- **Accueil peu personnalisé** : « Reprendre » n'apparaît qu'en rangées ; pas de hero livre, pas de recommandations.
- **Explorer** : recherche débounced OK mais pas de suggestions, pas de filtres avancés, pagination classique peu tactile.
- **Bibliothèque** : onglets texte, pas de vue grille, pas de tri.
- **Détail livre** : hero à 2 colonnes seulement ≥ 640 px ; sur mobile la cover fait `min(58vw, 240px)` — correct mais sans parallaxe/gradient.
- **Player plein écran** : beau mais dense (vitesses + sleep en bas), pas de chapitres cliquables, pas de cover en fond flou.
- **Mini-lecteur** : 64 px, titre tronqué, pas de progression visible au-delà de la barre 3 px ; pas de geste swipe.
- **Compte / Abonnement** : fonctionnels mais visuellement plats ; tableau de paiements brut ; pas de carte « statut abonnement ».
- **Admin** : tableau HTML brut, pas de graphiques, pas de navigation latérale dédiée.
- **États** : `Loading` = simple texte ; pas de skeleton ; `Empty` générique.
- **Typographie** : échelle limitée (h1 1.9rem, h2 1.3rem) ; pas de display size pour hero.
- **Pas de mode sombre travaillé** : les tokens dark existent mais les surfaces restent plates.
- **Pas d'illustration/motion d'entrée** au-delà de `.ripen` sur le titre d'accueil.

---

## 2. Principes transversaux (toutes directions)

1. **Mobile-first, pouce unique** : actions primaires en bas, zones tactiles ≥ 48 px, pas de hover-only.
2. **Covers d'abord** : ratio 1:1, ombres douces, rayon 16–20 px, lazy + blur placeholder.
3. **Une action principale par écran** : CTA primaire mirabelle, secondaires contour.
4. **États riches** : skeletons, empty states illustrés, erreurs inline avec retry.
5. **Motion sobre** : transitions 150–250 ms, respect `prefers-reduced-motion`, pas d'animation gratuite.
6. **Accessibilité** : contraste AA, focus visible, lecteur d'écran, safe areas.
7. **Performance** : images Next/Image, code-splitting, pas de librairie UI lourde.

---

## 3. Direction A — « Mirabelle Éditoriale » (évolution maîtrisée)

**Vibe** : magazine culturel africain, chaleureux, éditorial. On garde la palette mais on la structure.

### Tokens
```css
--radius: 18px;
--radius-sm: 10px;
--shadow-sm: 0 2px 8px rgba(31,22,51,.08);
--shadow-md: 0 8px 24px rgba(31,22,51,.12);
--shadow-lg: 0 20px 48px rgba(31,22,51,.18);
--display: 2.4rem;   /* hero */
--space-1..6: 4/8/12/16/24/32;
```
Typo : h1 display 2.2rem, h2 1.5rem, body 1rem. Ajout d'une police display optionnelle (ex. "Fraunces" ou "Playfair Display") pour les titres d'accueil uniquement, fallback serif.

### Accueil
- Hero pleine largeur avec cover du livre « à la une » en grand (280 px), titre display, CTA « Écouter » + « En savoir plus ».
- Section « Reprendre » en cartes horizontales avec progression circulaire (anneau) et temps restant.
- Carrousels horizontaux avec snap, flèches sur desktop, peek du suivant.
- Bandeau « Nouveautés » avec badge « Nouveau ».
- Footer léger.

### Explorer
- Barre de recherche sticky avec icône et bouton clear ; suggestions récentes.
- Filtres en chips horizontaux + filtre avancé (durée, tri) dans un bottom sheet.
- Résultats en grille 2 colonnes (mobile) / 4 (desktop) de covers avec titre + auteur sous.
- Pagination → bouton « Charger plus » (infinite scroll) avec skeleton.
- État vide illustré.

### Bibliothèque
- Onglets sous forme de segmented control.
- Vue liste par défaut avec cover 72 px + progression ; toggle grille.
- Tri (récents, alphabétique, progression).
- Section « Terminés » avec badge check.

### Détail livre
- Hero : cover 200–240 px avec ombre + dégradé de fond extrait de la cover (approximation via couleur de palette).
- Métadonnées en chips (auteur, catégorie, durée).
- CTA sticky en bas sur mobile (barre d'action) pour « Écouter ».
- Tabs avec underline animé ; contenu « Comprendre/Appliquer » en prose large avec titres.
- Chapitres : liste avec durée, bouton play au survol, chapitre courant surligné.

### Player
- Mini-lecteur : 72 px, cover 52 px, titre + auteur, boutons 44 px, barre de progression 4 px en haut avec pourcentage au tap.
- Plein écran : cover en grand (mirabelle) centrée, fond dégradé sombre, contrôles circulaires, vitesse/sleep dans un bottom sheet « ⋯ ».
- Chapitres : liste déroulante accessible depuis le player.
- Gestes : swipe down pour réduire, swipe horizontal pour skip ±15/30.

### Abonnement
- Cartes de plan avec prix gros, badge « Meilleur prix », comparaison mensuelle.
- Moyens de paiement en cartes radio avec logos (MTN/Moov/Celtiis) si dispo.
- Récapitulatif sticky « Total » en bas.
- Écran succès avec confetti léger (CSS) + CTA.

### Compte
- Carte de statut abonnement (anneau de progression jusqu'à expiration, date).
- Formulaire prénom en carte.
- Historique paiements en cartes plutôt que tableau ; statut coloré.
- Boutons en liste (admin, déconnexion) avec chevrons.

### Admin
- Sidebar dédiée (desktop) / bottom tabs (mobile).
- Cartes KPI avec icônes et tendance (↑/↓).
- Tableaux avec tri, recherche, pagination ; actions en menu ⋯.
- Formulaires en sections avec validation inline.

### Pros / Cons
- ✅ Faible risque, conserve la marque, migration incrémentale.
- ❌ Moins spectaculaire ; peut sembler « juste un polish ».

### Effort : M (2–3 semaines).

---

## 4. Direction B — « Nuit & Or » (immersive, dark-first)

**Vibe** : Spotify/Apple Music pour l'audio, cinématique, écoute nocturne. Dark-first, covers géantes, glow.

### Tokens
```css
:root { --bg: #0e0a1a; --surface: #1a1430; --surface-2: #241b3d; --ink: #f3f0fa; --muted: #9a90b8; --gold: #f2b33d; --gold-glow: rgba(242,179,61,.25); }
```
Light mode optionnel (inversé). Typo : sans-serif géométrique (Inter/Manrope) pour tout, titres en weight 800.

### Accueil
- Fond sombre, hero avec cover 320 px + glow gold derrière, titre très gros, CTA pill gold.
- Carrousels de covers avec ombre portée et effet de profondeur (scale au centre).
- Section « Continuer » avec barre de progression gold sur cover.

### Explorer
- Recherche en pleine largeur avec fond surface-2, suggestions en overlay.
- Grille de covers sans texte sous (hover/tap révèle titre) — plus immersif.
- Filtres en bottom sheet avec sliders.

### Bibliothèque
- Onglets en pill gold actif.
- Cover 80 px + progression circulaire gold.

### Détail livre
- Cover plein écran en haut avec gradient vers le bas, titre superposé.
- CTA flottant gold.
- Contenu sur surface sombre.

### Player
- Plein écran : cover 300 px avec glow, fond dégradé animé subtil (mirabelle qui pulse).
- Contrôles minimalistes, vitesse dans menu.
- Mini-lecteur : fond surface-2, cover 48 px, play gold.

### Abonnement / Compte / Admin
- Cartes sombres avec bordures subtiles, gold pour les prix.
- Admin : dashboard sombre avec graphiques (recharts) optionnels.

### Pros / Cons
- ✅ Très premium, différenciant, parfait pour l'audio nocturne.
- ❌ Risque de fatigue visuelle en plein jour ; accessibilité contraste à surveiller ; gros changement de marque.

### Effort : L (4–6 semaines) + tests contraste.

---

## 5. Direction C — « Papier & Encre » (littéraire, clair)

**Vibe** : livre papier, éditorial littéraire, chaud et calme. Pour une audience qui lit les résumés « Comprendre/Appliquer ».

### Tokens
```css
--bg: #faf6ef; --paper: #ffffff; --ink: #2a2218; --muted: #6b5f4f;
--accent: #8b4a2f; --gold: #c98a12; --serif: 'Fraunces', Georgia, serif; --sans: 'Inter', system-ui;
```
Beaucoup de blanc, grilles asymétriques, marges larges (max-width 680 px pour la prose).

### Accueil
- Titre serif très grand, sous-titre, CTA discret (lien souligné + bouton contour).
- Couvertures en 3:4 (portrait livre) plutôt que 1:1.
- Sections avec titres en petites caps.

### Explorer
- Liste verticale de livres (comme une table des matières) : cover 96 px à gauche, titre/auteur/durée à droite.
- Recherche minimaliste, ligne sous l'input.
- Filtres en texte (chips outline).

### Bibliothèque
- Onglets en texte souligné.
- Progression en barre fine sous le titre.

### Détail livre
- Cover portrait centrée, titre serif, métadonnées en italique.
- Tabs en texte ; contenu prose avec lettrine sur le premier paragraphe.
- Chapitres numérotés.

### Player
- Plein écran minimal : cover centrée, contrôles discrets, fond papier ; la mirabelle reste mais en version line-art.
- Mini-lecteur : bande fine en bas, pas de cover (juste titre + play).

### Compte / Abonnement / Admin
- Cartes papier avec bordures fines, beaucoup d'espace.
- Admin : tableau épuré, typographie mono pour les chiffres.

### Pros / Cons
- ✅ Très différenciant pour la partie « Comprendre/Appliquer », calme, lisible.
- ❌ Moins immersif pour l'écoute ; covers portrait = refonte des assets ; peut paraître « lent ».

### Effort : M-L (3–5 semaines).

---

## 6. Tableau comparatif

| Critère | A Éditoriale | B Nuit & Or | C Papier & Encre |
|---|---|---|---|
| Risque marque | Faible | Moyen | Moyen-élevé |
| Effort | M | L | M-L |
| Immersion audio | Moyenne | Élevée | Faible |
| Lecture résumés | Bonne | Moyenne | Excellente |
| Accessibilité | Excellente | À valider | Excellente |
| Différenciation | Moyenne | Élevée | Élevée |
| Migration incrémentale | Oui | Partielle | Partielle |

---

## 7. Recommandation

**Direction A — « Mirabelle Éditoriale »** comme base, avec **emprunts sélectifs** :
- De B : le glow gold sur la cover du hero et le player plein écran sombre (le player est déjà sombre, on garde).
- De C : la lettrine et la prose large pour « Comprendre/Appliquer ».

Raison : la marque actuelle est déjà prune+mirabelle et appréciée ; A capitalise sans rupture, garde l'accessibilité et permet une migration par pages. B et C restent des options si l'utilisateur veut un virage plus fort.

---

## 8. Plan par phases (si Direction A retenue)

**Phase 0 — Fondations (3–4 j)**
- Nouveaux tokens (radius, shadows, spacing, typo scale) dans `globals.css`.
- Composants : `Skeleton`, `EmptyState` illustré, `Card`, `Badge`, `SegmentedControl`, `BottomSheet`.
- Passer les covers en Next/Image avec blur placeholder.

**Phase 1 — Navigation & shell (2 j)**
- Sidebar desktop avec brand + sections ; tabbar mobile avec labels masqués < 360 px ? (garder labels).
- Footer déplacé dans une page « À propos » ? (garder minimal).
- Mini-lecteur refait (72 px, progression).

**Phase 2 — Accueil & Explorer (4–5 j)**
- Hero livre, carrousels, skeletons.
- Grille Explorer, infinite scroll, bottom sheet filtres.

**Phase 3 — Détail livre & Player (4–5 j)**
- Hero cover + chips, CTA sticky mobile.
- Player : chapitres, gestes, menu ⋯ pour vitesse/sleep.

**Phase 4 — Bibliothèque & Compte (3–4 j)**
- Segmented control, toggle liste/grille, tri.
- Carte statut abonnement, historique en cartes.

**Phase 5 — Abonnement (2–3 j)**
- Cartes plan, moyens de paiement avec logos, récap sticky, succès.

**Phase 6 — Admin (3–4 j)**
- Sidebar admin, KPI cards, tableaux avec tri/recherche, formulaires sectionnés.

**Phase 7 — Polish & QA (3 j)**
- Dark mode affiné, reduced motion, a11y audit, Lighthouse, e2e.

Total : ~4–5 semaines à 1 dev.

---

## 9. Quick wins (1–2 jours, sans refonte complète)

1. Remplacer `Loading` (texte) par des **skeletons** sur home/explorer/livre.
2. Agrandir les covers : tuiles 180 px, rangées 80 px.
3. Ajouter une **barre d'action sticky** sur le détail livre (mobile) avec « Écouter ».
4. Afficher la **progression en pourcentage** au tap sur la barre du mini-lecteur.
5. Empty states illustrés (SVG simple) au lieu du texte seul.
6. Carte de statut abonnement sur la page compte (anneau + date).
7. Ajouter `next/image` pour les covers (perf + LCP).
8. Focus ring mirabelle déjà OK ; vérifier contraste des `.muted` en dark.

---

## 10. Wireframes basse fidélité (ASCII)

### Accueil (mobile)
```
┌─────────────────────────┐
│ Mirabelu          🔔    │
├─────────────────────────┤
│                         │
│   ┌──────┐  À la une    │
│   │ cover│  Titre livre │
│   │ 280  │  Auteur      │
│   └──────┘  ▶ Écouter   │
│                         │
│ Reprendre               │
│ ┌─────────────────────┐ │
│ │ cover  Titre  62% ⏯  │ │
│ └─────────────────────┘ │
│                         │
│ Derniers ajouts  →      │
│ ┌──┐┌──┐┌──┐┌──┐       │
│ │  ││  ││  ││  │ →     │
│ └──┘└──┘└──┘└──┘       │
└─────────────────────────┘
│ 🏠  🔍  📚  👤          │
```

### Mini-lecteur
```
┌──────────────────────────────┐
│ ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬ (4px)    │
│ [cover] Titre du livre       │
│  52px   Auteur     ⏪  ▶    │
└──────────────────────────────┘
```

### Explorer (grille)
```
┌─────────────────────────────┐
│ [🔍 Titre ou auteur     ✕] │
│ [Tout][Roman][Essai]... →   │
├─────────────────────────────┤
│ ┌────┐ ┌────┐ ┌────┐ ┌────┐│
│ │    │ │    │ │    │ │    ││
│ └────┘ └────┘ └────┘ └────┘│
│ Titre  Titre  Titre  Titre  │
│ Auteur Auteur Auteur Auteur │
│ ... charger plus ...        │
└─────────────────────────────┘
```

### Détail livre (mobile)
```
┌─────────────────────────┐
│ ←                       │
│       ┌──────┐          │
│       │ cover│          │
│       │ 240  │          │
│       └──────┘          │
│   Titre du livre        │
│   Auteur · Cat · 8h30   │
│  [▶ Écouter] [♡ Favori] │
│  Écouté à 42 %          │
│ ─────────────────────── │
│ [Chapitres][Comprendre] │
│ 1. Intro ........ 0:00  │
│ 2. Chap 1 .... 12:30 ▶  │
└─────────────────────────┘
│  [▶ Écouter ce livre]   │  ← sticky
```

---

---

## 12. Direction D — « Hybride » (mix A + B + C)

**Vibe** : le meilleur des trois. Base éditoriale claire et accessible (A), immersion cinématique pour l'écoute (B), calme littéraire pour la lecture des résumés (C).

### Répartition par zone
| Zone | Source | Justification |
|---|---|---|
| Tokens de base (light) | A | Marque prune/mirabelle conservée, accessibilité. |
| Mode sombre | B | Dark-first travaillé, glow gold, surfaces profondes. |
| Accueil hero | A + B | Cover géante + glow gold derrière (B), typo éditoriale (A). |
| Carrousels | A | Snap + peek, covers 180 px. |
| Explorer | A | Grille 2/4 cols, infinite scroll, bottom sheet filtres. |
| Bibliothèque | A + C | Segmented control (A), progression fine et calme (C). |
| Détail livre | A + C | Hero cover + chips (A), prose large avec lettrine (C). |
| Player plein écran | B | Fond sombre, cover 300 px glow, contrôles minimalistes ; mirabelle conserve sa place. |
| Mini-lecteur | A | 72 px, cover 52 px, progression au tap. |
| Compte / Abonnement | A | Cartes claires, anneau statut, récap sticky. |
| Admin | A | Sidebar, KPI cards, tableaux triables. |
| « Comprendre/Appliquer » | C | Lettrine, prose serif 1.15rem, marges larges, numérotation chapitres. |

### Règles de cohérence
- **Une seule accentuation gold** par écran : CTA principal ou progression, jamais les deux en même temps.
- **Typo** : serif (Fraunces) pour titres éditoriaux et prose ; sans-serif (Inter) pour UI, boutons, admin.
- **Covers** : ratio 1:1 partout (pas de portrait) pour éviter la refonte d'assets ; ombre `--shadow-md`.
- **Motion** : transitions 180 ms `ease-out` ; glow pulse uniquement sur le player ; respect `prefers-reduced-motion`.
- **Dark mode** : bascule manuelle dans Compte + respect `prefers-color-scheme`.

### Effort estimé
M-L (4–5 semaines), migration incrémentale par phases (voir §8).

### Risques
- Cohérence à maintenir entre light (A) et dark (B) : tester chaque composant dans les deux thèmes.
- Lettrine (C) à désactiver sur petits écrans pour ne pas casser la mise en page.

---

## 13. Plan d'action immédiat (Direction D)

1. **Fondations** (`globals.css` + nouveaux composants) : tokens, shadows, spacing, typo scale, `Skeleton`, `EmptyState`, `Card`, `Badge`, `SegmentedControl`, `BottomSheet`, `next/image` pour covers.
2. **Page pilote : Accueil** : hero + glow, carrousels, skeletons, états vides.
3. **Explorer** : grille, infinite scroll, bottom sheet filtres.
4. **Détail livre + Player** : hero, chips, CTA sticky, chapitres, gestes.
5. **Bibliothèque + Compte + Abonnement**.
6. **Admin**.
7. **Polish** : dark mode, a11y, Lighthouse, e2e.

1. Direction préférée (A / B / C / mix) ?
2. Souhaitez-vous que je commence par les **quick wins** (phase 0) ou une page pilote (Accueil) ?
3. Avez-vous des assets (covers haute résolution, logos opérateurs Mobile Money) à fournir ?
4. Faut-il conserver la « mirabelle » (fruit) comme identité du player, ou la faire évoluer ?
5. Admin : priorité au dashboard ou aux formulaires d'import ?

---

*Fin du document.*
