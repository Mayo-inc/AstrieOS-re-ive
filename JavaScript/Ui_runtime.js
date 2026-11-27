/** Small runtime for lazily loaded AstrieOS windows and panels. */
const AstrieRuntime = {
    apps: new Map(),
    instances: new Map(),
    opening: new Map(),
    templates: new Map(),
    styles: new Map(),
    scripts: new Map(),
    windowShell: null,

    register(app) {
        if (!app?.id || !app.templateUrl || !app.templateId) {
            throw new Error('Eine AstrieOS-App braucht eine ID und ein Template.');
        }
        this.apps.set(app.id, Object.freeze({ ...app }));
        return this;
    },

    async open(id, params = {}) {
        const app = this.apps.get(id);
        if (!app) throw new Error(`Die App „${id}“ ist nicht registriert.`);
        const existing = app.presentation === 'panel' ? null : window.WindowManager?.windows?.[app.windowId || id];
        if (existing) {
            existing.minimized ? window.WindowManager.restoreWindow(existing.id) : window.WindowManager.focusWindow(existing.id);
            return existing;
        }
        const panelInstance = app.presentation === 'panel' && this.instances.get(id);
        if (panelInstance) {
            const openClass = app.openClass || 'Open';
            if (params.toggle) panelInstance.root.classList.toggle(openClass);
            else panelInstance.root.classList.add(openClass);
            return panelInstance.root;
        }
        if (this.opening.has(id)) return this.opening.get(id);
        const opening = this._open(app, params);
        this.opening.set(id, opening);
        try {
            return await opening;
        } catch (error) {
            console.error(`[AstrieRuntime] App „${id}“ konnte nicht geöffnet werden:`, error);
            await window.Popup?.alert?.(`„${app.title || id}“ konnte nicht geöffnet werden. ${error.message || ''}`, {
                title: 'App konnte nicht geöffnet werden', type: 'error'
            });
            return null;
        } finally {
            if (this.opening.get(id) === opening) this.opening.delete(id);
        }
    },

    async _open(app, params) {
        const isPanel = app.presentation === 'panel';
        const [content] = await Promise.all([
            this.loadTemplate(app.templateUrl, app.templateId),
            isPanel ? Promise.resolve() : this.ensureWindowShell(),
            app.styleUrl ? this.loadStyle(app.styleUrl) : Promise.resolve(),
            this.loadScripts(app.scriptUrls || [])
        ]);
        const id = app.windowId || app.id;
        let win = null;
        let root;
        if (isPanel) {
            root = content.querySelector(app.rootSelector) || content.firstElementChild;
            if (!root) throw new Error(`Panel „${app.title || app.id}“ ist leer.`);
            document.body.append(content);
        } else {
            win = window.WindowManager.createWindow({
                id,
                title: app.title || app.id,
                icon: app.icon || '',
                content,
                width: app.width,
                height: app.height
            });
            if (!win) return null;
            root = win.content.querySelector('.Window-body') || win.content;
        }
        const controller = new AbortController();
        const instance = { app, win, root, params, controller, cleanup: null };
        this.instances.set(id, instance);
        try {
            const cleanup = await app.mount?.({
                root,
                window: win,
                params,
                signal: controller.signal,
                runtime: this
            });
            if (controller.signal.aborted) {
                if (typeof cleanup === 'function') cleanup();
                return null;
            }
            if (typeof cleanup === 'function') instance.cleanup = cleanup;
            if (isPanel) root.classList.add(app.openClass || 'Open');
            window.dispatchEvent(new CustomEvent('astrie-app-mounted', { detail: { id, appId: app.id } }));
            return isPanel ? root : win;
        } catch (error) {
            console.error(`[AstrieRuntime] App „${app.id}“ konnte nicht gestartet werden:`, error);
            const wasClosedDuringMount = controller.signal.aborted;
            if (isPanel) {
                root.remove();
                this._disposeInstance(id);
            } else {
                window.WindowManager.closeWindow(id);
            }
            if (!wasClosedDuringMount) {
                await window.Popup?.alert?.(`„${app.title || app.id}“ konnte nicht geöffnet werden. ${error.message || ''}`, {
                    title: 'App konnte nicht gestartet werden', type: 'error'
                });
            }
            return null;
        }
    },

    loadTemplate(url, templateId) {
        const key = `${url}#${templateId}`;
        if (!this.templates.has(key)) {
            const request = fetch(url)
                .then(response => {
                    if (!response.ok) throw new Error(`${url} konnte nicht geladen werden (${response.status}).`);
                    return response.text();
                })
                .then(markup => {
                    const documentTemplate = new DOMParser().parseFromString(markup, 'text/html');
                    const template = documentTemplate.getElementById(templateId);
                    if (!template?.content) throw new Error(`Template „${templateId}“ fehlt in ${url}.`);
                    return template.content;
                })
                .catch(error => { this.templates.delete(key); throw error; });
            this.templates.set(key, request);
        }
        return this.templates.get(key).then(template => template.cloneNode(true));
    },

    loadStyle(url) {
        if (this.styles.has(url)) return this.styles.get(url);
        const existing = [...document.querySelectorAll('link[rel="stylesheet"]')].find(link => link.href === new URL(url, document.baseURI).href);
        if (existing?.sheet) {
            this.styles.set(url, Promise.resolve(existing));
            return this.styles.get(url);
        }
        const request = new Promise((resolve, reject) => {
            const link = existing || document.createElement('link');
            link.rel = 'stylesheet';
            link.href = url;
            link.dataset.astrieAppStyle = 'true';
            link.addEventListener('load', () => resolve(link), { once: true });
            link.addEventListener('error', () => reject(new Error(`Stylesheet ${url} konnte nicht geladen werden.`)), { once: true });
            if (!existing) document.head.append(link);
        }).catch(error => { this.styles.delete(url); throw error; });
        this.styles.set(url, request);
        return request;
    },

    loadScripts(urls) {
        return Promise.all(urls.map(url => this.loadScript(url)));
    },

    loadScript(url) {
        if (this.scripts.has(url)) return this.scripts.get(url);
        const request = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = url;
            script.async = false;
            script.dataset.astrieAppScript = 'true';
            script.addEventListener('load', () => resolve(script), { once: true });
            script.addEventListener('error', () => reject(new Error(`JavaScript ${url} konnte nicht geladen werden.`)), { once: true });
            document.head.append(script);
        }).catch(error => { this.scripts.delete(url); throw error; });
        this.scripts.set(url, request);
        return request;
    },

    ensureWindowShell() {
        if (window.WindowManager?.template) return Promise.resolve(window.WindowManager.template);
        if (this.windowShell) return this.windowShell;
        this.windowShell = fetch('/ui/overlay/window.html')
            .then(response => {
                if (!response.ok) throw new Error(`Fenstertemplate konnte nicht geladen werden (${response.status}).`);
                return response.text();
            })
            .then(markup => {
                const documentTemplate = new DOMParser().parseFromString(markup, 'text/html');
                const template = documentTemplate.getElementById('Window-border');
                if (!template?.content) throw new Error('Das Fenstertemplate fehlt.');
                window.WindowManager.init(template.content);
                return template.content;
            })
            .catch(error => { this.windowShell = null; throw error; });
        return this.windowShell;
    },

    close(id) {
        const instance = this.instances.get(id);
        if (instance?.app.presentation === 'panel') {
            instance.root.remove();
            this._disposeInstance(id);
            return true;
        }
        return window.WindowManager?.closeWindow(id) || false;
    },

    _handleWindowClosed(event) {
        this._disposeInstance(event.detail?.id);
    },

    _disposeInstance(id) {
        const instance = this.instances.get(id);
        if (!instance) return;
        this.instances.delete(id);
        instance.controller.abort();
        try {
            instance.cleanup?.();
            instance.app.unmount?.({
                root: instance.root,
                window: instance.win,
                params: instance.params,
                runtime: this
            });
        } catch (error) {
            console.error(`[AstrieRuntime] App „${instance.app.id}“ konnte nicht beendet werden:`, error);
        }
        window.dispatchEvent(new CustomEvent('astrie-app-unmounted', { detail: { id, appId: instance.app.id } }));
    }
};

window.AstrieRuntime = AstrieRuntime;
window.addEventListener('astrie-window-closed', event => AstrieRuntime._handleWindowClosed(event));
