/**
 * TVLoo Addon (adapté pour mono-repo)
 *
 * Chaînes sportives françaises en streaming via M3U
 */

const { addonBuilder } = require('stremio-addon-sdk');
const { fetchChannels, clearCache, getCacheStats } = require('./lib/m3uParser');

/**
 * Crée et configure l'addon TVLoo
 * @param {Object} config - Configuration
 * @returns {Object|null} { builder, setupRoutes, manifest, name } ou null si non configuré
 */
function createAddon(config = {}) {
    const m3uUrl = process.env.TVLOO_M3U_URL;

    if (!m3uUrl) {
        console.log('[TVLoo] TVLOO_M3U_URL non définie - addon désactivé');
        return null;
    }

    const ID_PREFIX = 'tvloo-';

    console.log('[TVLoo] Initialisation...');
    console.log(`[TVLoo] Source M3U: ${m3uUrl}`);

    // Manifest Stremio
    const manifest = {
        id: 'com.tvloo.sportsfrancefhd',
        version: '1.0.0',
        name: 'TV Sports France FHD',
        description: 'Chaînes sportives françaises en streaming FHD',
        logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c3/Flag_of_France.svg/200px-Flag_of_France.svg.png',
        resources: ['catalog', 'meta', 'stream'],
        types: ['tv'],
        catalogs: [
            {
                type: 'tv',
                id: 'tvloo-sports-france',
                name: 'Sports France FHD',
                extra: [
                    { name: 'search', isRequired: false },
                    { name: 'skip', isRequired: false }
                ]
            }
        ],
        idPrefixes: [ID_PREFIX]
    };

    const builder = new addonBuilder(manifest);

    // Catalog handler
    builder.defineCatalogHandler(async ({ type, id, extra }) => {
        console.log(`[TVLoo] Catalogue: type=${type}, id=${id}`);

        if (type !== 'tv' || id !== 'tvloo-sports-france') {
            return { metas: [] };
        }

        try {
            const channels = await fetchChannels(m3uUrl);

            let metas = channels.map(channel => ({
                id: channel.id,
                type: 'tv',
                name: channel.name,
                poster: channel.logo || manifest.logo,
                posterShape: 'square',
                background: channel.logo || manifest.logo,
                logo: channel.logo || manifest.logo,
                description: `Chaîne: ${channel.name}${channel.group ? ` | Groupe: ${channel.group}` : ''}`
            }));

            // Filtrage par recherche
            if (extra && extra.search) {
                const searchTerm = extra.search.toLowerCase();
                metas = metas.filter(meta =>
                    meta.name.toLowerCase().includes(searchTerm)
                );
                console.log(`[TVLoo] Recherche "${extra.search}": ${metas.length} résultats`);
            }

            // Pagination
            const skip = parseInt(extra?.skip) || 0;
            const limit = 50;
            metas = metas.slice(skip, skip + limit);

            console.log(`[TVLoo] ${metas.length} chaînes retournées`);
            return { metas };

        } catch (error) {
            console.error('[TVLoo] Erreur catalogue:', error.message);
            return { metas: [] };
        }
    });

    // Meta handler
    builder.defineMetaHandler(async ({ type, id }) => {
        console.log(`[TVLoo] Meta: type=${type}, id=${id}`);

        if (type !== 'tv' || !id.startsWith(ID_PREFIX)) {
            return { meta: null };
        }

        try {
            const channels = await fetchChannels(m3uUrl);
            const channel = channels.find(ch => ch.id === id);

            if (!channel) {
                console.log(`[TVLoo] Chaîne non trouvée: ${id}`);
                return { meta: null };
            }

            return {
                meta: {
                    id: channel.id,
                    type: 'tv',
                    name: channel.name,
                    poster: channel.logo || manifest.logo,
                    posterShape: 'square',
                    background: channel.logo || manifest.logo,
                    logo: channel.logo || manifest.logo,
                    description: `Chaîne: ${channel.name}${channel.group ? ` | Groupe: ${channel.group}` : ''}`
                }
            };

        } catch (error) {
            console.error('[TVLoo] Erreur meta:', error.message);
            return { meta: null };
        }
    });

    // Stream handler
    builder.defineStreamHandler(async ({ type, id }) => {
        console.log(`[TVLoo] Stream: type=${type}, id=${id}`);

        if (type !== 'tv' || !id.startsWith(ID_PREFIX)) {
            return { streams: [] };
        }

        try {
            const channels = await fetchChannels(m3uUrl);
            const channel = channels.find(ch => ch.id === id);

            if (!channel) {
                console.log(`[TVLoo] Chaîne non trouvée: ${id}`);
                return { streams: [] };
            }

            console.log(`[TVLoo] Stream trouvé: ${channel.name}`);

            return {
                streams: [
                    {
                        name: 'TVLoo',
                        title: `${channel.name}\n${channel.group ? `📺 ${channel.group}` : '📺 Sports France'}`,
                        url: channel.url,
                        behaviorHints: {
                            notWebReady: true
                        }
                    }
                ]
            };

        } catch (error) {
            console.error('[TVLoo] Erreur stream:', error.message);
            return { streams: [] };
        }
    });

    /**
     * Configure les routes Express custom
     */
    function setupRoutes(router) {
        // Route stats
        router.get('/stats', (req, res) => {
            const stats = getCacheStats();
            res.json({
                addon: 'TVLoo',
                m3uUrl: m3uUrl,
                cache: stats
            });
        });

        // Route pour vider le cache
        router.post('/clear-cache', (req, res) => {
            clearCache();
            res.json({ success: true, message: 'Cache vidé' });
        });
    }

    console.log('[TVLoo] Addon initialisé');

    return {
        builder,
        manifest,
        setupRoutes,
        name: 'TVLoo'
    };
}

module.exports = createAddon;
