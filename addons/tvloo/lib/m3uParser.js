/**
 * Parseur M3U pour TV Sports France
 *
 * Télécharge et parse un fichier M3U depuis une URL distante
 * avec gestion de cache intelligent
 */

const fetch = require('node-fetch');

// URL par défaut du fichier M3U
const DEFAULT_M3U_URL = 'https://raw.githubusercontent.com/victore447/M3uSportsFranceAndMore/main/M3uSportsFrance.m3u';

// Durée du cache (30 minutes)
const CACHE_DURATION = 30 * 60 * 1000;

// Cache en mémoire
let cachedChannels = null;
let cacheTime = null;

/**
 * Parse le contenu M3U et extrait les chaînes
 * @param {string} content - Contenu brut du fichier M3U
 * @returns {Array} Liste des chaînes parsées
 */
function parseM3U(content) {
    const lines = content.split('\n');
    const channels = [];
    let currentChannel = null;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        if (line.startsWith('#EXTINF:')) {
            currentChannel = {};

            // Extraire le nom (après la dernière virgule)
            const nameMatch = line.match(/,(.+)$/);
            if (nameMatch) {
                currentChannel.name = nameMatch[1].trim();
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

        } else if (line && !line.startsWith('#') && currentChannel) {
            // C'est l'URL du stream
            currentChannel.url = line;
            currentChannel.id = 'tvloo-' + Buffer.from(currentChannel.name || Date.now().toString()).toString('base64').replace(/[^a-zA-Z0-9]/g, '');
            channels.push(currentChannel);
            currentChannel = null;
        }
    }

    return channels;
}

/**
 * Récupère les chaînes depuis le fichier M3U (avec cache)
 * @param {string} m3uUrl - URL du fichier M3U (optionnel)
 * @returns {Promise<Array>} Liste des chaînes
 */
async function fetchChannels(m3uUrl = DEFAULT_M3U_URL) {
    const now = Date.now();

    // Retourner le cache si encore valide
    if (cachedChannels && cacheTime && (now - cacheTime) < CACHE_DURATION) {
        console.log('[TVLoo] Retour des chaînes depuis le cache');
        return cachedChannels;
    }

    try {
        console.log('[TVLoo] Téléchargement du fichier M3U depuis:', m3uUrl);

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
        cachedChannels = parseM3U(content);
        cacheTime = now;

        console.log(`[TVLoo] ${cachedChannels.length} chaînes trouvées`);
        return cachedChannels;

    } catch (error) {
        console.error('[TVLoo] Erreur téléchargement M3U:', error.message);
        // Retourner le cache même expiré en cas d'erreur
        if (cachedChannels) {
            console.log('[TVLoo] Utilisation du cache expiré');
            return cachedChannels;
        }
        return [];
    }
}

/**
 * Vide le cache
 */
function clearCache() {
    cachedChannels = null;
    cacheTime = null;
    console.log('[TVLoo] Cache vidé');
}

/**
 * Retourne les statistiques du cache
 */
function getCacheStats() {
    return {
        hasCachedData: !!cachedChannels,
        channelCount: cachedChannels ? cachedChannels.length : 0,
        cacheAge: cacheTime ? Date.now() - cacheTime : null,
        cacheExpired: cacheTime ? (Date.now() - cacheTime) > CACHE_DURATION : true
    };
}

module.exports = {
    fetchChannels,
    clearCache,
    getCacheStats,
    CACHE_DURATION
};
