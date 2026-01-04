/**
 * Parser EPG (XMLTV) en streaming pour TVLoo
 *
 * Utilise SAX pour parser le XML en streaming
 * afin d'éviter les problèmes de mémoire avec les gros fichiers
 */

const fetch = require('node-fetch');
const sax = require('sax');

// Durée du cache EPG (1 heure)
const EPG_CACHE_DURATION = 60 * 60 * 1000;

// Fenêtre de temps pour garder les programmes (en ms)
const TIME_WINDOW_BEFORE = 6 * 60 * 60 * 1000;  // 6h avant
const TIME_WINDOW_AFTER = 24 * 60 * 60 * 1000;  // 24h après

// Cache en mémoire
let cachedEpg = null;
let epgCacheTime = null;

/**
 * Parse une date XMLTV (format: 20240115183000 +0100)
 */
function parseXMLTVDate(dateStr) {
    if (!dateStr) return null;

    const match = dateStr.match(/(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-]\d{4})?/);
    if (!match) return null;

    const [, year, month, day, hour, min, sec, tz] = match;
    let date = new Date(Date.UTC(
        parseInt(year),
        parseInt(month) - 1,
        parseInt(day),
        parseInt(hour),
        parseInt(min),
        parseInt(sec)
    ));

    if (tz) {
        const tzHours = parseInt(tz.substring(0, 3));
        const tzMins = parseInt(tz.substring(3));
        date = new Date(date.getTime() - (tzHours * 60 + tzMins) * 60 * 1000);
    }

    return date;
}

/**
 * Décode les entités XML
 */
function decodeXMLEntities(str) {
    if (!str) return str;
    return str
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(num));
}

/**
 * Parse le fichier XMLTV en streaming
 * @param {ReadableStream} stream - Stream de réponse HTTP
 * @returns {Promise<Object>} Map des programmes par channel id
 */
function parseXMLTVStream(stream) {
    return new Promise((resolve, reject) => {
        const programs = {};
        const parser = sax.createStream(false, { lowercase: true, trim: true });

        // État du parsing
        let currentProgramme = null;
        let currentElement = null;
        let textContent = '';

        // Fenêtre de temps pour filtrer les programmes
        const now = Date.now();
        const minTime = now - TIME_WINDOW_BEFORE;
        const maxTime = now + TIME_WINDOW_AFTER;

        let totalParsed = 0;
        let keptCount = 0;

        parser.on('opentag', (node) => {
            currentElement = node.name;

            if (node.name === 'programme') {
                const start = parseXMLTVDate(node.attributes.start);
                const stop = parseXMLTVDate(node.attributes.stop);
                const channel = node.attributes.channel;

                // Ne garder que les programmes dans la fenêtre de temps
                if (start && stop && channel) {
                    const startTime = start.getTime();
                    const stopTime = stop.getTime();

                    // Programme pertinent si il chevauche notre fenêtre
                    if (stopTime >= minTime && startTime <= maxTime) {
                        currentProgramme = {
                            start,
                            stop,
                            channel,
                            title: null,
                            description: null,
                            category: null
                        };
                    }
                }
                totalParsed++;
            }

            textContent = '';
        });

        parser.on('text', (text) => {
            textContent += text;
        });

        parser.on('cdata', (cdata) => {
            textContent += cdata;
        });

        parser.on('closetag', (tagName) => {
            if (currentProgramme) {
                switch (tagName) {
                    case 'title':
                        if (!currentProgramme.title) {
                            currentProgramme.title = decodeXMLEntities(textContent.trim());
                        }
                        break;
                    case 'desc':
                        if (!currentProgramme.description) {
                            currentProgramme.description = decodeXMLEntities(textContent.trim());
                        }
                        break;
                    case 'category':
                        if (!currentProgramme.category) {
                            currentProgramme.category = decodeXMLEntities(textContent.trim());
                        }
                        break;
                    case 'programme':
                        // Sauvegarder le programme
                        const channelId = currentProgramme.channel;
                        if (!programs[channelId]) {
                            programs[channelId] = [];
                        }
                        programs[channelId].push({
                            start: currentProgramme.start,
                            stop: currentProgramme.stop,
                            title: currentProgramme.title || 'Programme inconnu',
                            description: currentProgramme.description,
                            category: currentProgramme.category
                        });
                        keptCount++;
                        currentProgramme = null;
                        break;
                }
            }

            textContent = '';
            currentElement = null;
        });

        parser.on('error', (err) => {
            console.error('[TVLoo EPG] Erreur parsing:', err.message);
            // Continue malgré les erreurs de parsing
            try {
                parser._parser.error = null;
                parser._parser.resume();
            } catch (e) {
                // Ignore
            }
        });

        parser.on('end', () => {
            // Trier les programmes par heure de début
            for (const channelId in programs) {
                programs[channelId].sort((a, b) => a.start - b.start);
            }

            console.log(`[TVLoo EPG] Streaming terminé: ${keptCount}/${totalParsed} programmes gardés (${Object.keys(programs).length} chaînes)`);
            resolve(programs);
        });

        // Gérer les erreurs du stream source
        stream.on('error', (err) => {
            console.error('[TVLoo EPG] Erreur stream:', err.message);
            resolve(programs); // Retourner ce qu'on a parsé
        });

        // Timeout de sécurité
        const timeout = setTimeout(() => {
            console.log(`[TVLoo EPG] Timeout - retour avec ${keptCount} programmes`);
            try { stream.destroy(); } catch (e) {}
            resolve(programs);
        }, 150000); // 2.5 minutes max

        parser.on('end', () => clearTimeout(timeout));

        // Pipe le stream vers le parser
        stream.pipe(parser);
    });
}

/**
 * Récupère l'EPG depuis l'URL (avec cache)
 * @param {string} epgUrl - URL du fichier XMLTV
 * @returns {Promise<Object>} Map des programmes
 */
async function fetchEpg(epgUrl) {
    if (!epgUrl) {
        return null;
    }

    const now = Date.now();

    // Retourner le cache si encore valide
    if (cachedEpg && epgCacheTime && (now - epgCacheTime) < EPG_CACHE_DURATION) {
        console.log('[TVLoo EPG] Retour depuis le cache');
        return cachedEpg;
    }

    // Éviter les téléchargements parallèles
    if (global._epgDownloading) {
        console.log('[TVLoo EPG] Téléchargement déjà en cours, attente...');
        // Attendre que le téléchargement en cours se termine
        await new Promise(resolve => setTimeout(resolve, 5000));
        if (cachedEpg) return cachedEpg;
        return null;
    }

    global._epgDownloading = true;

    try {
        console.log('[TVLoo EPG] Téléchargement streaming...');

        const response = await fetch(epgUrl, {
            timeout: 180000, // 3 minutes pour les gros fichiers
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                // Pas de Accept-Encoding pour éviter les problèmes de décompression stream
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        console.log('[TVLoo EPG] Réponse reçue, parsing en cours...');

        // Parser en streaming
        cachedEpg = await parseXMLTVStream(response.body);
        epgCacheTime = Date.now();

        global._epgDownloading = false;
        return cachedEpg;

    } catch (error) {
        global._epgDownloading = false;
        console.error('[TVLoo EPG] Erreur:', error.message);
        if (cachedEpg) {
            console.log('[TVLoo EPG] Utilisation du cache expiré');
            return cachedEpg;
        }
        return null;
    }
}

/**
 * Trouve le programme en cours pour une chaîne
 */
function getCurrentProgram(epgData, tvgId) {
    if (!epgData || !tvgId) return null;

    const variants = [
        tvgId,
        tvgId.toLowerCase(),
        tvgId.replace('.fr', ''),
        tvgId.split('.')[0]
    ];

    const now = new Date();

    for (const variant of variants) {
        const programs = epgData[variant];
        if (!programs) continue;

        const current = programs.find(p => p.start <= now && p.stop > now);
        if (current) {
            return current;
        }
    }

    return null;
}

/**
 * Trouve le prochain programme pour une chaîne
 */
function getNextProgram(epgData, tvgId) {
    if (!epgData || !tvgId) return null;

    const variants = [
        tvgId,
        tvgId.toLowerCase(),
        tvgId.replace('.fr', ''),
        tvgId.split('.')[0]
    ];

    const now = new Date();

    for (const variant of variants) {
        const programs = epgData[variant];
        if (!programs) continue;

        const next = programs.find(p => p.start > now);
        if (next) {
            return next;
        }
    }

    return null;
}

/**
 * Formate l'heure pour l'affichage
 */
function formatTime(date) {
    return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Vide le cache EPG
 */
function clearEpgCache() {
    cachedEpg = null;
    epgCacheTime = null;
    console.log('[TVLoo EPG] Cache vidé');
}

/**
 * Retourne les stats du cache EPG
 */
function getEpgCacheStats() {
    return {
        hasCachedData: !!cachedEpg,
        channelCount: cachedEpg ? Object.keys(cachedEpg).length : 0,
        cacheAge: epgCacheTime ? Date.now() - epgCacheTime : null,
        cacheExpired: epgCacheTime ? (Date.now() - epgCacheTime) > EPG_CACHE_DURATION : true
    };
}

module.exports = {
    fetchEpg,
    getCurrentProgram,
    getNextProgram,
    formatTime,
    clearEpgCache,
    getEpgCacheStats,
    EPG_CACHE_DURATION
};
