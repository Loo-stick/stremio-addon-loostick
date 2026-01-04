/**
 * Parseur M3U pour TVLoo
 *
 * Télécharge et parse des fichiers M3U depuis des URLs distantes
 * avec gestion de cache intelligent par source et filtrage
 */

const fetch = require('node-fetch');

// Durée du cache (30 minutes)
const CACHE_DURATION = 30 * 60 * 1000;

// Cache en mémoire par source (clé = hash de l'URL + filtres)
const cache = new Map();

/**
 * Génère une clé de cache unique pour une source avec ses filtres
 */
function getCacheKey(sourceIndex, filters) {
    const filterStr = filters ? `${filters.country || ''}-${filters.category || ''}` : '';
    return `source-${sourceIndex}-${filterStr}`;
}

/**
 * Parse le group-title en country et category
 * Format: "FR| SPORTS" → { country: "FR", category: "SPORTS" }
 * @param {string} group - Le group-title brut
 * @returns {Object} { country, category }
 */
function parseGroup(group) {
    if (!group) return { country: null, category: null };

    const pipeIndex = group.indexOf('|');
    if (pipeIndex === -1) {
        return { country: null, category: group.trim() };
    }

    return {
        country: group.substring(0, pipeIndex).trim(),
        category: group.substring(pipeIndex + 1).trim()
    };
}

/**
 * Vérifie si une chaîne correspond aux filtres
 * @param {Object} channel - La chaîne avec ses métadonnées
 * @param {Object} filters - { country, category }
 * @returns {boolean}
 */
function matchesFilters(channel, filters) {
    if (!filters) return true;

    const { country: filterCountry, category: filterCategory } = filters;
    const { country: channelCountry, category: channelCategory } = parseGroup(channel.group);

    // Filtre par pays (insensible à la casse)
    if (filterCountry) {
        if (!channelCountry || channelCountry.toUpperCase() !== filterCountry.toUpperCase()) {
            return false;
        }
    }

    // Filtre par catégorie (insensible à la casse, recherche partielle)
    if (filterCategory) {
        if (!channelCategory || !channelCategory.toUpperCase().includes(filterCategory.toUpperCase())) {
            return false;
        }
    }

    return true;
}

/**
 * Parse le contenu M3U et extrait les chaînes
 * @param {string} content - Contenu brut du fichier M3U
 * @param {string} idPrefix - Préfixe pour les IDs (ex: 'tvloo-1-')
 * @param {Object} filters - Filtres optionnels { country, category }
 * @returns {Array} Liste des chaînes parsées et filtrées
 */
function parseM3U(content, idPrefix = 'tvloo-', filters = null) {
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

            // Appliquer les filtres avant d'ajouter la chaîne
            if (matchesFilters(currentChannel, filters)) {
                currentChannel.id = idPrefix + Buffer.from(currentChannel.name || Date.now().toString()).toString('base64').replace(/[^a-zA-Z0-9]/g, '');

                // Nettoyer le nom du groupe pour l'affichage (enlever le préfixe pays)
                if (currentChannel.group) {
                    const { category } = parseGroup(currentChannel.group);
                    if (category) {
                        currentChannel.group = category;
                    }
                }

                channels.push(currentChannel);
            }
            currentChannel = null;
        }
    }

    return channels;
}

/**
 * Récupère les chaînes depuis un fichier M3U (avec cache par source)
 * @param {string} m3uUrl - URL du fichier M3U
 * @param {number} sourceIndex - Index de la source (pour le cache et les IDs)
 * @param {Object} filters - Filtres optionnels { country, category }
 * @returns {Promise<Array>} Liste des chaînes
 */
async function fetchChannels(m3uUrl, sourceIndex = 0, filters = null) {
    if (!m3uUrl) {
        console.error('[TVLoo] URL M3U non fournie');
        return [];
    }

    const cacheKey = getCacheKey(sourceIndex, filters);
    const now = Date.now();
    const cached = cache.get(cacheKey);

    // Retourner le cache si encore valide
    if (cached && cached.channels && (now - cached.time) < CACHE_DURATION) {
        console.log(`[TVLoo] Source ${sourceIndex + 1}: retour depuis le cache`);
        return cached.channels;
    }

    try {
        const filterInfo = [];
        if (filters?.country) filterInfo.push(`country=${filters.country}`);
        if (filters?.category) filterInfo.push(`category=${filters.category}`);
        const filterStr = filterInfo.length > 0 ? ` (${filterInfo.join(', ')})` : '';

        console.log(`[TVLoo] Source ${sourceIndex + 1}: téléchargement M3U...${filterStr}`);

        const response = await fetch(m3uUrl, {
            timeout: 15000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const content = await response.text();
        const idPrefix = `tvloo-${sourceIndex + 1}-`;
        const channels = parseM3U(content, idPrefix, filters);

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
        // Supprimer toutes les clés qui commencent par source-{index}
        for (const key of cache.keys()) {
            if (key.startsWith(`source-${sourceIndex}-`)) {
                cache.delete(key);
            }
        }
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
        // Trouver la première entrée de cache pour cette source
        for (const [key, value] of cache.entries()) {
            if (key.startsWith(`source-${sourceIndex}-`)) {
                return {
                    source: sourceIndex + 1,
                    hasCachedData: true,
                    channelCount: value.channels.length,
                    cacheAge: Date.now() - value.time,
                    cacheExpired: (Date.now() - value.time) > CACHE_DURATION
                };
            }
        }
        return {
            source: sourceIndex + 1,
            hasCachedData: false,
            channelCount: 0,
            cacheAge: null,
            cacheExpired: true
        };
    }

    // Stats de toutes les sources
    const stats = [];
    const seen = new Set();
    for (const [key, value] of cache.entries()) {
        const match = key.match(/^source-(\d+)-/);
        if (match) {
            const idx = parseInt(match[1]);
            if (!seen.has(idx)) {
                seen.add(idx);
                stats.push({
                    source: idx + 1,
                    channelCount: value.channels.length,
                    cacheAge: Date.now() - value.time,
                    cacheExpired: (Date.now() - value.time) > CACHE_DURATION
                });
            }
        }
    }
    return stats;
}

module.exports = {
    fetchChannels,
    clearCache,
    getCacheStats,
    CACHE_DURATION
};
