(() => {
    const start = () => {
        const overlay = document.querySelector('.Ladenoverlay');
        if (!overlay || overlay.dataset.loadingTracked === 'true') return;
        overlay.dataset.loadingTracked = 'true';

        const number = document.getElementById('Laden-nummer');
        const file = document.getElementById('text-file');
        const resources = [
            ...document.querySelectorAll('img[src]:not([loading="lazy"])'),
            ...document.querySelectorAll('link[rel="stylesheet"][href]'),
            ...document.querySelectorAll('script[src]:not([async]):not([defer])')
        ];
        const total = resources.length;
        let loaded = 0;
        let finishStarted = false;

        const setProgress = (value, name) => {
            if (number) number.textContent = `${value}%`;
            if (file && name) file.textContent = name;
        };

        const resourceName = element => {
            const source = element.currentSrc || element.src || element.href || '';
            try {
                return new URL(source, document.baseURI).pathname.split('/').pop() || 'Ressource';
            } catch {
                return 'Ressource';
            }
        };

        const waitForResource = element => new Promise(resolve => {
            let settled = false;
            const name = resourceName(element);
            const settle = () => {
                if (settled) return;
                settled = true;
                element.removeEventListener('load', onLoad);
                element.removeEventListener('error', onError);
                loaded++;
                setProgress(Math.min(100, Math.round(loaded / Math.max(total, 1) * 100)), name);
                resolve();
            };
            const onLoad = () => {
                if (element.tagName === 'IMG' && typeof element.decode === 'function') {
                    element.decode().catch(() => {}).then(settle);
                } else {
                    settle();
                }
            };
            const onError = settle;

            element.addEventListener('load', onLoad, { once: true });
            element.addEventListener('error', onError, { once: true });

            if (element.tagName === 'IMG' && element.complete) {
                onLoad();
            } else if (element.tagName === 'LINK' && (element.sheet !== null || document.readyState !== 'loading')) {
                // The loading script is parser-blocking and runs after the page's stylesheets settle.
                settle();
            } else if (element.tagName === 'SCRIPT' && (element.readyState === 'complete' || element.readyState === undefined)) {
                // Classic scripts before this script have already executed in document order.
                settle();
            }
        });

        const nextFrame = () => new Promise(resolve => {
            if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
            else window.setTimeout(resolve, 16);
        });

        const finish = async () => {
            if (finishStarted) return;
            finishStarted = true;
            await Promise.all(resources.map(waitForResource));

            setProgress(100, 'Schriftarten werden geladen …');
            try {
                if (document.fonts?.ready) await document.fonts.ready;
            } catch (error) {
                console.warn('[Ladenoverlay] Schriftarten konnten nicht vollständig geladen werden:', error);
            }

            await nextFrame();
            setProgress(100, 'Fertig');
            window.setTimeout(() => overlay.classList.add('fertig'), 100);
        };

        if (total === 0) setProgress(100, 'Schriftarten werden geladen …');
        finish();
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }
})();
