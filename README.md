# Stremio Addon Loostick

Mono-repo qui combine plusieurs addons Stremio en un seul service pour optimiser les ressources.

## Addons inclus

| Addon | Chemin | Description |
|-------|--------|-------------|
| **Subtitles FR** | `/subtitles` | Sous-titres français (OpenSubtitles + SubDL) |
| **Cataloog** | `/cataloog` | Catalogue TMDB enrichi (tendances, genres, plateformes) |
| **France.tv** | `/francetv` | Replay gratuit France Télévisions |
| **Arte.tv** | `/arte` | Streaming légal Arte.tv |

## Installation dans Stremio

Chaque addon a son propre manifest :

```
https://ton-addon.onrender.com/subtitles/manifest.json
https://ton-addon.onrender.com/cataloog/manifest.json
https://ton-addon.onrender.com/francetv/manifest.json
https://ton-addon.onrender.com/arte/manifest.json
```

Ou visite la page d'accueil pour les liens d'installation.

## Configuration

### Variables d'environnement

```env
# Serveur
PORT=7000
ADDON_URL=https://ton-addon.onrender.com

# Subtitles FR
OPENSUBTITLES_API_KEY=xxx
SUBDL_API_KEY=xxx

# Cataloog
TMDB_API_KEY=xxx
```

### APIs requises

| Addon | API | Lien |
|-------|-----|------|
| Subtitles FR | OpenSubtitles | https://www.opensubtitles.com/consumers |
| Subtitles FR | SubDL | https://subdl.com |
| Cataloog | TMDB | https://www.themoviedb.org/settings/api |
| France.tv | - | API publique |
| Arte.tv | - | API publique |

## Lancer en local

```bash
npm install
cp .env.example .env
# Édite .env avec tes API keys
npm start
```

Le serveur démarre sur `http://localhost:7000`

## Déployer sur Render

1. Fork ce repo sur GitHub
2. Crée un nouveau Web Service sur Render
3. Connecte ton repo GitHub
4. Configure les variables d'environnement :
   - `ADDON_URL` = URL de ton service Render
   - `OPENSUBTITLES_API_KEY` (optionnel)
   - `SUBDL_API_KEY` (optionnel)
   - `TMDB_API_KEY` (requis pour Cataloog)
5. Deploy !

## Avantage du mono-repo

**Avant** : 4 services × 24h × 31j = 2976h/mois (dépasse le free tier)

**Après** : 1 service × 24h × 31j = 744h/mois ✅ (dans le free tier)

## Structure

```
stremio-addon-loostick/
├── index.js              # Point d'entrée principal
├── package.json
├── .env.example
└── addons/
    ├── subtitles/        # Subtitles FR
    │   ├── addon.js
    │   └── lib/
    ├── cataloog/         # Cataloog TMDB
    │   ├── addon.js
    │   └── lib/
    ├── francetv/         # France.tv
    │   ├── addon.js
    │   └── lib/
    └── arte/             # Arte.tv
        ├── addon.js
        └── lib/
```

## Endpoints

- `/` - Dashboard avec liens d'installation
- `/health` - État du serveur
- `/api/addons` - Liste des addons actifs (JSON)
- `/{addon}/manifest.json` - Manifest Stremio
- `/{addon}/stats` - Stats de l'addon

## Changelog

- **v1.0.0** : Consolidation des 4 addons en mono-repo
