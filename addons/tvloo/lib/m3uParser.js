/**
 * Parseur M3U pour TVLoo
 *
 * Télécharge et parse des fichiers M3U depuis des URLs distantes
 * avec gestion de cache intelligent par source
 */

const fetch = require('node-fetch');

// Durée du cache (30 minutes)
const CACHE_DURATION = 30 * 60 * 1000;

// Cache en mémoire par source (clé = index de la source)
const cache = new Map();

/**
 * Parse le contenu M3U et extrait les chaînes
 * @param {string} content - Contenu brut du fichier M3U
 * @param {string} idPrefix - Préfixe pour les IDs (ex: 'tvloo-1-')
 * @returns {Array} Liste des chaînes parsées
 */
function parseM3U(content, idPrefix = 'tvloo-') {
    const lines = content.split('\n');
    const channels = [];
    let currentChannel = null;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        if (line.startsWith('#EXTINF:')) {
            currentChannel = {};

            // Extraire tvg-name (nom propre de la chaîne)
            const tvgNameMatch = line.match(/tvg-name="([^"]*)"/);
            if (tvgNameMatch) {
                currentChannel.tvgName = tvgNameMatch[1];
            }

            // Extraire l'ID tvg-id
            const idMatch = line.match(/tvg-id="([^"]*)"/);
            if (idMatch) {
                currentChannel.tvgId = idMatch[1];
            }

            // Extraire le logo
            const logoMatch = line.match(/tvg-logo="([^"]*)"/);
            if (logoMatch) {
                currentChannel.logo = logoMatch[1];
            }

            // Extraire le groupe
            const groupMatch = line.match(/group-title="([^"]*)"/);
            if (groupMatch) {
                currentChannel.group = groupMatch[1];
            }

            // Extraire le nom après la DERNIÈRE virgule (fallback)
            const lastCommaIndex = line.lastIndexOf(',');
            if (lastCommaIndex !== -1) {
                currentChannel.displayName = line.substring(lastCommaIndex + 1).trim();
            }

            // Utiliser tvg-name en priorité, sinon displayName
            currentChannel.name = currentChannel.tvgName || currentChannel.displayName || 'Chaîne inconnue';

        } else if (line && !line.startsWith('#') && currentChannel) {
            // C'est l'URL du stream
            currentChannel.url = line;
            currentChannel.id = idPrefix + Buffer.from(currentChannel.name || Date.now().toString()).toString('base64').replace(/[^a-zA-Z0-9]/g, '');
            channels.push(currentChannel);
            currentChannel = null;
        }
    }

    return channels;
}

/**
 * Récupère les chaînes depuis un fichier M3U (avec cache par source)
 * @param {string} m3uUrl - URL du fichier M3U
 * @param {number} sourceIndex - Index de la source (pour le cache et les IDs)
 * @returns {Promise<Array>} Liste des chaînes
 */
async function fetchChannels(m3uUrl, sourceIndex = 0) {
    if (!m3uUrl) {
        console.error('[TVLoo] URL M3U non fournie');
        return [];
    }

    const cacheKey = `source-${sourceIndex}`;
    const now = Date.now();
    const cached = cache.get(cacheKey);

    // Retourner le cache si encore valide
    if (cached && cached.channels && (now - cached.time) < CACHE_DURATION) {
        console.log(`[TVLoo] Source ${sourceIndex + 1}: retour depuis le cache`);
        return cached.channels;
    }

    try {
        console.log(`[TVLoo] Source ${sourceIndex + 1}: téléchargement M3U...`);

        const response = await fetch(m3uUrl, {
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const content = await response.text();
        const idPrefix = `tvloo-${sourceIndex + 1}-`;
        const channels = parseM3U(content, idPrefix);

        cache.set(cacheKey, {
            channels,
            time: now
        });

        console.log(`[TVLoo] Source ${sourceIndex + 1}: ${channels.length} chaînes trouvées`);
        return channels;

    } catch (error) {
        console.error(`[TVLoo] Source ${sourceIndex + 1}: erreur téléchargement -`, error.message);
        // Retourner le cache même expiré en cas d'erreur
        if (cached && cached.channels) {
            console.log(`[TVLoo] Source ${sourceIndex + 1}: utilisation du cache expiré`);
            return cached.channels;
        }
        return [];
    }
}

/**
 * Vide le cache d'une source ou de toutes les sources
 * @param {number|null} sourceIndex - Index de la source (null = toutes)
 */
function clearCache(sourceIndex = null) {
    if (sourceIndex !== null) {
        cache.delete(`source-${sourceIndex}`);
        console.log(`[TVLoo] Cache source ${sourceIndex + 1} vidé`);
    } else {
        cache.clear();
        console.log('[TVLoo] Tout le cache M3U vidé');
    }
}

/**
 * Retourne les statistiques du cache
 * @param {number|null} sourceIndex - Index de la source (null = toutes)
 */
function getCacheStats(sourceIndex = null) {
    if (sourceIndex !== null) {
        const cached = cache.get(`source-${sourceIndex}`);
        return {
            source: sourceIndex + 1,
            hasCachedData: !!cached,
            channelCount: cached ? cached.channels.length : 0,
            cacheAge: cached ? Date.now() - cached.time : null,
            cacheExpired: cached ? (Date.now() - cached.time) > CACHE_DURATION : true
        };
    }

    // Stats de toutes les sources
    const stats = [];
    for (const [key, value] of cache.entries()) {
        const idx = parseInt(key.replace('source-', ''));
        stats.push({
            source: idx + 1,
            channelCount: value.channels.length,
            cacheAge: Date.now() - value.time,
            cacheExpired: (Date.now() - value.time) > CACHE_DURATION
        });
    }
    return stats;
}

module.exports = {
    fetchChannels,
    clearCache,
    getCacheStats,
    CACHE_DURATION
};
