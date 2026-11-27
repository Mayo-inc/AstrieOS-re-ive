function Gretter_user() {
    const el = document.querySelector('[data-gretter-menu="accounts"]') || document.querySelector('.Gretter-background')
    if (el) {
        el.classList.toggle('Open');
        document.querySelector('[data-gretter-menu="desktop"]')?.classList.remove('Open');
    }
}

function Gretter_De() {
    const el = document.querySelector('[data-gretter-menu="desktop"]') || document.querySelector('.Gretter-background')
    if (el) {
        el.classList.toggle('Open');
        document.querySelector('[data-gretter-menu="accounts"]')?.classList.remove('Open');
    }
}

function placeholder_user() {
    const el = document.querySelector('.PLaceholder-nutzercenter')
    if (el) {
        el.classList.contains('Open') ? Sound.play('menu-close') : Sound.play('menu-open');
        el.classList.toggle('Open')
    }
}

function placeholder_setting() {
    const el = document.querySelector('.Einstellungen-placeholder')
    if (el) {
        const wasOpen = el.classList.contains('Open');
        wasOpen ? Sound.play('menu-close') : Sound.play('menu-open');
        el.classList.toggle('Open')
        if (!wasOpen) {
            const attachPlayerSettings = () => window.Mediaplayer?.attachSettingsControls?.();
            if (window.Mediaplayer) attachPlayerSettings();
            else window.AstrieRuntime?.loadScript?.('/JavaScript/Mediaplayer.js')
                .then(attachPlayerSettings)
                .catch(error => console.error('[Einstellungen] Mediaplayer-Regler konnten nicht geladen werden:', error));
        }
    }
}

function mediaplayer_user() {
    return window.openMusikplayerPanel?.({ toggle: true });
}

function Mediaplayer_dropdown() {
    const el = document.querySelector('.Mediaplayer-box-menu')
    if (el) {
        el.classList.contains('Open') ? Sound.play('menu-close') : Sound.play('menu-open');
        el.classList.toggle('Open')
    }
}

function User_Wallpapier() {
    const el = document.querySelector('.Einstellungen-hintergrund-display')
    if (el) {
        el.classList.contains('Open') ? Sound.play('menu-close') : Sound.play('menu-open');
        el.classList.toggle('Open')
        
        // Stelle sicher, dass Event-Listener gebunden sind
        if (el.classList.contains('Open') && typeof EinstellungenHintergrund !== 'undefined') {
            EinstellungenHintergrund.init();
        }
    }
}

function User_farbePalette(button) {
    const el = document.querySelector('.Einstellungen-farbe-display')
    if (el) {
        el.classList.contains('Open') ? Sound.play('menu-close') : Sound.play('menu-open');
        const isOpen = el.classList.toggle('Open');
        button?.setAttribute('aria-expanded', String(isOpen));
    }
}

function openNutzer_custom() {
    const el = document.querySelector('.Placeholder-usercustom')
    if (el) {
        el.classList.contains('Open') ? Sound.play('menu-close') : Sound.play('menu-open');
        el.classList.toggle('Open')
    }
}

function open_Changelogmk(version) {
    window.Changelog?.open(version).catch(error => console.warn('[Changelog]', error));
}

function placeholder_notifield() {
    const el = document.querySelector('.Benachrichtigung-content')
    if (el) {
        el.classList.contains('Open') ? Sound.play('menu-close') : Sound.play('menu-open');
        el.classList.toggle('Open')
    }
}
