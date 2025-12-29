/**
 * Stream Formatter Addon (adapté pour mono-repo)
 *
 * Agrège et reformatte les streams de plusieurs addons Stremio
 */

const { addonBuilder } = require('stremio-addon-sdk');
const fetch = require('node-fetch');

/**
 * Crée et configure l'addon Stream Formatter
 * @param {Object} config - Configuration
 * @returns {Object} { builder, setupRoutes, manifest }
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
            addons.push({ name, url });
            console.log(`[Formatter] Addon ${index}: ${name}`);
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
     * Parse le titre d'un stream
     */
    function parseStreamTitle(title) {
        const info = { quality: '', type: '', hdr: '', audio: '', size: '', raw: title };
        if (!title) return info;

        const upperTitle = title.toUpperCase();

        // Qualité
        if (upperTitle.includes('2160P') || upperTitle.includes('4K') || upperTitle.includes('UHD')) info.quality = '4K';
        else if (upperTitle.includes('1080P')) info.quality = '1080p';
        else if (upperTitle.includes('720P')) info.quality = '720p';
        else if (upperTitle.includes('480P')) info.quality = '480p';

        // HDR
        if (upperTitle.includes('DOLBY VISION') || upperTitle.includes('DV')) info.hdr = 'DV';
        else if (upperTitle.includes('HDR10+')) info.hdr = 'HDR10+';
        else if (upperTitle.includes('HDR')) info.hdr = 'HDR';

        // Type
        if (upperTitle.includes('REMUX')) info.type = 'REMUX';
        else if (upperTitle.includes('BLURAY') || upperTitle.includes('BLU-RAY')) info.type = 'BluRay';
        else if (upperTitle.includes('WEB-DL') || upperTitle.includes('WEBDL')) info.type = 'WEB-DL';
        else if (upperTitle.includes('WEBRIP')) info.type = 'WEBRip';
        else if (upperTitle.includes('HDTV')) info.type = 'HDTV';

        // Audio
        if (upperTitle.includes('ATMOS')) info.audio = 'Atmos';
        else if (upperTitle.includes('TRUEHD')) info.audio = 'TrueHD';
        else if (upperTitle.includes('DTS-HD')) info.audio = 'DTS-HD';
        else if (upperTitle.includes('DTS')) info.audio = 'DTS';
        else if (upperTitle.includes('DD+') || upperTitle.includes('DDP') || upperTitle.includes('EAC3')) info.audio = 'DD+';
        else if (upperTitle.includes('5.1') || upperTitle.includes('AC3')) info.audio = '5.1';

        // Taille
        const sizeMatch = title.match(/(\d+\.?\d*)\s*(GB|MB|TB)/i);
        if (sizeMatch) info.size = `${sizeMatch[1]} ${sizeMatch[2].toUpperCase()}`;

        return info;
    }

    /**
     * Formate un stream
     */
    function formatStream(stream, info, addonName) {
        const parts = [];
        if (info.quality === '4K') parts.push('🎬 4K');
        else if (info.quality) parts.push(`📺 ${info.quality}`);
        if (info.hdr) parts.push(info.hdr);
        if (info.type) parts.push(info.type);
        if (info.audio) parts.push(info.audio);
        if (info.size) parts.push(info.size);
        parts.push(`[${addonName}]`);

        return {
            ...stream,
            name: parts.join(' • '),
            title: stream.title || info.raw,
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
                timeout: 10000,
                headers: { 'User-Agent': 'Stremio-Addon-Formatter/1.0' }
            });

            if (!response.ok) return [];

            const data = await response.json();
            const streams = data.streams || [];

            return streams.map(stream => {
                const info = parseStreamTitle(stream.title || stream.name || '');
                return formatStream(stream, info, addon.name);
            });
        } catch (error) {
            console.error(`[Formatter] Erreur ${addon.name}:`, error.message);
            return [];
        }
    }

    /**
     * Trie les streams par qualité
     */
    function sortStreams(streams) {
        const qualityOrder = { '4K': 0, '1080p': 1, '720p': 2, '480p': 3, '': 4 };
        return streams.sort((a, b) => {
            const infoA = parseStreamTitle(a.title || a.name || '');
            const infoB = parseStreamTitle(b.title || b.name || '');
            return (qualityOrder[infoA.quality] ?? 4) - (qualityOrder[infoB.quality] ?? 4);
        });
    }

    // Charge les addons
    const ADDONS = loadAddons();

    if (ADDONS.length === 0) {
        console.warn('[Formatter] Addon désactivé (aucune source configurée)');
        return null;
    }

    // Manifest
    const manifest = {
        id: 'community.stream.formatter',
        version: '1.0.0',
        name: 'Stream Formatter',
        description: 'Agrège et reformatte les streams de plusieurs addons',
        logo: 'https://i.imgur.com/qlfRzoT.png',
        catalogs: [],
        resources: ['stream'],
        types: ['movie', 'series'],
        idPrefixes: ['tt']
    };

    const builder = new addonBuilder(manifest);

    // Stream handler
    builder.defineStreamHandler(async ({ type, id }) => {
        console.log(`[Formatter] Stream: ${type} ${id}`);

        const promises = ADDONS.map(addon => fetchStreamsFromAddon(addon, type, id));
        const results = await Promise.all(promises);
        let allStreams = sortStreams(results.flat());

        console.log(`[Formatter] ${allStreams.length} streams combinés`);
        return { streams: allStreams };
    });

    /**
     * Configure les routes Express
     */
    function setupRoutes(router) {
        router.get('/stats', (req, res) => {
            res.json({
                addons: ADDONS.map(a => a.name),
                count: ADDONS.length
            });
        });
    }

    return {
        builder,
        manifest,
        setupRoutes,
        name: 'formatter'
    };
}

module.exports = createAddon;
