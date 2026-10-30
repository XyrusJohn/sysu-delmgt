import {AuthService} from '../api/authService.js';

AuthService.subscribe(user => {
    window.kioskQueueUser = user ? {id: user.id, username: user.username} : null;
    window.dispatchEvent(new Event('kiosk-auth-changed'));
});
