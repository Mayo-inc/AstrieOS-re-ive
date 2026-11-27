/**
 * Nutzerkonto-Verwaltung für AstrieOS
 * Verwaltet das Nutzercenter-UI und die Interaktion mit dem Multi-Konto-System
 * Arbeitet mit den bestehenden toggle.js-Funktionen zusammen
 */
const Nutzerkonto = {
    // Referenzen auf DOM-Elemente
    userCenterElement: null,
    userCustomElement: null,
    kontoDashboard: null,
    cropDialog: null,
    maxProfileImageBytes: 20 * 1024 * 1024,

    /**
     * Initialisiert das Nutzerkonto-System
     */
    init() {
        // Warte auf das Nutzercenter-Element (wird von ui.js geladen)
        const waitForElement = setInterval(() => {
            this.userCenterElement = document.querySelector('.PLaceholder-nutzercenter');
            this.userCustomElement = document.querySelector('.Placeholder-usercustom');
            this.kontoDashboard = document.querySelector('#konto-dashboard') || 
                                  this.userCenterElement?.querySelector('.Placeholder-dashboard');

            if (this.userCenterElement && this.userCustomElement && this.kontoDashboard) {
                clearInterval(waitForElement);
                this.setupEventHandlers();
                this.aktualisiereKontoDashboard();
                this.ladeUndZeigeBenutzerdaten();
                console.log('[Nutzerkonto] Initialisiert');
            }
        }, 100);

        // Falls das Element bereits existiert
        if (this.userCenterElement && this.userCustomElement && this.kontoDashboard) {
            this.setupEventHandlers();
            this.aktualisiereKontoDashboard();
            this.ladeUndZeigeBenutzerdaten();
        }
    },

    /**
     * Erstellt die Konto-Buttons im Dashboard
     */
    aktualisiereKontoDashboard() {
        if (!this.kontoDashboard || typeof Nutzerspeicher === 'undefined') return;

        // Dashboard leeren
        this.kontoDashboard.innerHTML = '';

        const konten = Nutzerspeicher.getAlleKonten();
        const aktiveId = Nutzerspeicher.getAktiveKontoId();

        // Für jedes Konto einen Button erstellen
        konten.forEach(konto => {
            const button = document.createElement('div');
            button.className = 'Placeholder-user-btn';
            button.dataset.kontoId = konto.id;
            
            // Wenn aktiv, hervorheben
            if (konto.id === aktiveId) {
                button.classList.add('aktiv');
            }

            const avatar = document.createElement('img');
            avatar.className = 'Placeholder-pfp-icon';
            avatar.src = konto.profilbildUrl || '/Res/Bild/Logo/AddText_07-03-07.27.32.png';
            avatar.width = 64;
            avatar.height = 64;
            const label = document.createElement('p');
            const username = document.createElement('span');
            username.textContent = konto.username || 'Gast!';
            label.appendChild(username);
            button.append(avatar, label);

            // Event-Listener hinzufügen
            button.addEventListener('click', (e) => {
                e.stopPropagation();
                this.wechsleKonto(konto.id);
            });

            this.kontoDashboard.appendChild(button);
        });

        console.log('[Nutzerkonto] Konto-Dashboard aktualisiert:', konten.length, 'Konten');
    },

    /**
     * Zeigt Dialog zum Erstellen eines neuen Kontos
     */
    async zeigeNeuesKontoDialog() {
        const username = await Popup.prompt('Neuen Benutzernamen eingeben:', {
            title: 'Konto erstellen',
            inputLabel: 'Benutzername',
            value: 'Nutzer' + Math.floor(Math.random() * 1000),
            confirmLabel: 'Erstellen'
        });
        
        if (username && username.trim()) {
            this.erstelleNeuesKonto(username.trim());
        }
    },

    /**
     * Erstellt ein neues Konto
     * @param {string} username - Benutzername
     */
    async erstelleNeuesKonto(username) {
        if (typeof Nutzerspeicher === 'undefined') {
            console.error('[Nutzerkonto] Nutzerspeicher nicht verfügbar');
            return;
        }

        const neuesKonto = Nutzerspeicher.erstelleKonto(username);
        
        if (neuesKonto) {
            // Wechsle zum neuen Konto
            Nutzerspeicher.wechsleKonto(neuesKonto.id);
            
            // UI aktualisieren
            this.aktualisiereKontoDashboard();
            this.ladeUndZeigeBenutzerdaten();
            
            // Benutzercenter öffnen
            if (typeof openNutzer_custom === 'function') {
                openNutzer_custom();
            }
            
            console.log('[Nutzerkonto] Neues Konto erstellt:', username);
            Popup.toast(`Neues Konto „${username}“ erstellt.`, { title: 'Konto erstellt', type: 'success' });
        } else {
            await Popup.alert('Der Benutzername ist bereits vergeben oder ungültig.', { title: 'Konto nicht erstellt', type: 'error' });
        }
    },

    /**
     * Wechselt zu einem anderen Konto
     * @param {string} kontoId - ID des Kontos
     */
    wechsleKonto(kontoId) {
        if (typeof Nutzerspeicher === 'undefined') {
            console.error('[Nutzerkonto] Nutzerspeicher nicht verfügbar');
            return;
        }

        if (Nutzerspeicher.wechsleKonto(kontoId)) {
            this.aktualisiereKontoDashboard();
            this.ladeUndZeigeBenutzerdaten();
            console.log('[Nutzerkonto] Zu Konto gewechselt:', kontoId);
        }
    },

    /**
     * Registriert alle Event-Handler
     */
    setupEventHandlers() {
        if (!this.userCenterElement) return;

        // PFP Upload
        const pfpUpload = this.userCenterElement.querySelector('.Custom-pfp-upload');
        if (pfpUpload) {
            pfpUpload.onclick = (e) => {
                e.stopPropagation();
                this.uploadProfilbild();
            };
        }

        // PFP Bild klickbar
        const pfpImg = this.userCenterElement.querySelector('.Custom-pfp');
        if (pfpImg) {
            pfpImg.onclick = (e) => {
                e.stopPropagation();
                this.uploadProfilbild();
            };
            pfpImg.style.cursor = 'pointer';
        }

        // Banner Upload
        const bannerUpload = this.userCenterElement.querySelector('.nutzerbanner');
        if (bannerUpload) {
            bannerUpload.onclick = (e) => {
                e.stopPropagation();
                this.uploadBanner();
            };
        }

        // Banner Bild klickbar
        const bannerImg = this.userCenterElement.querySelector('.banner-bg');
        if (bannerImg) {
            bannerImg.onclick = (e) => {
                e.stopPropagation();
                this.uploadBanner();
            };
            bannerImg.style.cursor = 'pointer';
        }

        // Konto speichern
        const speichernBtn = this.userCenterElement.querySelector('.nutzerspeicher');
        if (speichernBtn) {
            speichernBtn.onclick = (e) => {
                e.stopPropagation();
                this.speichereBenutzerdaten();
            };
        }

        // Konto löschen
        const loeschenBtn = this.userCenterElement.querySelector('.nutzerwegwerfen');
        if (loeschenBtn) {
            loeschenBtn.onclick = (e) => {
                e.stopPropagation();
                this.loescheAktivesKonto();
            };
        }

        // Buttons im Flex-Button Bereich
        const buttons = this.userCenterElement.querySelectorAll('.Placeholder-flex-button .Placeholder-btn');
        if (buttons.length >= 3) {
            buttons[0].onclick = (e) => {
                e.stopPropagation();
                this.zeigeNeuesKontoDialog();
            }; // Neues Konto erstellen
            buttons[1].onclick = (e) => {
                e.stopPropagation();
                if (typeof openNutzer_custom === 'function') {
                    openNutzer_custom();
                }
            }; // Konto konfigurieren
            buttons[2].onclick = (e) => {
                e.stopPropagation();
                this.loescheAktivesKonto();
            }; // Konto löschen
        }

        // Close Button
        const closeBtn = this.userCenterElement.querySelector('.Placeholder-close');
        if (closeBtn) {
            closeBtn.onclick = (e) => {
                e.stopPropagation();
                if (typeof placeholder_user === 'function') {
                    placeholder_user();
                }
            };
        }
    },

    /**
     * Öffnet das Nutzercenter
     */
    oeffneNutzercenter() {
        if (typeof placeholder_user === 'function') {
            placeholder_user();
        }
    },

    /**
     * Öffnet den Custom-Bereich für Konto-Konfiguration
     */
    openNutzer_custom() {
        if (typeof openNutzer_custom === 'function') {
            openNutzer_custom();
        }
        
        // Benutzerdaten neu laden
        this.ladeUndZeigeBenutzerdaten();
    },

    /**
     * Lädt eine Profilbild-Datei hoch
     */
    uploadProfilbild() {
        this.waehleBildDatei('profilbild');
    },

    /**
     * Lädt eine Banner-Datei hoch
     */
    uploadBanner() {
        this.waehleBildDatei('banner');
    },

    waehleBildDatei(typ) {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = async () => {
            const file = input.files?.[0];
            input.remove();
            if (file) await this.bearbeiteProfilbild(file, typ);
        };
        input.oncancel = () => input.remove();
        input.click();
    },

    async bearbeiteProfilbild(file, typ) {
        const alert = (message, title = 'Bild konnte nicht geladen werden') => window.Popup?.alert
            ? window.Popup.alert(message, { title, type: 'warning' })
            : window.alert(message);

        if (file.size > this.maxProfileImageBytes) {
            await alert('Die Bilddatei darf höchstens 20 MB groß sein.');
            return false;
        }
        if (file.type && !file.type.startsWith('image/')) {
            await alert('Bitte wähle eine Bilddatei aus.');
            return false;
        }
        if (!window.Nutzerspeicher?.getAktiveKontoId?.()) {
            await alert('Es ist kein aktives Nutzerkonto verfügbar.');
            return false;
        }

        if (this.cropDialog) this.cropDialog.close(false);
        const imageUrl = URL.createObjectURL(file);
        const image = new Image();
        try {
            await new Promise((resolve, reject) => {
                image.onload = resolve;
                image.onerror = () => reject(new Error('Dieses Bildformat kann nicht geöffnet werden.'));
                image.src = imageUrl;
            });
        } catch (error) {
            URL.revokeObjectURL(imageUrl);
            await alert(error.message);
            return false;
        }
        if (!image.naturalWidth || !image.naturalHeight) {
            URL.revokeObjectURL(imageUrl);
            await alert('Die Bilddatei enthält keine lesbaren Bilddaten.');
            return false;
        }

        const isBanner = typ === 'banner';
        const width = isBanner ? 1600 : 512;
        const height = isBanner ? 560 : 512;
        const accountId = window.Nutzerspeicher.getAktiveKontoId();
        const title = isBanner ? 'Banner zuschneiden' : 'Profilbild zuschneiden';
        const backdrop = document.createElement('div');
        backdrop.className = 'Nutzerbild-crop-backdrop';
        const dialog = document.createElement('section');
        dialog.className = 'Nutzerbild-crop-dialog';
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        dialog.setAttribute('aria-labelledby', 'Nutzerbild-crop-title');
        dialog.tabIndex = -1;

        const header = document.createElement('header');
        header.className = 'Nutzerbild-crop-header';
        const heading = document.createElement('h2');
        heading.id = 'Nutzerbild-crop-title';
        heading.textContent = title;
        header.append(heading);

        const stage = document.createElement('div');
        stage.className = 'Nutzerbild-crop-stage';
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.tabIndex = 0;
        canvas.setAttribute('role', 'img');
        canvas.setAttribute('aria-label', 'Verschiebe das Bild zum Zuschneiden.');
        stage.append(canvas);

        const hint = document.createElement('p');
        hint.className = 'Nutzerbild-crop-hint';
        hint.id = 'Nutzerbild-crop-hint';
        hint.textContent = 'Ziehe das Bild zum Verschieben und nutze den Regler zum Vergrößern.';
        dialog.setAttribute('aria-describedby', hint.id);

        const zoomLabel = document.createElement('label');
        zoomLabel.className = 'Nutzerbild-crop-zoom';
        const zoomText = document.createElement('span');
        zoomText.textContent = 'Zoom';
        const zoom = document.createElement('input');
        zoom.type = 'range';
        zoom.min = '1';
        zoom.max = '3';
        zoom.step = '0.01';
        zoom.value = '1';
        zoom.setAttribute('aria-label', 'Bild vergrößern');
        zoomLabel.append(zoomText, zoom);

        const status = document.createElement('p');
        status.className = 'Nutzerbild-crop-status';
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'polite');

        const actions = document.createElement('footer');
        actions.className = 'Nutzerbild-crop-actions';
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'Nutzerbild-crop-cancel';
        cancel.textContent = 'Abbrechen';
        const finish = document.createElement('button');
        finish.type = 'button';
        finish.className = 'Nutzerbild-crop-finish';
        finish.textContent = 'Fertig';
        actions.append(cancel, finish);
        dialog.append(header, stage, hint, zoomLabel, status, actions);
        backdrop.append(dialog);

        const context = canvas.getContext('2d');
        if (!context) {
            URL.revokeObjectURL(imageUrl);
            await alert('Der Bildzuschnitt wird von diesem Browser nicht unterstützt.');
            return false;
        }

        const baseScale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
        let scale = baseScale;
        let offsetX = (width - image.naturalWidth * scale) / 2;
        let offsetY = (height - image.naturalHeight * scale) / 2;
        let drag = null;
        let saving = false;
        const previousFocus = document.activeElement;
        const previousBodyOverflow = document.body.style.overflow;

        const draw = () => {
            const drawWidth = image.naturalWidth * scale;
            const drawHeight = image.naturalHeight * scale;
            offsetX = Math.max(width - drawWidth, Math.min(0, offsetX));
            offsetY = Math.max(height - drawHeight, Math.min(0, offsetY));
            context.clearRect(0, 0, width, height);
            if (isBanner) {
                context.fillStyle = '#19171f';
                context.fillRect(0, 0, width, height);
            }
            context.drawImage(image, offsetX, offsetY, drawWidth, drawHeight);
        };

        const close = result => {
            if (this.cropDialog?.close !== close || (saving && result !== true)) return;
            window.removeEventListener('keydown', onKeydown, true);
            URL.revokeObjectURL(imageUrl);
            document.body.style.overflow = previousBodyOverflow;
            backdrop.remove();
            this.cropDialog = null;
            if (previousFocus?.isConnected) previousFocus.focus();
            resolveCrop(result);
        };

        let resolveCrop;
        const cropPromise = new Promise(resolve => { resolveCrop = resolve; });
        const focusable = () => [...dialog.querySelectorAll('button:not(:disabled), input:not(:disabled), canvas[tabindex]')];
        const onKeydown = event => {
            if (event.key === 'Escape' && !saving) {
                event.preventDefault();
                close(false);
                return;
            }
            if (event.key !== 'Tab') return;
            const items = focusable();
            if (!items.length) return;
            if (event.shiftKey && document.activeElement === items[0]) {
                event.preventDefault();
                items.at(-1).focus();
            } else if (!event.shiftKey && document.activeElement === items.at(-1)) {
                event.preventDefault();
                items[0].focus();
            }
        };

        backdrop.addEventListener('pointerdown', event => {
            if (event.target === backdrop && !saving) close(false);
        });
        cancel.addEventListener('click', () => { if (!saving) close(false); });
        zoom.addEventListener('input', () => {
            const oldScale = scale;
            const centerX = (width / 2 - offsetX) / oldScale;
            const centerY = (height / 2 - offsetY) / oldScale;
            scale = baseScale * Number(zoom.value);
            offsetX = width / 2 - centerX * scale;
            offsetY = height / 2 - centerY * scale;
            draw();
        });
        canvas.addEventListener('pointerdown', event => {
            if (event.button !== 0 || saving) return;
            drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
            canvas.setPointerCapture(event.pointerId);
            canvas.classList.add('is-dragging');
            event.preventDefault();
        });
        canvas.addEventListener('pointermove', event => {
            if (!drag || drag.id !== event.pointerId) return;
            const rect = canvas.getBoundingClientRect();
            offsetX += (event.clientX - drag.x) * width / rect.width;
            offsetY += (event.clientY - drag.y) * height / rect.height;
            drag.x = event.clientX;
            drag.y = event.clientY;
            draw();
        });
        const endDrag = () => { drag = null; canvas.classList.remove('is-dragging'); };
        canvas.addEventListener('pointerup', endDrag);
        canvas.addEventListener('pointercancel', endDrag);

        finish.addEventListener('click', async () => {
            if (saving) return;
            saving = true;
            finish.disabled = true;
            cancel.disabled = true;
            finish.textContent = 'Speichere …';
            status.textContent = '';
            try {
                if (window.Nutzerspeicher.getAktiveKontoId() !== accountId) {
                    throw new Error('Das aktive Konto wurde gewechselt. Bitte starte den Upload erneut.');
                }
                const outputType = isBanner ? 'image/jpeg' : 'image/webp';
                const blob = await new Promise(resolve => canvas.toBlob(resolve, outputType, 0.86));
                if (!blob) throw new Error('Das Bild konnte nicht verarbeitet werden.');
                const extension = blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg';
                const outputFile = new File([blob], `astrieos-${typ}-${Date.now()}.${extension}`, { type: blob.type });
                const save = isBanner
                    ? window.Nutzerspeicher.speichereDateiAlsBanner(outputFile, accountId)
                    : window.Nutzerspeicher.speichereDateiAlsProfilbild(outputFile, accountId);
                if (!await save) throw new Error('Das zugeschnittene Bild konnte nicht gespeichert werden.');
                this.aktualisiereKontoDashboard();
                this.ladeUndZeigeBenutzerdaten();
                close(true);
            } catch (error) {
                saving = false;
                finish.disabled = false;
                cancel.disabled = false;
                finish.textContent = 'Fertig';
                status.classList.add('is-error');
                status.textContent = error.message || 'Das Bild konnte nicht gespeichert werden.';
            }
        });

        this.cropDialog = { close };
        document.body.style.overflow = 'hidden';
        document.body.append(backdrop);
        window.addEventListener('keydown', onKeydown, true);
        draw();
        requestAnimationFrame(() => finish.focus());
        return cropPromise;
    },

    /**
     * Speichert die Benutzerdaten (Benutzername) für das aktive Konto
     */
    async speichereBenutzerdaten() {
        const usernameInput = this.userCenterElement.querySelector('.custom-username');
        const passwordInput = this.userCenterElement.querySelector('.custom-passwort');
        const removePassword = this.userCenterElement.querySelector('.custom-passwort-entfernen');
        const username = usernameInput ? usernameInput.value.trim() : 'Gast!';

        // Lade aktuelle Benutzerdaten
        if (typeof Nutzerspeicher !== 'undefined') {
            const aktivesKonto = Nutzerspeicher.getAktivesKonto();
            
            if (aktivesKonto && aktivesKonto.username !== username) {
                // Prüfe ob Benutzername bereits existiert
                const konten = Nutzerspeicher.getAlleKonten();
                const nameExists = konten.some(k => k.username === username && k.id !== aktivesKonto.id);
                
                if (nameExists) {
                    await Popup.alert('Dieser Benutzername ist bereits vergeben.', { title: 'Name schon vergeben', type: 'warning' });
                    return;
                }
            }
            
            Nutzerspeicher.aktualisiereKonto(Nutzerspeicher.getAktiveKontoId(), {
                username: username
            });

            const password = passwordInput?.value || '';
            if (removePassword?.checked || password) {
                try {
                    await Nutzerspeicher.setKontoPasswort(aktivesKonto.id, removePassword.checked ? '' : password);
                    if (passwordInput) passwordInput.value = '';
                    if (removePassword) removePassword.checked = false;
                } catch (error) {
                    await Popup.alert(error.message || 'Das Passwort konnte nicht gespeichert werden.', { title: 'Passwort nicht gespeichert', type: 'error' });
                    return;
                }
            }
            
            // Aktualisiere UI
            this.aktualisiereKontoDashboard();
            this.ladeUndZeigeBenutzerdaten();
            
            console.log('[Nutzerkonto] Benutzername gespeichert:', username);
        }
    },

    /**
     * Löscht das aktive Konto
     */
    async loescheAktivesKonto() {
        if (typeof Nutzerspeicher === 'undefined') {
            console.error('[Nutzerkonto] Nutzerspeicher nicht verfügbar');
            return;
        }

        const konten = Nutzerspeicher.getAlleKonten();
        const aktivesKonto = Nutzerspeicher.getAktivesKonto();

        if (!aktivesKonto) {
            await Popup.alert('Kein aktives Konto zum Löschen gefunden.', { title: 'Kein aktives Konto', type: 'warning' });
            return;
        }

        // Warnung wenn nur Gast-Konto existiert
        if (konten.length <= 1) {
            await Popup.alert('Das letzte Konto kann nicht gelöscht werden.', { title: 'Konto bleibt erhalten', type: 'warning' });
            return;
        }

        const bestätigt = await Popup.confirm(`Möchtest du das Konto „${aktivesKonto.username}“ wirklich löschen?\n\nDie Kontodaten gehen dabei verloren.`, {
            title: 'Konto löschen',
            type: 'warning',
            confirmLabel: 'Konto löschen',
            danger: true
        });
        
        if (bestätigt) {
            if (Nutzerspeicher.loescheKonto(aktivesKonto.id)) {
                // UI aktualisieren
                this.aktualisiereKontoDashboard();
                this.ladeUndZeigeBenutzerdaten();
                
                // Schließe Custom-Bereich
                if (this.userCustomElement) {
                    this.userCustomElement.style.display = 'none';
                }
                
                console.log('[Nutzerkonto] Aktives Konto gelöscht:', aktivesKonto.username);
                Popup.toast(`Konto „${aktivesKonto.username}“ wurde gelöscht.`, { title: 'Konto gelöscht', type: 'success' });
            }
        }
    },

    /**
     * Lädt Benutzerdaten und zeigt sie im UI an
     */
    ladeUndZeigeBenutzerdaten() {
        if (typeof Nutzerspeicher === 'undefined') {
            console.warn('[Nutzerkonto] Nutzerspeicher nicht verfügbar');
            return;
        }

        const aktivesKonto = Nutzerspeicher.getAktivesKonto();

        if (!aktivesKonto) {
            console.warn('[Nutzerkonto] Kein aktives Konto');
            return;
        }

        // Dashboard Benutzername (falls vorhanden)
        const dashboardUsername = this.userCenterElement.querySelector('#Placeholder-username');
        if (dashboardUsername) {
            dashboardUsername.textContent = aktivesKonto.username;
        }

        // Topbar Benutzername
        const topbarUsername = document.getElementById('username');
        if (topbarUsername) {
            topbarUsername.textContent = aktivesKonto.username;
        }

        // Custom Input
        const usernameInput = this.userCenterElement.querySelector('.custom-username');
        if (usernameInput) {
            usernameInput.value = aktivesKonto.username;
            usernameInput.placeholder = 'Benutzername eingeben...';
        }
        const passwordInput = this.userCenterElement.querySelector('.custom-passwort');
        if (passwordInput) passwordInput.value = '';
        const removePassword = this.userCenterElement.querySelector('.custom-passwort-entfernen');
        if (removePassword) removePassword.checked = false;

        // PFP - Custom-Bereich und Topbar
        const pfpImg = this.userCenterElement.querySelector('.Custom-pfp');
        const topbarPfp = document.getElementById('userpfp');
        
        if (pfpImg) pfpImg.src = aktivesKonto.profilbildUrl;
        if (topbarPfp) topbarPfp.src = aktivesKonto.profilbildUrl;

        // Banner
        const bannerImg = this.userCenterElement.querySelector('.banner-bg');
        if (bannerImg) {
            bannerImg.src = aktivesKonto.bannerUrl;
        }
    }
};

// ========== INITIALISIERUNG ==========

// Initialisiere wenn Nutzerspeicher bereit ist
function initNutzerkonto() {
    if (typeof Nutzerspeicher !== 'undefined') {
        Nutzerkonto.init();
    } else {
        // Warte auf Nutzerspeicher
        setTimeout(initNutzerkonto, 100);
    }
}

// Starte Initialisierung
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initNutzerkonto);
} else {
    initNutzerkonto();
}

// Mache Nutzerkonto global verfügbar
window.Nutzerkonto = Nutzerkonto;
