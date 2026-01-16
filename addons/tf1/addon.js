/**
 * TF1+ Addon pour Stremio
 *
 * Replay et Direct TF1, TMC, TFX, LCI
 * Nécessite un compte TF1+ (gratuit)
 *
 * SÉCURITÉ: Les credentials sont lus depuis les variables d'environnement
 * TF1_EMAIL et TF1_PASSWORD - JAMAIS stockés dans le code
 */

const { addonBuilder } = require('stremio-addon-sdk');
const TF1Client = require('./lib/tf1');

/**
 * Crée et configure l'addon TF1+
 *
 * @param {Object} config - Configuration
 * @returns {Object} { builder, setupRoutes, manifest }
 */
function createAddon(config = {}) {
    const tf1 = new TF1Client();
    const ID_PREFIX = 'tf1:';

    // Vérification des credentials au démarrage
    if (tf1.isConfigured()) {
        console.log('[TF1+] Client initialisé (credentials configurés)');
    } else {
        console.warn('[TF1+] ⚠️ TF1_EMAIL et TF1_PASSWORD non configurés - addon désactivé');
    }

    // Manifest
    const manifest = {
        id: 'community.stremio.tf1plus',
        version: '1.0.0',
        name: 'TF1+',
        description: 'Replay et Direct TF1, TMC, TFX, LCI - Nécessite un compte TF1+ gratuit',
        logo: 'https://photos.tf1.fr/450/0/logo-tf1-2020-min-1c7c27-26ba3a-0@1x.jpg',
        resources: ['catalog', 'meta', 'stream'],
        types: ['tv', 'movie'],
        catalogs: [
            { type: 'tv', id: 'tf1-direct', name: '📡 TF1+ Direct' },
            { type: 'movie', id: 'tf1-replay', name: '🎬 TF1+ Replay', extra: [{ name: 'skip', isRequired: false }] }
        ],
        idPrefixes: [ID_PREFIX],
        behaviorHints: {
            configurable: false,
            configurationRequired: false
        }
    };

    const builder = new addonBuilder(manifest);

    // Catalog handler
    builder.defineCatalogHandler(async ({ type, id, extra }) => {
        console.log(`[TF1+] Catalogue: ${id} (type: ${type})`);

        // Vérifier que les credentials sont configurés
        if (!tf1.isConfigured()) {
            console.log('[TF1+] Credentials non configurés, catalogue vide');
            return { metas: [] };
        }

        try {
            if (id === 'tf1-direct') {
                // Catalogue des lives
                const lives = await tf1.getLiveChannels();
                const metas = lives.map(live => ({
                    id: `${ID_PREFIX}live:${live.id}`,
                    type: 'tv',
                    name: live.title,
                    poster: live.image || live.logo,
                    posterShape: 'landscape',
                    description: live.description,
                    background: live.image,
                    logo: live.logo
                }));

                console.log(`[TF1+] ${metas.length} directs`);
                return { metas };

            } else if (id === 'tf1-replay') {
                // Catalogue replay
                const skip = parseInt(extra?.skip) || 0;
                const programs = await tf1.getPopularPrograms();

                const metas = programs.map(prog => ({
                    id: `${ID_PREFIX}${prog.id}`,
                    type: 'movie',
                    name: prog.title,
                    poster: prog.image,
                    posterShape: 'landscape',
                    description: prog.description || prog.programName,
                    background: prog.image
                }));

                console.log(`[TF1+] ${metas.length} replays`);
                return { metas };
            }

            return { metas: [] };

        } catch (error) {
            console.error(`[TF1+] Erreur catalogue:`, error.message);
            return { metas: [] };
        }
    });

    // Meta handler
    builder.defineMetaHandler(async ({ type, id }) => {
        console.log(`[TF1+] Meta: ${id} (type: ${type})`);

        if (!tf1.isConfigured()) {
            return { meta: null };
        }

        const contentId = id.replace(ID_PREFIX, '');

        try {
            // Gestion des lives
            let mediaId = contentId;
            if (contentId.startsWith('live:')) {
                mediaId = contentId.replace('live:', '');
            }

            const info = await tf1.getMediaInfo(mediaId);
            if (!info) return { meta: null };

            return {
                meta: {
                    id: id,
                    type: info.isLive ? 'tv' : 'movie',
                    name: info.title || info.programName,
                    poster: info.preview,
                    posterShape: 'landscape',
                    background: info.preview,
                    description: info.shortTitle || `${info.programName} sur ${info.channel}`,
                    logo: info.isLive ? LIVE_CHANNELS_LOGOS[mediaId] : null,
                    genres: ['TF1+', info.isLive ? 'Direct' : 'Replay']
                }
            };

        } catch (error) {
            console.error(`[TF1+] Erreur meta:`, error.message);
            return { meta: null };
        }
    });

    // Stream handler
    builder.defineStreamHandler(async ({ type, id }) => {
        console.log(`[TF1+] Stream: ${id}`);

        if (!tf1.isConfigured()) {
            return {
                streams: [{
                    name: 'TF1+',
                    title: '⚠️ TF1_EMAIL et TF1_PASSWORD non configurés',
                    externalUrl: 'https://www.tf1.fr/'
                }]
            };
        }

        let mediaId = id.replace(ID_PREFIX, '');

        // Gestion des lives
        const isLive = mediaId.startsWith('live:');
        if (isLive) {
            mediaId = mediaId.replace('live:', '');
        }

        try {
            const info = await tf1.getMediaInfo(mediaId);

            if (!info) {
                console.log(`[TF1+] Pas d'info pour ${mediaId}`);
                return { streams: [] };
            }

            if (info.error) {
                return {
                    streams: [{
                        name: 'TF1+',
                        title: `${info.title || 'Vidéo'}\n⚠️ ${info.errorDesc || info.error}`,
                        externalUrl: 'https://www.tf1.fr/'
                    }]
                };
            }

            if (!info.streamUrl) {
                return {
                    streams: [{
                        name: 'TF1+',
                        title: `${info.title || 'Vidéo'}\n⚠️ Stream non disponible`,
                        externalUrl: 'https://www.tf1.fr/'
                    }]
                };
            }

            // Stream disponible
            const streamTitle = isLive
                ? `🔴 ${info.title || info.channel}\n🇫🇷 ${info.channel}`
                : `${info.title}\n🇫🇷 ${info.channel || 'TF1+'}`;

            return {
                streams: [{
                    name: 'TF1+',
                    title: streamTitle,
                    url: info.streamUrl,
                    behaviorHints: { notWebReady: false }
                }]
            };

        } catch (error) {
            console.error(`[TF1+] Erreur stream:`, error.message);
            return { streams: [] };
        }
    });

    /**
     * Configure les routes Express pour cet addon
     *
     * @param {Object} router - Router Express
     */
    function setupRoutes(router) {
        // Route de statut pour vérifier si TF1+ est configuré
        router.get('/status', (req, res) => {
            res.json({
                configured: tf1.isConfigured(),
                message: tf1.isConfigured()
                    ? 'TF1+ est configuré et prêt'
                    : 'TF1_EMAIL et TF1_PASSWORD non configurés'
            });
        });
    }

    return {
        builder,
        manifest,
        setupRoutes
    };
}

// Logos des chaînes pour le meta handler
const LIVE_CHANNELS_LOGOS = {
    'L_TF1': 'https://photos.tf1.fr/450/0/logo-tf1-2020-min-1c7c27-26ba3a-0@1x.jpg',
    'L_TMC': 'https://photos.tf1.fr/450/0/logo-tmc-2020-min-9fe0e0-5b1f13-0@1x.jpg',
    'L_TFX': 'https://photos.tf1.fr/450/0/logo-tfx-2020-min-e2ef72-8c8d13-0@1x.jpg',
    'L_LCI': 'https://photos.tf1.fr/450/0/logo-lci-2020-min-a0978b-4a05fe-0@1x.jpg'
};

module.exports = createAddon;
