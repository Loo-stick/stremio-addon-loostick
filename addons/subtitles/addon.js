/**
 * Subtitles FR Addon (adapté pour mono-repo)
 *
 * Sous-titres français depuis OpenSubtitles et SubDL
 */

const { addonBuilder } = require('stremio-addon-sdk');
const OpenSubtitlesClient = require('./lib/opensubtitles');
const { RateLimitError } = require('./lib/opensubtitles');
const SubDLClient = require('./lib/subdl');
const CinemetaClient = require('./lib/cinemeta');
const SubtitleChecker = require('./lib/subtitle-checker');
const PersistentCache = require('./lib/cache');

/**
 * Crée et configure l'addon Subtitles
 * @param {Object} config - Configuration
 * @returns {Object} { builder, setupRoutes, manifest }
 */
function createAddon(config = {}) {
    const {
        osApiKey = process.env.OPENSUBTITLES_API_KEY,
        osUserAgent = process.env.OPENSUBTITLES_USER_AGENT || 'stremio-subtitles-fr v1.0',
        subdlApiKey = process.env.SUBDL_API_KEY,
        subdlEnabled = process.env.SUBDL_ENABLED !== 'false',
        enableMeta = process.env.ENABLE_META !== 'false',
        badgeInTitle = process.env.BADGE_IN_TITLE === 'true',
        cacheTtlDays = parseInt(process.env.CACHE_TTL_DAYS, 10) || 7,
        subtitlesCacheTtlHours = parseInt(process.env.SUBTITLES_CACHE_TTL_HOURS, 10) || 24
    } = config;

    let addonUrl = config.addonUrl || 'http://localhost:7000/subtitles';

    // Cache pour les recherches de sous-titres
    class SubtitlesCache {
        constructor(ttlMs) {
            this.cache = new Map();
            this.ttl = ttlMs;
            this.hits = 0;
            this.misses = 0;
            this.cleanupInterval = setInterval(() => this.cleanup(), 30 * 60 * 1000);
        }

        generateKey(type, id) {
            return `${type}:${id}`;
        }

        get(type, id) {
            const key = this.generateKey(type, id);
            const item = this.cache.get(key);
            if (!item) { this.misses++; return null; }
            if (Date.now() > item.expiry) { this.cache.delete(key); this.misses++; return null; }
            this.hits++;
            return item.subtitles;
        }

        set(type, id, subtitles) {
            const key = this.generateKey(type, id);
            this.cache.set(key, { subtitles, expiry: Date.now() + this.ttl, timestamp: Date.now() });
        }

        cleanup() {
            const now = Date.now();
            for (const [key, item] of this.cache.entries()) {
                if (now > item.expiry) this.cache.delete(key);
            }
        }

        stats() {
            return {
                entries: this.cache.size,
                hits: this.hits,
                misses: this.misses,
                hitRate: this.hits + this.misses > 0 ? ((this.hits / (this.hits + this.misses)) * 100).toFixed(1) + '%' : 'N/A'
            };
        }

        stop() {
            if (this.cleanupInterval) clearInterval(this.cleanupInterval);
        }
    }

    const subtitlesCache = new SubtitlesCache(subtitlesCacheTtlHours * 60 * 60 * 1000);

    // Initialisation des clients
    let osClient = null;
    let subdlClient = null;
    const sources = [];

    if (osApiKey && osApiKey !== 'your_api_key_here') {
        osClient = new OpenSubtitlesClient(osApiKey, osUserAgent);
        sources.push('OpenSubtitles');
        console.log('[Subtitles] Source activée: OpenSubtitles');
    }

    if (subdlEnabled && subdlApiKey && subdlApiKey !== 'your_api_key_here') {
        subdlClient = new SubDLClient(subdlApiKey);
        sources.push('SubDL');
        console.log('[Subtitles] Source activée: SubDL');
    } else if (!subdlEnabled && subdlApiKey) {
        console.log('[Subtitles] SubDL désactivé via SUBDL_ENABLED=false');
    }

    if (sources.length === 0) {
        console.warn('[Subtitles] Aucune source configurée - addon désactivé');
        return null;
    }

    // Meta clients
    let cinemetaClient = null;
    let subtitleChecker = null;
    let metaCache = null;
    const hasMetaSource = osApiKey || subdlApiKey;

    if (enableMeta && hasMetaSource) {
        cinemetaClient = new CinemetaClient();
        subtitleChecker = new SubtitleChecker({ osApiKey, osUserAgent, subdlApiKey });
        metaCache = new PersistentCache({ ttl: cacheTtlDays * 24 * 60 * 60 * 1000 });
    }

    // Manifest
    const resources = ['subtitles'];
    if (enableMeta && hasMetaSource) resources.unshift('meta');

    const manifest = {
        id: 'community.subtitles.fr',
        version: '1.7.0',
        name: 'Subtitles FR',
        description: `Sous-titres français (${sources.join(' + ')})${enableMeta && hasMetaSource ? ' + Info dispo' : ''}`,
        logo: 'https://www.opensubtitles.org/favicon.ico',
        catalogs: [],
        resources: resources,
        types: ['movie', 'series'],
        idPrefixes: ['tt'],
        behaviorHints: { configurable: false, configurationRequired: false }
    };

    const builder = new addonBuilder(manifest);

    // Helper functions
    function parseId(id, type, extra = {}) {
        const result = { imdbId: null, type, season: null, episode: null, videoHash: extra.videoHash || null, videoSize: extra.videoSize ? parseInt(extra.videoSize, 10) : null, filename: extra.filename || null };
        if (!id) return result;
        if (type === 'series' && id.includes(':')) {
            const parts = id.split(':');
            result.imdbId = parts[0];
            result.season = parseInt(parts[1], 10) || null;
            result.episode = parseInt(parts[2], 10) || null;
        } else {
            result.imdbId = id.split(':')[0];
        }
        if (!result.imdbId || !result.imdbId.match(/^tt\d+$/)) result.imdbId = null;
        return result;
    }

    function parseReleaseName(filename) {
        if (!filename) return {};
        const result = { original: filename, normalized: filename.toLowerCase().replace(/[._-]/g, ' '), group: null, quality: null, source: null, codec: null, year: null };
        const groupMatch = filename.match(/-([A-Za-z0-9]+)(?:\.[a-z]{2,4})?$/i);
        if (groupMatch) result.group = groupMatch[1].toUpperCase();
        if (/2160p|4k|uhd/i.test(filename)) result.quality = '2160p';
        else if (/1080p/i.test(filename)) result.quality = '1080p';
        else if (/720p/i.test(filename)) result.quality = '720p';
        return result;
    }

    function calculateMatchScore(subtitle, videoInfo, hashMatch = false) {
        if (hashMatch) return 100;
        let score = 0;
        const subInfo = parseReleaseName(subtitle.release || subtitle.SubFileName || '');
        if (videoInfo.group && subInfo.group && videoInfo.group === subInfo.group) score += 40;
        if (videoInfo.quality && subInfo.quality && videoInfo.quality === subInfo.quality) score += 20;
        return score;
    }

    function sortSubtitlesByMatch(subtitles, parsed) {
        if (!parsed.filename && !parsed.videoHash) return subtitles;
        const videoInfo = parseReleaseName(parsed.filename);
        return subtitles.map(sub => ({ ...sub, _score: calculateMatchScore(sub, videoInfo, sub._hashMatch === true) }))
            .sort((a, b) => b._score - a._score)
            .map(sub => { const c = { ...sub }; delete c._score; delete c._release; delete c._hashMatch; return c; });
    }

    async function searchOpenSubtitles(parsed) {
        try {
            const searchResult = await osClient.searchSubtitles({ imdbId: parsed.imdbId, type: parsed.type, season: parsed.season, episode: parsed.episode, videoHash: parsed.videoHash, videoSize: parsed.videoSize });
            if (searchResult.subtitles.length === 0) return [];
            return osClient.formatForStremio(searchResult, addonUrl);
        } catch (error) {
            console.error('[Subtitles] Erreur OpenSubtitles:', error.message);
            return [];
        }
    }

    async function searchSubDL(parsed) {
        try {
            const subtitles = await subdlClient.searchSubtitles({ imdbId: parsed.imdbId, type: parsed.type, season: parsed.season, episode: parsed.episode });
            if (subtitles.length === 0) return [];
            return subdlClient.formatForStremio(subtitles);
        } catch (error) {
            console.error('[Subtitles] Erreur SubDL:', error.message);
            return [];
        }
    }

    function enrichDescription(originalDesc, subtitleInfo) {
        let prefix = '';
        if (subtitleInfo === null) prefix = 'Sous-titres FR : info non disponible\n\n';
        else if (subtitleInfo.available) {
            const details = [];
            if (subtitleInfo.sources?.os?.count) details.push(`OS:${subtitleInfo.sources.os.count}`);
            if (subtitleInfo.sources?.subdl?.count) details.push(`SubDL:${subtitleInfo.sources.subdl.count}`);
            prefix = `Sous-titres FR disponibles${details.length > 0 ? ` (${details.join(', ')})` : ''}\n\n`;
        } else prefix = 'Pas de sous-titres FR disponibles\n\n';
        return prefix + (originalDesc || '');
    }

    function enrichReleaseInfo(originalReleaseInfo, subtitleInfo) {
        const base = originalReleaseInfo || '';
        if (subtitleInfo === null) return base;
        if (subtitleInfo.available) return base ? `${base} 🇫🇷` : '🇫🇷 Subs FR';
        return base;
    }

    // Subtitles handler
    builder.defineSubtitlesHandler(async (args) => {
        const { type, id, extra } = args;
        console.log(`[Subtitles] Requête: ${type} ${id}`);

        try {
            const parsed = parseId(id, type, extra || {});
            if (!parsed.imdbId) return { subtitles: [] };

            const cachedSubtitles = subtitlesCache.get(type, id);
            if (cachedSubtitles !== null) {
                console.log(`[Subtitles] Cache HIT - ${cachedSubtitles.length} sous-titres`);
                return { subtitles: sortSubtitlesByMatch(cachedSubtitles, parsed) };
            }

            const searchPromises = [];
            if (osClient) searchPromises.push(searchOpenSubtitles(parsed));
            if (subdlClient) searchPromises.push(searchSubDL(parsed));

            const results = await Promise.all(searchPromises);
            const allSubtitles = results.flat();

            subtitlesCache.set(type, id, allSubtitles);
            console.log(`[Subtitles] ${allSubtitles.length} sous-titres trouvés`);

            return { subtitles: sortSubtitlesByMatch(allSubtitles, parsed) };
        } catch (error) {
            console.error('[Subtitles] Erreur:', error.message);
            return { subtitles: [] };
        }
    });

    // Meta handler (conditionnel)
    if (enableMeta && cinemetaClient && subtitleChecker) {
        builder.defineMetaHandler(async (args) => {
            const { type, id } = args;
            const imdbId = id.split(':')[0];
            if (!imdbId || !imdbId.match(/^tt\d+$/)) return { meta: null };

            try {
                let subtitleInfo = metaCache.get(imdbId);
                const needsCheck = subtitleInfo === null;
                const promises = [cinemetaClient.getMeta(type, imdbId)];
                if (needsCheck) promises.push(subtitleChecker.checkAll(imdbId, type));

                const results = await Promise.all(promises);
                const meta = results[0];
                if (needsCheck) {
                    subtitleInfo = results[1];
                    if (subtitleInfo !== null) metaCache.set(imdbId, subtitleInfo);
                }

                if (!meta) return { meta: null };
                meta.description = enrichDescription(meta.description, subtitleInfo);
                if (badgeInTitle) meta.releaseInfo = enrichReleaseInfo(meta.releaseInfo || meta.year, subtitleInfo);

                return { meta };
            } catch (error) {
                console.error('[Subtitles] Erreur meta:', error.message);
                return { meta: null };
            }
        });
    }

    /**
     * Configure les routes Express pour cet addon
     * @param {Express.Router} router - Router Express
     */
    function setupRoutes(router) {
        // Proxy OpenSubtitles
        router.get('/proxy/os/:fileId', async (req, res) => {
            const { fileId } = req.params;
            if (!fileId || !/^\d+$/.test(fileId)) return res.status(400).send('Invalid file ID');
            if (!osClient) return res.status(503).send('OpenSubtitles not configured');

            try {
                const downloadUrl = await osClient.getDownloadLink(parseInt(fileId, 10));
                if (!downloadUrl) return res.status(404).send('Subtitle not found');
                return res.redirect(downloadUrl);
            } catch (error) {
                if (error instanceof RateLimitError) {
                    if (error.retryAfter) res.set('Retry-After', error.retryAfter);
                    return res.status(429).send('Rate limit exceeded');
                }
                return res.status(500).send('Internal server error');
            }
        });

        // Stats
        router.get('/stats', (req, res) => {
            res.json({
                sources,
                subtitlesCache: subtitlesCache.stats(),
                metaCache: metaCache ? metaCache.stats() : null
            });
        });
    }

    /**
     * Met à jour l'URL de l'addon (pour le proxy)
     */
    function setAddonUrl(url) {
        addonUrl = url;
    }

    return {
        builder,
        manifest,
        setupRoutes,
        setAddonUrl,
        name: 'subtitles'
    };
}

module.exports = createAddon;
