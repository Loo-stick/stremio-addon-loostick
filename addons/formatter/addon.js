/**
 * Stream Formatter Addon (adapté pour mono-repo)
 *
 * Agrège et reformatte les streams de plusieurs addons Stremio
 * Format inspiré d'AIOStreams
 *
 * Routes créées dynamiquement:
 * - /formatter/manifest.json → Tous les streams combinés
 * - /formatter/{addon}/manifest.json → Streams d'un seul addon
 */

const { addonBuilder, getRouter } = require('stremio-addon-sdk');
const fetch = require('node-fetch');

/**
 * Crée et configure l'addon Stream Formatter
 * @param {Object} config - Configuration
 * @returns {Object} { builder, setupRoutes, manifest, subAddons }
 */
function createAddon(config = {}) {
    const torboxApiKey = config.torboxApiKey || process.env.TORBOX_API_KEY || '';

    /**
     * Charge les addons depuis les variables d'environnement
     */
    function loadAddons() {
        const addons = [];
        let index = 1;

        while (process.env[`FORMATTER_ADDON_${index}`]) {
            let url = process.env[`FORMATTER_ADDON_${index}`];

            // Substitue {TORBOX_API_KEY} dans l'URL
            if (torboxApiKey) {
                url = url.replace(/\{TORBOX_API_KEY\}/g, torboxApiKey);
            }

            const name = extractAddonName(url);
            const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '-');
            const service = extractServiceInfo(url);
            addons.push({ name, slug, url, service });
            console.log(`[Formatter] Addon ${index}: ${name} (${service.shortName}) → /${slug}`);
            index++;
        }

        if (addons.length === 0) {
            console.warn('[Formatter] Aucun addon configuré (FORMATTER_ADDON_1, etc.)');
        }

        return addons;
    }

    /**
     * Extrait un nom lisible depuis l'URL
     */
    function extractAddonName(url) {
        try {
            const hostname = new URL(url).hostname;
            const knownAddons = {
                'torrentio.strem.fun': 'Torrentio',
                'stremio-fr.aymene69.workers.dev': 'StremioFR',
                'wastream': 'WAStream',
                'comet': 'Comet',
                'aiostreams': 'AIOStreams',
                'mediafusion': 'MediaFusion',
                'torbox': 'TorBox',
            };
            for (const [key, name] of Object.entries(knownAddons)) {
                if (hostname.includes(key)) return name;
            }
            return hostname.split('.')[0];
        } catch {
            return 'Unknown';
        }
    }

    /**
     * Extrait les infos du service debrid depuis l'URL
     */
    function extractServiceInfo(url) {
        const lowerUrl = url.toLowerCase();

        if (lowerUrl.includes('torbox')) {
            return { name: 'TorBox', shortName: 'TB', type: 'debrid' };
        } else if (lowerUrl.includes('realdebrid') || lowerUrl.includes('rd=')) {
            return { name: 'RealDebrid', shortName: 'RD', type: 'debrid' };
        } else if (lowerUrl.includes('alldebrid') || lowerUrl.includes('ad=')) {
            return { name: 'AllDebrid', shortName: 'AD', type: 'debrid' };
        } else if (lowerUrl.includes('premiumize') || lowerUrl.includes('pm=')) {
            return { name: 'Premiumize', shortName: 'PM', type: 'debrid' };
        } else if (lowerUrl.includes('debridlink') || lowerUrl.includes('dl=')) {
            return { name: 'DebridLink', shortName: 'DL', type: 'debrid' };
        }

        return { name: 'P2P', shortName: 'P2P', type: 'p2p' };
    }

    /**
     * Parse le titre d'un stream pour extraire les métadonnées
     */
    function parseStreamTitle(title, streamName) {
        const info = {
            quality: '',
            resolution: '',
            type: '',
            hdr: '',
            audio: '',
            size: '',
            seeders: '',
            extension: '',
            filename: '',
            indexer: '',
            languages: [],
            cached: false,
            raw: title
        };

        if (!title && !streamName) return info;

        const fullText = `${title || ''} ${streamName || ''}`;
        const upperText = fullText.toUpperCase();

        // Cached (⚡ ou + dans le nom)
        if (fullText.includes('⚡') || fullText.includes('[+]') || fullText.includes('(+)')) {
            info.cached = true;
        }

        // Qualité
        if (upperText.includes('2160P') || upperText.includes('4K') || upperText.includes('UHD')) {
            info.quality = '4K';
            info.resolution = '2160p';
        } else if (upperText.includes('1080P')) {
            info.quality = 'FHD';
            info.resolution = '1080p';
        } else if (upperText.includes('720P')) {
            info.quality = 'HD';
            info.resolution = '720p';
        } else if (upperText.includes('480P')) {
            info.quality = 'SD';
            info.resolution = '480p';
        } else if (upperText.includes('CAM') || upperText.includes('HDCAM')) {
            info.quality = 'CAM';
            info.resolution = 'CAM';
        }

        // HDR
        if (upperText.includes('DOLBY VISION') || upperText.includes(' DV ') || upperText.includes('.DV.')) {
            info.hdr = 'DV';
        } else if (upperText.includes('HDR10+')) {
            info.hdr = 'HDR10+';
        } else if (upperText.includes('HDR')) {
            info.hdr = 'HDR';
        }

        // Type de source
        if (upperText.includes('REMUX')) {
            info.type = 'REMUX';
        } else if (upperText.includes('BLURAY') || upperText.includes('BLU-RAY') || upperText.includes('BDREMUX')) {
            info.type = 'BluRay';
        } else if (upperText.includes('WEB-DL') || upperText.includes('WEBDL')) {
            info.type = 'WEB-DL';
        } else if (upperText.includes('WEBRIP')) {
            info.type = 'WEBRip';
        } else if (upperText.includes('HDTV')) {
            info.type = 'HDTV';
        } else if (upperText.includes('HDRIP')) {
            info.type = 'HDRip';
        } else if (upperText.includes('DVDRIP')) {
            info.type = 'DVDRip';
        }

        // Audio
        if (upperText.includes('ATMOS')) {
            info.audio = 'Atmos';
        } else if (upperText.includes('TRUEHD')) {
            info.audio = 'TrueHD';
        } else if (upperText.includes('DTS-HD') || upperText.includes('DTS:X')) {
            info.audio = 'DTS-HD';
        } else if (upperText.includes('DTS')) {
            info.audio = 'DTS';
        } else if (upperText.includes('DD+') || upperText.includes('DDP') || upperText.includes('EAC3') || upperText.includes('E-AC-3')) {
            info.audio = 'DD+';
        } else if (upperText.includes('DD5.1') || upperText.includes('AC3') || upperText.includes('5.1')) {
            info.audio = '5.1';
        } else if (upperText.includes('AAC')) {
            info.audio = 'AAC';
        }

        // Taille
        const sizeMatch = fullText.match(/(\d+\.?\d*)\s*(GB|MB|TB)/i);
        if (sizeMatch) {
            info.size = `${sizeMatch[1]} ${sizeMatch[2].toUpperCase()}`;
        }

        // Seeders (👤 123 ou Seeds: 123)
        const seedersMatch = fullText.match(/👤\s*(\d+)|seeds?:?\s*(\d+)/i);
        if (seedersMatch) {
            info.seeders = seedersMatch[1] || seedersMatch[2];
        }

        // Extension
        const extMatch = fullText.match(/\.(mkv|mp4|avi|webm)/i);
        if (extMatch) {
            info.extension = extMatch[1].toLowerCase();
        } else {
            info.extension = 'mkv';
        }

        // Filename
        const filenameMatch = fullText.match(/([A-Za-z0-9._-]+\.(mkv|mp4|avi))/i);
        if (filenameMatch) {
            info.filename = filenameMatch[1];
        } else {
            info.filename = (title || streamName || '').split('\n')[0].substring(0, 60);
        }

        // Indexer
        const indexerPatterns = [
            { pattern: /\[([A-Z0-9]+)\]/i, group: 1 },
            { pattern: /⚙️\s*([A-Za-z0-9]+)/i, group: 1 },
            { pattern: /YTS|YIFY/i, value: 'YTS' },
            { pattern: /RARBG/i, value: 'RARBG' },
            { pattern: /1337X/i, value: '1337x' },
            { pattern: /TPB|PIRATEBAY/i, value: 'TPB' },
            { pattern: /EZTV/i, value: 'EZTV' },
            { pattern: /NYAA/i, value: 'Nyaa' },
            { pattern: /TORRENTGALAXY|TGX/i, value: 'TGx' },
        ];

        for (const { pattern, group, value } of indexerPatterns) {
            const match = fullText.match(pattern);
            if (match) {
                info.indexer = value || match[group];
                break;
            }
        }

        // Languages
        const langPatterns = [
            { pattern: /🇫🇷|FRENCH|TRUEFRENCH|VFF|VFI|VF2/i, code: 'FR' },
            { pattern: /🇬🇧|🇺🇸|ENGLISH|ENG\b/i, code: 'EN' },
            { pattern: /MULTI/i, code: 'MULTI' },
            { pattern: /🇪🇸|SPANISH|ESP\b/i, code: 'ES' },
            { pattern: /🇩🇪|GERMAN|GER\b/i, code: 'DE' },
            { pattern: /🇮🇹|ITALIAN|ITA\b/i, code: 'IT' },
            { pattern: /🇯🇵|JAPANESE|JAP\b/i, code: 'JP' },
            { pattern: /🇰🇷|KOREAN|KOR\b/i, code: 'KR' },
            { pattern: /VOSTFR/i, code: 'VOSTFR' },
        ];

        for (const { pattern, code } of langPatterns) {
            if (pattern.test(fullText)) {
                if (!info.languages.includes(code)) {
                    info.languages.push(code);
                }
            }
        }

        return info;
    }

    /**
     * Formate un stream selon le template AIOStreams
     */
    function formatStream(stream, addonName, service) {
        const info = parseStreamTitle(stream.title, stream.name);

        const isDebrid = service.type === 'debrid';
        const isCached = info.cached || stream.name?.includes('⚡') || stream.name?.includes('[+]');

        // NAME
        let nameParts = [];
        nameParts.push(`🔍${addonName}`);
        nameParts.push(`${service.shortName}${isCached ? '⚡' : ''}`);
        if (isDebrid) {
            nameParts.push('🧲 DB');
        } else {
            nameParts.push('[P2P]');
        }
        const formattedName = nameParts.join(' | ');

        // DESCRIPTION
        let descParts = [];

        const qualityParts = [info.quality, info.resolution, info.type, info.hdr].filter(Boolean);
        if (qualityParts.length > 0) {
            descParts.push(`ℹ️ ${qualityParts.join(' / ')} / ${info.extension}`);
        }

        if (info.filename) {
            descParts.push(`🎬 ${info.filename}`);
        }

        if (info.indexer) {
            descParts.push(`🔍 ${info.indexer}`);
        }

        if (info.size) {
            descParts.push(`💾 ${info.size}`);
        }

        if (info.languages.length > 0) {
            descParts.push(`🔊 ${info.languages.join(' ')}`);
        }

        if (info.seeders) {
            descParts.push(`👤 ${info.seeders}`);
        }

        if (info.audio) {
            descParts.push(`🔉 ${info.audio}`);
        }

        const formattedTitle = descParts.join('\n');

        return {
            ...stream,
            name: formattedName,
            title: formattedTitle,
            behaviorHints: stream.behaviorHints || {}
        };
    }

    /**
     * Récupère les streams d'un addon
     */
    async function fetchStreamsFromAddon(addon, type, id) {
        try {
            const baseUrl = addon.url.replace('/manifest.json', '');
            const streamUrl = `${baseUrl}/stream/${type}/${id}.json`;

            console.log(`[Formatter] Fetch ${addon.name}`);

            const response = await fetch(streamUrl, {
                timeout: 15000,
                headers: { 'User-Agent': 'Stremio-Addon-Formatter/1.0' }
            });

            if (!response.ok) return [];

            const data = await response.json();
            const streams = data.streams || [];

            console.log(`[Formatter] ${addon.name}: ${streams.length} streams`);

            return streams.map(stream => formatStream(stream, addon.name, addon.service));
        } catch (error) {
            console.error(`[Formatter] Erreur ${addon.name}:`, error.message);
            return [];
        }
    }

    /**
     * Trie les streams par qualité
     */
    function sortStreams(streams) {
        const qualityOrder = { '4K': 0, 'FHD': 1, 'HD': 2, 'SD': 3, 'CAM': 4, '': 5 };

        return streams.sort((a, b) => {
            const infoA = parseStreamTitle(a.title, a.name);
            const infoB = parseStreamTitle(b.title, b.name);

            if (infoA.cached !== infoB.cached) {
                return infoA.cached ? -1 : 1;
            }

            const orderA = qualityOrder[infoA.quality] ?? 5;
            const orderB = qualityOrder[infoB.quality] ?? 5;
            return orderA - orderB;
        });
    }

    /**
     * Crée un builder pour un addon spécifique ou combiné
     */
    function createBuilder(addonInfo, isCombined = false) {
        const manifest = {
            id: isCombined
                ? 'community.stream.formatter'
                : `community.stream.formatter.${addonInfo.slug}`,
            version: '1.2.0',
            name: isCombined
                ? 'Formatter (All)'
                : `Formatter ${addonInfo.name}`,
            description: isCombined
                ? `Streams combinés de ${ADDONS.map(a => a.name).join(', ')}`
                : `Streams ${addonInfo.name} reformatés`,
            logo: 'https://i.imgur.com/qlfRzoT.png',
            catalogs: [],
            resources: ['stream'],
            types: ['movie', 'series'],
            idPrefixes: ['tt']
        };

        const builder = new addonBuilder(manifest);

        builder.defineStreamHandler(async ({ type, id }) => {
            console.log(`[Formatter${isCombined ? '' : '/' + addonInfo.slug}] Stream: ${type} ${id}`);

            let streams = [];

            if (isCombined) {
                const promises = ADDONS.map(addon => fetchStreamsFromAddon(addon, type, id));
                const results = await Promise.all(promises);
                streams = results.flat();
            } else {
                streams = await fetchStreamsFromAddon(addonInfo, type, id);
            }

            streams = sortStreams(streams);
            console.log(`[Formatter] ${streams.length} streams`);

            return { streams };
        });

        return { builder, manifest };
    }

    // Charge les addons
    const ADDONS = loadAddons();

    if (ADDONS.length === 0) {
        console.warn('[Formatter] Addon désactivé (aucune source configurée)');
        return null;
    }

    // Crée le builder combiné (principal)
    const { builder: mainBuilder, manifest: mainManifest } = createBuilder(null, true);

    // Crée les builders individuels
    const subAddons = ADDONS.map(addon => {
        const { builder, manifest } = createBuilder(addon, false);
        return { addon, builder, manifest };
    });

    /**
     * Configure les routes Express
     */
    function setupRoutes(router) {
        // Route stats
        router.get('/stats', (req, res) => {
            res.json({
                addons: ADDONS.map(a => ({
                    name: a.name,
                    slug: a.slug,
                    service: a.service.shortName,
                    manifest: `/${a.slug}/manifest.json`
                })),
                count: ADDONS.length
            });
        });

        // Routes pour chaque addon individuel
        subAddons.forEach(({ addon, builder }) => {
            console.log(`[Formatter] Route: /${addon.slug}/manifest.json`);
            router.use(`/${addon.slug}`, getRouter(builder.getInterface()));
        });
    }

    return {
        builder: mainBuilder,
        manifest: mainManifest,
        setupRoutes,
        subAddons,
        name: 'formatter'
    };
}

module.exports = createAddon;
