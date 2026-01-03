/**
 * TVLoo Addon (adapté pour mono-repo)
 *
 * Chaînes sportives françaises en streaming via M3U
 */

const { addonBuilder } = require('stremio-addon-sdk');
const { fetchChannels, clearCache, getCacheStats } = require('./lib/m3uParser');
const { fetchEpg, getCurrentProgram, getNextProgram, formatTime, clearEpgCache, getEpgCacheStats } = require('./lib/epgParser');

/**
 * Crée et configure l'addon TVLoo
 * @param {Object} config - Configuration
 * @returns {Object|null} { builder, setupRoutes, manifest, name } ou null si non configuré
 */
function createAddon(config = {}) {
    const m3uUrl = process.env.TVLOO_M3U_URL;
    const epgUrl = process.env.TVLOO_EPG_URL;

    if (!m3uUrl) {
        console.log('[TVLoo] TVLOO_M3U_URL non définie - addon désactivé');
        return null;
    }

    const ID_PREFIX = 'tvloo-';

    console.log('[TVLoo] Initialisation...');
    console.log(`[TVLoo] Source M3U: ${m3uUrl}`);
    if (epgUrl) {
        console.log(`[TVLoo] Source EPG: ${epgUrl}`);
    } else {
        console.log('[TVLoo] EPG non configuré (TVLOO_EPG_URL)');
    }

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

    /**
     * Construit la description avec le programme en cours
     */
    function buildDescription(channel, epgData) {
        const parts = [];

        // Groupe/catégorie
        if (channel.group) {
            parts.push(`📺 ${channel.group}`);
        }

        // Programme en cours
        if (epgData && channel.tvgId) {
            const current = getCurrentProgram(epgData, channel.tvgId);
            if (current) {
                parts.push(`\n▶️ ${current.title}`);
                parts.push(`   ${formatTime(current.start)} - ${formatTime(current.stop)}`);

                // Prochain programme
                const next = getNextProgram(epgData, channel.tvgId);
                if (next) {
                    parts.push(`\n⏭️ ${formatTime(next.start)} : ${next.title}`);
                }
            }
        }

        return parts.length > 0 ? parts.join('\n') : '📺 TV en direct';
    }

    // Catalog handler
    builder.defineCatalogHandler(async ({ type, id, extra }) => {
        console.log(`[TVLoo] Catalogue: type=${type}, id=${id}`);

        if (type !== 'tv' || id !== 'tvloo-sports-france') {
            return { metas: [] };
        }

        try {
            // Charger channels et EPG en parallèle
            const [channels, epgData] = await Promise.all([
                fetchChannels(m3uUrl),
                epgUrl ? fetchEpg(epgUrl) : Promise.resolve(null)
            ]);

            let metas = channels.map(channel => ({
                id: channel.id,
                type: 'tv',
                name: channel.name,
                poster: channel.logo || manifest.logo,
                posterShape: 'square',
                background: channel.logo || manifest.logo,
                logo: channel.logo || manifest.logo,
                description: buildDescription(channel, epgData)
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
            // Charger channels et EPG en parallèle
            const [channels, epgData] = await Promise.all([
                fetchChannels(m3uUrl),
                epgUrl ? fetchEpg(epgUrl) : Promise.resolve(null)
            ]);

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
                    description: buildDescription(channel, epgData)
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
            // Charger channels et EPG en parallèle
            const [channels, epgData] = await Promise.all([
                fetchChannels(m3uUrl),
                epgUrl ? fetchEpg(epgUrl) : Promise.resolve(null)
            ]);

            const channel = channels.find(ch => ch.id === id);

            if (!channel) {
                console.log(`[TVLoo] Chaîne non trouvée: ${id}`);
                return { streams: [] };
            }

            console.log(`[TVLoo] Stream trouvé: ${channel.name}`);

            // Construire le titre avec programme en cours
            let streamTitle = channel.name;
            if (epgData && channel.tvgId) {
                const current = getCurrentProgram(epgData, channel.tvgId);
                if (current) {
                    streamTitle += `\n▶️ ${current.title}`;
                }
            }
            if (channel.group) {
                streamTitle += `\n📺 ${channel.group}`;
            }

            return {
                streams: [
                    {
                        name: 'TVLoo',
                        title: streamTitle,
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
            res.json({
                addon: 'TVLoo',
                m3uUrl: m3uUrl,
                epgUrl: epgUrl || null,
                m3uCache: getCacheStats(),
                epgCache: getEpgCacheStats()
            });
        });

        // Route pour vider le cache
        router.post('/clear-cache', (req, res) => {
            clearCache();
            clearEpgCache();
            res.json({ success: true, message: 'Cache M3U et EPG vidés' });
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
