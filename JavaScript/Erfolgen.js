/* Local activity status and achievements. No activity data leaves the browser. */
const achievementDefinitions = [
    {
        id: 'first_visit', title: 'Erster Start', description: 'Starte AstrieOS zum ersten Mal.',
        category: 'Besuche', isUnlocked: data => data.visits >= 1,
        progress: data => ({ current: data.visits, target: 1 })
    },
    {
        id: 'return_visit', title: 'Wieder da', description: 'Komm für einen zweiten Besuch zurück.',
        category: 'Besuche', isUnlocked: data => data.visits >= 2,
        progress: data => ({ current: data.visits, target: 2 })
    },
    {
        id: 'frequent_flyer', title: 'Stammgast', description: 'Starte AstrieOS insgesamt zehnmal.',
        category: 'Besuche', isUnlocked: data => data.visits >= 10,
        progress: data => ({ current: data.visits, target: 10 })
    },
    {
        id: 'clicker', title: 'Klicker', description: 'Klicke hundertmal durch AstrieOS.',
        category: 'Aktivität', isUnlocked: data => data.clicks >= 100,
        progress: data => ({ current: data.clicks, target: 100 })
    },
    {
        id: 'super_clicker', title: 'Klicklegende', description: 'Erreiche tausend Klicks.',
        category: 'Aktivität', isUnlocked: data => data.clicks >= 1000,
        progress: data => ({ current: data.clicks, target: 1000 })
    },
    {
        id: 'afk', title: 'Kurz mal weg', description: 'Lass AstrieOS eine Minute ohne Eingabe offen.',
        category: 'Aktivität', isUnlocked: data => data.afkMilliseconds >= 60_000,
        progress: data => ({ current: data.afkMilliseconds, target: 60_000, format: formatUserDuration })
    },
    {
        id: 'long_session', title: 'Bleib noch kurz', description: 'Sammle dreißig aktive Minuten in einer Sitzung.',
        category: 'Aktivität', isUnlocked: data => data.longestSessionMilliseconds >= 30 * 60_000,
        progress: data => ({ current: data.longestSessionMilliseconds, target: 30 * 60_000, format: formatUserDuration })
    },
    {
        id: 'first_day', title: 'Ein ganzer Tag', description: 'Sammle insgesamt vierundzwanzig aktive Stunden.',
        category: 'Aktivität', isUnlocked: data => data.activeMilliseconds >= 86_400_000,
        progress: data => ({ current: data.activeMilliseconds, target: 86_400_000, format: formatUserDuration })
    },
    {
        id: 'music_jammer', title: 'Musik an', description: 'Starte zum ersten Mal einen Titel im Mediaplayer.',
        category: 'Mediaplayer', isUnlocked: data => data.musicStarts >= 1,
        progress: data => ({ current: data.musicStarts, target: 1 })
    },
    {
        id: 'playlist_regular', title: 'Auf Dauerschleife', description: 'Starte zehn Wiedergaben im Mediaplayer.',
        category: 'Mediaplayer', isUnlocked: data => data.musicStarts >= 10,
        progress: data => ({ current: data.musicStarts, target: 10 })
    },
    {
        id: 'controller_gerate', title: 'Extra Gerät', description: 'Verbinde einen Controller mit AstrieOS.',
        category: 'Geräte', isUnlocked: data => data.gamepadConnections >= 1,
        progress: data => ({ current: data.gamepadConnections, target: 1 })
    },
    {
        id: 'mod_collector', title: 'Modding beginnt', description: 'Registriere deine erste Modding-Erweiterung.',
        category: 'Modding', isUnlocked: () => (window.DebugMenu?.modules?.length || 0) >= 1,
        progress: () => ({ current: window.DebugMenu?.modules?.length || 0, target: 1 })
    },
    {
        id: 'october', title: 'Spooky Season', description: 'Öffne AstrieOS im Oktober.',
        category: 'Saison', isUnlocked: () => new Date().getMonth() === 9,
        progress: () => ({ current: new Date().getMonth() === 9 ? 1 : 0, target: 1 })
    },
    {
        id: 'error', title: 'Oops …', description: 'AstrieOS hat einen Fehler entdeckt.',
        category: 'Geheim', isUnlocked: data => data.errors >= 1,
        progress: data => ({ current: data.errors, target: 1 })
    }
];

const UserStatus = {
    storageKey: 'astrieos-user-status-v1',
    idleAfter: 60_000,
    achievementDefinitions,
    achievementNames: Object.fromEntries(achievementDefinitions.map(item => [item.id, item.title])),
    data: null,
    listeners: new Set(),
    lastTick: 0,
    lastActivity: 0,
    notificationsReady: false,
    initialized: false,

    init() {
        if (this.initialized) return;
        this.initialized = true;
        const now = Date.now();
        this.data = this._load();
        this.data.visits += 1;
        this.data.firstSeen ||= now;
        this.data.lastVisit = now;
        this.lastTick = now;
        this.lastActivity = now;

        try {
            if (Array.from(navigator.getGamepads?.() || []).some(Boolean)) {
                this.data.gamepadConnections = Math.max(1, this.data.gamepadConnections);
            }
        } catch { /* Gamepad access is optional. */ }

        this._updateAchievements(false);
        this._save();
        ['pointerdown', 'pointermove', 'keydown', 'touchstart'].forEach(eventName => {
            document.addEventListener(eventName, event => this._recordActivity(event), { passive: true });
        });
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) this.lastActivity = Date.now();
            this._save();
        });
        document.addEventListener('play', event => {
            if (!event.target?.matches?.('[data-music-player]')) return;
            this.data.musicStarts += 1;
            this._updateAchievements();
            this._saveAndNotify();
        }, true);
        window.addEventListener('gamepadconnected', () => {
            this.data.gamepadConnections = Math.max(1, this.data.gamepadConnections + 1);
            this._updateAchievements();
            this._saveAndNotify();
        });
        window.addEventListener('error', () => {
            this.data.errors += 1;
            this._updateAchievements();
            this._saveAndNotify();
        });
        window.addEventListener('pagehide', () => this._save());
        window.setInterval(() => this._tick(), 1000);
        this.notificationsReady = true;
        this._notify();
    },

    subscribe(listener) {
        this.listeners.add(listener);
        listener(this.snapshot());
        return () => this.listeners.delete(listener);
    },

    snapshot() {
        const unlocked = this.achievementDefinitions
            .filter(item => Boolean(this.data.achievements[item.id]))
            .map(item => item.id);
        return {
            ...this.data,
            activeSession: this._activeSession(Date.now()),
            unlocked,
            unlockedCount: unlocked.length,
            totalCount: this.achievementDefinitions.length
        };
    },

    _recordActivity(event) {
        this.lastActivity = Date.now();
        if (event.type === 'pointerdown' && event.button !== undefined && event.button !== 0) return;
        if (event.type === 'pointerdown') {
            this.data.clicks += 1;
            if (this._updateAchievements()) this._saveAndNotify();
        }
    },

    _tick() {
        const now = Date.now();
        const elapsed = Math.max(0, Math.min(now - this.lastTick, 10_000));
        this.lastTick = now;
        if (!document.hidden) {
            if (now - this.lastActivity < this.idleAfter) this.data.activeMilliseconds += elapsed;
            else this.data.afkMilliseconds += elapsed;
        }
        this.data.longestSessionMilliseconds = Math.max(this.data.longestSessionMilliseconds, this._activeSession(now));
        this._updateAchievements();
        this._saveAndNotify();
    },

    _activeSession(now) {
        return this.data.activeMilliseconds - this.data.sessionStartActiveMilliseconds +
            (!document.hidden && now - this.lastActivity < this.idleAfter ? Math.max(0, now - this.lastTick) : 0);
    },

    _updateAchievements(announce = this.notificationsReady) {
        let changed = false;
        this.achievementDefinitions.forEach(item => {
            const unlocked = item.isUnlocked(this.data, this);
            if (this._unlock(item.id, unlocked, announce)) changed = true;
        });
        return changed;
    },

    _unlock(id, condition, announce) {
        if (!condition || this.data.achievements[id]) return false;
        this.data.achievements[id] = true;
        if (announce) this._showAchievementNotification(id);
        return true;
    },

    _showAchievementNotification(id) {
        const achievement = this.achievementDefinitions.find(item => item.id === id);
        if (!achievement) return;
        let region = document.querySelector('.Achievement-notifications');
        if (!region) {
            region = document.createElement('div');
            region.className = 'Achievement-notifications';
            region.setAttribute('aria-live', 'polite');
            document.body.append(region);
        }
        const notification = document.createElement('div');
        notification.className = 'Achievement-notification';
        const copy = document.createElement('div');
        const heading = document.createElement('strong');
        const description = document.createElement('span');
        heading.textContent = 'Erfolg freigeschaltet';
        description.textContent = achievement.title;
        copy.append(heading, description);
        notification.append(copy);
        region.append(notification);
        if (typeof Sound !== 'undefined') Sound.play('menu-open');
        window.setTimeout(() => {
            notification.classList.add('is-leaving');
            window.setTimeout(() => notification.remove(), 220);
        }, 5_000);
    },

    // Console helpers: display test notifications without changing saved progress.
    testAchievement(...ids) {
        const requested = ids.flat().filter(Boolean);
        const valid = requested.filter(id => Object.hasOwn(this.achievementNames, id));
        const invalid = requested.filter(id => !Object.hasOwn(this.achievementNames, id));
        valid.forEach(id => this._showAchievementNotification(id));
        if (invalid.length) console.warn('Unbekannte Erfolgs-IDs:', invalid.join(', '));
        return valid;
    },

    unlockForTest(...ids) {
        const unlocked = this.testAchievement(...ids);
        unlocked.forEach(id => { this.data.achievements[id] = true; });
        this._saveAndNotify();
        return unlocked;
    },

    _load() {
        const defaults = {
            visits: 0, firstSeen: null, lastVisit: null, clicks: 0, errors: 0,
            musicStarts: 0, gamepadConnections: 0,
            activeMilliseconds: 0, afkMilliseconds: 0, longestSessionMilliseconds: 0,
            sessionStartActiveMilliseconds: 0, achievements: {}
        };
        try {
            const saved = JSON.parse(localStorage.getItem(this.storageKey));
            const data = { ...defaults, ...(saved || {}) };
            ['visits', 'clicks', 'errors', 'musicStarts', 'gamepadConnections', 'activeMilliseconds', 'afkMilliseconds', 'longestSessionMilliseconds']
                .forEach(key => {
                    const value = Number(data[key]);
                    data[key] = Number.isFinite(value) ? Math.max(0, value) : defaults[key];
                });
            data.achievements = { ...defaults.achievements, ...(saved?.achievements || {}) };
            data.sessionStartActiveMilliseconds = data.activeMilliseconds;
            return data;
        } catch {
            return defaults;
        }
    },

    _saveAndNotify() { this._save(); this._notify(); },
    _save() {
        try { localStorage.setItem(this.storageKey, JSON.stringify(this.data)); } catch { /* Storage is optional. */ }
    },
    _notify() {
        const status = this.snapshot();
        this.listeners.forEach(listener => {
            try { listener(status); }
            catch (error) { console.error('[UserStatus] Status-Ansicht konnte nicht aktualisiert werden:', error); }
        });
    }
};

function formatUserDuration(milliseconds) {
    const seconds = Math.floor(milliseconds / 1000);
    const days = Math.floor(seconds / 86_400);
    const hours = Math.floor((seconds % 86_400) / 3_600);
    const minutes = Math.floor((seconds % 3_600) / 60);
    const remainingSeconds = seconds % 60;
    return days > 0
        ? `${days}:${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`
        : `${hours}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
}

window.UserStatus = UserStatus;
UserStatus.init();
