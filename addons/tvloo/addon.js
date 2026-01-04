/**
 * TVLoo Addon (adapté pour mono-repo)
 *
 * Addon IPTV générique avec support multi-sources M3U
 * Sources avec même CATALOG_NAME = fusionnées en un seul catalogue
 */

const { addonBuilder } = require('stremio-addon-sdk');
const { fetchChannels, clearCache, getCacheStats } = require('./lib/m3uParser');
const { fetchEpg, getCurrentProgram, getNextProgram, formatTime, clearEpgCache, getEpgCacheStats } = require('./lib/epgParser');

/**
 * Détecte les sources M3U configurées dans les variables d'environnement
 * @returns {Array} Liste des sources
 */
function detectSources() {
    const sources = [];

    for (let i = 1; i <= 20; i++) {
        const url = process.env[`TVLOO_M3U_URL_${i}`];
        if (url) {
            const name = process.env[`TVLOO_CATALOG_NAME_${i}`] || `TV Channels ${i}`;
            const filterCountry = process.env[`TVLOO_FILTER_COUNTRY_${i}`] || null;
            const filterCategory = process.env[`TVLOO_FILTER_CATEGORY_${i}`] || null;
            const filterChaines = process.env[`TVLOO_CHAINES_${i}`] || null;

            const channels = filterChaines
                ? filterChaines.split('|').map(c => c.trim()).filter(c => c.length > 0)
                : null;

            const filters = (filterCountry || filterCategory || channels) ? {
                country: filterCountry,
                category: filterCategory,
                channels: channels
            } : null;

            sources.push({
                index: i - 1,
                number: i,
                url,
                catalogName: name,
                filters
            });
        }
    }

    return sources;
}

/**
 * Groupe les sources par nom de catalogue
 * @param {Array} sources - Liste des sources
 * @returns {Map} Map catalogName -> [sources]
 */
function groupSourcesByCatalog(sources) {
    const groups = new Map();

    for (const source of sources) {
        const name = source.catalogName;
        if (!groups.has(name)) {
            groups.set(name, []);
        }
        groups.get(name).push(source);
    }

    return groups;
}

/**
 * Normalise un nom de chaîne pour comparaison
 */
function normalizeChannelName(name) {
    return (name || '')
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
        .replace(/^(FR|AF|AR|UK|US|DE|ES|IT|PT):?\s*/i, ''); // Enlever préfixes pays
}

/**
 * Crée et configure l'addon TVLoo
 */
function createAddon(config = {}) {
    const sources = detectSources();
    const epgUrl = process.env.TVLOO_EPG_URL;

    if (sources.length === 0) {
        console.log('[TVLoo] Aucune source M3U configurée (TVLOO_M3U_URL_1, TVLOO_M3U_URL_2, ...)');
        return null;
    }

    // Grouper les sources par nom de catalogue
    const catalogGroups = groupSourcesByCatalog(sources);

    console.log('[TVLoo] Initialisation...');
    console.log(`[TVLoo] ${sources.length} source(s) M3U → ${catalogGroups.size} catalogue(s):`);

    for (const [catalogName, groupSources] of catalogGroups) {
        if (groupSources.length === 1) {
            const s = groupSources[0];
            const filterInfo = [];
            if (s.filters?.country) filterInfo.push(`country=${s.filters.country}`);
            if (s.filters?.category) filterInfo.push(`category=${s.filters.category}`);
            if (s.filters?.channels?.length) filterInfo.push(`${s.filters.channels.length} chaînes`);
            const filterStr = filterInfo.length > 0 ? ` [${filterInfo.join(', ')}]` : '';
            console.log(`  - "${catalogName}" (source ${s.number})${filterStr}`);
        } else {
            console.log(`  - "${catalogName}" (${groupSources.length} sources fusionnées: ${groupSources.map(s => s.number).join(', ')})`);
        }
    }

    if (epgUrl) {
        console.log('[TVLoo] EPG configuré');
    }

    // Générer les catalogues (un par groupe)
    const catalogs = [];
    let catalogIndex = 0;
    const catalogIdToGroup = new Map();

    for (const [catalogName, groupSources] of catalogGroups) {
        const catalogId = `tvloo-catalog-${catalogIndex}`;
        catalogs.push({
            type: 'tv',
            id: catalogId,
            name: catalogName,
            extra: [
                { name: 'search', isRequired: false },
                { name: 'skip', isRequired: false }
            ]
        });
        catalogIdToGroup.set(catalogId, { name: catalogName, sources: groupSources });
        catalogIndex++;
    }

    // Générer les préfixes d'ID
    const idPrefixes = sources.map(s => `tvloo-${s.number}-`);

    const manifest = {
        id: 'com.tvloo.iptv',
        version: '2.1.0',
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
     * Trouve la source par ID de chaîne
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
     * Trouve toutes les sources du même catalogue
     */
    function findSiblingsSources(source) {
        return sources.filter(s => s.catalogName === source.catalogName);
    }

    /**
     * Construit la description avec le programme en cours
     */
    function buildDescription(channel, epgData) {
        const parts = [];

        if (channel.group) {
            parts.push(`📺 ${channel.group}`);
        }

        if (epgData && channel.tvgId) {
            const current = getCurrentProgram(epgData, channel.tvgId);
            if (current) {
                parts.push(`\n▶️ ${current.title}`);
                parts.push(`   ${formatTime(current.start)} - ${formatTime(current.stop)}`);

                const next = getNextProgram(epgData, channel.tvgId);
                if (next) {
                    parts.push(`\n⏭️ ${formatTime(next.start)} : ${next.title}`);
                }
            }
        }

        return parts.length > 0 ? parts.join('\n') : '📺 TV en direct';
    }

    // Catalog handler - fusionne les sources du même catalogue
    builder.defineCatalogHandler(async ({ type, id, extra }) => {
        if (type !== 'tv') {
            return { metas: [] };
        }

        const group = catalogIdToGroup.get(id);
        if (!group) {
            return { metas: [] };
        }

        console.log(`[TVLoo] Catalogue "${group.name}" (${group.sources.length} source(s))`);

        try {
            // Charger toutes les sources du groupe + EPG en parallèle
            const channelsPromises = group.sources.map(s =>
                fetchChannels(s.url, s.index, s.filters)
            );

            const [epgData, ...channelsArrays] = await Promise.all([
                epgUrl ? fetchEpg(epgUrl) : Promise.resolve(null),
                ...channelsPromises
            ]);

            // Fusionner les chaînes (dédupliquer par nom normalisé)
            const seenNames = new Map(); // normalizedName -> channel
            const mergedChannels = [];

            for (const channels of channelsArrays) {
                for (const channel of channels) {
                    const normalized = normalizeChannelName(channel.name);
                    if (!seenNames.has(normalized)) {
                        seenNames.set(normalized, channel);
                        mergedChannels.push(channel);
                    }
                }
            }

            let metas = mergedChannels.map(channel => ({
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

        try {
            const [channels, epgData] = await Promise.all([
                fetchChannels(source.url, source.index, source.filters),
                epgUrl ? fetchEpg(epgUrl) : Promise.resolve(null)
            ]);

            const channel = channels.find(ch => ch.id === id);
            if (!channel) {
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

    // Stream handler - retourne plusieurs streams si la chaîne existe dans plusieurs sources
    builder.defineStreamHandler(async ({ type, id }) => {
        if (type !== 'tv') {
            return { streams: [] };
        }

        const primarySource = findSourceByChannelId(id);
        if (!primarySource) {
            return { streams: [] };
        }

        try {
            // Trouver toutes les sources du même catalogue
            const siblingsSources = findSiblingsSources(primarySource);

            // Charger toutes les sources + EPG
            const channelsPromises = siblingsSources.map(s =>
                fetchChannels(s.url, s.index, s.filters)
            );

            const [epgData, ...channelsArrays] = await Promise.all([
                epgUrl ? fetchEpg(epgUrl) : Promise.resolve(null),
                ...channelsPromises
            ]);

            // Trouver la chaîne principale
            const primaryIndex = siblingsSources.findIndex(s => s.number === primarySource.number);
            const primaryChannels = channelsArrays[primaryIndex];
            const primaryChannel = primaryChannels.find(ch => ch.id === id);

            if (!primaryChannel) {
                return { streams: [] };
            }

            const normalizedName = normalizeChannelName(primaryChannel.name);
            const streams = [];

            // Chercher cette chaîne dans toutes les sources
            for (let i = 0; i < siblingsSources.length; i++) {
                const source = siblingsSources[i];
                const channels = channelsArrays[i];

                const matchingChannel = channels.find(ch =>
                    normalizeChannelName(ch.name) === normalizedName
                );

                if (matchingChannel) {
                    let streamTitle = matchingChannel.name;
                    if (epgData && matchingChannel.tvgId) {
                        const current = getCurrentProgram(epgData, matchingChannel.tvgId);
                        if (current) {
                            streamTitle += `\n▶️ ${current.title}`;
                        }
                    }
                    if (matchingChannel.group) {
                        streamTitle += `\n📺 ${matchingChannel.group}`;
                    }

                    streams.push({
                        name: siblingsSources.length > 1 ? `Source ${source.number}` : 'TVLoo',
                        title: streamTitle,
                        url: matchingChannel.url,
                        behaviorHints: {
                            notWebReady: true
                        }
                    });
                }
            }

            console.log(`[TVLoo] Stream "${primaryChannel.name}": ${streams.length} source(s)`);
            return { streams };

        } catch (error) {
            console.error('[TVLoo] Erreur stream:', error.message);
            return { streams: [] };
        }
    });

    /**
     * Configure les routes Express custom
     */
    function setupRoutes(router) {
        router.get('/stats', (req, res) => {
            const stats = {
                addon: 'TVLoo',
                catalogs: [],
                epg: epgUrl ? getEpgCacheStats() : null
            };

            for (const [catalogName, groupSources] of catalogGroups) {
                stats.catalogs.push({
                    name: catalogName,
                    sources: groupSources.map(s => ({
                        number: s.number,
                        filters: s.filters || null,
                        cache: getCacheStats(s.index)
                    }))
                });
            }

            res.json(stats);
        });

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
