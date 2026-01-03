# Stremio Addon Loostick

Mono-repo combinant plusieurs addons Stremio en un seul service pour optimiser les ressources.

## Avertissement / Disclaimer

**CE LOGICIEL EST FOURNI "TEL QUEL", SANS GARANTIE D'AUCUNE SORTE, EXPRESSE OU IMPLICITE.**

Ce projet est créé **strictement à des fins éducatives et personnelles uniquement**. Les développeurs :

- **NE** fournissent, hébergent ou distribuent **AUCUN** contenu média
- **NE** contrôlent ou n'exploitent **AUCUNE** source de streaming
- **NE SONT PAS** responsables du contenu accessible via ce logiciel
- **N'encouragent PAS** et ne cautionnent pas le piratage ou la violation du droit d'auteur

**L'utilisation de ce logiciel est entièrement à vos propres risques.** Les utilisateurs sont seuls responsables de :

- La légalité du contenu auquel ils accèdent
- La conformité avec les lois et réglementations locales
- La configuration et l'utilisation des clés API ou services externes

**En utilisant ce logiciel, vous acceptez de ne l'utiliser que pour accéder à du contenu que vous avez légalement le droit de visionner.**

---

## Addons Inclus

| Addon | Chemin | Description |
|-------|--------|-------------|
| **Subtitles FR** | `/subtitles` | Sous-titres français (OpenSubtitles + SubDL) |
| **Cataloog** | `/cataloog` | Catalogue TMDB (tendances, genres, plateformes) |
| **Cataloog BP** | `/cataloog-bp` | Catalogue TMDB (Asie, Classiques, Thrillers) |
| **France.tv** | `/francetv` | Replay gratuit France Télévisions |
| **Arte.tv** | `/arte` | Streaming légal Arte.tv |
| **Formatter** | `/formatter` | Agrégateur et formateur de streams |
| **TVLoo** | `/tvloo` | Lecteur IPTV M3U avec EPG |

## Prérequis

- Node.js 14+
- npm

## Installation

```bash
git clone https://github.com/Loo-stick/stremio-addon-loostick.git
cd stremio-addon-loostick
npm install
cp .env.example .env
# Éditez .env avec votre configuration
npm start
```

## Configuration

### Variables d'environnement

```env
# Serveur
PORT=7000
ADDON_URL=https://votre-addon-url.com

# Subtitles FR (optionnel)
OPENSUBTITLES_API_KEY=
SUBDL_API_KEY=

# Cataloog / Cataloog BP (requis pour ces addons)
TMDB_API_KEY=

# Formatter (optionnel)
TORBOX_API_KEY=
FORMATTER_ADDON_1=
FORMATTER_ADDON_2=

# TVLoo (requis pour cet addon)
TVLOO_M3U_URL=
TVLOO_EPG_URL=
```

### Clés API

| Addon | API | Lien |
|-------|-----|------|
| Subtitles FR | OpenSubtitles | https://www.opensubtitles.com/consumers |
| Subtitles FR | SubDL | https://subdl.com |
| Cataloog | TMDB | https://www.themoviedb.org/settings/api |
| France.tv | - | API publique |
| Arte.tv | - | API publique |
| Formatter | TorBox | https://torbox.app |
| TVLoo | - | M3U fourni par l'utilisateur |

## Déployer sur Render

1. Fork ce repo sur GitHub
2. Créez un nouveau Web Service sur [Render](https://render.com)
3. Connectez votre repo GitHub
4. Configurez les variables d'environnement
5. Déployez !

## Structure du Projet

```
stremio-addon-loostick/
├── index.js              # Point d'entrée principal
├── package.json
├── .env.example
└── addons/
    ├── subtitles/        # Sous-titres français
    ├── cataloog/         # Catalogue TMDB
    ├── cataloog-bp/      # Catalogue TMDB (BP)
    ├── francetv/         # Replay France.tv
    ├── arte/             # Arte.tv
    ├── formatter/        # Formateur de streams
    └── tvloo/            # Lecteur IPTV M3U
```

## Endpoints

| Endpoint | Description |
|----------|-------------|
| `/` | Dashboard avec liens d'installation |
| `/health` | État du serveur |
| `/api/addons` | Liste des addons actifs (JSON) |
| `/{addon}/manifest.json` | Manifest Stremio |

## Avantage du Mono-repo

**Avant** : 7 services × 24h × 31j = 5208h/mois (dépasse le free tier)

**Après** : 1 service × 24h × 31j = 744h/mois ✅ (dans le free tier)

## Licence

Licence MIT

## Mentions Légales

Ce projet est fourni à des fins éducatives uniquement. Les développeurs n'assument aucune responsabilité quant à l'utilisation de ce logiciel. Les utilisateurs doivent s'assurer de respecter toutes les lois applicables dans leur juridiction.

**Aucun contenu média n'est fourni, hébergé ou distribué par ce logiciel.**
