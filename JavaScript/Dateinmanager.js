/** Lokaler Dateimanager, getrennt nach aktivem AstrieOS-Konto. */
const Dateinmanager = {
    DB_NAME: 'astrieos_dateien',
    DB_VERSION: 1,
    STORE: 'eintraege',
    database: null,
    root: null,
    folderId: null,
    inTrash: false,
    search: '',
    sort: 'name',
    entries: [],
    categories: [
        ['Dokumente', 'description_24dp_FFFFFF_FILL1_wght400_GRAD0_opsz24.svg'],
        ['Downloads', 'download_24dp_FFFFFF_FILL1_wght400_GRAD0_opsz24.svg'],
        ['Videos', 'video_library_24dp_FFFFFF_FILL1_wght400_GRAD0_opsz24.svg'],
        ['Audio', 'music_note_2_24dp_FFFFFF_FILL1_wght400_GRAD0_opsz24.svg'],
        ['Bilder', 'photo_24dp_FFFFFF_FILL1_wght400_GRAD0_opsz24.svg']
    ],
    fileIcons: {
        text: '/Res/Bild/Icon/Window/file_text.svg',
        code: '/Res/Bild/Icon/Window/file_code.svg',
        audio: '/Res/Bild/Icon/Window/file_audio.svg',
        video: '/Res/Bild/Icon/Window/file_video.svg',
        image: '/Res/Bild/Icon/Window/file_image.svg',
        pdf: '/Res/Bild/Icon/Window/file_pdf.svg',
        generic: '/Res/Bild/Icon/Window/file_generic.svg',
        player: '/Res/Bild/Icon/Topbar/music_note_2_24dp_FFFFFF_FILL1_wght400_GRAD0_opsz24.svg'
    },

    async mount(root) {
        this.root = root;
        this.folderId = null;
        this.inTrash = false;
        this.search = '';
        const search = root.querySelector('.D-suche');
        const sort = root.querySelector('.Datein-sort');
        if (search) search.value = '';
        if (sort) sort.value = 'name';
        root.querySelector('[data-action="home"]')?.addEventListener('click', () => this.goHome());
        root.querySelector('[data-action="upload"]')?.addEventListener('click', () => root.querySelector('.Datein-file-input')?.click());
        root.querySelector('[data-action="create"]')?.addEventListener('click', () => this.createFolder());
        root.querySelector('[data-action="trash"]')?.addEventListener('click', () => this.openTrash());
        search?.addEventListener('input', () => { this.search = search.value.trim().toLocaleLowerCase('de'); this.render(); });
        sort?.addEventListener('change', () => { this.sort = sort.value; this.render(); });
        root.querySelector('.Datein-file-input')?.addEventListener('change', event => this.uploadFiles([...event.target.files]));
        window.addEventListener('astrie-account-changed', () => this.refresh(), { signal: this._lifecycleSignal(root) });
        try {
            await this.openDatabase();
            await this.ensureDefaultFolders();
            await this.refresh();
        } catch (error) {
            console.error('[Dateinmanager] Initialisierung fehlgeschlagen:', error);
            this.setStatus(`Der lokale Dateispeicher konnte nicht geöffnet werden. ${error.message || ''}`, true);
        }
    },

    _lifecycleSignal(root) {
        // Keep account-change listeners scoped to the window instance.
        const controller = new AbortController();
        const observer = new MutationObserver(() => {
            if (!root.isConnected) { controller.abort(); observer.disconnect(); }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        return controller.signal;
    },

    async openDatabase() {
        if (this.database) return this.database;
        this.database = await new Promise((resolve, reject) => {
            const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);
            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains(this.STORE)) {
                    const store = db.createObjectStore(this.STORE, { keyPath: 'id' });
                    store.createIndex('accountId', 'accountId', { unique: false });
                }
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error || new Error('IndexedDB ist nicht verfügbar.'));
            request.onblocked = () => reject(new Error('Ein anderer Tab blockiert den Dateispeicher.'));
        });
        this.database.onversionchange = () => { this.database.close(); this.database = null; };
        return this.database;
    },

    closeDatabase() {
        this.database?.close();
        this.database = null;
    },

    accountId() { return window.Nutzerspeicher?.getAktiveKontoId?.() || 'gast'; },
    accountName() { return window.Nutzerspeicher?.getAktivesKonto?.()?.username || 'Gast!'; },
    id() { return `datei_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`; },

    async allEntries() {
        const db = await this.openDatabase();
        return new Promise((resolve, reject) => {
            const request = db.transaction(this.STORE, 'readonly').objectStore(this.STORE).getAll();
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error || new Error('Dateiliste konnte nicht geladen werden.'));
        });
    },

    async write(entry) {
        const db = await this.openDatabase();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.STORE, 'readwrite');
            tx.objectStore(this.STORE).put(entry);
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => reject(tx.error || new Error('Änderung konnte nicht gespeichert werden.'));
            tx.onabort = () => reject(tx.error || new Error('Speichern wurde abgebrochen.'));
        });
    },

    async remove(id) {
        const db = await this.openDatabase();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.STORE, 'readwrite');
            tx.objectStore(this.STORE).delete(id);
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => reject(tx.error || new Error('Eintrag konnte nicht gelöscht werden.'));
        });
    },

    async ensureDefaultFolders() {
        const accountId = this.accountId();
        const entries = await this.allEntries();
        const existing = entries.filter(item => item.accountId === accountId && item.parentId === null);
        if (existing.length) return;
        for (const [name] of this.categories) {
            await this.write({ id: this.id(), accountId, parentId: null, name, kind: 'folder', size: 0, modifiedAt: Date.now(), trashedAt: null });
        }
    },

    async refresh() {
        if (!this.root?.isConnected) return;
        try {
            await this.ensureDefaultFolders();
            this.entries = (await this.allEntries()).filter(item => item.accountId === this.accountId());
            const account = this.root.querySelector('.Datein-name');
            if (account) account.textContent = this.accountName();
            if (this.folderId && !this.entries.some(item => item.id === this.folderId && !item.trashedAt)) this.folderId = null;
            this.render();
        } catch (error) {
            console.error('[Dateinmanager] Laden fehlgeschlagen:', error);
            this.setStatus(`Dateien konnten nicht geladen werden. ${error.message || ''}`, true);
        }
    },

    goHome() { this.folderId = null; this.inTrash = false; this.render(); },
    openTrash() { this.folderId = null; this.inTrash = true; this.render(); },

    async createFolder() {
        const name = await this.ask('Name des neuen Ordners:', 'Neuer Ordner');
        if (!name) return;
        const clean = this.cleanName(name);
        if (!clean || this.nameExists(clean)) return this.setStatus('In diesem Ordner gibt es bereits einen Eintrag mit diesem Namen.', true);
        await this.write({ id: this.id(), accountId: this.accountId(), parentId: this.folderId, name: clean, kind: 'folder', size: 0, modifiedAt: Date.now(), trashedAt: null });
        await this.refresh();
        this.setStatus(`Ordner „${clean}“ wurde erstellt.`);
    },

    async uploadFiles(files) {
        if (!files.length) return;
        try {
            for (const file of files) {
                const name = this.cleanName(file.name);
                if (this.nameExists(name)) { this.setStatus(`„${name}“ existiert in diesem Ordner bereits.`, true); continue; }
                await this.write({ id: this.id(), accountId: this.accountId(), parentId: this.folderId, name, kind: 'file', mime: file.type || 'application/octet-stream', size: file.size, blob: file, modifiedAt: Date.now(), trashedAt: null });
            }
            this.root.querySelector('.Datein-file-input').value = '';
            await this.refresh();
            this.setStatus(`${files.length === 1 ? 'Datei' : 'Dateien'} hochgeladen.`);
        } catch (error) {
            console.error('[Dateinmanager] Upload fehlgeschlagen:', error);
            this.setStatus(`Upload fehlgeschlagen. ${error.message || ''}`, true);
        }
    },

    async rename(entry) {
        const name = await this.ask('Neuer Name:', entry.name);
        if (!name) return;
        const clean = this.cleanName(name);
        if (this.nameExists(clean, entry.id)) return this.setStatus('In diesem Ordner gibt es bereits einen Eintrag mit diesem Namen.', true);
        entry.name = clean;
        entry.modifiedAt = Date.now();
        await this.write(entry);
        await this.refresh();
    },

    async trashEntry(entry) {
        if (!await this.confirm(`„${entry.name}“ in den Papierkorb verschieben?`)) return;
        const now = Date.now();
        entry.trashedAt = now;
        entry.modifiedAt = now;
        await this.write(entry);
        await this.setTrashForDescendants(entry.id, now);
        await this.refresh();
    },

    async setTrashForDescendants(parentId, trashedAt) {
        for (const child of this.entries.filter(item => item.parentId === parentId && !item.trashedAt)) {
            child.trashedAt = trashedAt;
            child.modifiedAt = trashedAt;
            await this.write(child);
            await this.setTrashForDescendants(child.id, trashedAt);
        }
    },

    async restore(entry) {
        entry.trashedAt = null;
        entry.parentId = this.entries.some(item => item.id === entry.parentId && !item.trashedAt) ? entry.parentId : null;
        entry.modifiedAt = Date.now();
        await this.write(entry);
        await this.restoreDescendants(entry.id);
        await this.refresh();
    },

    async restoreDescendants(parentId) {
        for (const child of this.entries.filter(item => item.parentId === parentId && item.trashedAt)) {
            child.trashedAt = null;
            child.modifiedAt = Date.now();
            await this.write(child);
            await this.restoreDescendants(child.id);
        }
    },

    async deletePermanently(entry) {
        if (!await this.confirm(`„${entry.name}“ endgültig löschen?`)) return;
        const descendants = this.entries.filter(item => item.parentId === entry.id);
        for (const child of descendants) await this.deletePermanentlySilent(child);
        await this.remove(entry.id);
        await this.refresh();
    },

    async deletePermanentlySilent(entry) {
        for (const child of this.entries.filter(item => item.parentId === entry.id)) await this.deletePermanentlySilent(child);
        await this.remove(entry.id);
    },

    download(entry) {
        if (!entry.blob) return this.setStatus('Der Dateiinhalt ist nicht verfügbar.', true);
        const url = URL.createObjectURL(entry.blob);
        const link = document.createElement('a');
        link.href = url; link.download = entry.name; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    },

    fileType(entry) {
        const extension = entry.name.split('.').pop()?.toLocaleLowerCase('en') || '';
        const mime = entry.mime || '';
        if (mime.startsWith('audio/') || /^(mp3|ogg|oga|wav|m4a|aac|flac|opus|weba)$/.test(extension)) return 'audio';
        if (mime.startsWith('video/') || /^(mp4|webm|mov|m4v|ogv|avi|mkv)$/.test(extension)) return 'video';
        if (mime.startsWith('image/') || /^(png|jpe?g|gif|webp|avif|svg|bmp|ico)$/.test(extension)) return 'image';
        if (extension === 'pdf' || mime === 'application/pdf') return 'pdf';
        if (/^(txt|md|markdown|csv|log|ini|xml|ya?ml)$/.test(extension)) return 'text';
        if (/^(js|mjs|cjs|ts|tsx|jsx|html?|css|json|py|java|c|cc|cpp|h|hpp|sh|sql|php|rs|go|vue|svelte)$/.test(extension)) return 'code';
        return 'generic';
    },

    async openFile(entry) {
        const type = this.fileType(entry);
        if (type === 'audio' || type === 'video') {
            const app = await window.Popup?.choose?.(
                `„${entry.name}“ kann im Mediaplayer oder in einem eigenen ${type === 'audio' ? 'Audio' : 'Video'}fenster geöffnet werden.`,
                [
                    { value: 'player', label: 'Im Mediaplayer öffnen', description: 'Zur Mediathek hinzufügen und direkt abspielen', icon: this.fileIcons.player },
                    { value: 'preview', label: `Im eigenen ${type === 'audio' ? 'Audio' : 'Video'}fenster öffnen`, description: 'Direkt mit der eingebauten Wiedergabesteuerung öffnen', icon: this.fileIcons[type] }
                ],
                { title: 'Datei öffnen', cancelLabel: 'Abbrechen' }
            );
            if (!app) return;
            if (app === 'player') return this.openInMediaplayer(entry);
            return this.openPreview(entry, type);
        }
        return this.openPreview(entry, type);
    },

    async openInMediaplayer(entry) {
        if (typeof window.openMusikplayerPanel !== 'function' || !window.AstrieRuntime) {
            return window.Popup?.alert?.('Der Mediaplayer ist gerade nicht verfügbar.', { title: 'Datei öffnen', type: 'error' });
        }
        try {
            await window.AstrieRuntime.loadScript('/JavaScript/Mediaplayer.js');
            const playerPanel = await window.openMusikplayerPanel();
            const player = window.Mediaplayer;
            if (!playerPanel || !player) {
                return window.Popup?.alert?.('Der Mediaplayer konnte nicht geöffnet werden.', { title: 'Datei öffnen', type: 'error' });
            }
            await player.libraryReady;
            const file = new File([entry.blob], entry.name, { type: entry.mime || entry.blob.type || 'application/octet-stream' });
            let index = player.tracks.findIndex(track => track.blob?.name === file.name && track.blob.size === file.size && track.blob.lastModified === file.lastModified);
            if (index < 0) {
                const previousCount = player.tracks.length;
                await player.importFiles([file]);
                index = player.tracks.findIndex((track, trackIndex) => trackIndex >= previousCount && track.blob?.name === file.name);
            }
            if (index < 0) {
                return window.Popup?.alert?.(`„${entry.name}“ konnte nicht in den Mediaplayer übernommen werden.`, { title: 'Format nicht unterstützt', type: 'warning' });
            }
            player.select(index, true);
        } catch (error) {
            console.error('[Dateinmanager] Mediaplayer-Übergabe fehlgeschlagen:', error);
            await window.Popup?.alert?.(`„${entry.name}“ konnte nicht geöffnet werden. ${error.message || ''}`, { title: 'Datei öffnen', type: 'error' });
        }
    },

    async openPreview(entry, type = this.fileType(entry)) {
        const windowId = `datei-vorschau-${entry.id}`;
        const existing = window.WindowManager?.windows?.[windowId];
        if (existing) {
            existing.minimized ? window.WindowManager.restoreWindow(windowId) : window.WindowManager.focusWindow(windowId);
            return;
        }
        if (!window.WindowManager?.template) return window.Popup?.alert?.('Das Fenstersystem ist noch nicht bereit.', { title: 'Datei öffnen', type: 'error' });
        this.loadPreviewStyles();
        const content = document.createElement('div');
        content.className = `File-preview File-preview-${type}`;
        const viewer = document.createElement('div');
        viewer.className = 'File-preview-viewer';
        viewer.textContent = 'Datei wird geöffnet …';
        content.append(viewer);
        const win = window.WindowManager.createWindow({
            id: windowId,
            title: entry.name,
            icon: this.fileIcons[type] || this.fileIcons.generic,
            content,
            width: type === 'audio' ? 560 : 900,
            height: type === 'audio' ? 300 : 620
        });
        if (!win) return;
        const download = document.createElement('button');
        download.className = 'File-preview-download';
        download.type = 'button';
        download.textContent = 'Datei herunterladen';
        download.addEventListener('click', () => this.download(entry));
        content.append(download);

        if (type === 'text' || type === 'code') {
            try {
                const pre = document.createElement('pre');
                pre.className = 'File-preview-text';
                pre.textContent = await entry.blob.text();
                viewer.replaceChildren(pre);
            } catch (error) {
                viewer.textContent = `Datei konnte nicht gelesen werden. ${error.message || ''}`;
            }
            return;
        }

        if (type === 'audio' || type === 'video') {
            this.createMediaPlayer(entry, type, viewer, windowId);
            return;
        }

        if (type === 'image') {
            const image = document.createElement('img');
            image.className = 'File-preview-image';
            image.alt = entry.name;
            image.src = URL.createObjectURL(entry.blob);
            this.revokePreviewUrlOnClose(windowId, image.src);
            viewer.replaceChildren(image);
            return;
        }

        if (type === 'pdf') {
            const frame = document.createElement('iframe');
            frame.className = 'File-preview-pdf';
            frame.title = entry.name;
            frame.src = URL.createObjectURL(entry.blob);
            this.revokePreviewUrlOnClose(windowId, frame.src);
            viewer.replaceChildren(frame);
            return;
        }

        viewer.textContent = `Für „${entry.name}“ ist keine Vorschau verfügbar. Du kannst die Datei herunterladen.`;
    },

    createMediaPlayer(entry, type, viewer, windowId) {
        const isVideo = type === 'video';
        const iconRoot = `/Res/Bild/Icon/Window/Window-${isVideo ? 'videoplayer' : 'audioplayer'}`;
        const media = document.createElement(type);
        media.className = isVideo ? 'File-video-element' : 'File-audio-element';
        media.preload = 'metadata';
        media.playsInline = true;
        media.src = URL.createObjectURL(entry.blob);
        this.revokePreviewUrlOnClose(windowId, media.src);

        const player = document.createElement('div');
        player.className = `File-custom-player ${isVideo ? 'is-video' : 'is-audio'}`;
        const status = document.createElement('span');
        status.className = 'File-player-status';
        status.textContent = 'Bereit';

        const seek = document.createElement('input');
        seek.type = 'range'; seek.min = '0'; seek.max = '1000'; seek.value = '0';
        seek.className = 'File-player-seek';
        seek.setAttribute('aria-label', 'Wiedergabeposition');

        const currentTime = document.createElement('span'); currentTime.textContent = '0:00';
        const duration = document.createElement('span'); duration.textContent = '0:00';
        const time = document.createElement('div'); time.className = 'File-player-time'; time.append(currentTime, document.createTextNode(' / '), duration);

        const playButton = this.mediaButton('Abspielen', `${iconRoot}/play_arrow_24dp_FFFFFF_FILL1_wght400_GRAD0_opsz24.svg`, 'File-player-play');
        const togglePlayback = () => {
            if (media.paused) media.play().catch(() => { status.textContent = 'Wiedergabe konnte nicht automatisch starten. Drücke auf Abspielen.'; });
            else media.pause();
        };
        playButton.addEventListener('click', togglePlayback);

        const backButton = this.mediaButton('10 Sekunden zurück', `${iconRoot}/skip_previous_24dp_FFFFFF_FILL1_wght400_GRAD0_opsz24.svg`);
        backButton.addEventListener('click', () => { if (Number.isFinite(media.duration)) media.currentTime = Math.max(0, media.currentTime - 10); });
        const forwardButton = this.mediaButton('10 Sekunden vor', `${iconRoot}/skip_next_24dp_FFFFFF_FILL1_wght400_GRAD0_opsz24.svg`);
        forwardButton.addEventListener('click', () => { if (Number.isFinite(media.duration)) media.currentTime = Math.min(media.duration, media.currentTime + 10); });

        const muteButton = document.createElement('button');
        muteButton.className = 'File-player-mute'; muteButton.type = 'button'; muteButton.textContent = 'Ton an';
        muteButton.setAttribute('aria-label', 'Ton stummschalten');
        muteButton.addEventListener('click', () => {
            media.muted = !media.muted;
            muteButton.textContent = media.muted ? 'Stumm' : 'Ton an';
            muteButton.setAttribute('aria-label', media.muted ? 'Ton einschalten' : 'Ton stummschalten');
        });

        const volume = document.createElement('input');
        volume.className = 'File-player-volume'; volume.type = 'range'; volume.min = '0'; volume.max = '1'; volume.step = '0.01'; volume.value = '0.85';
        volume.setAttribute('aria-label', 'Lautstärke');
        media.volume = 0.85;
        volume.addEventListener('input', () => { media.volume = Number(volume.value); if (media.volume) media.muted = false; });

        const controls = document.createElement('div'); controls.className = 'File-player-controls';
        controls.append(backButton, playButton, forwardButton, time, muteButton, volume);
        if (isVideo) {
            const fullscreenButton = this.mediaButton('Vollbild', '/Res/Bild/Icon/Window/Window-videoplayer/fullscreen_24dp_FFFFFF_FILL1_wght400_GRAD0_opsz24.svg', 'File-player-fullscreen');
            fullscreenButton.addEventListener('click', async () => {
                try {
                    if (document.fullscreenElement) await document.exitFullscreen();
                    else await viewer.requestFullscreen();
                } catch (error) { status.textContent = `Vollbild konnte nicht geöffnet werden. ${error.message || ''}`; }
            });
            const syncFullscreenIcon = () => {
                const fullscreen = document.fullscreenElement === viewer;
                fullscreenButton.querySelector('img').src = `/Res/Bild/Icon/Window/Window-videoplayer/fullscreen${fullscreen ? '_exit' : ''}_24dp_FFFFFF_FILL1_wght400_GRAD0_opsz24.svg`;
                fullscreenButton.setAttribute('aria-label', fullscreen ? 'Vollbild beenden' : 'Vollbild');
                fullscreenButton.title = fullscreen ? 'Vollbild beenden' : 'Vollbild';
            };
            document.addEventListener('fullscreenchange', syncFullscreenIcon);
            this.onWindowClosed(windowId, () => document.removeEventListener('fullscreenchange', syncFullscreenIcon));
            controls.append(fullscreenButton);
            const screen = document.createElement('div'); screen.className = 'File-video-screen';
            const overlayPlay = this.mediaButton('Abspielen', `${iconRoot}/play_arrow_24dp_FFFFFF_FILL1_wght400_GRAD0_opsz24.svg`, 'File-video-overlay-play');
            overlayPlay.addEventListener('click', togglePlayback);
            screen.append(media, overlayPlay);
            player.append(screen);
        } else {
            const artwork = document.createElement('div'); artwork.className = 'File-audio-art';
            const cover = document.createElement('img');
            cover.src = '/Res/Bild/Icon/Window/Window-topbar/audio_file_24dp_FFFFFF_FILL1_wght400_GRAD0_opsz24.svg';
            cover.alt = '';
            artwork.append(cover);
            const waveform = document.createElement('div'); waveform.className = 'File-audio-waveform';
            [22, 38, 54, 32, 68, 46, 28, 58, 36, 64, 27, 49, 34, 61, 40, 25].forEach(height => {
                const bar = document.createElement('i'); bar.style.setProperty('--wave-height', `${height}%`); waveform.append(bar);
            });
            artwork.append(waveform);
            const info = document.createElement('div'); info.className = 'File-audio-info';
            const title = document.createElement('strong'); title.textContent = entry.name;
            info.append(title, status);
            player.append(artwork, info);
        }

        const timeline = document.createElement('div'); timeline.className = 'File-player-timeline'; timeline.append(seek);
        player.append(timeline, controls);
        if (isVideo) player.append(status);
        viewer.replaceChildren(player);

        const formatTime = value => {
            if (!Number.isFinite(value)) return '0:00';
            const seconds = Math.max(0, Math.floor(value));
            return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
        };
        const update = () => {
            if (Number.isFinite(media.duration)) {
                seek.value = String(Math.round(media.currentTime / media.duration * 1000));
                currentTime.textContent = formatTime(media.currentTime);
                duration.textContent = formatTime(media.duration);
            }
            const playing = !media.paused && !media.ended;
            player.classList.toggle('is-playing', playing);
            playButton.querySelector('img').src = `${iconRoot}/${playing ? 'pause' : 'play_arrow'}_24dp_FFFFFF_FILL1_wght400_GRAD0_opsz24.svg`;
            playButton.setAttribute('aria-label', playing ? 'Pause' : 'Abspielen');
            if (isVideo) {
                const overlay = player.querySelector('.File-video-overlay-play');
                overlay.hidden = playing;
                overlay.querySelector('img').src = `${iconRoot}/${playing ? 'pause' : 'play_arrow'}_24dp_FFFFFF_FILL1_wght400_GRAD0_opsz24.svg`;
                overlay.setAttribute('aria-label', playing ? 'Pause' : 'Abspielen');
            }
            if (media.ended) status.textContent = 'Wiedergabe beendet';
            else if (playing) status.textContent = 'Wird wiedergegeben';
            else if (media.currentTime > 0) status.textContent = 'Pausiert';
        };
        ['loadedmetadata', 'durationchange', 'timeupdate', 'play', 'pause', 'ended'].forEach(eventName => media.addEventListener(eventName, update));
        seek.addEventListener('input', () => {
            if (Number.isFinite(media.duration)) media.currentTime = media.duration * Number(seek.value) / 1000;
        });
        media.addEventListener('error', () => { status.textContent = 'Der Browser kann dieses Medienformat nicht wiedergeben.'; }, { once: true });
        media.play().catch(() => { status.textContent = 'Drücke auf Abspielen, um die Wiedergabe zu starten.'; });
    },

    mediaButton(label, iconUrl, className = '') {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `File-player-button ${className}`.trim();
        button.setAttribute('aria-label', label);
        button.title = label;
        const icon = document.createElement('img'); icon.src = iconUrl; icon.alt = '';
        button.append(icon);
        return button;
    },

    loadPreviewStyles() {
        if (document.querySelector('link[data-file-preview-styles]')) return;
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = '/ui/Ui_css/Datei-vorschau.css';
        link.dataset.filePreviewStyles = 'true';
        document.head.append(link);
    },

    revokePreviewUrlOnClose(windowId, url) {
        this.onWindowClosed(windowId, () => URL.revokeObjectURL(url));
    },

    onWindowClosed(windowId, callback) {
        const cleanup = event => {
            if (event.detail?.id !== windowId) return;
            callback();
            window.removeEventListener('astrie-window-closed', cleanup);
        };
        window.addEventListener('astrie-window-closed', cleanup);
    },

    fileIcon(entry) {
        const type = this.fileType(entry);
        return this.fileIcons[type] || this.fileIcons.generic;
    },

    nameExists(name, exceptId = null) {
        return this.entries.some(item => item.id !== exceptId && item.parentId === this.folderId && !item.trashedAt && item.name.toLocaleLowerCase('de') === name.toLocaleLowerCase('de'));
    },
    cleanName(name) { return String(name).trim().replace(/[\/\\]/g, '').replace(/\0/g, '').slice(0, 180); },
    async ask(message, value = '') { return window.Popup?.prompt ? window.Popup.prompt(message, { title: 'Dateimanager', value, confirmLabel: 'Speichern' }) : window.prompt(message, value); },
    async confirm(message) { return window.Popup?.confirm ? window.Popup.confirm(message, { title: 'Dateimanager', confirmLabel: 'Bestätigen' }) : window.confirm(message); },
    setStatus(message, error = false) {
        const status = this.root?.querySelector('.Datein-status');
        if (status) { status.textContent = message; status.classList.toggle('is-error', error); }
    },
    formatSize(size) {
        if (!size) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB'];
        const index = Math.min(Math.floor(Math.log(size) / Math.log(1024)), units.length - 1);
        return `${(size / 1024 ** index).toLocaleString('de-DE', { maximumFractionDigits: 1 })} ${units[index]}`;
    },

    render() {
        if (!this.root?.isConnected) return;
        const list = this.root.querySelector('.Datein-list');
        const crumbs = this.root.querySelector('.Datein-breadcrumbs');
        const count = this.root.querySelector('.Datein-count');
        if (!list || !crumbs) return;
        crumbs.replaceChildren();
        const chain = [];
        let current = this.entries.find(item => item.id === this.folderId);
        while (current) { chain.unshift(current); current = this.entries.find(item => item.id === current.parentId); }
        if (!this.inTrash) {
            const home = document.createElement('button');
            home.type = 'button'; home.className = 'Datein-crumb'; home.textContent = 'Dateien';
            home.addEventListener('click', () => this.goHome()); crumbs.append(home);
            chain.forEach((entry, index) => {
                const sep = document.createElement('span'); sep.className = 'Datein-separator'; sep.textContent = '›'; crumbs.append(sep);
                const button = document.createElement('button'); button.type = 'button'; button.className = 'Datein-crumb'; button.textContent = entry.name;
                button.addEventListener('click', () => { this.folderId = entry.id; this.render(); });
                if (index === chain.length - 1) button.disabled = true;
                crumbs.append(button);
            });
        } else {
            const label = document.createElement('span'); label.className = 'Datein-crumb'; label.textContent = 'Papierkorb'; crumbs.append(label);
        }
        const folder = this.entries.find(item => item.id === this.folderId);
        const visible = this.entries.filter(item => this.inTrash ? Boolean(item.trashedAt) : !item.trashedAt && item.parentId === this.folderId)
            .filter(item => !this.search || item.name.toLocaleLowerCase('de').includes(this.search));
        visible.sort((a, b) => {
            if (this.sort === 'modified') return b.modifiedAt - a.modifiedAt;
            if (this.sort === 'size') return b.size - a.size || a.name.localeCompare(b.name, 'de');
            if (this.sort === 'type') return a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name, 'de');
            return (a.kind === b.kind ? 0 : a.kind === 'folder' ? -1 : 1) || a.name.localeCompare(b.name, 'de');
        });
        list.replaceChildren();
        if (!this.inTrash && this.folderId) {
            const back = this.entries.find(item => item.id === folder?.parentId);
            const up = document.createElement('button'); up.type = 'button'; up.className = 'Datein-row Datein-up'; up.innerHTML = '<span class="Datein-item-icon">↰</span><span class="Datein-item-name">Übergeordneter Ordner</span>';
            up.addEventListener('click', () => { this.folderId = back?.id || null; this.render(); }); list.append(up);
        }
        visible.forEach(entry => list.append(this.makeRow(entry)));
        if (!visible.length) {
            const empty = document.createElement('div'); empty.className = 'Datein-empty';
            empty.textContent = this.search ? 'Keine passenden Einträge gefunden.' : this.inTrash ? 'Der Papierkorb ist leer.' : 'Dieser Ordner ist leer. Erstelle einen Ordner oder lade Dateien hoch.';
            list.append(empty);
        }
        if (count) count.textContent = `${visible.length} ${visible.length === 1 ? 'Element' : 'Elemente'}`;
        this.root.querySelector('[data-action="upload"]').hidden = this.inTrash;
        this.root.querySelector('[data-action="create"]').hidden = this.inTrash;
        this.root.querySelector('[data-action="trash"]').classList.toggle('is-active', this.inTrash);
    },

    makeRow(entry) {
        const row = document.createElement('div'); row.className = 'Datein-row'; row.setAttribute('role', 'listitem');
        const open = document.createElement('button'); open.type = 'button'; open.className = 'Datein-open';
        const icon = document.createElement('span'); icon.className = `Datein-item-icon ${entry.kind === 'folder' ? 'is-folder' : 'is-file'}`;
        const iconImage = document.createElement('img');
        const folderIcon = this.categories.find(([name]) => name === entry.name)?.[1] || 'home_24dp_FFFFFF_FILL1_wght400_GRAD0_opsz24.svg';
        iconImage.src = entry.kind === 'folder'
            ? `/Res/Bild/Icon/Datein/Folder/${folderIcon}`
            : this.fileIcon(entry);
        iconImage.alt = '';
        icon.append(iconImage);
        const details = document.createElement('span'); details.className = 'Datein-item-details';
        const name = document.createElement('span'); name.className = 'Datein-item-name'; name.textContent = entry.name;
        const meta = document.createElement('span'); meta.className = 'Datein-item-meta'; meta.textContent = entry.kind === 'folder' ? 'Ordner' : `${this.formatSize(entry.size)} · ${entry.mime || 'Datei'}`;
        details.append(name, meta); open.append(icon, details);
        open.addEventListener('click', () => {
            if (this.inTrash) return;
            if (entry.kind === 'folder') { this.folderId = entry.id; this.render(); }
            else this.openFile(entry);
        });
        row.append(open);
        if (this.inTrash) this.addAction(row, 'Wiederherstellen', '↶', () => this.restore(entry));
        else if (entry.kind === 'file') this.addAction(row, 'Herunterladen', '↓', () => this.download(entry));
        this.addAction(row, 'Umbenennen', '✎', () => this.rename(entry));
        this.addAction(row, this.inTrash ? 'Endgültig löschen' : 'In Papierkorb verschieben', '×', () => this.inTrash ? this.deletePermanently(entry) : this.trashEntry(entry), true);
        return row;
    },
    addAction(row, label, glyph, action, danger = false) {
        const button = document.createElement('button'); button.type = 'button'; button.className = `Datein-action${danger ? ' is-danger' : ''}`;
        button.title = label; button.setAttribute('aria-label', label); button.textContent = glyph; button.addEventListener('click', action); row.append(button);
    }
};

window.Dateinmanager = Dateinmanager;

// Backwards compatibility for older markup that may still call this name.
function ertstellen_button() { return Dateinmanager.createFolder(); }
