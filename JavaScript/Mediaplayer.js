const Mediaplayer = {
    DB_NAME: 'astrieos_mediaplayer',
    DB_STORE: 'tracks',
    DB_SKIN_STORE: 'osu-skins',
    DB_VERSION: 2,
    dbPromise: null,
    tracks: [],
    currentIndex: -1,
    audio: document.createElement('video'),
    objectUrls: new Map(),
    bound: false,
    seekDragging: false,
    beatmapHitTimes: [],
    nextHitIndex: 0,
    fadingPlayers: new Set(),
    audioContext: null,
    analyser: null,
    gainNode: null,
    crossfadeFrame: 0,
    crossfadeGeneration: 0,
    crossfadeActive: false,
    crossfadeStartVolume: 0,
    crossfadeOutgoingStart: 0,
    backgroundVolumeFactor: 0,
    backgroundFadeFrame: 0,
    backgroundFadeGeneration: 0,
    autoCrossfadeTriggered: false,
    visualizerFrame: 0,
    titleResizeObserver: null,
    gameplayFrame: 0,
    gameplayHandled: new Set(),
    gameplayElements: new Map(),
    gameplaySliderPaths: new Map(),
    activeGameplaySliders: new Set(),
    gameplayCursor: null,
    gameplaySliderBalls: new Map(),
    gameplayWindowIndex: 0,
    wallpaperRestoreState: null,
    wallpaperSyncId: 0,
    skins: [],
    skinsLoaded: false,
    skinLoadPromise: null,
    activeSkin: null,
    skinObjectUrls: new Map(),

    init() {
        const attach = () => {
            if (this.bound || !document.querySelector('.Mediaplayer-placeholder')) return;
            this.bound = true;
            this.audio.preload = 'metadata';
            this.audio.dataset.musicPlayer = 'true';
            this.audio.hidden = true;
            this.audio.playsInline = true;
            this.updateVolume();
            document.body.appendChild(this.audio);
            this.bindPlayerControls();
            this.attachSettingsControls();
            this.watchTitleSize();
            this.loadLibrary();
        };
        attach();
        document.addEventListener('mediaplayer-template-ready', attach);
        document.addEventListener('settings-template-ready', () => this.attachSettingsControls());
    },

    openDB() {
        if (this.dbPromise) return this.dbPromise;
        this.dbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);
            request.onupgradeneeded = () => {
                const database = request.result;
                if (!database.objectStoreNames.contains(this.DB_STORE)) {
                    database.createObjectStore(this.DB_STORE, { keyPath: 'id' });
                }
                if (!database.objectStoreNames.contains(this.DB_SKIN_STORE)) {
                    database.createObjectStore(this.DB_SKIN_STORE, { keyPath: 'id' });
                }
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
        return this.dbPromise;
    },

    async closeDB() {
        this.audio.pause();
        this.stopGameplayLoop();
        this.cancelCrossfade();
        this.stopFadeOutPlayers();
        const databasePromise = this.dbPromise;
        this.dbPromise = null;
        if (databasePromise) {
            try { (await databasePromise).close(); } catch {}
        }
        for (const url of this.objectUrls.values()) URL.revokeObjectURL(url);
        this.objectUrls.clear();
        for (const url of this.skinObjectUrls.values()) URL.revokeObjectURL(url);
        this.skinObjectUrls.clear();
    },

    async storeTrack(track) {
        const db = await this.openDB();
        await new Promise((resolve, reject) => {
            const request = db.transaction(this.DB_STORE, 'readwrite').objectStore(this.DB_STORE).put(track);
            request.onsuccess = resolve;
            request.onerror = () => reject(request.error);
        });
    },

    async storeOsuSkin(skin) {
        const db = await this.openDB();
        await new Promise((resolve, reject) => {
            const request = db.transaction(this.DB_SKIN_STORE, 'readwrite').objectStore(this.DB_SKIN_STORE).put(skin);
            request.onsuccess = resolve;
            request.onerror = () => reject(request.error);
        });
    },

    async readOsuSkins() {
        const db = await this.openDB();
        return new Promise((resolve, reject) => {
            const request = db.transaction(this.DB_SKIN_STORE).objectStore(this.DB_SKIN_STORE).getAll();
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    },

    async deleteOsuSkin(id) {
        const db = await this.openDB();
        await new Promise((resolve, reject) => {
            const request = db.transaction(this.DB_SKIN_STORE, 'readwrite').objectStore(this.DB_SKIN_STORE).delete(id);
            request.onsuccess = resolve;
            request.onerror = () => reject(request.error);
        });
    },

    async loadLibrary() {
        try {
            const db = await this.openDB();
            this.tracks = await new Promise((resolve, reject) => {
                const request = db.transaction(this.DB_STORE).objectStore(this.DB_STORE).getAll();
                request.onsuccess = () => resolve(request.result || []);
                request.onerror = () => reject(request.error);
            });
            this.tracks.sort((a, b) => a.addedAt - b.addedAt);
            this.renderPlaylist();
            const lastId = Nutzerspeicher.getSetting('mediaplayerCurrentTrack');
            const index = this.tracks.findIndex(track => track.id === lastId);
            if (index >= 0) this.select(index, false);
        } catch (error) {
            console.error('[Mediaplayer] Musikbibliothek konnte nicht geladen werden:', error);
            this.setStatus('Lokaler Musik-Speicher ist nicht verfügbar.');
        }
    },

    bindPlayerControls() {
        const root = document.querySelector('.Mediaplayer-placeholder');
        root.querySelector('[data-player-upload]')?.addEventListener('change', event => this.importFiles([...event.target.files]));
        root.querySelector('[data-player-previous]')?.addEventListener('click', () => this.step(-1));
        root.querySelector('[data-player-next]')?.addEventListener('click', () => this.step(1));
        root.querySelector('[data-player-toggle]')?.addEventListener('click', () => this.togglePlayback());
        root.querySelector('[data-player-shuffle]')?.addEventListener('click', event => {
            const enabled = event.currentTarget.getAttribute('aria-pressed') !== 'true';
            event.currentTarget.setAttribute('aria-pressed', String(enabled));
            Nutzerspeicher.setSetting('mediaplayerShuffle', enabled);
        });
        const seek = root.querySelector('[data-player-seek]');
        seek?.addEventListener('input', () => {
            this.seekDragging = true;
            if (Number.isFinite(this.audio.duration)) this.audio.currentTime = this.audio.duration * Number(seek.value) / 1000;
            this.renderTime();
            this.syncCoverPlayback(!this.audio.paused);
        });
        seek?.addEventListener('change', () => { this.seekDragging = false; });
        this.audio.addEventListener('timeupdate', () => {
            if (!this.seekDragging && Number.isFinite(this.audio.duration)) {
                seek.value = String(Math.round(this.audio.currentTime / this.audio.duration * 1000));
            }
            this.renderTime();
            this.maybeAutoCrossfade();
            this.syncCoverPlayback(!this.audio.paused);
            this.drawVisualizer();
        });
        this.audio.addEventListener('ended', () => {
            this.gameplayHandled.clear();
            this.gameplayElements.clear();
            this.gameplaySliderPaths.clear();
            this.gameplaySliderBalls.clear();
            this.gameplayWindowIndex = 0;
            this.activeGameplaySliders.clear();
            document.querySelector('.Mediaplayer-gameplay')?.replaceChildren();
            this.step(1);
        });
        this.audio.addEventListener('seeking', () => {
            this.gameplayHandled.clear();
            this.gameplayElements.clear();
            this.gameplaySliderPaths.clear();
            this.gameplaySliderBalls.clear();
            this.gameplayWindowIndex = 0;
            this.activeGameplaySliders.clear();
            document.querySelector('.Mediaplayer-gameplay')?.replaceChildren();
            const beatmap = this.tracks[this.currentIndex]?.beatmap;
            const now = this.audio.currentTime * 1000;
            this.nextHitIndex = beatmap?.hitTimes?.findIndex(time => time >= now) ?? 0;
            if (this.nextHitIndex < 0) this.nextHitIndex = beatmap?.hitTimes?.length || 0;
        });
        this.audio.addEventListener('play', () => {
            this.renderPlayButton(true);
            this.syncCoverPlayback(true);
            this.startGameplayLoop();
            if (Nutzerspeicher.getSetting('visualizerEnabled', false)) {
                this.ensureAudioGraph().then(() => this.drawVisualizer()).catch(error => console.warn('[Mediaplayer] Visualizer nicht verfügbar:', error));
            }
        });
        this.audio.addEventListener('pause', () => {
            this.renderPlayButton(false);
            this.syncCoverPlayback(false);
            this.stopGameplayLoop();
        });
        this.audio.addEventListener('error', () => this.setStatus('Diese Audiodatei kann der Browser nicht abspielen.'));
        this.backgroundVolumeFactor = document.hidden ? 1 : 0;
        document.addEventListener('visibilitychange', () => this.setBackgroundDuck(document.hidden));
        window.addEventListener('blur', () => this.setBackgroundDuck(true));
        window.addEventListener('focus', () => this.setBackgroundDuck(document.hidden));
    },

    async importFiles(files) {
        const input = document.querySelector('[data-player-upload]');
        if (input) input.value = '';
        if (!files.length) return;

        window.ReleaseNotifications?.notify(
            'Medien-Upload gestartet',
            `${files.length} ${files.length === 1 ? 'Datei wird' : 'Dateien werden'} in deine Mediathek importiert …`,
            'notification-default'
        );

        let added = 0;
        let failed = 0;
        try {
            const fileMap = new Map(files.map(file => [file.name.toLowerCase(), file]));
            const beatmaps = files.filter(file => file.name.toLowerCase().endsWith('.osu'));
            const archives = files.filter(file => file.name.toLowerCase().endsWith('.osz'));
            const beatmapAudioNames = new Set();
            const coverFiles = files.filter(file => file.type.startsWith('image/') || file.type.startsWith('video/') || /\.(png|jpe?g|webp|gif|apng|mp4|webm|mov)$/i.test(file.name));

            for (const mapFile of beatmaps) {
                try {
                    const metadata = this.parseBeatmap(await mapFile.text());
                    if (metadata.audioFilename) beatmapAudioNames.add(metadata.audioFilename.split('/').pop().toLowerCase());
                    const audioFile = fileMap.get(metadata.audioFilename.toLowerCase()) || files.find(file => file.name.toLowerCase().split('/').pop() === metadata.audioFilename.split('/').pop().toLowerCase());
                    if (audioFile) {
                        await this.addTrack(audioFile, { title: metadata.title || audioFile.name, artist: metadata.artist, beatmap: metadata, files });
                        added++;
                    } else {
                        failed++;
                        this.setStatus(`Beatmap-Audio nicht mit ausgewählt: ${metadata.audioFilename}`);
                    }
                } catch (error) {
                    failed++;
                    console.warn('[Mediaplayer] Beatmap konnte nicht gelesen werden:', error);
                }
            }

            for (const archive of archives) {
                try {
                    const entries = await this.extractZip(archive);
                    const mapEntry = entries.find(entry => entry.name.toLowerCase().endsWith('.osu'));
                    if (!mapEntry) {
                        failed++;
                        continue;
                    }
                    const metadata = this.parseBeatmap(await mapEntry.blob.text());
                    if (metadata.audioFilename) beatmapAudioNames.add(metadata.audioFilename.split('/').pop().toLowerCase());
                    const audioEntry = entries.find(entry => entry.name.toLowerCase().split('/').pop() === metadata.audioFilename.toLowerCase());
                    if (audioEntry) {
                        await this.addTrack(audioEntry.blob, { title: metadata.title || metadata.audioFilename, artist: metadata.artist, beatmap: metadata, files: entries.map(entry => entry.file) });
                        added++;
                    } else failed++;
                } catch (error) {
                    failed++;
                    console.error('[Mediaplayer] .osz konnte nicht entpackt werden:', error);
                    this.setStatus('Diese .osz-Datei konnte nicht entpackt werden.');
                }
            }

            for (const file of files.filter(file => file.type.startsWith('audio/') || /\.(mp3|ogg|wav|m4a|aac|flac|opus)$/i.test(file.name))) {
                if (beatmapAudioNames.has(file.name.toLowerCase())) continue;
                await this.addTrack(file, { title: file.name.replace(/\.[^.]+$/, ''), artist: 'Lokale Datei', files: coverFiles });
                added++;
            }
            const containsAudio = files.some(file => file.type.startsWith('audio/') || /\.(mp3|ogg|wav|m4a|aac|flac|opus)$/i.test(file.name));
            if (!containsAudio && !beatmaps.length && !archives.length) {
                for (const file of files.filter(file => file.type.startsWith('video/') || /\.(mp4|webm|mov|m4v|ogv)$/i.test(file.name))) {
                    await this.addTrack(file, { title: file.name.replace(/\.[^.]+$/, ''), artist: 'Lokales Video', type: 'video', files: [file] });
                    added++;
                }
            }
            this.renderPlaylist();
            this.setStatus(added ? `${added} Titel zur Bibliothek hinzugefügt.` : 'Keine unterstützten Audiodateien gefunden.');
            if (added && this.currentIndex < 0) this.select(0, true);

            if (added && failed) {
                window.ReleaseNotifications?.notify(
                    'Upload teilweise fertig',
                    `${added} ${added === 1 ? 'Medium wurde' : 'Medien wurden'} hinzugefügt; einige Dateien konnten nicht importiert werden.`,
                    'notification-error'
                );
            } else if (added) {
                window.ReleaseNotifications?.notify(
                    'Upload fertig! :D',
                    `${added} ${added === 1 ? 'Medium wurde' : 'Medien wurden'} in deine Mediathek übernommen.`,
                    'notification-done'
                );
            } else {
                window.ReleaseNotifications?.notify(
                    failed ? 'Upload fehlgeschlagen' : 'Keine Medien erkannt',
                    failed ? 'Die ausgewählten Dateien konnten nicht importiert werden.' : 'Wähle unterstützte Audio-, Video- oder osu!-Dateien aus.',
                    failed ? 'notification-error' : 'notification-cancel'
                );
            }
        } catch (error) {
            console.error('[Mediaplayer] Medienimport fehlgeschlagen:', error);
            this.setStatus('Medien konnten nicht vollständig importiert werden.');
            window.ReleaseNotifications?.notify(
                added ? 'Upload teilweise fertig' : 'Upload fehlgeschlagen',
                added
                    ? `${added} ${added === 1 ? 'Medium wurde' : 'Medien wurden'} übernommen; der Import wurde vorzeitig beendet.`
                    : 'Die ausgewählten Dateien konnten nicht in die Mediathek übernommen werden.',
                'notification-error'
            );
        }
    },

    parseBeatmap(text) {
        const section = text.match(/\[General\]([\s\S]*?)(?:\r?\n\[|$)/i)?.[1] || '';
        const metadata = text.match(/\[Metadata\]([\s\S]*?)(?:\r?\n\[|$)/i)?.[1] || '';
        const events = text.match(/\[Events\]([\s\S]*?)(?:\r?\n\[|$)/i)?.[1] || '';
        const hitObjects = text.match(/\[HitObjects\]([\s\S]*?)(?:\r?\n\[|$)/i)?.[1] || '';
        const colours = text.match(/\[(?:Colours|Colors)\]([\s\S]*?)(?:\r?\n\[|$)/i)?.[1] || '';
        const difficulty = text.match(/\[Difficulty\]([\s\S]*?)(?:\r?\n\[|$)/i)?.[1] || '';
        const timing = text.match(/\[TimingPoints\]([\s\S]*?)(?:\r?\n\[|$)/i)?.[1] || '';
        const value = (source, key) => source.match(new RegExp(`^${key}:(.*)$`, 'mi'))?.[1]?.trim() || '';
        const videoLine = events.match(/^Video,\s*([^,]+),\s*"([^"]+)"/mi);
        const backgroundLine = events.match(/^0,\s*0,\s*"([^"]+)"/mi);
        const mode = Number(value(section, 'Mode')) || 0;
        const approachRateValue = Number(value(difficulty, 'ApproachRate'));
        const sliderMultiplier = Number(value(difficulty, 'SliderMultiplier')) || 1.4;
        const sliderTickRate = Number(value(difficulty, 'SliderTickRate')) || 1;
        const timingPoints = timing.split(/\r?\n/).map(line => {
            const fields = line.split(',');
            const time = Number(fields[0]);
            const beatLength = Number(fields[1]);
            if (!Number.isFinite(time) || !Number.isFinite(beatLength)) return null;
            return { time, beatLength, uninherited: fields[6] === '1' };
        }).filter(Boolean).sort((a, b) => a.time - b.time);

        const hitObjectData = [];
        const hitEvents = [];
        const comboColors = this._parseComboColors(colours);
        let comboColorIndex = -1;
        hitObjects.split(/\r?\n/).forEach(line => {
            const fields = line.split(',');
            const x = Number(fields[0]);
            const y = Number(fields[1]);
            const time = Number(fields[2]);
            const type = Number(fields[3]);
            if (![x, y, time, type].every(Number.isFinite)) return;

            const kind = type & 8 ? 'spinner' : type & 2 ? 'slider' : type & 1 ? 'circle' : null;
            if (!kind) return;
            if (type & 4) comboColorIndex = comboColorIndex < 0 ? 0 : comboColorIndex + 1 + ((type >> 4) & 7);
            if (comboColorIndex < 0) comboColorIndex = 0;

            const sampleField = fields[kind === 'slider' ? 10 : kind === 'spinner' ? 6 : 5] || '';
            const sampleParts = sampleField.split(':');
            const object = {
                x: kind === 'spinner' ? 256 : x,
                y: kind === 'spinner' ? 192 : y,
                time,
                endTime: kind === 'spinner' ? Number(fields[5]) || time : time,
                kind,
                hitSound: Number(fields[4]) || 0,
                comboColorIndex,
                sampleSet: Number(sampleParts[0]) || 0,
                additionSet: Number(sampleParts[1]) || 0,
                sampleIndex: Number(sampleParts[2]) || 0,
                sampleVolume: Number(sampleParts[3]) || 0,
                customSample: sampleParts.slice(4).join(':') || ''
            };

            if (kind === 'slider') {
                const curve = fields[5] || '';
                const [curveType = 'B', ...rawPoints] = curve.split('|');
                const controlPoints = [{ x, y }, ...rawPoints.map(point => {
                    const [pointX, pointY] = point.split(':').map(Number);
                    return Number.isFinite(pointX) && Number.isFinite(pointY) ? { x: pointX, y: pointY } : null;
                }).filter(Boolean)];
                const timingAt = timingPoints.filter(point => point.time <= time);
                const baseTiming = [...timingAt].reverse().find(point => point.uninherited && point.beatLength > 0);
                const inheritedTiming = [...timingAt].reverse().find(point => !point.uninherited && point.beatLength < 0);
                const beatLength = baseTiming?.beatLength || 500;
                const velocity = inheritedTiming ? Math.min(10, 100 / -inheritedTiming.beatLength) : 1;
                const spanCount = Math.max(1, Number(fields[6]) || 1);
                const pixelLength = Math.max(0, Number(fields[7]) || 0);
                const spanDuration = pixelLength / (100 * sliderMultiplier * velocity) * beatLength;

                object.curveType = curveType;
                object.pathPoints = this._fitBeatmapPath(
                    this._sampleBeatmapPath(curveType, controlPoints),
                    pixelLength
                );
                object.pathLength = this._measureBeatmapPath(object.pathPoints);
                object.spanCount = spanCount;
                object.spanDuration = spanDuration;
                object.duration = spanDuration * spanCount;
                object.endTime = time + object.duration;
                object.hitSample = sampleField;

                const tickInterval = beatLength / sliderTickRate / velocity;
                if (tickInterval > 0 && spanDuration > 0) {
                    for (let span = 0; span < spanCount; span += 1) {
                        for (let tick = tickInterval; tick < spanDuration - 10; tick += tickInterval) {
                            hitEvents.push({ time: time + span * spanDuration + tick, object, kind: 'tick' });
                        }
                        if (span < spanCount - 1) {
                            hitEvents.push({ time: time + (span + 1) * spanDuration, object, kind: 'repeat' });
                        }
                    }
                }
            } else if (kind === 'spinner') {
                object.hitSample = sampleField;
            } else {
                object.hitSample = sampleField;
            }

            hitObjectData.push(object);
            hitEvents.push({ time, object, kind: 'head' });
        });

        hitEvents.sort((a, b) => a.time - b.time);
        return {
            mode,
            sampleSet: value(section, 'SampleSet').toLowerCase() || 'normal',
            comboColors,
            audioFilename: value(section, 'AudioFilename'),
            title: value(metadata, 'TitleUnicode') || value(metadata, 'Title'),
            artist: value(metadata, 'ArtistUnicode') || value(metadata, 'Artist'),
            videoFilename: videoLine?.[2] || '',
            videoOffset: Number(videoLine?.[1]) || 0,
            backgroundFilename: backgroundLine?.[1] || '',
            circleSize: Number(value(difficulty, 'CircleSize')) || 5,
            approachRate: Number.isFinite(approachRateValue) ? approachRateValue : 5,
            hitObjects: hitObjectData,
            hitEvents,
            hitTimes: hitEvents.map(event => event.time)
        };
    },

    _parseComboColors(sectionText) {
        return sectionText.split(/\r?\n/).map(line => {
            const match = line.match(/^Combo(\d+)\s*:\s*(.+)$/i);
            if (!match) return null;
            const color = this._parseRgbColor(match[2]);
            return color ? { index: Number(match[1]), color } : null;
        }).filter(Boolean).sort((a, b) => a.index - b.index).map(item => item.color);
    },

    _parseRgbColor(value) {
        const channels = String(value).match(/^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*$/);
        if (!channels) return '';
        const color = channels.slice(1).map(channel => Math.max(0, Math.min(255, Number(channel))));
        return color.every(Number.isFinite) ? `rgb(${color.join(', ')})` : '';
    },

    _parseSkinConfig(text) {
        const colours = text.match(/\[(?:Colours|Colors)\]([\s\S]*?)(?:\r?\n\[|$)/i)?.[1] || '';
        const readColor = key => {
            const value = colours.match(new RegExp(`^${key}\\s*:\\s*(.+)$`, 'mi'))?.[1];
            return value ? this._parseRgbColor(value) : '';
        };
        const overlayAboveNumber = text.match(/^HitCircleOverlayAboveNumber\s*:\s*(\d+)/mi)?.[1];
        return {
            comboColors: this._parseComboColors(colours),
            sliderBorderColor: readColor('SliderBorder'),
            sliderTrackColor: readColor('SliderTrackOverride'),
            hitCircleOverlayAboveNumber: overlayAboveNumber === '1'
        };
    },

    _sampleBeatmapPath(curveType, points) {
        if (points.length < 2 || curveType === 'L') return points;
        const sampled = [];
        const segments = curveType === 'C' ? points.length - 1 : 48;
        for (let step = 0; step <= segments; step += 1) {
            const t = step / segments;
            if (curveType === 'C' && points.length > 2) {
                const position = t * (points.length - 1);
                const index = Math.min(points.length - 2, Math.floor(position));
                const local = position - index;
                const p0 = points[Math.max(0, index - 1)];
                const p1 = points[index];
                const p2 = points[index + 1];
                const p3 = points[Math.min(points.length - 1, index + 2)];
                const local2 = local * local;
                const local3 = local2 * local;
                sampled.push({
                    x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * local + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * local2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * local3),
                    y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * local + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * local2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * local3)
                });
                continue;
            }

            let current = points.map(point => ({ ...point }));
            while (current.length > 1) {
                current = current.slice(1).map((point, index) => ({
                    x: current[index].x + (point.x - current[index].x) * t,
                    y: current[index].y + (point.y - current[index].y) * t
                }));
            }
            sampled.push(current[0]);
        }
        return sampled;
    },

    _measureBeatmapPath(points) {
        return points.slice(1).reduce((length, point, index) => {
            const previous = points[index];
            return length + Math.hypot(point.x - previous.x, point.y - previous.y);
        }, 0);
    },

    _fitBeatmapPath(points, targetLength) {
        if (points.length < 2 || targetLength <= 0) return points;
        const fitted = [points[0]];
        let length = 0;
        for (let index = 1; index < points.length; index += 1) {
            const start = points[index - 1];
            const end = points[index];
            const segmentLength = Math.hypot(end.x - start.x, end.y - start.y);
            if (length + segmentLength >= targetLength) {
                const fraction = segmentLength ? (targetLength - length) / segmentLength : 0;
                fitted.push({
                    x: start.x + (end.x - start.x) * fraction,
                    y: start.y + (end.y - start.y) * fraction
                });
                return fitted;
            }
            fitted.push(end);
            length += segmentLength;
        }
        if (length < targetLength) {
            const last = fitted[fitted.length - 1];
            const previous = fitted[fitted.length - 2] || last;
            const angle = Math.atan2(last.y - previous.y, last.x - previous.x);
            fitted.push({
                x: last.x + Math.cos(angle) * (targetLength - length),
                y: last.y + Math.sin(angle) * (targetLength - length)
            });
        }
        return fitted;
    },

    _pointOnBeatmapPath(points, distance, totalLength) {
        if (points.length < 2 || !totalLength) return points[0] || { x: 256, y: 192 };
        let remaining = Math.max(0, Math.min(totalLength, distance));
        for (let index = 1; index < points.length; index += 1) {
            const start = points[index - 1];
            const end = points[index];
            const segmentLength = Math.hypot(end.x - start.x, end.y - start.y);
            if (remaining <= segmentLength) {
                const amount = segmentLength ? remaining / segmentLength : 0;
                return { x: start.x + (end.x - start.x) * amount, y: start.y + (end.y - start.y) * amount };
            }
            remaining -= segmentLength;
        }
        return points[points.length - 1];
    },

    async extractZip(file) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const view = new DataView(bytes.buffer);
        let end = -1;
        for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65558); i--) {
            if (view.getUint32(i, true) === 0x06054b50) { end = i; break; }
        }
        if (end < 0) throw new Error('ZIP directory not found');
        const count = view.getUint16(end + 10, true);
        let cursor = view.getUint32(end + 16, true);
        const entries = [];
        for (let i = 0; i < count; i++) {
            if (view.getUint32(cursor, true) !== 0x02014b50) break;
            const method = view.getUint16(cursor + 10, true);
            const compressedSize = view.getUint32(cursor + 20, true);
            const nameLength = view.getUint16(cursor + 28, true);
            const extraLength = view.getUint16(cursor + 30, true);
            const commentLength = view.getUint16(cursor + 32, true);
            const localOffset = view.getUint32(cursor + 42, true);
            const name = new TextDecoder().decode(bytes.slice(cursor + 46, cursor + 46 + nameLength));
            const localNameLength = view.getUint16(localOffset + 26, true);
            const localExtraLength = view.getUint16(localOffset + 28, true);
            const dataStart = localOffset + 30 + localNameLength + localExtraLength;
            let data = bytes.slice(dataStart, dataStart + compressedSize);
            if (method === 8) {
                if (typeof DecompressionStream === 'undefined') throw new Error('Deflate decompression unavailable');
                const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
                data = new Uint8Array(await new Response(stream).arrayBuffer());
            } else if (method !== 0) {
                cursor += 46 + nameLength + extraLength + commentLength;
                continue;
            }
            const blob = new Blob([data]);
            entries.push({ name, blob, file: new File([blob], name.split('/').pop()) });
            cursor += 46 + nameLength + extraLength + commentLength;
        }
        return entries;
    },

    async addTrack(file, details = {}) {
        const assets = details.files ? details.files.map(asset => ({ name: asset.name, type: asset.type || '', blob: asset })) : [];
        if (!assets.some(asset => /\.(png|jpe?g|webp|gif|apng)$/i.test(asset.name))) {
            const embeddedCover = await this.extractEmbeddedCover(file);
            if (embeddedCover) assets.push(embeddedCover);
        }
        const track = {
            id: crypto.randomUUID(),
            title: details.title || file.name,
            artist: details.artist || 'Unbekannt',
            type: details.beatmap ? 'osu' : (details.type || 'audio'),
            beatmap: details.beatmap || null,
            blob: file,
            files: assets,
            addedAt: Date.now()
        };
        await this.storeTrack(track);
        this.tracks.push(track);
    },

    async extractEmbeddedCover(file) {
        if (!/\.mp3$/i.test(file.name)) return null;
        const header = new Uint8Array(await file.slice(0, 10).arrayBuffer());
        if (header.length < 10 || String.fromCharCode(...header.slice(0, 3)) !== 'ID3') return null;
        const version = header[3];
        const tagSize = (header[6] & 0x7f) * 0x200000 + (header[7] & 0x7f) * 0x4000 + (header[8] & 0x7f) * 0x80 + (header[9] & 0x7f);
        const bytes = new Uint8Array(await file.slice(10, 10 + tagSize).arrayBuffer());
        for (let offset = 0; offset + 10 < bytes.length;) {
            const id = String.fromCharCode(...bytes.slice(offset, offset + 4));
            if (!/^[A-Z0-9]{4}$/.test(id)) break;
            const sizeBytes = bytes.slice(offset + 4, offset + 8);
            const size = version >= 4
                ? ((sizeBytes[0] & 0x7f) << 21) | ((sizeBytes[1] & 0x7f) << 14) | ((sizeBytes[2] & 0x7f) << 7) | (sizeBytes[3] & 0x7f)
                : new DataView(sizeBytes.buffer, sizeBytes.byteOffset, 4).getUint32(0, false);
            const start = offset + 10;
            const frame = bytes.slice(start, start + size);
            if (id === 'APIC' && frame.length > 5) {
                const encoding = frame[0];
                let cursor = 1;
                while (cursor < frame.length && frame[cursor] !== 0) cursor++;
                const mime = new TextDecoder().decode(frame.slice(1, cursor)) || 'image/jpeg';
                cursor += 2; // MIME terminator plus picture type.
                if (encoding === 1 || encoding === 2) {
                    while (cursor + 1 < frame.length && (frame[cursor] !== 0 || frame[cursor + 1] !== 0)) cursor += 2;
                    cursor += 2;
                } else {
                    while (cursor < frame.length && frame[cursor] !== 0) cursor++;
                    cursor++;
                }
                const image = new Blob([frame.slice(cursor)], { type: mime });
                if (image.size) return { name: `embedded-cover.${mime.split('/')[1] || 'jpg'}`, type: mime, blob: image };
            }
            if (!size) break;
            offset = start + size;
        }
        return null;
    },

    renderPlaylist() {
        const list = document.querySelector('.Mediaplayer-box-scroll');
        if (!list) return;
        list.replaceChildren();
        if (!this.tracks.length) {
            const empty = document.createElement('p');
            empty.className = 'Mediaplayer-playlist-empty';
            empty.textContent = 'Noch keine Musik in der Playlist.';
            list.append(empty);
            return;
        }
        this.tracks.forEach((track, index) => {
            const row = document.createElement('div');
            row.className = 'Mediaplayer-btn';
            row.setAttribute('aria-current', String(index === this.currentIndex));
            const title = document.createElement('span');
            title.className = 'Mediaplayer-btn-title';
            title.textContent = track.title;
            const artist = document.createElement('span');
            artist.className = 'Mediaplayer-btn-artour';
            artist.textContent = `${track.artist || 'Unbekannt'}${track.type === 'osu' ? ' · osu!' : ''}`;
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'Mediaplayer-btn-nuke';
            remove.setAttribute('aria-label', `„${track.title}“ aus der Bibliothek löschen`);
            const removeIcon = document.createElement('img');
            removeIcon.src = '/Res/Bild/Icon/Mediaplayer/delete_24dp_FFFFFF_FILL1_wght400_GRAD0_opsz24.svg';
            removeIcon.alt = '';
            remove.appendChild(removeIcon);
            remove.addEventListener('click', event => {
                event.stopPropagation();
                this.removeTrack(track.id);
            });
            row.append(title, artist, remove);
            row.addEventListener('click', () => this.select(index, true));
            list.appendChild(row);
        });
    },

    select(index, play = false, requestedCrossfadeSeconds = null) {
        if (!this.tracks.length) return;
        const wasPlaying = !this.audio.paused;
        const configuredCrossfade = Math.max(1, Math.min(15, Number(Nutzerspeicher.getSetting('crossfadeSeconds', 8)) || 8));
        const crossfadeSeconds = Nutzerspeicher.getSetting('crossfadeEnabled', false)
            ? Math.max(0, Math.min(15, requestedCrossfadeSeconds ?? configuredCrossfade))
            : 0;
        this.stopFadeOutPlayers();
        const previousAudio = play && wasPlaying && crossfadeSeconds > 0
            ? this.fadePreviousAudio()
            : Promise.resolve(null);
        this.cancelCrossfade();
        this.autoCrossfadeTriggered = false;
        this.currentIndex = (index + this.tracks.length) % this.tracks.length;
        const track = this.tracks[this.currentIndex];
        let url = this.objectUrls.get(track.id);
        if (!url) {
            url = URL.createObjectURL(track.blob);
            this.objectUrls.set(track.id, url);
        }
        this.audio.src = url;
        this.updateVolume();
        document.querySelector('.Mediaplayer-title').textContent = track.title;
        this.updateTitleScroll();
        document.getElementById('Mediaplayer-arthur-id').textContent = track.artist || 'Unbekannt';
        Nutzerspeicher.setSetting('mediaplayerCurrentTrack', track.id);
        this.renderPlaylist();
        this.renderCover(track);
        this.gameplayHandled.clear();
        this.gameplayElements.clear();
        this.gameplaySliderPaths.clear();
        this.gameplaySliderBalls.clear();
        this.gameplayWindowIndex = 0;
        this.activeGameplaySliders.clear();
        document.querySelector('.Mediaplayer-gameplay')?.replaceChildren();
        this.renderBeatmapGameplay();
        this.syncBeatmapWallpaper();
        if (!this.audio.paused) this.startGameplayLoop();
        if (track.type === 'osu' && Nutzerspeicher.getSetting('osuOptions', {}).enabled) {
            this.beatmapHitTimes = track.beatmap?.hitTimes || [];
            this.nextHitIndex = this.beatmapHitTimes.findIndex(time => time >= this.audio.currentTime * 1000);
            if (this.nextHitIndex < 0) this.nextHitIndex = this.beatmapHitTimes.length;
        } else {
            this.beatmapHitTimes = [];
            this.nextHitIndex = 0;
        }
        if (play) {
            this.setAudioVolume(this.audio, crossfadeSeconds > 0 ? 0 : this.effectiveTargetVolume());
            this.audio.play().then(() => {
                if (crossfadeSeconds > 0) {
                    previousAudio.then(previous => {
                        if (!Nutzerspeicher.getSetting('crossfadeEnabled', false)) {
                            if (previous) this.stopFadeOutPlayer(previous);
                            this.setAudioVolume(this.audio, this.effectiveTargetVolume());
                        } else if (previous && !this.audio.paused) this.crossfadePlayers(previous, crossfadeSeconds);
                        else this.fadeAudio(this.audio, () => this.effectiveTargetVolume(), crossfadeSeconds);
                    });
                }
            }).catch(error => this.setStatus(`Wiedergabe konnte nicht gestartet werden: ${error.message}`));
        }
    },

    maybeAutoCrossfade() {
        if (this.autoCrossfadeTriggered || this.tracks.length < 2 || this.audio.paused) return;
        if (!Nutzerspeicher.getSetting('crossfadeEnabled', false)) return;
        const configured = Math.max(1, Math.min(15, Number(Nutzerspeicher.getSetting('crossfadeSeconds', 8)) || 8));
        const duration = this.audio.duration;
        if (!configured || !Number.isFinite(duration) || duration <= 0) return;
        const transition = Math.min(configured, duration * 0.4);
        if (duration - this.audio.currentTime > transition) return;
        this.autoCrossfadeTriggered = true;
        this.step(1, transition);
    },

    applyBeatmap(track) {
        const options = Nutzerspeicher.getSetting('osuOptions', {});
        const master = options.enabled === true;
        const auto = master && options.autoEffects === true;
        const files = track.files || [];
        const videoFilename = track.beatmap?.videoFilename;
        const cover = document.querySelector('.cover-overlay');
        document.querySelector('.Mediaplayer-beatmap-video')?.remove();
        if (!master) return;
        if ((options.video || auto) && videoFilename) {
            const file = files.find(item => item.name.toLowerCase().split('/').pop() === videoFilename.split('/').pop().toLowerCase());
            if (file && cover) {
                const video = document.createElement('video');
                video.className = 'Mediaplayer-beatmap-video';
                video.src = this.assetUrl(track, file);
                video.autoplay = true;
                video.loop = true;
                video.muted = true;
                video.playsInline = true;
                cover.prepend(video);
                this.syncCoverPlayback(!this.audio.paused);
            }
        }
        if ((options.storyboard || auto) && track.beatmap?.backgroundFilename) {
            const file = files.find(item => item.name.toLowerCase().split('/').pop() === track.beatmap.backgroundFilename.split('/').pop().toLowerCase());
            const image = document.querySelector('.cover-center');
            if (file && image) image.src = this.assetUrl(track, file);
        }
    },

    assetUrl(track, asset) {
        const key = `${track.id}:${asset.name}`;
        if (!this.objectUrls.has(key)) this.objectUrls.set(key, URL.createObjectURL(asset.blob || asset));
        return this.objectUrls.get(key);
    },

    renderCover(track) {
        this.clearBeatmapVisuals();
        const image = document.querySelector('.cover-center');
        const files = track.files || [];
        let cover = null;
        if (track.type === 'osu' && track.beatmap?.backgroundFilename) {
            cover = files.find(asset => asset.name.toLowerCase().split('/').pop() === track.beatmap.backgroundFilename.split('/').pop().toLowerCase());
        }
        if (!cover) cover = files.find(asset => /\.(png|jpe?g|webp|gif|apng)$/i.test(asset.name));
        const videoCover = track.type !== 'osu' && files.find(asset => /\.(mp4|webm|mov)$/i.test(asset.name));
        if (cover && image) image.src = this.assetUrl(track, cover);
        if (videoCover) {
            const video = document.createElement('video');
            video.className = 'Mediaplayer-beatmap-video';
            video.src = this.assetUrl(track, videoCover);
            video.autoplay = true;
            video.loop = true;
            video.muted = true;
            video.playsInline = true;
            document.querySelector('.cover-overlay')?.prepend(video);
            this.syncCoverPlayback(!this.audio.paused);
        } else if (track.type === 'osu') this.applyBeatmap(track);
    },

    syncCoverPlayback(playing) {
        const cover = document.querySelector('.Mediaplayer-cover');
        cover?.classList.toggle('is-playing', playing);
        const video = cover?.querySelector('.Mediaplayer-beatmap-video');
        if (!video) return;
        if (video.readyState >= 1) {
            const track = this.tracks[this.currentIndex];
            const offset = track?.type === 'osu' ? (track.beatmap?.videoOffset || 0) / 1000 : 0;
            const wantedTime = Math.max(0, this.audio.currentTime - offset);
            if (!playing || Math.abs(video.currentTime - wantedTime) > 0.25) {
                try { video.currentTime = wantedTime; } catch {}
            }
        }
        if (playing) video.play().catch(() => {});
        else video.pause();
    },

    clearBeatmapVisuals() {
        document.querySelector('.Mediaplayer-beatmap-video')?.remove();
        const image = document.querySelector('.cover-center');
        if (image) image.src = '/Res/Bild/Hintergrund/Default-Banner.png';
    },

    renderBeatmapGameplay() {
        const track = this.tracks[this.currentIndex];
        const options = Nutzerspeicher.getSetting('osuOptions', {});
        const container = document.querySelector('.Mediaplayer-cover');
        const enabled = Boolean(
            track?.type === 'osu'
            && track.beatmap?.mode === 0
            && options.enabled
            && options.gameplay_standard
            && container
        );

        if (!enabled) {
            this.stopGameplayLoop();
            document.querySelector('.Mediaplayer-gameplay')?.remove();
            this.gameplayElements.clear();
            this.gameplaySliderPaths.clear();
            this.gameplaySliderBalls.clear();
            this.gameplayWindowIndex = 0;
            this.activeGameplaySliders.clear();
            return;
        }

        let overlay = container.querySelector('.Mediaplayer-gameplay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.className = 'Mediaplayer-gameplay';
            overlay.setAttribute('aria-label', 'osu! Standard-Beatmap');
            container.append(overlay);
        }

        let sliderLayer = overlay.querySelector('.Mediaplayer-slider-layer');
        if (!sliderLayer) {
            sliderLayer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            sliderLayer.classList.add('Mediaplayer-slider-layer');
            sliderLayer.setAttribute('viewBox', '0 0 512 384');
            sliderLayer.setAttribute('preserveAspectRatio', 'none');
            sliderLayer.setAttribute('aria-hidden', 'true');
            overlay.prepend(sliderLayer);
        }
        this._ensureGameplayCursor(overlay);

        const objects = track.beatmap.hitObjects || [];
        const now = this.audio.currentTime * 1000;
        const approachTime = this._beatmapApproachTime(track.beatmap);
        const autoplay = Boolean(options.gameplay_autoplay_standard);
        const circleDiameter = Math.max(40, 108.8 - 8.96 * (track.beatmap.circleSize || 5));
        const visibleIndices = new Set();

        // Fenster ueber die zeitsortierten Objekte statt forEach ueber alle.
        let start = Math.min(this.gameplayWindowIndex || 0, objects.length);
        while (start < objects.length && objects[start].endTime + 600 < now) start += 1;
        this.gameplayWindowIndex = start;

        for (let index = start; index < objects.length; index += 1) {
            const object = objects[index];
            const untilHit = object.time - now;
            if (untilHit > approachTime) break;
            if (this.gameplayHandled.has(index)) continue;
            const isSlider = object.kind === 'slider';
            const expiresAt = isSlider ? object.endTime + 180 : object.time + 220;
            if (now > expiresAt) {
                this.gameplayHandled.add(index);
                this.activeGameplaySliders.delete(index);
                this.gameplayElements.get(index)?.remove();
                this.gameplayElements.delete(index);
                this.gameplaySliderPaths.get(index)?.remove();
                this.gameplaySliderPaths.delete(index);
                this._removeSliderBall(overlay, index);
                continue;
            }

            visibleIndices.add(index);
            if (isSlider) this._renderSliderPath(sliderLayer, object, index, circleDiameter);
            let circle = this.gameplayElements.get(index);
            if (!circle) {
                circle = this._createBeatmapCircle(object, index, circleDiameter, autoplay);
                this.gameplayElements.set(index, circle);
                overlay.append(circle);
            }

            const approach = circle.querySelector('.Mediaplayer-approach-circle');
            const sliderActive = isSlider && (this.activeGameplaySliders.has(index) || autoplay && untilHit <= 12);
            if (sliderActive && !this.activeGameplaySliders.has(index)) {
                this.activeGameplaySliders.add(index);
                circle.classList.add('is-following');
            }

            if (isSlider && sliderActive) {
                this._updateSliderBall(overlay, object, index, now, circleDiameter);
                if (now > object.endTime + 40) {
                    this.gameplayHandled.add(index);
                    this.activeGameplaySliders.delete(index);
                    circle.classList.add('is-hit');
                    window.setTimeout(() => circle.remove(), 110);
                    this.gameplayElements.delete(index);
                    this.gameplaySliderPaths.get(index)?.remove();
                    this.gameplaySliderPaths.delete(index);
                    this._removeSliderBall(overlay, index);
                }
            } else if (approach) {
                const scale = 1 + Math.max(0, untilHit) / approachTime * 2.4;
                approach.style.transform = `scale(${scale})`;
            }

            if (!isSlider && autoplay && untilHit <= 12) {
                this.gameplayHandled.add(index);
                this._moveGameplayCursor(object.x, object.y);
                circle.classList.add('is-hit');
                window.setTimeout(() => circle.remove(), 110);
                this.gameplayElements.delete(index);
            }
        }

        this.gameplayElements.forEach((circle, index) => {
            if (!visibleIndices.has(index) && !this.gameplayHandled.has(index)) {
                circle.remove();
                this.gameplayElements.delete(index);
            }
        });
    },

    _ensureGameplayCursor(overlay) {
        let cursor = overlay.querySelector('.Mediaplayer-osu-cursor');
        if (!cursor) {
            cursor = document.createElement('span');
            cursor.className = 'Mediaplayer-osu-cursor';
            cursor.setAttribute('aria-hidden', 'true');
            const image = document.createElement('img');
            image.alt = '';
            cursor.append(image);
            overlay.append(cursor);
        }
        const image = cursor.querySelector('img');
        const skinCursor = this._skinAssetUrl('cursor');
        cursor.classList.toggle('is-skinned', Boolean(skinCursor));
        if (image) {
            image.hidden = !skinCursor;
            if (skinCursor) image.src = skinCursor;
        }

        // Listener immer am Cover hosten: Das Gameplay-Overlay selbst hat
        // pointer-events:none, der alte Code hingegen hoerte nur auf den Kreisen.
        // Der aktuelle Cursor wird pro Event frisch gesucht, damit das Binding
        // auch nach overlay.replaceChildren() weiter funktioniert.
        if (!overlay.dataset.cursorBound) {
            overlay.dataset.cursorBound = 'true';
            const host = overlay.closest('.Mediaplayer-cover') || overlay;
            host.addEventListener('pointermove', event => {
                const current = overlay.querySelector('.Mediaplayer-osu-cursor');
                if (!current) return;
                const bounds = overlay.getBoundingClientRect();
                if (!bounds.width || !bounds.height) return;
                const x = Math.max(0, Math.min(100, (event.clientX - bounds.left) / bounds.width * 100));
                const y = Math.max(0, Math.min(100, (event.clientY - bounds.top) / bounds.height * 100));
                current.style.left = `${x}%`;
                current.style.top = `${y}%`;
                current.classList.add('is-visible');
            });
            host.addEventListener('pointerleave', () => {
                overlay.querySelector('.Mediaplayer-osu-cursor')?.classList.remove('is-visible');
            });
        }
        this.gameplayCursor = cursor;
    },

    _moveGameplayCursor(x, y) {
        if (!this.gameplayCursor) return;
        this.gameplayCursor.style.left = `${x / 512 * 100}%`;
        this.gameplayCursor.style.top = `${y / 384 * 100}%`;
        this.gameplayCursor.classList.add('is-visible');
    },

    _renderSliderPath(layer, object, index, diameter) {
        if (this.gameplaySliderPaths.has(index)) return;
        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        group.classList.add('Mediaplayer-slider-path');
        const track = this.tracks[this.currentIndex];
        const comboColor = this._comboColor(track?.beatmap, object);
        if (comboColor) group.style.setProperty('--osu-combo-color', comboColor);
        const borderColor = this.activeSkin?.config?.sliderBorderColor;
        if (borderColor) group.style.setProperty('--osu-slider-border-color', borderColor);
        const trackColor = this.activeSkin?.config?.sliderTrackColor;
        if (trackColor) group.style.setProperty('--osu-slider-track-color', trackColor);
        const pathData = object.pathPoints.map((point, pointIndex) => `${pointIndex ? 'L' : 'M'}${point.x} ${point.y}`).join(' ');
        const outline = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        outline.setAttribute('d', pathData);
        outline.setAttribute('stroke-width', String(diameter * 1.16));
        outline.classList.add('Mediaplayer-slider-outline');
        const body = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        body.setAttribute('d', pathData);
        body.setAttribute('stroke-width', String(diameter * 0.88));
        body.classList.add('Mediaplayer-slider-body');
        group.append(outline, body);
        layer.append(group);
        this.gameplaySliderPaths.set(index, group);
    },

    _comboColor(beatmap, object) {
        const beatmapColors = beatmap?.comboColors || [];
        const skinColors = this.activeSkin?.config?.comboColors || [];
        const palette = beatmapColors.length ? beatmapColors : skinColors;
        return palette.length ? palette[(object?.comboColorIndex || 0) % palette.length] : '';
    },

    _updateSliderBall(overlay, object, index, now, diameter) {
        let ball = this.gameplaySliderBalls.get(index);
        if (!ball || !ball.isConnected) {
            if (ball) this.gameplaySliderBalls.delete(index);
            ball = document.createElement('span');
            ball.className = 'Mediaplayer-slider-ball';
            ball.dataset.sliderBall = String(index);
            const skin = this._skinAssetUrl('sliderfollowcircle');
            if (skin) {
                ball.style.backgroundImage = `url("${skin}")`;
                ball.classList.add('has-custom-skin');
            }
            overlay.append(ball);
            this.gameplaySliderBalls.set(index, ball);
        }

        const elapsed = Math.max(0, now - object.time);
        const spanDuration = Math.max(1, object.spanDuration);
        const span = Math.min(object.spanCount - 1, Math.floor(elapsed / spanDuration));
        let progress = Math.min(1, (elapsed - span * spanDuration) / spanDuration);
        if (span % 2) progress = 1 - progress;
        const point = this._pointOnBeatmapPath(object.pathPoints, object.pathLength * progress, object.pathLength);
        ball.style.left = `${point.x / 512 * 100}%`;
        ball.style.top = `${point.y / 384 * 100}%`;
        ball.style.width = `${diameter / 512 * 100}%`;
        const comboColor = this._comboColor(this.tracks[this.currentIndex]?.beatmap, object);
        if (comboColor) ball.style.setProperty('--osu-combo-color', comboColor);
        if (Nutzerspeicher.getSetting('osuOptions', {}).gameplay_autoplay_standard) {
            this._moveGameplayCursor(point.x, point.y);
        }
    },

    _removeSliderBall(overlay, index) {
        const ball = this.gameplaySliderBalls.get(index);
        if (ball) {
            ball.remove();
            this.gameplaySliderBalls.delete(index);
        } else {
            overlay.querySelector(`[data-slider-ball="${index}"]`)?.remove();
        }
    },

    _createBeatmapCircle(object, index, diameter, autoplay) {
        const circle = document.createElement('button');
        circle.type = 'button';
        circle.className = `Mediaplayer-hit-circle is-${object.kind}`;
        const comboColor = this._comboColor(this.tracks[this.currentIndex]?.beatmap, object);
        if (comboColor) circle.style.setProperty('--osu-combo-color', comboColor);
        circle.classList.toggle('has-custom-skin', Boolean(this.activeSkin));
        circle.dataset.hitObject = String(index);
        circle.setAttribute('aria-label', `Beatmap-Kreis ${index + 1}`);
        circle.style.left = `${object.x / 512 * 100}%`;
        circle.style.top = `${object.y / 384 * 100}%`;
        circle.style.width = `${diameter / 512 * 100}%`;
        circle.disabled = autoplay;

        const approach = document.createElement('span');
        approach.className = 'Mediaplayer-approach-circle';
        const skin = this._skinAssetUrl('approachcircle');
        if (skin) {
            approach.style.backgroundImage = `url("${skin}")`;
            approach.classList.add('is-skinned');
        }

        const hitCircle = document.createElement('span');
        hitCircle.className = 'Mediaplayer-hit-circle-face';
        const hitCircleSkin = this._skinAssetUrl('hitcircle');
        if (hitCircleSkin) {
            hitCircle.style.backgroundImage = `url("${hitCircleSkin}")`;
            hitCircle.classList.add('is-skinned');
        }

        const overlaySkin = this._skinAssetUrl('hitcircleoverlay');
        if (overlaySkin) {
            const overlay = document.createElement('span');
            overlay.className = 'Mediaplayer-hit-circle-overlay';
            overlay.style.backgroundImage = `url("${overlaySkin}")`;
            if (this.activeSkin?.config?.hitCircleOverlayAboveNumber) {
                overlay.style.zIndex = '2';
                hitCircle.append(overlay);
            } else {
                overlay.style.zIndex = '0';
                hitCircle.prepend(overlay);
            }
        }
        const number = document.createElement('span');
        number.className = 'Mediaplayer-hit-number';
        number.textContent = String(index + 1);
        hitCircle.append(number);
        circle.append(approach, hitCircle);

        circle.addEventListener('click', () => {
            const track = this.tracks[this.currentIndex];
            const currentObject = track?.beatmap?.hitObjects?.[index];
            if (!currentObject || this.audio.paused) return;
            const difference = Math.abs(this.audio.currentTime * 1000 - currentObject.time);
            if (difference > 180) return;
            if (currentObject.kind === 'slider') {
                this.activeGameplaySliders.add(index);
                circle.classList.add('is-following');
                return;
            }
            this.gameplayHandled.add(index);
            this.gameplayElements.delete(index);
            circle.classList.add('is-hit');
            window.setTimeout(() => circle.remove(), 100);
        });
        return circle;
    },

    _beatmapApproachTime(beatmap) {
        const section = beatmap.approachRate ?? 5;
        return Math.max(450, Math.min(1800, 1800 - 120 * section));
    },

    startGameplayLoop() {
        const track = this.tracks[this.currentIndex];
        const options = Nutzerspeicher.getSetting('osuOptions', {});
        if (this.audio.paused || track?.type !== 'osu' || !options.enabled) return;
        if (this.gameplayFrame) return;
        const renderFrame = () => {
            this.gameplayFrame = 0;
            if (this.audio.paused) return;
            const activeTrack = this.tracks[this.currentIndex];
            const activeOptions = Nutzerspeicher.getSetting('osuOptions', {});
            if (activeTrack?.type !== 'osu' || !activeOptions.enabled) return;
            this.playBeatmapHits();
            if (activeTrack.beatmap?.mode === 0 && activeOptions.gameplay_standard) this.renderBeatmapGameplay();
            this.gameplayFrame = window.requestAnimationFrame(renderFrame);
        };
        this.gameplayFrame = window.requestAnimationFrame(renderFrame);
    },

    stopGameplayLoop() {
        if (!this.gameplayFrame) return;
        window.cancelAnimationFrame(this.gameplayFrame);
        this.gameplayFrame = 0;
    },

    async syncBeatmapWallpaper() {
        const requestId = ++this.wallpaperSyncId;
        const track = this.tracks[this.currentIndex];
        const options = Nutzerspeicher.getSetting('osuOptions', {});
        const backgroundName = track?.type === 'osu' && track.beatmap?.backgroundFilename;
        const asset = backgroundName && track.files?.find(file => file.name.toLowerCase().split('/').pop() === backgroundName.split('/').pop().toLowerCase());
        const shouldOverride = Boolean(track?.type === 'osu' && options.enabled && options['wallpaper-override'] && asset);

        if (shouldOverride) {
            if (!this.wallpaperRestoreState) {
                try {
                    const state = await this._captureWallpaperState();
                    if (requestId !== this.wallpaperSyncId) return;
                    this.wallpaperRestoreState = state;
                } catch (error) {
                    console.warn('[Mediaplayer] Aktueller Hintergrund konnte nicht gesichert werden:', error);
                    return;
                }
            }
            if (requestId !== this.wallpaperSyncId) return;
            Nutzerspeicher.ladeHintergrund(this.assetUrl(track, asset), 'static');
            return;
        }

        if (this.wallpaperRestoreState) await this._restoreWallpaperState(requestId);
    },

    async _captureWallpaperState() {
        const saved = Nutzerspeicher.hintergrundLaden();
        const image = document.querySelector('.Desktop-wallpaper');
        const video = document.querySelector('.Desktop-video-wallpaper');
        const videoIsVisible = Boolean(video && video.style.display !== 'none');
        let url = saved.url;
        if (url?.startsWith('indexeddb:')) url = await Nutzerspeicher.resolveWallpaperUrl(url);
        if (!url) url = videoIsVisible ? video.currentSrc || video.querySelector('source')?.src : image?.currentSrc || image?.src;

        return {
            url,
            type: saved.url ? saved.type : videoIsVisible ? 'video' : 'static',
            videoTime: video?.currentTime || 0,
            videoWasPlaying: Boolean(video && !video.paused),
            imageObjectFit: image?.style.objectFit || 'cover'
        };
    },

    async _restoreWallpaperState(requestId) {
        const state = this.wallpaperRestoreState;
        if (!state || requestId !== this.wallpaperSyncId) return;
        if (!state.url) {
            this.wallpaperRestoreState = null;
            return;
        }

        const saved = Nutzerspeicher.hintergrundLaden();
        let url = saved.url || state.url;
        if (url.startsWith('indexeddb:')) url = await Nutzerspeicher.resolveWallpaperUrl(url);
        if (requestId !== this.wallpaperSyncId) return;
        this.wallpaperRestoreState = null;

        const type = saved.url ? saved.type : state.type;
        Nutzerspeicher.ladeHintergrund(url, type);
        const image = document.querySelector('.Desktop-wallpaper');
        if (image) image.style.objectFit = state.imageObjectFit;

        if (type === 'video') {
            const video = document.querySelector('.Desktop-video-wallpaper');
            if (video) {
                const restoreTime = () => {
                    try { video.currentTime = state.videoTime; } catch {}
                    if (!state.videoWasPlaying) video.pause();
                };
                if (video.readyState >= 1) restoreTime();
                else video.addEventListener('loadedmetadata', restoreTime, { once: true });
            }
        }
    },

    async removeTrack(id) {
        const index = this.tracks.findIndex(track => track.id === id);
        if (index < 0) return;
        const confirmed = window.Popup
            ? await window.Popup.confirm(`„${this.tracks[index].title}“ aus der Mediathek löschen?`, {
                title: 'Medium löschen',
                type: 'warning',
                confirmLabel: 'Löschen',
                danger: true
            })
            : window.confirm(`„${this.tracks[index].title}“ aus der Mediathek löschen?`);
        if (!confirmed) return;
        const wasCurrent = index === this.currentIndex;
        if (wasCurrent) {
            this.audio.pause();
            this.currentIndex = -1;
            await this.syncBeatmapWallpaper();
        }
        const db = await this.openDB();
        await new Promise((resolve, reject) => {
            const request = db.transaction(this.DB_STORE, 'readwrite').objectStore(this.DB_STORE).delete(id);
            request.onsuccess = resolve;
            request.onerror = () => reject(request.error);
        });
        for (const [key, url] of this.objectUrls) {
            if (key === id || key.startsWith(`${id}:`)) {
                URL.revokeObjectURL(url);
                this.objectUrls.delete(key);
            }
        }
        this.tracks.splice(index, 1);
        if (wasCurrent) {
            this.audio.removeAttribute('src');
            this.audio.load();
            Nutzerspeicher.setSetting('mediaplayerCurrentTrack', null);
            document.querySelector('.Mediaplayer-gameplay')?.remove();
            this.gameplayElements.clear();
            this.gameplaySliderPaths.clear();
            this.gameplaySliderBalls.clear();
            this.gameplayWindowIndex = 0;
            this.activeGameplaySliders.clear();
            this.gameplayHandled.clear();
            this.clearBeatmapVisuals();
            if (this.tracks.length) this.select(Math.min(index, this.tracks.length - 1), false);
            else {
                document.querySelector('.Mediaplayer-title').textContent = 'Keine Musik ausgewählt';
                document.getElementById('Mediaplayer-arthur-id').textContent = '—';
            }
        } else if (index < this.currentIndex) this.currentIndex--;
        this.renderPlaylist();
        this.setStatus('Titel aus der Mediathek gelöscht.');
    },

    async clearLibrary() {
        this.audio.pause();
        this.stopGameplayLoop();
        this.cancelCrossfade();
        this.stopFadeOutPlayers();

        const database = await this.openDB();
        await new Promise((resolve, reject) => {
            const transaction = database.transaction(this.DB_STORE, 'readwrite');
            transaction.objectStore(this.DB_STORE).clear();
            transaction.oncomplete = resolve;
            transaction.onerror = () => reject(transaction.error || new Error('Playlist konnte nicht geleert werden.'));
            transaction.onabort = () => reject(transaction.error || new Error('Leeren der Playlist wurde abgebrochen.'));
        });

        for (const objectUrl of this.objectUrls.values()) URL.revokeObjectURL(objectUrl);
        this.objectUrls.clear();
        this.tracks = [];
        this.currentIndex = -1;
        this.beatmapHitTimes = [];
        this.nextHitIndex = 0;
        this.gameplayHandled.clear();
        this.gameplayElements.clear();
        this.gameplaySliderPaths.clear();
        this.gameplaySliderBalls.clear();
        this.gameplayWindowIndex = 0;
        this.activeGameplaySliders.clear();
        this.audio.removeAttribute('src');
        this.audio.load();
        this.renderPlayButton(false);
        this.syncCoverPlayback(false);
        this.clearBeatmapVisuals();
        document.querySelector('.Mediaplayer-gameplay')?.remove();
        document.querySelector('.Mediaplayer-title').textContent = 'Keine Musik ausgewählt';
        document.getElementById('Mediaplayer-arthur-id').textContent = '—';
        Nutzerspeicher.setSetting('mediaplayerCurrentTrack', null);
        await this.syncBeatmapWallpaper();
        this.renderPlaylist();
    },

    targetVolume() {
        const master = Math.max(0, Math.min(100, Number(Nutzerspeicher.getSetting('musicVolume', 24))));
        const player = Math.max(0, Math.min(100, Number(Nutzerspeicher.getSetting('playerVolume', 12))));
        return master * player / 10000;
    },

    effectiveTargetVolume() {
        const player = Math.max(0, Math.min(100, Number(Nutzerspeicher.getSetting('playerVolume', 12))));
        const inactiveMaster = Math.max(0, Math.min(100, Number(Nutzerspeicher.getSetting('inactiveVolume', 42))));
        const activeVolume = this.targetVolume();
        const inactiveVolume = inactiveMaster * player / 10000;
        return activeVolume + (inactiveVolume - activeVolume) * this.backgroundVolumeFactor;
    },

    readAudioVolume(audio) {
        return audio === this.audio && this.gainNode ? this.gainNode.gain.value : audio.volume;
    },

    setAudioVolume(audio, value) {
        const volume = Math.max(0, Math.min(1, Number(value) || 0));
        if (audio === this.audio && this.gainNode) this.gainNode.gain.value = volume;
        else audio.volume = volume;
    },

    setBackgroundDuck(hidden) {
        const destination = hidden ? 1 : 0;
        if (hidden) {
            if (this.backgroundFadeFrame) cancelAnimationFrame(this.backgroundFadeFrame);
            this.backgroundFadeFrame = 0;
            this.backgroundFadeGeneration++;
            const previousTarget = this.effectiveTargetVolume();
            this.backgroundVolumeFactor = destination;
            const nextTarget = this.effectiveTargetVolume();
            const factor = previousTarget > 0 ? nextTarget / previousTarget : 1;
            if (this.crossfadeActive) {
                this.setAudioVolume(this.audio, this.readAudioVolume(this.audio) * factor);
                this.fadingPlayers.forEach(player => this.setAudioVolume(player, this.readAudioVolume(player) * factor));
            } else {
                this.setAudioVolume(this.audio, nextTarget);
                this.fadingPlayers.forEach(player => this.setAudioVolume(player, this.readAudioVolume(player) * factor));
            }
            if (this.crossfadeActive) {
                this.crossfadeOutgoingStart *= factor;
                this.crossfadeStartVolume = nextTarget;
            }
            return;
        }
        const start = this.backgroundVolumeFactor;
        const generation = ++this.backgroundFadeGeneration;
        const started = performance.now();
        let previousTarget = this.effectiveTargetVolume();
        if (this.backgroundFadeFrame) cancelAnimationFrame(this.backgroundFadeFrame);
        const render = now => {
            if (generation !== this.backgroundFadeGeneration) return;
            const progress = Math.min(1, (now - started) / 350);
            const smooth = progress * progress * (3 - 2 * progress);
            this.backgroundVolumeFactor = start + (destination - start) * smooth;
            const nextTarget = this.effectiveTargetVolume();
            if (!this.crossfadeActive) {
                if (!this.audio.volumeFadeActive) this.setAudioVolume(this.audio, nextTarget);
                const factor = previousTarget > 0 ? nextTarget / previousTarget : 1;
                this.fadingPlayers.forEach(player => this.setAudioVolume(player, this.readAudioVolume(player) * factor));
            }
            previousTarget = nextTarget;
            if (progress < 1) this.backgroundFadeFrame = requestAnimationFrame(render);
            else this.backgroundFadeFrame = 0;
        };
        this.backgroundFadeFrame = requestAnimationFrame(render);
    },

    fadeAudio(audio, target, seconds) {
        const resolveTarget = typeof target === 'function' ? target : () => target;
        const start = this.readAudioVolume(audio);
        const started = performance.now();
        const token = (audio.volumeFadeToken || 0) + 1;
        audio.volumeFadeToken = token;
        audio.volumeFadeActive = true;
        const tick = now => {
            if (audio.volumeFadeToken !== token) return;
            if (audio.paused) {
                audio.volumeFadeActive = false;
                return;
            }
            const progress = Math.min(1, (now - started) / (seconds * 1000));
            const smooth = progress * progress * (3 - 2 * progress);
            const destination = Math.max(0, Math.min(1, resolveTarget()));
            this.setAudioVolume(audio, start + (destination - start) * smooth);
            if (progress < 1) requestAnimationFrame(tick);
            else audio.volumeFadeActive = false;
        };
        if (seconds <= 0) {
            this.setAudioVolume(audio, resolveTarget());
            audio.volumeFadeActive = false;
            return;
        }
        requestAnimationFrame(tick);
    },

    fadePreviousAudio() {
        const previous = this.audio.cloneNode();
        const previousTime = this.audio.currentTime;
        previous.hidden = true;
        previous.volume = this.readAudioVolume(this.audio);
        document.body.appendChild(previous);
        this.fadingPlayers.add(previous);
        return new Promise(resolve => {
            let settled = false;
            const timeout = window.setTimeout(() => {
                this.stopFadeOutPlayer(previous);
                finish(null);
            }, 1500);
            const finish = player => {
                if (settled) return;
                settled = true;
                window.clearTimeout(timeout);
                if (!player) this.stopFadeOutPlayer(previous);
                resolve(player);
            };
            const start = () => {
                if (settled) return;
                try { previous.currentTime = previousTime; } catch {}
                previous.play().then(() => finish(previous)).catch(() => {
                    finish(null);
                });
            };
            previous.addEventListener('error', () => {
                finish(null);
            }, { once: true });
            if (previous.readyState >= 1) start();
            else previous.addEventListener('loadedmetadata', start, { once: true });
            previous.load();
        });
    },

    crossfadePlayers(previous, seconds) {
        this.cancelCrossfade();
        this.crossfadeActive = true;
        const generation = this.crossfadeGeneration;
        const started = performance.now();
        this.crossfadeOutgoingStart = this.readAudioVolume(previous);
        this.crossfadeStartVolume = Math.max(0.001, this.effectiveTargetVolume());
        const render = now => {
            if (generation !== this.crossfadeGeneration || this.audio.paused) {
                this.crossfadeActive = false;
                return;
            }
            if (previous.paused) {
                this.crossfadeFrame = 0;
                this.crossfadeActive = false;
                this.setAudioVolume(this.audio, this.effectiveTargetVolume());
                this.stopFadeOutPlayer(previous);
                return;
            }
            const progress = Math.min(1, (now - started) / (seconds * 1000));
            const angle = progress * Math.PI / 2;
            this.setAudioVolume(previous, this.crossfadeOutgoingStart * (this.effectiveTargetVolume() / this.crossfadeStartVolume) * Math.cos(angle));
            this.setAudioVolume(this.audio, this.effectiveTargetVolume() * Math.sin(angle));
            if (progress < 1) this.crossfadeFrame = requestAnimationFrame(render);
            else {
                this.crossfadeFrame = 0;
                this.crossfadeActive = false;
                this.setAudioVolume(this.audio, this.effectiveTargetVolume());
                this.stopFadeOutPlayer(previous);
            }
        };
        this.crossfadeFrame = requestAnimationFrame(render);
    },

    cancelCrossfade() {
        this.crossfadeGeneration++;
        if (this.crossfadeFrame) cancelAnimationFrame(this.crossfadeFrame);
        this.crossfadeFrame = 0;
        this.crossfadeActive = false;
    },

    stopFadeOutPlayer(player) {
        player.pause();
        player.removeAttribute('src');
        player.load();
        player.remove();
        this.fadingPlayers.delete(player);
    },

    stopFadeOutPlayers() {
        [...this.fadingPlayers].forEach(player => this.stopFadeOutPlayer(player));
    },

    playBeatmapHits() {
        const track = this.tracks[this.currentIndex];
        const events = track?.beatmap?.hitEvents || [];
        if (!events.length || !Nutzerspeicher.getSetting('osuOptions', {}).enabled) return;
        const now = this.audio.currentTime * 1000;
        while (this.nextHitIndex < events.length && events[this.nextHitIndex].time <= now + 35) {
            const event = events[this.nextHitIndex];
            if (event.time >= now - 100) {
                this._playBeatmapEvent(track, event);
                if (event.kind === 'head' && Nutzerspeicher.getSetting('osuOptions', {}).starFountains) this.spawnHitStar();
            }
            this.nextHitIndex++;
        }
    },

    _playBeatmapEvent(track, event) {
        const object = event.object;
        const volume = Math.max(0, Math.min(100, Number(Nutzerspeicher.getSetting('osuHitsoundVolume', 24)))) / 100;
        if (!volume) return;

        const sampleSets = ['normal', 'normal', 'soft', 'drum'];
        const beatmapSet = sampleSets[object.sampleSet] || sampleSets[
            ({ normal: 1, soft: 2, drum: 3 })[track.beatmap?.sampleSet] || 1
        ];
        const additionSet = sampleSets[object.additionSet] || beatmapSet;
        const hitSound = object.hitSound || 0;
        const soundTypes = event.kind === 'tick'
            ? ['slidertick']
            : event.kind === 'repeat'
                ? ['sliderslide', 'hitnormal']
                : ['hitnormal'];
        if (event.kind === 'head' && hitSound & 2) soundTypes.push('hitwhistle');
        if (event.kind === 'head' && hitSound & 4) soundTypes.push('hitfinish');
        if (event.kind === 'head' && hitSound & 8) soundTypes.push('hitclap');

        const files = track.files || [];
        const customName = object.customSample?.toLowerCase();
        const customFile = customName && files.find(file => file.name.toLowerCase().split('/').pop() === customName.split('/').pop());
        let played = false;
        if (customFile && event.kind === 'head') {
            played = this._playAudioSample(this.assetUrl(track, customFile), volume * this._sampleVolume(object));
        }

        const sets = event.kind === 'head' ? [beatmapSet, additionSet] : [beatmapSet];
        soundTypes.forEach((type, index) => {
            if (played && type === 'hitnormal') return;
            const set = sets[Math.min(index, sets.length - 1)];
            const sample = this._findSkinHitSound(set, type, object.sampleIndex);
            if (sample && this._playAudioSample(sample, volume * this._sampleVolume(object))) played = true;
        });
        if (!played && typeof Sound !== 'undefined') Sound.play('cursor-tap', 1, volume * this._sampleVolume(object));
    },

    _sampleVolume(object) {
        return object.sampleVolume > 0 ? Math.min(1, object.sampleVolume / 100) : 1;
    },

    _findSkinHitSound(set, type, sampleIndex = 0) {
        const sounds = this.activeSkin?.assets?.hitSounds || {};
        const prefix = `${set}-${type}`;
        const indexed = sampleIndex ? `${prefix}${sampleIndex}.` : '';
        const candidates = [indexed, `${prefix}.`, `${prefix}0.`].filter(Boolean);
        const key = Object.keys(sounds).find(name => candidates.some(candidate => name.startsWith(candidate)));
        if (!key) return '';
        const cacheKey = `${this.activeSkin.id}:sound:${key}`;
        if (!this.skinObjectUrls.has(cacheKey)) this.skinObjectUrls.set(cacheKey, URL.createObjectURL(sounds[key]));
        return this.skinObjectUrls.get(cacheKey);
    },

    _playAudioSample(url, volume) {
        if (!url) return false;
        try {
            const player = new Audio(url);
            player.volume = Math.max(0, Math.min(1, volume));
            player.play().catch(() => {});
            return true;
        } catch {
            return false;
        }
    },

    spawnHitStar() {
        const cover = document.querySelector('.Mediaplayer-cover');
        if (!cover) return;
        const star = document.createElement('span');
        star.className = 'Mediaplayer-hit-star';
        star.textContent = '✦';
        star.style.left = `${15 + Math.random() * 70}%`;
        cover.appendChild(star);
        star.addEventListener('animationend', () => star.remove(), { once: true });
    },

    step(direction, crossfadeSeconds = null) {
        if (!this.tracks.length) return;
        if (Nutzerspeicher.getSetting('mediaplayerShuffle', false) && direction > 0) {
            let index = this.currentIndex;
            if (this.tracks.length > 1) while (index === this.currentIndex) index = Math.floor(Math.random() * this.tracks.length);
            this.select(index, true, crossfadeSeconds);
            return;
        }
        this.select(this.currentIndex + direction, true, crossfadeSeconds);
    },

    togglePlayback() {
        if (this.audio.paused) {
            if (this.currentIndex < 0 && this.tracks.length) this.select(0, true);
            else {
                this.updateVolume();
                this.audio.play().catch(() => {});
            }
        } else {
            this.audio.pause();
            this.cancelCrossfade();
            this.stopFadeOutPlayers();
            this.updateVolume();
        }
    },

    renderPlayButton(playing) {
        const button = document.querySelector('[data-player-toggle]');
        const icon = document.querySelector('[data-player-toggle-icon]');
        if (!button || !icon) return;
        button.setAttribute('aria-label', playing ? 'Pause' : 'Abspielen');
        icon.src = playing ? '/Res/Bild/Icon/Mediaplayer/pause_24dp_FFFFFF_FILL1_wght400_GRAD0_opsz24.svg' : '/Res/Bild/Icon/Mediaplayer/play_arrow_24dp_FFFFFF_FILL1_wght400_GRAD0_opsz24.svg';
    },

    renderTime() {
        const format = seconds => Number.isFinite(seconds) ? `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}` : '0:00';
        const counter = document.getElementById('playing-counter');
        if (counter) counter.textContent = `${format(this.audio.currentTime)} | ${format(this.audio.duration)}`;
    },

    setStatus(message) {
        const title = document.querySelector('.Mediaplayer-title');
        if (title && !this.tracks.length) {
            title.textContent = message;
            this.updateTitleScroll();
        }
    },

    updateTitleScroll() {
        const title = document.querySelector('.Mediaplayer-title');
        if (!title) return;
        title.classList.remove('is-overflowing');
        title.style.removeProperty('--title-scroll-distance');
        requestAnimationFrame(() => {
            const clipWidth = title.parentElement?.clientWidth ?? title.clientWidth;
            const distance = title.scrollWidth - clipWidth;
            if (distance <= 4) return;
            title.style.setProperty('--title-scroll-distance', `${distance}px`);
            title.style.setProperty('--title-scroll-duration', `${Math.max(5, distance / 28)}s`);
            title.classList.add('is-overflowing');
        });
    },

    watchTitleSize() {
        const title = document.querySelector('.Mediaplayer-title');
        if (!title || typeof ResizeObserver === 'undefined') return;
        this.titleResizeObserver?.disconnect();
        this.titleResizeObserver = new ResizeObserver(() => this.updateTitleScroll());
        this.titleResizeObserver.observe(title);
        if (title.parentElement) this.titleResizeObserver.observe(title.parentElement);
    },

    async ensureAudioGraph() {
        if (!this.audioContext) {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            if (!AudioContextClass) throw new Error('Web Audio wird von diesem Browser nicht unterstützt.');
            this.audioContext = new AudioContextClass();
            const source = this.audioContext.createMediaElementSource(this.audio);
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 256;
            this.gainNode = this.audioContext.createGain();
            source.connect(this.analyser);
            this.analyser.connect(this.gainNode);
            this.gainNode.connect(this.audioContext.destination);
            this.audio.volume = 1;
            this.updateVolume();
        }
        if (this.audioContext.state === 'suspended') await this.audioContext.resume();
    },

    applyVisualizerSettings() {
        const enabled = Boolean(Nutzerspeicher.getSetting('visualizerEnabled', false));
        const placement = Nutzerspeicher.getSetting('visualizerPlacement', 'player');
        const player = document.querySelector('[data-visualizer-player]');
        const desktop = document.querySelector('[data-visualizer-desktop]');
        if (player) player.hidden = !enabled || placement !== 'player';
        if (desktop) desktop.hidden = !enabled || placement !== 'desktop';
        const button = document.querySelector('[data-visualizer-toggle]');
        if (button) {
            button.setAttribute('aria-pressed', String(enabled));
            const label = button.querySelector('span');
            if (label) label.textContent = enabled ? 'An' : 'Aus';
        }
        const select = document.querySelector('[data-visualizer-placement]');
        if (select) select.value = placement;
        if (enabled) {
            this.ensureAudioGraph().then(() => this.drawVisualizer()).catch(error => console.warn('[Mediaplayer] Visualizer wartet auf Wiedergabe:', error));
        } else if (this.visualizerFrame) {
            cancelAnimationFrame(this.visualizerFrame);
            this.visualizerFrame = 0;
            document.querySelectorAll('[data-visualizer-player] canvas, [data-visualizer-desktop] canvas').forEach(canvas => {
                canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
            });
        }
    },

    drawVisualizer() {
        if (!Nutzerspeicher.getSetting('visualizerEnabled', false) || !this.analyser) return;
        if (this.visualizerFrame) return;
        const render = () => {
            this.visualizerFrame = 0;
            if (!Nutzerspeicher.getSetting('visualizerEnabled', false)) return;
            const canvas = document.querySelector('[data-visualizer-player]:not([hidden]) canvas, [data-visualizer-desktop]:not([hidden]) canvas');
            if (!canvas) return;
            const context = canvas.getContext('2d');
            context.clearRect(0, 0, canvas.width, canvas.height);
            if (this.audio.paused) return;
            const values = new Uint8Array(this.analyser.frequencyBinCount);
            this.analyser.getByteFrequencyData(values);
            const barWidth = canvas.width / values.length;
            values.forEach((value, index) => {
                const height = value / 255 * canvas.height;
                context.fillStyle = `hsl(${260 + index / values.length * 80} 85% 78%)`;
                context.fillRect(index * barWidth, canvas.height - height, Math.max(1, barWidth - 2), height);
            });
            this.visualizerFrame = requestAnimationFrame(render);
        };
        this.visualizerFrame = requestAnimationFrame(render);
    },

    attachSettingsControls() {
        const optionButtons = document.querySelectorAll('[data-osu-setting]');
        const renderOptions = () => {
            const options = Nutzerspeicher.getSetting('osuOptions', {});
            optionButtons.forEach(button => {
                const key = button.dataset.osuSetting;
                const enabled = Boolean(options[key]);
                const master = key === 'enabled';
                button.disabled = (!master && !options.enabled)
                    || (key === 'gameplay_autoplay_standard' && !options.gameplay_standard);
                button.setAttribute('aria-pressed', String(enabled));
                const label = button.querySelector('span');
                if (label) label.textContent = enabled ? 'An' : 'Aus';
            });
            if (this.currentIndex >= 0 && this.tracks[this.currentIndex].type === 'osu') this.applyBeatmap(this.tracks[this.currentIndex]);
        };
        optionButtons.forEach(button => {
            if (button.dataset.bound) return;
            button.dataset.bound = 'true';
            button.addEventListener('click', () => {
                const options = Nutzerspeicher.getSetting('osuOptions', {});
                const key = button.dataset.osuSetting;
                options[key] = !options[key];
                if (key === 'enabled' && !options.enabled) {
                    options.autoEffects = false;
                    options.video = false;
                    options.storyboard = false;
                    options.starFountains = false;
                    options.gameplay_standard = false;
                    options.gameplay_autoplay_standard = false;
                    options['wallpaper-override'] = false;
                }
                Nutzerspeicher.setSetting('osuOptions', options);
                renderOptions();
                this.gameplayElements.clear();
                this.gameplaySliderPaths.clear();
                this.gameplaySliderBalls.clear();
                this.gameplayWindowIndex = 0;
                this.activeGameplaySliders.clear();
                document.querySelector('.Mediaplayer-gameplay')?.replaceChildren();
                this.renderBeatmapGameplay();
                this.syncBeatmapWallpaper();
                this.startGameplayLoop();
            });
        });
        renderOptions();
        this.attachOsuSkinControls();

        const crossfadeToggle = document.querySelector('[data-crossfade-toggle]');
        const crossfadeSlider = document.getElementById('crossfaded-id');
        const crossfadeOutput = document.getElementById('crossfaded-nummer');
        if (crossfadeToggle && !crossfadeToggle.dataset.bound) {
            crossfadeToggle.dataset.bound = 'true';
            const renderCrossfade = () => {
                const enabled = Boolean(Nutzerspeicher.getSetting('crossfadeEnabled', false));
                crossfadeToggle.setAttribute('aria-pressed', String(enabled));
                const status = crossfadeToggle.querySelector('span');
                if (status) status.textContent = enabled ? 'An' : 'Aus';
                if (crossfadeSlider) crossfadeSlider.disabled = !enabled;
            };
            crossfadeToggle.addEventListener('click', () => {
                const enabled = !Nutzerspeicher.getSetting('crossfadeEnabled', false);
                Nutzerspeicher.setSetting('crossfadeEnabled', enabled);
                if (!enabled) {
                    this.cancelCrossfade();
                    this.stopFadeOutPlayers();
                    this.updateVolume();
                }
                renderCrossfade();
            });
            renderCrossfade();
        }

        const visualizerToggle = document.querySelector('[data-visualizer-toggle]');
        const visualizerPlacement = document.querySelector('[data-visualizer-placement]');
        if (visualizerToggle && !visualizerToggle.dataset.bound) {
            visualizerToggle.dataset.bound = 'true';
            visualizerToggle.addEventListener('click', async () => {
                const enabled = !Nutzerspeicher.getSetting('visualizerEnabled', false);
                Nutzerspeicher.setSetting('visualizerEnabled', enabled);
                this.applyVisualizerSettings();
                if (enabled) {
                    try { await this.ensureAudioGraph(); this.drawVisualizer(); }
                    catch (error) { console.warn('[Mediaplayer] Visualizer konnte nicht gestartet werden:', error); }
                }
            });
        }
        if (visualizerPlacement && !visualizerPlacement.dataset.bound) {
            visualizerPlacement.dataset.bound = 'true';
            visualizerPlacement.addEventListener('change', () => {
                Nutzerspeicher.setSetting('visualizerPlacement', visualizerPlacement.value);
                this.applyVisualizerSettings();
                this.drawVisualizer();
            });
        }
        this.applyVisualizerSettings();

        const sliders = [
            ['Audio-slider-id', 'playerVolume', 'Audio-nummer', 12, () => this.updateVolume()],
            ['crossfaded-id', 'crossfadeSeconds', 'crossfaded-nummer', 8, value => {}],
            ['osu-betamap-hitsound-id', 'osuHitsoundVolume', 'osu-beatmap-hitsounds-nummer', 24, value => {}]
        ];
        sliders.forEach(([id, key, outputId, fallback, apply]) => {
            const slider = document.getElementById(id);
            const output = document.getElementById(outputId);
            if (!slider || slider.dataset.bound) return;
            slider.dataset.bound = 'true';
            const value = Math.max(Number(slider.min) || 0, Math.min(Number(slider.max) || 100, Number(Nutzerspeicher.getSetting(key, fallback))));
            slider.value = String(value);
            if (key === 'crossfadeSeconds') Nutzerspeicher.setSetting(key, value);
            if (output) output.textContent = key === 'crossfadeSeconds' ? `${value} Sekunden` : `${value}%`;
            apply(value);
            slider.addEventListener('input', () => {
                const next = Number(slider.value);
                if (output) output.textContent = key === 'crossfadeSeconds' ? `${next} Sekunden` : `${next}%`;
                apply(next);
                Nutzerspeicher.setSetting(key, next);
            });
        });
    },

    attachOsuSkinControls() {
        const input = document.querySelector('[data-osu-skin-upload]');
        const uploadButton = document.querySelector('[data-osu-skin-upload-button]');
        const defaultButton = document.querySelector('[data-osu-skin-default]');
        if (uploadButton && input && !uploadButton.dataset.bound) {
            uploadButton.dataset.bound = 'true';
            uploadButton.addEventListener('click', () => input.click());
        }
        if (defaultButton && !defaultButton.dataset.bound) {
            defaultButton.dataset.bound = 'true';
            defaultButton.addEventListener('click', () => this.selectOsuSkin(''));
        }
        if (input && !input.dataset.bound) {
            input.dataset.bound = 'true';
            input.addEventListener('change', async () => {
                const file = input.files?.[0];
                input.value = '';
                if (!file) return;
                try {
                    await this.importOsuSkin(file);
                    window.ReleaseNotifications?.notify('osu!-Skin installiert', 'Der Skin wird für Kreise, Slider, Cursor und verfügbare Hitsounds verwendet.', 'notification-done');
                } catch (error) {
                    console.error('[Mediaplayer] osu!-Skin konnte nicht importiert werden:', error);
                    window.ReleaseNotifications?.notify('Skin-Upload fehlgeschlagen', error.message || 'Die Datei ist kein lesbarer osu!-Skin.', 'notification-error');
                }
            });
        }

        if (!this.skinsLoaded && !this.skinLoadPromise) {
            this.skinLoadPromise = this.readOsuSkins()
                .then(skins => {
                    this.skins = skins;
                    this.activeSkin = skins.find(skin => skin.id === Nutzerspeicher.getSetting('osuSkinId', '')) || null;
                    this.skinsLoaded = true;
                    this.renderOsuSkins();
                    this.renderBeatmapGameplay();
                })
                .catch(error => console.warn('[Mediaplayer] osu!-Skins konnten nicht geladen werden:', error))
                .finally(() => { this.skinLoadPromise = null; });
        } else {
            this.renderOsuSkins();
        }
    },

    async importOsuSkin(file) {
        if (this.skinLoadPromise) await this.skinLoadPromise;
        const entries = await this.extractZip(file);
        const findImage = name => entries.find(entry => {
            const basename = entry.name.toLowerCase().split('/').pop();
            return basename === `${name}.png` || basename === `${name}@2x.png`;
        })?.blob || null;
        const hitcircle = findImage('hitcircle');
        if (!hitcircle) throw new Error('Im Skin fehlt hitcircle.png.');

        const config = entries.find(entry => entry.name.toLowerCase().endsWith('skin.ini'));
        const configText = config ? await config.blob.text() : '';
        const configuredName = configText.match(/^Name\s*:\s*(.+)$/mi)?.[1]?.trim();
        const skinConfig = this._parseSkinConfig(configText);
        const hitSounds = {};
        entries.forEach(entry => {
            const basename = entry.name.toLowerCase().split('/').pop();
            if (/^(normal|soft|drum)-(hitnormal|hitwhistle|hitfinish|hitclap|sliderslide|slidertick)\d*\.(wav|ogg)$/i.test(basename)) {
                hitSounds[basename] = entry.blob;
            }
        });
        const skin = {
            id: crypto.randomUUID(),
            name: configuredName || file.name.replace(/\.(osk|zip)$/i, ''),
            config: skinConfig,
            assets: {
                hitcircle,
                approachcircle: findImage('approachcircle'),
                hitcircleoverlay: findImage('hitcircleoverlay'),
                sliderfollowcircle: findImage('sliderfollowcircle'),
                cursor: findImage('cursor'),
                hitSounds
            },
            addedAt: Date.now()
        };

        await this.storeOsuSkin(skin);
        this.skins.push(skin);
        await this.selectOsuSkin(skin.id);
    },

    async selectOsuSkin(id) {
        this.activeSkin = this.skins.find(skin => skin.id === id) || null;
        Nutzerspeicher.setSetting('osuSkinId', this.activeSkin?.id || '');
        this.renderOsuSkins();
        this.gameplayElements.clear();
        this.gameplaySliderPaths.clear();
        this.gameplaySliderBalls.clear();
        this.gameplayWindowIndex = 0;
        this.activeGameplaySliders.clear();
        document.querySelector('.Mediaplayer-gameplay')?.replaceChildren();
        this.renderBeatmapGameplay();
    },

    async removeOsuSkin(id) {
        const skin = this.skins.find(item => item.id === id);
        if (!skin) return;
        const confirmed = window.Popup
            ? await window.Popup.confirm(`osu!-Skin „${skin.name}“ entfernen?`, {
                title: 'Skin entfernen',
                type: 'warning',
                confirmLabel: 'Entfernen',
                danger: true
            })
            : window.confirm(`osu!-Skin „${skin.name}“ entfernen?`);
        if (!confirmed) return;
        try {
            await this.deleteOsuSkin(id);
            this.skins = this.skins.filter(item => item.id !== id);
            for (const [key, url] of this.skinObjectUrls) {
                if (key.startsWith(`${id}:`)) {
                    URL.revokeObjectURL(url);
                    this.skinObjectUrls.delete(key);
                }
            }
            if (this.activeSkin?.id === id) await this.selectOsuSkin('');
            else this.renderOsuSkins();
        } catch (error) {
            console.error('[Mediaplayer] osu!-Skin konnte nicht entfernt werden:', error);
        }
    },

    _skinAssetUrl(name) {
        const blob = this.activeSkin?.assets?.[name];
        if (!blob) return '';
        const key = `${this.activeSkin.id}:${name}`;
        if (!this.skinObjectUrls.has(key)) this.skinObjectUrls.set(key, URL.createObjectURL(blob));
        return this.skinObjectUrls.get(key);
    },

    renderOsuSkins() {
        const list = document.querySelector('[data-osu-skin-list]');
        const preview = document.querySelector('[data-osu-skin-preview]');
        const empty = document.querySelector('[data-osu-skin-empty]');
        const name = document.querySelector('[data-osu-skin-name]');
        const defaultButton = document.querySelector('[data-osu-skin-default]');
        if (name) name.textContent = this.activeSkin?.name || 'Standard-Skin';
        if (defaultButton) defaultButton.setAttribute('aria-pressed', String(!this.activeSkin));
        const previewUrl = this._skinAssetUrl('hitcircle');
        if (preview) {
            preview.hidden = !previewUrl;
            if (previewUrl) preview.src = previewUrl;
        }
        if (empty) empty.hidden = Boolean(previewUrl);
        if (!list) return;

        list.replaceChildren();
        if (!this.skins.length) {
            const message = document.createElement('p');
            message.textContent = 'Noch keine Skins hochgeladen.';
            list.append(message);
            return;
        }

        this.skins.forEach(skin => {
            const row = document.createElement('div');
            row.className = 'osu-skin-row';
            const select = document.createElement('button');
            select.type = 'button';
            select.className = 'Placeholder-btn osu-skin-select';
            select.textContent = `${skin.name}${this.activeSkin?.id === skin.id ? ' · Aktiv' : ''}`;
            select.setAttribute('aria-pressed', String(this.activeSkin?.id === skin.id));
            select.addEventListener('click', () => this.selectOsuSkin(skin.id));

            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'osu-skin-remove';
            remove.textContent = 'Entfernen';
            remove.addEventListener('click', () => this.removeOsuSkin(skin.id));
            row.append(select, remove);
            list.append(row);
        });
    },

    updateVolume() {
        if (this.gainNode) this.audio.volume = 1;
        if (this.crossfadeActive) return;
        this.setAudioVolume(this.audio, this.effectiveTargetVolume());
    }
};

window.Mediaplayer = Mediaplayer;
Mediaplayer.init();
