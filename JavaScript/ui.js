function bindAchievementFilters(root) {
    const grid = root.querySelector('[data-achievement-grid]');
    if (!grid) return;
    grid.dataset.filter ||= 'all';
    root.querySelectorAll('[data-achievement-filter]').forEach(button => {
        if (button.dataset.bound) return;
        button.dataset.bound = 'true';
        button.addEventListener('click', () => {
            grid.dataset.filter = button.dataset.achievementFilter;
            root.querySelectorAll('[data-achievement-filter]').forEach(filter => {
                filter.setAttribute('aria-pressed', String(filter === button));
            });
            applyAchievementFilter(grid);
        });
    });
}

function applyAchievementFilter(grid) {
    if (!grid) return;
    const filter = grid.dataset.filter || 'all';
    grid.querySelectorAll('[data-achievement]').forEach(card => {
        const unlocked = card.classList.contains('is-unlocked');
        card.hidden = (filter === 'unlocked' && !unlocked) || (filter === 'locked' && unlocked);
    });
}

function renderAchievementCards(root) {
    const grid = root.querySelector('[data-achievement-grid]');
    if (!grid || grid.dataset.rendered === 'true') return;
    const cards = UserStatus.achievementDefinitions.map(achievement => {
        const card = document.createElement('article');
        card.className = 'Achievement-card is-locked';
        card.dataset.achievement = achievement.id;
        card.dataset.category = achievement.category;

        const top = document.createElement('div');
        top.className = 'Achievement-card-top';
        const category = document.createElement('p');
        category.className = 'Achievement-category';
        category.textContent = achievement.category;
        const state = document.createElement('span');
        state.className = 'Achievement-state';
        state.dataset.achievementState = '';
        top.append(category, state);
        const title = document.createElement('h3');
        title.textContent = achievement.title;
        const description = document.createElement('p');
        description.className = 'Achievement-description';
        description.textContent = achievement.description;

        const progress = document.createElement('div');
        progress.className = 'Achievement-card-progress';
        const track = document.createElement('div');
        track.className = 'Achievement-progress-track';
        track.setAttribute('role', 'progressbar');
        track.setAttribute('aria-label', `Fortschritt: ${achievement.title}`);
        track.setAttribute('aria-valuemin', '0');
        track.setAttribute('aria-valuemax', '100');
        track.setAttribute('aria-valuenow', '0');
        const fill = document.createElement('span');
        fill.dataset.achievementBar = '';
        track.append(fill);
        const count = document.createElement('p');
        count.dataset.achievementProgress = '';
        progress.append(track, count);
        card.append(top, title, description, progress);
        return card;
    });
    grid.replaceChildren(...cards);
    grid.dataset.rendered = 'true';
}

function renderAchievementProfile(root) {
    const account = window.Nutzerspeicher?.getAktivesKonto?.();
    const profile = account || window.Nutzerspeicher?.ladeBenutzerdaten?.() || {};
    const name = profile.username || 'Gast!';
    const avatar = root.querySelector('[data-profile-avatar]');
    const banner = root.querySelector('[data-profile-banner]');
    const nameElement = root.querySelector('[data-profile-name]');
    const defaultAvatar = '/Res/Bild/Logo/AddText_07-03-07.27.32.png';
    const defaultBanner = '/Res/Bild/Hintergrund/Default-Banner.png';

    if (nameElement) nameElement.textContent = name;
    if (avatar) {
        const source = profile.profilbildUrl || defaultAvatar;
        if (avatar.getAttribute('src') !== source) avatar.src = source;
        avatar.alt = `Profilbild von ${name}`;
        if (avatar.dataset.fallbackBound !== 'true') {
            avatar.dataset.fallbackBound = 'true';
            avatar.onerror = () => {
                const fallback = new URL(defaultAvatar, document.baseURI).href;
                if (avatar.src !== fallback) avatar.src = defaultAvatar;
            };
        }
    }
    if (banner) {
        const source = profile.bannerUrl || defaultBanner;
        if (banner.getAttribute('src') !== source) banner.src = source;
        if (banner.dataset.fallbackBound !== 'true') {
            banner.dataset.fallbackBound = 'true';
            banner.onerror = () => {
                const fallback = new URL(defaultBanner, document.baseURI).href;
                if (banner.src !== fallback) banner.src = defaultBanner;
            };
        }
    }
}

function updateErfolgenUI(status) {
    const root = document.querySelector('.Erfolgen-placeholder');
    if (!root) return;
    renderAchievementCards(root);
    bindAchievementFilters(root);

    const setText = (selector, value) => {
        const element = root.querySelector(selector);
        if (element) element.textContent = String(value);
    };
    const total = status.totalCount || UserStatus.achievementDefinitions.length;
    const percentage = total ? Math.round(status.unlockedCount / total * 100) : 0;
    setText('#Erfolgen-tracken', `${percentage}%`);
    setText('#Erfolgen-nummer', status.unlockedCount);
    setText('#Erfolgen-gesamt', total);
    setText('#user-runtime', formatUserDuration(status.activeMilliseconds));
    setText('#user-session', formatUserDuration(status.longestSessionMilliseconds));
    setText('#user-visits', status.visits.toLocaleString('de-DE'));
    setText('#user-clicks', status.clicks.toLocaleString('de-DE'));
    const trackedTime = status.activeMilliseconds + status.afkMilliseconds;
    setText('#user-afk', `${trackedTime ? Math.round(status.afkMilliseconds / trackedTime * 100) : 0}%`);

    const progressTrack = root.querySelector('.Achievement-overall-progress');
    const progressFill = root.querySelector('[data-overall-progress]');
    if (progressTrack) progressTrack.setAttribute('aria-valuenow', String(percentage));
    if (progressFill) progressFill.style.width = `${percentage}%`;

    root.querySelectorAll('[data-achievement]').forEach(card => {
        const achievement = UserStatus.achievementDefinitions.find(item => item.id === card.dataset.achievement);
        if (!achievement) return;
        const unlocked = Boolean(status.achievements[achievement.id]);
        card.classList.toggle('is-unlocked', unlocked);
        card.classList.toggle('is-locked', !unlocked);
        card.setAttribute('aria-label', `${achievement.title}: ${unlocked ? 'freigeschaltet' : 'noch offen'}`);
        const state = card.querySelector('[data-achievement-state]');
        if (state) state.textContent = unlocked ? 'Erreicht' : 'Offen';

        const progress = achievement.progress(status);
        const ratio = progress.target ? Math.min(100, Math.round(progress.current / progress.target * 100)) : 0;
        const bar = card.querySelector('[data-achievement-bar]');
        const count = card.querySelector('[data-achievement-progress]');
        if (bar) bar.style.width = `${ratio}%`;
        const track = bar?.parentElement;
        if (track) track.setAttribute('aria-valuenow', String(ratio));
        if (count) {
            const format = progress.format || (value => Number(value).toLocaleString('de-DE'));
            count.textContent = `${format(progress.current)} / ${format(progress.target)}`;
        }
    });
    applyAchievementFilter(root.querySelector('[data-achievement-grid]'));
}

UserStatus.subscribe(updateErfolgenUI);
window.addEventListener('astrie-account-changed', () => {
    const root = document.querySelector('.Erfolgen-placeholder');
    if (root) renderAchievementProfile(root);
});

AstrieRuntime
    .register({
        id: 'datein',
        title: 'Datein! ^⎚-⎚^',
        icon: '/Res/Bild/Icon/Topbar/folder_24dp_FFFFFF_FILL1_wght400_GRAD0_opsz24.svg',
        templateUrl: '/ui/Datein.html',
        templateId: 'Datein-placeholder',
        styleUrl: '/ui/Ui_css/Datein.css',
        scriptUrls: ['/JavaScript/Dateinmanager.js'],
        width: 1050,
        height: 680,
        mount: ({ root }) => {
            const panel = root.querySelector('.Datein-placeholder');
            if (panel) return window.Dateinmanager?.mount(panel);
        }
    })
    .register({
        id: 'erfolgen',
        title: 'Fortschritten! ᕙ(  •̀ ᗜ •́  )ᕗ',
        icon: '/Res/Bild/Icon/Topbar/trophy_24dp_FFFFFF_FILL1_wght400_GRAD0_opsz24.svg',
        templateUrl: '/ui/Erfolgen.html',
        templateId: 'Erfolgen-ui',
        styleUrl: '/ui/Ui_css/Erfolgen.css',
        width: 1280,
        height: 720,
        mount: ({ root }) => {
            renderAchievementProfile(root);
            updateErfolgenUI(UserStatus.snapshot());
        }
    })
    .register({
        id: 'musikplayer',
        title: 'Musikplayer! 〜امبر annakva👅🏻‬‬(⁀ᴥ⁀)‬',
        icon: '/Res/Bild/Icon/Topbar/music_note_2_24dp_FFFFFF_FILL1_wght400_GRAD0_opsz24.svg',
        templateUrl: '/ui/mediaplayer.html',
        templateId: 'mediaplayer-ui',
        styleUrl: '/ui/Ui_css/Musikplayer.css',
        scriptUrls: ['/JavaScript/Mediaplayer.js'],
        presentation: 'panel',
        rootSelector: '.Mediaplayer-placeholder',
        mount: () => window.Mediaplayer?.init?.()
    });

fetch('/ui/Gretter.html')
    .then(res => {
        if (!res.ok) throw new Error(`Greeter konnte nicht geladen werden (${res.status}).`);
        return res.text();
    })
    .then(html => {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const template = doc.querySelector('#Nutzer_gretterui');
        if (!template) throw new Error('Greeter-Template wurde nicht gefunden.');
        document.body.appendChild(template.content.cloneNode(true));
        if (!document.querySelector('link[data-gretter-styles]')) {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = '/ui/Ui_css/Gretter.css';
            link.dataset.gretterStyles = 'true';
            document.head.appendChild(link);
        }
        document.dispatchEvent(new Event('gretter-template-ready'));
    })
    .catch(error => console.error('[Greeter]', error));

fetch('/ui/Nutzercenter.html')
  .then(res => res.text())
  .then(html => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const template = doc.querySelector('#Nutztercenter-placeholder');
    document.body.appendChild(template.content.cloneNode(true));
  });

fetch('/ui/Einstellungen.html')
    .then(res => res.text())
    .then(html => {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const template = doc.querySelector('#einstellungen-placeholder');
        document.body.appendChild(template.content.cloneNode(true));
        document.dispatchEvent(new Event('settings-template-ready'));
    });

fetch('/ui/Benachrichtigung.html')
    .then(res => res.text())
    .then(html => {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const template = doc.querySelector('#Benachrichtigung-ui');
        document.body.appendChild(template.content.cloneNode(true));
        document.dispatchEvent(new Event('notifications-template-ready'));
    });

function openDateinWindow() {
    return AstrieRuntime.open('datein');
}

function openwindow_trophy() {
    return AstrieRuntime.open('erfolgen');
}

function openMusikplayerPanel({ toggle = false } = {}) {
    const panel = document.querySelector('.Mediaplayer-placeholder');
    const wasOpen = Boolean(panel?.classList.contains('Open'));
    const willOpen = toggle ? !wasOpen : true;
    if (wasOpen !== willOpen && typeof Sound !== 'undefined') Sound.play(willOpen ? 'menu-open' : 'menu-close');
    return AstrieRuntime.open('musikplayer', { toggle });
}

/**
 * WallhavenManager - Verwaltet die Wallhaven-Suche
 */
const WallhavenManager = {
    wallhavenWindow: null,
    currentPage: 1,
    lastPage: 1,
    
    /**
     * Öffnet das Wallhaven-Suchfenster
     */
    openWallhavenWindow() {
        return window.AstrieRuntime.open('wallhaven-search');
    },

    mountWindow(root, win) {
        this.wallhavenWindow = win;
        root?.querySelector('.wallhaven-button')?.addEventListener('click', () => this._searchWallhaven(1));
        root?.querySelector('.wallhaven-input')?.addEventListener('keydown', event => {
            if (event.key === 'Enter') this._searchWallhaven(1);
        });
    },
    
    /**
     * Sucht auf Wallhaven nach Wallpapers
     */
    async _searchWallhaven(page = 1) {
        const root = WindowManager.windows['wallhaven-search']?.content;
        const searchInput = root?.querySelector('.wallhaven-input');
        const resultsContainer = root?.querySelector('#wallhaven-results');
        const pagination = root?.querySelector('#wallhaven-pagination');
        if (!searchInput || !resultsContainer) return;

        const query = searchInput.value.trim();
        const category = root.querySelector('#wallhaven-category')?.value || '111';
        const purity = root.querySelector('#wallhaven-purity')?.value || '100';
        const resolution = root.querySelector('#wallhaven-resolution')?.value || '';
        const apiKey = root.querySelector('.wallhaven-api-key')?.value.trim() || '';
        resultsContainer.replaceChildren();
        resultsContainer.appendChild(this._statusMessage('wallhaven-loading', 'Suche auf Wallhaven…'));
        if (pagination) pagination.replaceChildren();

        try {
            const apiUrl = this._buildWallhavenUrl(query, category, purity, resolution, page, apiKey);
            const response = await fetch(apiUrl);
            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.error || `Wallhaven antwortete mit HTTP ${response.status}.`);
            }
            this.currentPage = data.meta?.current_page || page;
            this.lastPage = data.meta?.last_page || 1;
            this._displayWallhavenResults(data, resultsContainer);
            this._renderWallhavenPagination(pagination);
        } catch (error) {
            console.error('[Wallhaven] Fehler:', error);
            resultsContainer.replaceChildren(this._statusMessage('wallhaven-error', `Wallhaven-Suche fehlgeschlagen: ${error.message}`));
        }
    },

    _statusMessage(className, message) {
        const element = document.createElement('p');
        element.className = className;
        element.textContent = message;
        return element;
    },
    
    /**
     * Baut die Wallhaven API URL
     */
    _buildWallhavenUrl(query, category, purity, resolution, page = 1, apiKey = '') {
        const baseUrl = 'https://wallhaven.cc/api/v1/search';
        const params = new URLSearchParams();
        if (query) params.set('q', query);
        params.set('categories', category || '111');
        params.set('purity', purity || '100');
        if (resolution) params.set('resolutions', resolution);
        if (apiKey) params.set('apikey', apiKey);
        params.set('page', String(page));
        params.set('sorting', 'relevance');
        params.set('order', 'desc');
        return `${baseUrl}?${params.toString()}`;
    },

    _renderWallhavenPagination(container) {
        if (!container || this.lastPage <= 1) return;
        const button = (label, page, disabled = false) => {
            const element = document.createElement('button');
            element.className = 'wallhaven-page';
            element.textContent = label;
            element.disabled = disabled;
            element.addEventListener('click', () => this._searchWallhaven(page));
            return element;
        };
        container.append(
            button('‹', this.currentPage - 1, this.currentPage <= 1),
            this._statusMessage('wallhaven-page-label', `${this.currentPage} / ${this.lastPage}`),
            button('›', this.currentPage + 1, this.currentPage >= this.lastPage)
        );
    },
    
    /**
     * Zeigt Wallhaven-Suchergebnisse an
     */
    _displayWallhavenResults(data, container) {
        if (!data || !data.data || data.data.length === 0) {
            container.replaceChildren(this._statusMessage('wallhaven-empty', 'Keine Wallpapers gefunden'));
            return;
        }
        const grid = document.createElement('div');
        grid.className = 'wallhaven-grid';
        data.data.forEach(wallpaper => {
            const card = document.createElement('button');
            card.type = 'button';
            card.className = 'wallhaven-card';
            card.style.cssText = 'width:100%;padding:0;border:0;color:inherit;font:inherit;text-align:left;cursor:pointer;';
            card.addEventListener('click', () => this._selectWallpaper(wallpaper.path || `https://wallhaven.cc/wallpaper/${wallpaper.id}`));
            const image = document.createElement('img');
            image.src = wallpaper.thumbs?.large || wallpaper.thumbs?.original || wallpaper.path || '';
            image.alt = String(wallpaper.id || 'Wallhaven wallpaper');
            image.className = 'wallhaven-thumb';
            image.loading = 'lazy';
            const info = document.createElement('div');
            info.className = 'wallhaven-card-info';
            const title = document.createElement('span');
            title.className = 'wallhaven-card-title';
            title.textContent = wallpaper.id || 'Wallhaven Wallpaper';
            const stats = document.createElement('span');
            stats.className = 'wallhaven-card-stats';
            stats.textContent = `${Number(wallpaper.views || 0).toLocaleString()} Views | ${Number(wallpaper.favorites || 0).toLocaleString()} Favorites`;
            info.append(title, stats);
            card.append(image, info);
            grid.appendChild(card);
        });
        container.replaceChildren(grid);
    },
    
    /**
     * Wählt ein Wallpaper aus
     */
    async _selectWallpaper(wallpaperUrl) {
        try {
            if (typeof Nutzerspeicher === 'undefined' || !await Nutzerspeicher.speichereWallhavenHintergrund(wallpaperUrl)) {
                throw new Error('Das Wallpaper konnte nicht gespeichert oder aktiviert werden.');
            }
            if (typeof WindowManager !== 'undefined') WindowManager.closeWindow('wallhaven-search');
            this._showSuccess('Hintergrund erfolgreich geändert!');
        } catch (error) {
            console.error('[Wallhaven] Wallpaper konnte nicht angewendet werden:', error);
            const root = WindowManager.windows['wallhaven-search']?.content;
            const results = root?.querySelector('#wallhaven-results');
            if (results) results.replaceChildren(this._statusMessage('wallhaven-error', error.message));
        }
    },
    
    /**
     * Zeigt eine Erfolgsmeldung an
     */
    _showSuccess(message) {
        if (typeof Benachrichtigung !== 'undefined') {
            new Benachrichtigung('Hintergrund', message, '/Res/Bild/Icon/Topbar/check_circle_24dp_FFFFFF_FILL1_wght400_GRAD0_opsz24.svg');
        } else {
            const notification = document.createElement('div');
            notification.className = 'hintergrund-notification';
            notification.textContent = message;
            notification.style.cssText = `
                position: fixed;
                bottom: 100px;
                left: 50%;
                transform: translateX(-50%);
                background: rgba(0, 0, 0, 0.7);
                color: white;
                padding: 12px 24px;
                border-radius: 8px;
                z-index: 1000000;
                animation: slideUp 0.3s ease;
            `;
            document.body.appendChild(notification);
            
            setTimeout(() => {
                notification.style.opacity = '0';
                notification.style.transition = 'opacity 0.3s ease';
                setTimeout(() => notification.remove(), 300);
            }, 3000);
        }
    }
};

// Export für andere Module
window.WallhavenManager = WallhavenManager;

AstrieRuntime.register({
    id: 'wallhaven-search',
    title: 'Wallhaven Suche',
    icon: '/Res/Bild/Icon/Topbar/search_24dp_FFFFFF_FILL1_wght400_GRAD0_opsz24.svg',
    templateUrl: '/ui/Wallhaven.html',
    templateId: 'wallhaven-ui',
    styleUrl: '/ui/Ui_css/Wallhaven.css',
    width: 800,
    height: 600,
    mount: ({ root, window: win }) => WallhavenManager.mountWindow(root, win)
});
