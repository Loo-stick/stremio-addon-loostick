/**
 * Stremio Addon Loostick - Mono-repo
 *
 * Serveur unique qui combine plusieurs addons Stremio:
 * - /subtitles   : Sous-titres FR (OpenSubtitles + SubDL)
 * - /cataloog    : Catalogue TMDB enrichi
 * - /cataloog-bp : Catalogue TMDB personnalisé (Asie, Classiques, Thrillers)
 * - /francetv    : Replay France Télévisions
 * - /arte        : Streaming Arte.tv
 * - /formatter   : Agrégateur de streams reformatés
 *
 * @version 1.1.0
 */

require('dotenv').config();

const express = require('express');
const { getRouter } = require('stremio-addon-sdk');

// Configuration
const PORT = process.env.PORT || 7000;
const ADDON_URL = process.env.ADDON_URL || `http://localhost:${PORT}`;

// Import des créateurs d'addons
const createSubtitlesAddon = require('./addons/subtitles/addon');
const createCataloogAddon = require('./addons/cataloog/addon');
const createCataloogBpAddon = require('./addons/cataloog-bp/addon');
const createFrancetvAddon = require('./addons/francetv/addon');
const createArteAddon = require('./addons/arte/addon');
const createFormatterAddon = require('./addons/formatter/addon');

// Serveur Express principal
const app = express();

// CORS pour Stremio
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

// Liste des addons actifs
const activeAddons = [];

/**
 * Monte un addon sur une route spécifique
 * @param {string} path - Chemin de base (ex: '/subtitles')
 * @param {Function} createFn - Fonction de création de l'addon
 * @param {Object} config - Configuration additionnelle
 */
function mountAddon(path, createFn, config = {}) {
    try {
        const addon = createFn({
            ...config,
            addonUrl: `${ADDON_URL}${path}`
        });

        if (!addon) {
            console.log(`[Main] Addon ${path} désactivé (config manquante)`);
            return;
        }

        // Router pour cet addon
        const router = express.Router();

        // Routes custom de l'addon
        if (addon.setupRoutes) {
            addon.setupRoutes(router);
        }

        // Routes Stremio SDK
        router.use(getRouter(addon.builder.getInterface()));

        // Monte le router sur le chemin
        app.use(path, router);

        // Met à jour l'URL si fonction disponible
        if (addon.setAddonUrl) {
            addon.setAddonUrl(`${ADDON_URL}${path}`);
        }

        activeAddons.push({
            name: addon.name,
            path: path,
            manifest: `${ADDON_URL}${path}/manifest.json`,
            id: addon.manifest.id
        });

        console.log(`[Main] ✓ ${addon.manifest.name} monté sur ${path}`);
    } catch (error) {
        console.error(`[Main] ✗ Erreur montage ${path}:`, error.message);
    }
}

// Monte les addons
console.log('\n[Main] Initialisation des addons...\n');

mountAddon('/subtitles', createSubtitlesAddon);
mountAddon('/cataloog', createCataloogAddon);
mountAddon('/cataloog-bp', createCataloogBpAddon);
mountAddon('/francetv', createFrancetvAddon);
mountAddon('/arte', createArteAddon);
mountAddon('/formatter', createFormatterAddon);

// Route racine - liste des addons
app.get('/', (req, res) => {
    const html = `
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Stremio Addons Loostick</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); min-height: 100vh; color: #fff; padding: 40px 20px; }
        .container { max-width: 800px; margin: 0 auto; }
        h1 { text-align: center; margin-bottom: 10px; font-size: 2.5em; }
        .subtitle { text-align: center; color: #888; margin-bottom: 40px; }
        .addon { background: rgba(255,255,255,0.05); border-radius: 12px; padding: 20px; margin-bottom: 20px; border: 1px solid rgba(255,255,255,0.1); }
        .addon h2 { margin-bottom: 10px; display: flex; align-items: center; gap: 10px; }
        .addon .path { color: #888; font-size: 0.9em; margin-bottom: 15px; }
        .addon .install { display: inline-block; background: #7b2cbf; color: #fff; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 500; transition: background 0.2s; }
        .addon .install:hover { background: #9d4edd; }
        .addon .manifest { color: #666; font-size: 0.8em; margin-top: 10px; word-break: break-all; }
        .status { display: inline-block; width: 10px; height: 10px; background: #4ade80; border-radius: 50%; }
        .footer { text-align: center; margin-top: 40px; color: #666; font-size: 0.9em; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🎬 Stremio Addons</h1>
        <p class="subtitle">by Loostick</p>

        ${activeAddons.map(addon => `
        <div class="addon">
            <h2><span class="status"></span> ${addon.name}</h2>
            <p class="path">${addon.path}</p>
            <a class="install" href="stremio://${addon.manifest.replace('https://', '').replace('http://', '')}">
                Installer dans Stremio
            </a>
            <p class="manifest">${addon.manifest}</p>
        </div>
        `).join('')}

        <div class="footer">
            <p>${activeAddons.length} addon(s) actif(s)</p>
        </div>
    </div>
</body>
</html>
    `;
    res.send(html);
});

// Route santé globale
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        addons: activeAddons.map(a => ({ name: a.name, path: a.path })),
        uptime: process.uptime()
    });
});

// Route API - liste des manifests
app.get('/api/addons', (req, res) => {
    res.json(activeAddons);
});

// Démarrage du serveur
app.listen(PORT, () => {
    console.log(`
[Main] ========================================
[Main] Stremio Addons Loostick démarré!
[Main] Port: ${PORT}
[Main] URL: ${ADDON_URL}
[Main] ========================================

[Main] Addons disponibles:
${activeAddons.map(a => `[Main]   - ${a.name}: ${a.manifest}`).join('\n')}

[Main] ========================================
[Main] Dashboard: ${ADDON_URL}
[Main] Health: ${ADDON_URL}/health
[Main] ========================================
`);
});

// Gestion arrêt propre
process.on('SIGTERM', () => {
    console.log('[Main] Arrêt...');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('\n[Main] Interruption...');
    process.exit(0);
});
