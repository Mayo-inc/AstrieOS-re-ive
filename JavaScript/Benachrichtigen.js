/* Tracks published GitHub releases only — never commits, issues or pull requests. */
const ReleaseNotifications = {
    repository: 'AstrieOS-modding/AstrieOS-re-ive',
    pollInterval: 10 * 60 * 1000,
    storageKey: 'astrieos-release-notifications',
    seenReleaseKey: 'astrieos-last-seen-release',
    notifications: [],
    started: false,
    checking: false,
    panelBound: false,
    activityTimer: null,
    activitySignature: '',
    latestRelease: null,
    seenReleaseId: null,

    init() {
        if (this.started) return;
        this.started = true;
        this.notifications = this._readNotifications();
        this.seenReleaseId = this._readSeenRelease();
        this._bindPanel();
        this.render();
        this.checkForRelease();
        window.setInterval(() => this.checkForRelease(), this.pollInterval);
    },

    async checkForRelease() {
        if (this.checking) return;
        this.checking = true;

        try {
            const response = await fetch(`https://api.github.com/repos/${this.repository}/releases/latest`, {
                headers: { Accept: 'application/vnd.github+json' }
            });
            if (response.status === 404) return; // No published release exists yet.
            if (!response.ok) throw new Error(`GitHub antwortet mit ${response.status}`);

            const release = await response.json();
            if (!release?.id || release.draft) return;

            this.latestRelease = release;
            this._renderVersionStatus();

            const releaseId = String(release.id);
            const previousId = this.seenReleaseId || this._readSeenRelease();

            // The first check establishes a baseline without announcing an old release.
            if (!previousId) {
                this._saveSeenRelease(releaseId);
                return;
            }
            if (previousId === releaseId) return;

            this._saveSeenRelease(releaseId);
            this.addRelease(release);
        } catch (error) {
            console.warn('Release-Tracking ist gerade nicht verfügbar.', error);
        } finally {
            this.checking = false;
        }
    },

    addRelease(release) {
        if (!release?.id) return;

        const notification = {
            id: `release-${release.id}`,
            title: 'Neues Update verfügbar!',
            detail: release.name || release.tag_name || 'Neue AstrieOS-Version',
            url: this._externalUrl(release.html_url),
            downloadUrl: this._externalUrl(this._downloadUrl(release)),
            isFictional: Boolean(release.isFictional),
            createdAt: new Date().toISOString()
        };

        this.notifications = [
            notification,
            ...this.notifications.filter(item => item.id !== notification.id)
        ].slice(0, 30);
        this._saveNotifications();
        this.render();
        this.showToast(notification);
        if (typeof Sound !== 'undefined') Sound.play('notification-default');
    },

    showFictionalUpdate() {
        const release = {
            id: `fiction-${Date.now()}`,
            tag_name: 'v0.1.1-test',
            name: 'Fiction Update 0.1.1',
            html_url: '',
            isFictional: true
        };
        this.latestRelease = release;
        this.addRelease(release);
        this._renderVersionStatus();
    },

    showToast(notification) {
        const stack = this._getToastStack();

        const toast = document.createElement('article');
        toast.className = 'Release-toast';

        const icon = document.createElement('img');
        icon.src = '/Res/Bild/Icon/Benachrichtige/update_24dp_FFFFFF_FILL1_wght400_GRAD0_opsz24.svg';
        icon.alt = '';

        const content = document.createElement('div');
        content.className = 'Release-toast-content';
        const title = document.createElement('p');
        title.className = 'Release-toast-title';
        title.textContent = notification.title;
        const detail = document.createElement('p');
        detail.className = 'Release-toast-body';
        detail.textContent = notification.detail;

        const actions = document.createElement('div');
        actions.className = 'Release-toast-actions';
        const downloadButton = this._createButton('Release-toast-action', 'Herunterladen');
        const laterButton = this._createButton('Release-toast-later', 'Später');
        actions.append(downloadButton, laterButton);
        content.append(title, detail, actions);

        const closeButton = this._createButton('Release-toast-close', '×');
        closeButton.setAttribute('aria-label', 'Benachrichtigung schließen');
        toast.append(icon, content, closeButton);

        let dismissed = false;
        const dismiss = () => {
            if (dismissed) return;
            dismissed = true;
            toast.classList.add('is-leaving');
            window.setTimeout(() => toast.remove(), 220);
        };

        closeButton.addEventListener('click', dismiss);
        laterButton.addEventListener('click', dismiss);
        downloadButton.addEventListener('click', () => {
            this.downloadRelease(notification);
            dismiss();
        });
        toast.addEventListener('click', event => {
            if (event.target.closest('button')) return;
            const url = this._externalUrl(notification.url);
            if (url) window.open(url, '_blank', 'noopener,noreferrer');
        });

        stack.append(toast);
        window.setTimeout(dismiss, 9000);
    },

    notify(titleText, detailText, sound = 'notification-default') {
        const toast = document.createElement('article');
        toast.className = 'Release-toast Release-toast-message';
        toast.setAttribute('role', 'status');

        const content = document.createElement('div');
        content.className = 'Release-toast-content';
        const title = document.createElement('p');
        title.className = 'Release-toast-title';
        title.textContent = titleText;
        const detail = document.createElement('p');
        detail.className = 'Release-toast-body';
        detail.textContent = detailText;
        content.append(title, detail);

        const closeButton = this._createButton('Release-toast-close', '×');
        closeButton.setAttribute('aria-label', 'Benachrichtigung schließen');
        toast.append(content, closeButton);

        let dismissed = false;
        const dismiss = () => {
            if (dismissed) return;
            dismissed = true;
            toast.classList.add('is-leaving');
            window.setTimeout(() => toast.remove(), 220);
        };
        closeButton.addEventListener('click', dismiss);

        this._getToastStack().append(toast);
        window.setTimeout(dismiss, 6000);
        if (typeof Sound !== 'undefined') Sound.play(sound);
        return toast;
    },

    _getToastStack() {
        let stack = document.querySelector('.Release-toast-stack');
        if (!stack) {
            stack = document.createElement('div');
            stack.className = 'Release-toast-stack';
            stack.setAttribute('aria-live', 'polite');
            stack.setAttribute('aria-relevant', 'additions');
            document.body.append(stack);
        }
        return stack;
    },

    _createButton(className, label) {
        const button = document.createElement('button');
        button.className = className;
        button.type = 'button';
        button.textContent = label;
        return button;
    },

    _bindPanel() {
        const attach = () => {
            if (this.panelBound || !document.querySelector('[data-notification-list]')) return;
            this.panelBound = true;

            document.querySelector('[data-notification-clear]')?.addEventListener('click', () => {
                this.notifications = [];
                this._saveNotifications();
                this.render();
            });
            this.render();
            this._renderActivities();
            this.activityTimer = window.setInterval(() => this._renderActivities(), 1000);
        };

        attach();
        document.addEventListener('notifications-template-ready', attach, { once: true });
    },

    _renderActivities() {
        const list = document.querySelector('[data-activity-list]');
        const counter = document.querySelector('[data-activity-count]');
        if (!list) return;

        const activities = [];
        const player = document.querySelector('[data-music-player]');
        if (player && !player.paused && !player.ended) {
            const title = document.querySelector('.Mediaplayer-title')?.textContent?.trim();
            const artist = document.getElementById('Mediaplayer-arthur-id')?.textContent?.trim();
            if (title) {
                activities.push({
                    id: 'now-playing',
                    title: 'Wird gerade abgespielt',
                    detail: [title, artist].filter(Boolean).join(' · '),
                    icon: '/Res/Bild/Icon/Topbar/music_note_2_24dp_FFFFFF_FILL1_wght400_GRAD0_opsz24.svg'
                });
            }
        }

        const account = window.Nutzerspeicher?.getAktivesKonto?.();
        if (account) {
            activities.push({
                id: 'active-account',
                title: 'Aktives Konto',
                detail: `Du verwendest „${account.username || 'Gast!'}“ für diese Sitzung.`,
                icon: '/Res/Bild/Icon/Topbar/person_24dp_FFFFFF_FILL1_wght400_GRAD0_opsz24.svg'
            });
        }

        const settings = window.Nutzerspeicher?.laden?.();
        if (settings) {
            const materialYouEnabled = Boolean(settings.materialYouEnabled);
            const background = window.Nutzerspeicher?.hintergrundLaden?.();
            const liveBackground = background && ['video', 'live'].includes(background.type);
            activities.push({
                id: 'material-you-sync',
                title: materialYouEnabled ? 'Material You synchronisiert' : 'Material You ist ausgeschaltet',
                detail: materialYouEnabled
                    ? liveBackground && settings.materialYouLiveEnabled
                        ? 'Farben werden laufend mit dem Live-Hintergrund synchronisiert.'
                        : 'Farben werden mit dem aktuellen Hintergrund synchronisiert.'
                    : 'Aktiviere Material You in den Einstellungen, um Hintergrundfarben zu übernehmen.',
                icon: '/Res/Bild/Icon/EInstellungen/Hintergrund formaten/image_24dp_FFFFFF_FILL1_wght400_GRAD0_opsz24.svg'
            });
        }

        if (counter) counter.textContent = String(activities.length);
        const signature = JSON.stringify(activities);
        if (signature === this.activitySignature) return;
        this.activitySignature = signature;
        list.replaceChildren();
        if (!activities.length) {
            list.append(this._createEmptyActivityState());
            return;
        }

        activities.forEach(activity => list.append(this._renderActivity(activity)));
    },

    _renderActivity(activity) {
        const item = document.createElement('article');
        item.className = 'Benachricht-item Benachricht-activity';
        item.dataset.activityId = activity.id;

        const icon = document.createElement('img');
        icon.src = activity.icon;
        icon.alt = '';

        const text = document.createElement('div');
        text.className = 'Benachricht-item-text';
        const title = document.createElement('p');
        title.className = 'Benachricht-item-title';
        title.textContent = activity.title;
        const detail = document.createElement('p');
        detail.className = 'Benachricht-item-detail';
        detail.textContent = activity.detail;
        text.append(title, detail);
        item.append(icon, text);
        return item;
    },

    _createEmptyActivityState() {
        const empty = document.createElement('div');
        empty.className = 'Benachricht-leer';
        const message = document.createElement('p');
        message.textContent = 'Gerade läuft nichts.';
        empty.append(message);
        return empty;
    },

    _renderVersionStatus() {
        if (!this.latestRelease) return;

        const current = this._currentVersion();
        const latest = this.latestRelease.tag_name || this.latestRelease.name || 'unbekannt';
        const newer = this._isNewer(latest, current);
        this._setVersionStatus(newer
            ? `Version ${latest} ist verfügbar. Installiert: ${current}.`
            : `Du nutzt die neueste Version (${current}).`);

        const card = document.querySelector('[data-update-card]');
        if (!card) return;
        card.hidden = !newer;
        if (newer) {
            const title = card.querySelector('[data-update-title]');
            const detail = card.querySelector('[data-update-detail]');
            if (title) title.textContent = `Version ${latest} ist verfügbar`;
            if (detail) detail.textContent = this.latestRelease.name || 'Möchtest du das Update jetzt herunterladen?';
        }
    },

    _setVersionStatus(message) {
        const status = document.querySelector('[data-version-status]');
        if (status) status.textContent = message;
    },

    downloadRelease(releaseOrNotification) {
        if (!releaseOrNotification) return;

        if (releaseOrNotification.isFictional) {
            const file = new Blob(['AstrieOS Fiction Update\n\nDies ist nur eine Debug-Testdatei.'], { type: 'text/plain' });
            const url = URL.createObjectURL(file);
            const link = document.createElement('a');
            link.href = url;
            link.download = 'AstrieOS-fiction-update.txt';
            link.click();
            window.setTimeout(() => URL.revokeObjectURL(url), 0);
            return;
        }

        const updateRequest = new CustomEvent('app-update-request', {
            detail: { release: releaseOrNotification },
            cancelable: true
        });
        if (!document.dispatchEvent(updateRequest)) return;

        const url = this._externalUrl(releaseOrNotification.downloadUrl)
            || this._externalUrl(this._downloadUrl(releaseOrNotification))
            || this._externalUrl(releaseOrNotification.html_url)
            || this._externalUrl(releaseOrNotification.url);
        if (url) window.open(url, '_blank', 'noopener,noreferrer');
    },

    _downloadUrl(release) {
        return release.assets?.[0]?.browser_download_url || release.html_url;
    },

    _externalUrl(value) {
        if (typeof value !== 'string' || !value) return '';
        try {
            const url = new URL(value, window.location.href);
            return url.protocol === 'https:' ? url.href : '';
        } catch {
            return '';
        }
    },

    _currentVersion() {
        return document.querySelector('meta[name="astrieos-version"]')?.content || '0.1.0';
    },

    _isNewer(candidate, current) {
        const parse = value => {
            const match = String(value).trim().match(/^v?(\d+(?:\.\d+)*)/i);
            return match ? match[1].split('.').map(Number) : null;
        };
        const next = parse(candidate);
        const installed = parse(current);
        if (!next || !installed) return false;

        for (let index = 0; index < Math.max(next.length, installed.length); index += 1) {
            const difference = (next[index] || 0) - (installed[index] || 0);
            if (difference !== 0) return difference > 0;
        }
        return false;
    },

    render() {
        const list = document.querySelector('[data-notification-list]');
        const counter = document.querySelector('[data-notification-count]');
        if (counter) counter.textContent = String(this.notifications.length);
        if (!list) return;

        list.replaceChildren();
        if (!this.notifications.length) {
            const empty = document.createElement('div');
            empty.className = 'Benachricht-leer';
            const message = document.createElement('p');
            message.textContent = 'Ganz leise sein...(╭ರ_•́)';
            empty.append(message);
            list.append(empty);
            return;
        }

        this.notifications.forEach(notification => list.append(this._renderNotification(notification)));
    },

    _renderNotification(notification) {
        const url = this._externalUrl(notification.url);
        const item = document.createElement(url ? 'a' : 'article');
        item.className = 'Benachricht-item';
        if (url) {
            item.href = url;
            item.target = '_blank';
            item.rel = 'noopener noreferrer';
        }

        const icon = document.createElement('img');
        icon.src = '/Res/Bild/Icon/Benachrichtige/update_24dp_FFFFFF_FILL1_wght400_GRAD0_opsz24.svg';
        icon.alt = '';

        const text = document.createElement('div');
        text.className = 'Benachricht-item-text';
        const title = document.createElement('p');
        title.className = 'Benachricht-item-title';
        title.textContent = notification.title;
        const detail = document.createElement('p');
        detail.className = 'Benachricht-item-detail';
        detail.textContent = notification.detail;
        const time = document.createElement('time');
        const date = new Date(notification.createdAt);
        if (!Number.isNaN(date.getTime())) {
            time.dateTime = date.toISOString();
            time.textContent = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
        }

        text.append(title, detail, time);
        item.append(icon, text);
        return item;
    },

    _readNotifications() {
        try {
            const stored = JSON.parse(localStorage.getItem(this.storageKey));
            if (!Array.isArray(stored)) return [];
            return stored
                .filter(item => item && typeof item.id === 'string')
                .map(item => ({
                    id: item.id,
                    title: typeof item.title === 'string' ? item.title : 'Benachrichtigung',
                    detail: typeof item.detail === 'string' ? item.detail : '',
                    url: this._externalUrl(item.url),
                    downloadUrl: this._externalUrl(item.downloadUrl),
                    isFictional: Boolean(item.isFictional),
                    createdAt: typeof item.createdAt === 'string' ? item.createdAt : ''
                }))
                .slice(0, 30);
        } catch {
            return [];
        }
    },

    _saveNotifications() {
        try {
            localStorage.setItem(this.storageKey, JSON.stringify(this.notifications));
        } catch { /* Storage can be disabled or full. */ }
    },

    _readSeenRelease() {
        try {
            return localStorage.getItem(this.seenReleaseKey);
        } catch {
            return null;
        }
    },

    _saveSeenRelease(releaseId) {
        this.seenReleaseId = releaseId;
        try {
            localStorage.setItem(this.seenReleaseKey, releaseId);
        } catch { /* Tracking still works for this page session. */ }
    }
};

window.ReleaseNotifications = ReleaseNotifications;
ReleaseNotifications.init();
