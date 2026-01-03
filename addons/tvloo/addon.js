/**
 * TVLoo Addon (adapté pour mono-repo)
 *
 * Addon IPTV générique avec support multi-sources M3U
 * Chaque source M3U = un catalogue séparé
 */

const { addonBuilder } = require('stremio-addon-sdk');
const { fetchChannels, clearCache, getCacheStats } = require('./lib/m3uParser');
const { fetchEpg, getCurrentProgram, getNextProgram, formatTime, clearEpgCache, getEpgCacheStats } = require('./lib/epgParser');

/**
 * Détecte les sources M3U configurées dans les variables d'environnement
 * Format: TVLOO_M3U_URL_1, TVLOO_M3U_URL_2, etc.
 * Noms: TVLOO_CATALOG_NAME_1, TVLOO_CATALOG_NAME_2, etc.
 * @returns {Array} Liste des sources { index, url, name }
 */
function detectSources() {
    const sources = [];

    // Chercher TVLOO_M3U_URL_1, TVLOO_M3U_URL_2, etc.
    for (let i = 1; i <= 20; i++) {
        const url = process.env[`TVLOO_M3U_URL_${i}`];
        if (url) {
            const name = process.env[`TVLOO_CATALOG_NAME_${i}`] || `TV Channels ${i}`;
            sources.push({
                index: i - 1, // Index 0-based pour le cache
                number: i,    // Numéro 1-based pour l'affichage
                url,
                name
            });
        }
    }

    return sources;
}

/**
 * Crée et configure l'addon TVLoo
 * @param {Object} config - Configuration
 * @returns {Object|null} { builder, setupRoutes, manifest, name } ou null si non configuré
 */
function createAddon(config = {}) {
    const sources = detectSources();
    const epgUrl = process.env.TVLOO_EPG_URL;

    if (sources.length === 0) {
        console.log('[TVLoo] Aucune source M3U configurée (TVLOO_M3U_URL_1, TVLOO_M3U_URL_2, ...)');
        return null;
    }

    console.log('[TVLoo] Initialisation...');
    console.log(`[TVLoo] ${sources.length} source(s) M3U détectée(s):`);
    sources.forEach(s => console.log(`  - Source ${s.number}: "${s.name}"`));

    if (epgUrl) {
        console.log('[TVLoo] EPG configuré');
    }

    // Générer les catalogues dynamiquement
    const catalogs = sources.map(source => ({
        type: 'tv',
        id: `tvloo-catalog-${source.number}`,
        name: source.name,
        extra: [
            { name: 'search', isRequired: false },
            { name: 'skip', isRequired: false }
        ]
    }));

    // Générer les préfixes d'ID (tvloo-1-, tvloo-2-, etc.)
    const idPrefixes = sources.map(s => `tvloo-${s.number}-`);

    // Manifest Stremio
    const manifest = {
        id: 'com.tvloo.iptv',
        version: '2.0.0',
        name: 'TVLoo',
        description: 'Addon IPTV - Lecture de playlists M3U avec support EPG',
        logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5a/TV_icon_2.svg/200px-TV_icon_2.svg.png',
        resources: ['catalog', 'meta', 'stream'],
        types: ['tv'],
        catalogs,
        idPrefixes
    };

    const builder = new addonBuilder(manifest);

    /**
     * Trouve la source correspondant à un ID de chaîne
     * @param {string} channelId - ID de la chaîne (ex: tvloo-1-xxx)
     * @returns {Object|null} Source correspondante
     */
    function findSourceByChannelId(channelId) {
        const match = channelId.match(/^tvloo-(\d+)-/);
        if (match) {
            const sourceNumber = parseInt(match[1]);
            return sources.find(s => s.number === sourceNumber);
        }
        return null;
    }

    /**
     * Trouve la source correspondant à un ID de catalogue
     * @param {string} catalogId - ID du catalogue (ex: tvloo-catalog-1)
     * @returns {Object|null} Source correspondante
     */
    function findSourceByCatalogId(catalogId) {
        const match = catalogId.match(/^tvloo-catalog-(\d+)$/);
        if (match) {
            const sourceNumber = parseInt(match[1]);
            return sources.find(s => s.number === sourceNumber);
        }
        return null;
    }

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
        if (type !== 'tv') {
            return { metas: [] };
        }

        const source = findSourceByCatalogId(id);
        if (!source) {
            return { metas: [] };
        }

        console.log(`[TVLoo] Catalogue "${source.name}" (source ${source.number})`);

        try {
            // Charger channels et EPG en parallèle
            const [channels, epgData] = await Promise.all([
                fetchChannels(source.url, source.index),
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
        if (type !== 'tv') {
            return { meta: null };
        }

        const source = findSourceByChannelId(id);
        if (!source) {
            return { meta: null };
        }

        console.log(`[TVLoo] Meta: ${id} (source ${source.number})`);

        try {
            // Charger channels et EPG en parallèle
            const [channels, epgData] = await Promise.all([
                fetchChannels(source.url, source.index),
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
        if (type !== 'tv') {
            return { streams: [] };
        }

        const source = findSourceByChannelId(id);
        if (!source) {
            return { streams: [] };
        }

        console.log(`[TVLoo] Stream: ${id} (source ${source.number})`);

        try {
            // Charger channels et EPG en parallèle
            const [channels, epgData] = await Promise.all([
                fetchChannels(source.url, source.index),
                epgUrl ? fetchEpg(epgUrl) : Promise.resolve(null)
            ]);

            const channel = channels.find(ch => ch.id === id);

            if (!channel) {
                console.log(`[TVLoo] Chaîne non trouvée: ${id}`);
                return { streams: [] };
            }

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
                sources: sources.map(s => ({
                    number: s.number,
                    name: s.name,
                    cache: getCacheStats(s.index)
                })),
                epg: epgUrl ? getEpgCacheStats() : null
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
