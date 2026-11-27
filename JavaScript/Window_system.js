/* AstrieOS desktop windows: move, resize, minimize, maximize and focus. */
const WindowManager = {
    windows: Object.create(null),
    template: null,
    zIndexCounter: 500000,
    minWidth: 280,
    minHeight: 180,
    edgePadding: 12,
    _interaction: null,
    _activeId: null,
    _listenersInstalled: false,
    init(templateContent) {
        this.template = templateContent;
        this._installGlobalListeners();
    },

    createWindow({ id, title = 'Fenster', icon = '', content, width = 1050, height = 680 } = {}) {
        if (!id) throw new Error('Für ein Fenster wird eine eindeutige ID benötigt.');
        if (!this.template) {
            console.warn('[WindowManager] Das Fenstertemplate ist noch nicht geladen.');
            return null;
        }
        if (this.windows[id]) {
            const existing = this.windows[id];
            existing.minimized ? this.restoreWindow(id) : this.focusWindow(id);
            return existing;
        }

        const fragment = this.template.cloneNode(true);
        const outline = fragment.querySelector('.Window-outline');
        const windowContent = fragment.querySelector('.Window-content');
        const header = fragment.querySelector('.Window-header');
        if (!outline || !windowContent || !header) throw new Error('Das Fenstertemplate ist ungültig.');

        const titleElement = fragment.querySelector('#Window-name');
        const iconElement = fragment.querySelector('.Window-icon');
        titleElement?.removeAttribute('id');
        if (titleElement) titleElement.textContent = title;
        if (iconElement) {
            if (icon) iconElement.src = icon;
            iconElement.alt = '';
        }

        outline.removeAttribute('id');
        windowContent.removeAttribute('id');
        outline.dataset.windowId = id;
        windowContent.dataset.windowId = id;
        outline.setAttribute('role', 'group');
        outline.setAttribute('aria-label', title);
        windowContent.setAttribute('aria-label', `${title} – Inhalt`);

        const minimizeButton = fragment.querySelector('.Window-hidden');
        const maximizeButton = fragment.querySelector('.Window-fullscreen');
        const closeButton = fragment.querySelector('.Window-schließen');
        document.body.append(fragment);

        const headerHeight = Math.ceil(outline.getBoundingClientRect().height) || 48;
        const pos = this._nextPosition();
        const size = this._fitSize(width, height, pos, headerHeight);
        const win = {
            id, title, outline, content: windowContent, header, headerHeight,
            state: 'normal', minimized: false, pos, size, previous: null
        };
        this.windows[id] = win;

        if (content) {
            const body = document.createElement('div');
            body.className = 'Window-body';
            body.append(content);
            windowContent.prepend(body);
        }
        const resizeHandle = document.createElement('div');
        resizeHandle.className = 'Window-resize-handle';
        resizeHandle.setAttribute('role', 'separator');
        resizeHandle.setAttribute('aria-orientation', 'both');
        resizeHandle.setAttribute('aria-label', `Größe von ${title} ändern`);
        windowContent.append(resizeHandle);

        this._setGeometry(win, pos, size);
        requestAnimationFrame(() => {
            if (!this.windows[id]) return;
            outline.classList.add('Open');
            windowContent.classList.add('Open');
        });
        this._wireWindow(win, { minimizeButton, maximizeButton, closeButton, resizeHandle });
        this.focusWindow(id);
        this._playSound('menu-open');
        window.dispatchEvent(new CustomEvent('astrie-window-opened', { detail: { id, title } }));
        return win;
    },

    closeWindow(id) {
        const win = this.windows[id];
        if (!win) return false;
        if (this._interaction?.id === id) this._stopInteraction();
        win.outline.classList.remove('Open');
        win.content.classList.remove('Open');
        delete this.windows[id];
        if (this._activeId === id) this._focusTopWindow();
        window.dispatchEvent(new CustomEvent('astrie-window-closed', { detail: { id } }));
        window.setTimeout(() => { win.outline.remove(); win.content.remove(); }, 160);
        this._playSound('menu-close');
        return true;
    },

    minimizeWindow(id) {
        const win = this.windows[id];
        if (!win || win.minimized) return false;
        if (this._interaction?.id === id) this._stopInteraction();
        win.minimized = true;
        win.outline.classList.add('minimized');
        win.content.classList.add('minimized');
        if (this._activeId === id) this._focusTopWindow();
        window.dispatchEvent(new CustomEvent('astrie-window-minimized', { detail: { id } }));
        this._playSound('menu-close');
        return true;
    },

    restoreWindow(id) {
        const win = this.windows[id];
        if (!win || !win.minimized) return false;
        win.minimized = false;
        win.outline.classList.remove('minimized');
        win.content.classList.remove('minimized');
        this.focusWindow(id);
        window.dispatchEvent(new CustomEvent('astrie-window-restored', { detail: { id } }));
        this._playSound('menu-open');
        return true;
    },

    maximizeWindow(id) {
        const win = this.windows[id];
        if (!win || win.minimized) return false;
        this._stopInteraction();
        if (win.state === 'maximized') {
            win.state = 'normal';
            win.outline.classList.remove('maximized');
            win.content.classList.remove('maximized');
            const previous = win.previous || { pos: this._nextPosition(), size: { w: 700, h: 480 } };
            this._setGeometry(win, previous.pos, this._fitSize(previous.size.w, previous.size.h, previous.pos, win.headerHeight));
            win.previous = null;
        } else {
            win.previous = { pos: { ...win.pos }, size: { ...win.size } };
            win.state = 'maximized';
            win.outline.classList.add('maximized');
            win.content.classList.add('maximized');
            this._setMaximizedGeometry(win);
        }
        this._updateControls(win);
        this.focusWindow(id);
        window.dispatchEvent(new CustomEvent('astrie-window-state-changed', { detail: { id, state: win.state } }));
        return true;
    },

    focusWindow(id) {
        const win = this.windows[id];
        if (!win || win.minimized) return false;
        this._activeId = id;
        const zIndex = ++this.zIndexCounter;
        win.outline.style.zIndex = String(zIndex);
        win.content.style.zIndex = String(zIndex);
        Object.values(this.windows).forEach(item => {
            const focused = item === win;
            item.outline.classList.toggle('is-focused', focused);
            item.content.classList.toggle('is-focused', focused);
            item.outline.setAttribute('aria-current', focused ? 'true' : 'false');
        });
        window.dispatchEvent(new CustomEvent('astrie-window-focused', { detail: { id } }));
        return true;
    },

    _focusTopWindow() {
        const candidates = Object.values(this.windows).filter(item => !item.minimized);
        candidates.sort((a, b) => Number(b.outline.style.zIndex) - Number(a.outline.style.zIndex));
        this._activeId = null;
        if (candidates[0]) this.focusWindow(candidates[0].id);
    },

    _wireWindow(win, { minimizeButton, maximizeButton, closeButton, resizeHandle }) {
        win.header.style.touchAction = 'none';
        resizeHandle.style.touchAction = 'none';
        win.outline.addEventListener('pointerdown', () => this.focusWindow(win.id));
        win.content.addEventListener('pointerdown', () => this.focusWindow(win.id));
        win.header.addEventListener('pointerdown', event => {
            if (event.button !== 0 || event.target.closest('.Window-controls, button, a, input, select')) return;
            if (win.state === 'maximized') this._restoreFromHeaderDrag(event, win);
            this._beginInteraction(event, win, 'move');
        });
        win.header.addEventListener('dblclick', event => {
            if (!event.target.closest('.Window-controls, button')) this.maximizeWindow(win.id);
        });
        resizeHandle.addEventListener('pointerdown', event => {
            if (event.button !== 0 || win.state === 'maximized') return;
            event.stopPropagation();
            this._beginInteraction(event, win, 'resize');
        });
        this._makeButton(minimizeButton, 'Fenster minimieren', () => this.minimizeWindow(win.id));
        this._makeButton(maximizeButton, 'Fenster maximieren', () => this.maximizeWindow(win.id));
        this._makeButton(closeButton, 'Fenster schließen', () => this.closeWindow(win.id));
        this._updateControls(win);
    },

    _makeButton(element, label, action) {
        if (!element) return;
        element.type = 'button';
        element.setAttribute('aria-label', label);
        element.title = label;
        element.addEventListener('click', event => { event.stopPropagation(); action(); });
    },

    _updateControls(win) {
        const maximize = win.outline.querySelector('.Window-fullscreen');
        if (!maximize) return;
        const label = win.state === 'maximized' ? 'Fenster wiederherstellen' : 'Fenster maximieren';
        maximize.setAttribute('aria-label', label);
        maximize.title = label;
        maximize.setAttribute('aria-pressed', String(win.state === 'maximized'));
        win.outline.dataset.windowState = win.state;
    },

    _restoreFromHeaderDrag(event, win) {
        const ratio = Math.max(0, Math.min(1, event.clientX / Math.max(window.innerWidth, 1)));
        this.maximizeWindow(win.id);
        const x = this._clamp(event.clientX - win.size.w * ratio, this.edgePadding - win.size.w + 80, window.innerWidth - 80);
        const y = this._clamp(event.clientY - win.headerHeight / 2, 0, window.innerHeight - win.headerHeight);
        this._setGeometry(win, { x, y }, win.size);
    },

    _beginInteraction(event, win, type) {
        this.focusWindow(win.id);
        this._interaction = {
            id: win.id, type, pointerId: event.pointerId,
            startX: event.clientX, startY: event.clientY,
            pos: { ...win.pos }, size: { ...win.size }
        };
        document.body.classList.add('Window-interacting');
        event.preventDefault();
    },

    _installGlobalListeners() {
        if (this._listenersInstalled) return;
        this._listenersInstalled = true;
        document.addEventListener('pointermove', event => this._updateInteraction(event));
        document.addEventListener('pointerup', event => this._finishInteraction(event));
        document.addEventListener('pointercancel', event => this._finishInteraction(event));
        window.addEventListener('resize', () => this._fitAllWindows());
        window.addEventListener('blur', () => this._stopInteraction());
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape' && this._interaction) this._stopInteraction();
            if (event.altKey && event.key === 'F4' && this._activeId) {
                event.preventDefault();
                this.closeWindow(this._activeId);
            }
        });
    },

    _updateInteraction(event) {
        const action = this._interaction;
        if (!action || action.pointerId !== event.pointerId) return;
        const win = this.windows[action.id];
        if (!win) return this._stopInteraction();
        const dx = event.clientX - action.startX;
        const dy = event.clientY - action.startY;
        const bounds = this._availableBounds();
        if (action.type === 'move') {
            this._setGeometry(win, {
                x: this._clamp(action.pos.x + dx, this.edgePadding - win.size.w + 96, bounds.width - 96),
                y: this._clamp(action.pos.y + dy, 0, bounds.height - win.headerHeight)
            }, win.size);
            return;
        }
        const minWidth = Math.min(this.minWidth, bounds.width);
        const minHeight = Math.min(this.minHeight, bounds.height - win.headerHeight);
        const maxWidth = Math.max(minWidth, bounds.width - win.pos.x);
        const maxHeight = Math.max(minHeight, bounds.height - win.pos.y - win.headerHeight);
        this._setGeometry(win, win.pos, {
            w: this._clamp(action.size.w + dx, minWidth, maxWidth),
            h: this._clamp(action.size.h + dy, minHeight, maxHeight)
        });
    },

    _finishInteraction(event) {
        if (this._interaction?.pointerId === event.pointerId) this._stopInteraction();
    },

    _stopInteraction() {
        this._interaction = null;
        document.body.classList.remove('Window-interacting');
    },

    _fitAllWindows() {
        Object.values(this.windows).forEach(win => {
            if (win.state === 'maximized') return this._setMaximizedGeometry(win);
            const bounds = this._availableBounds();
            const pos = {
                x: this._clamp(win.pos.x, this.edgePadding - win.size.w + 96, bounds.width - 96),
                y: this._clamp(win.pos.y, 0, Math.max(0, bounds.height - win.headerHeight))
            };
            this._setGeometry(win, pos, this._fitSize(win.size.w, win.size.h, pos, win.headerHeight));
        });
    },

    _setGeometry(win, pos, size) {
        win.pos = { ...pos };
        win.size = { ...size };
        this._setStyle(win.outline, {
            left: `${pos.x}px`, top: `${pos.y}px`, width: `${size.w}px`, height: `${win.headerHeight}px`
        });
        this._setStyle(win.content, {
            left: `${pos.x}px`, top: `${pos.y + win.headerHeight}px`, width: `${size.w}px`, height: `${size.h}px`
        });
    },

    _setMaximizedGeometry(win) {
        const bounds = this._availableBounds();
        this._setStyle(win.outline, { left: '0px', top: '0px', width: `${bounds.width}px`, height: `${win.headerHeight}px` }, true);
        this._setStyle(win.content, {
            left: '0px', top: `${win.headerHeight}px`, width: `${bounds.width}px`, height: `${Math.max(0, bounds.height - win.headerHeight)}px`
        }, true);
    },

    _setStyle(element, properties, important = false) {
        Object.entries(properties).forEach(([name, value]) => element.style.setProperty(name, value, important ? 'important' : ''));
    },

    _fitSize(width, height, pos, headerHeight) {
        const bounds = this._availableBounds();
        return {
            w: this._clamp(Number(width) || 700, Math.min(this.minWidth, bounds.width), Math.max(this.minWidth, bounds.width - Math.max(pos.x, 0))),
            h: this._clamp(Number(height) || 480, Math.min(this.minHeight, bounds.height - headerHeight), Math.max(this.minHeight, bounds.height - pos.y - headerHeight))
        };
    },

    _nextPosition() {
        const index = Object.keys(this.windows).length;
        const bounds = this._availableBounds();
        return {
            x: this._clamp(64 + (index * 30) % 210, this.edgePadding, Math.max(this.edgePadding, bounds.width - 160)),
            y: this._clamp(72 + (index * 28) % 150, 0, Math.max(0, bounds.height - 120))
        };
    },

    _availableBounds() { return { width: window.innerWidth, height: window.innerHeight }; },
    _clamp(value, min, max) { return Math.min(Math.max(value, min), Math.max(min, max)); },
    _playSound(name) {
        if (typeof Sound !== 'undefined' && typeof Sound.play === 'function') Sound.play(name);
    }
};

window.WindowManager = WindowManager;
