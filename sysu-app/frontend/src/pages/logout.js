import {AuthService} from '../api/authService.js';

try {
    await AuthService.logout({redirect: false});
    window.location.replace('./index.html');
} catch {
    document.getElementById('logout-status').textContent = 'Sign out failed. Please check your connection and retry.';
}
