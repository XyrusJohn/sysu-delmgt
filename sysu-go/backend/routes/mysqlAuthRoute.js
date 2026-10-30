const express = require('express');
const {AuthError} = require('../services/mysqlAuthService');

function createMysqlAuthRouter({service}) {
    if (!service) throw new TypeError('MySQL auth service is required');
    const router = express.Router();

    function run(action, successStatus = 200) {
        return async (req, res) => {
            try {
                if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) throw new AuthError('INVALID_REQUEST');
                const result = await action(req);
                res.status(successStatus).json({success: true, ...result});
            } catch (error) {
                if (error instanceof AuthError) {
                    res.status(error.status).json({success: false, code: error.code});
                    return;
                }
                res.status(500).json({success: false, code: 'AUTH_SERVICE_UNAVAILABLE'});
            }
        };
    }

    router.post('/username/register', run(req => service.registerWithUsername(req.body), 201));
    router.post('/username/login', run(req => service.loginWithUsername(req.body)));
    const updateProfile = run(req => service.updateProfile(bearerToken(req.get('authorization')), req.body));
    router.patch('/profile', updateProfile);
    // HttpURLConnection on Android does not consistently support PATCH.
    router.put('/profile', updateProfile);
    router.get('/session', async (req, res) => {
        const token = bearerToken(req.get('authorization'));
        if (!token) return res.status(401).json({success: false, code: 'AUTHENTICATION_REQUIRED'});
        try {
            const user = await service.authenticate(token);
            if (!user) return res.status(401).json({success: false, code: 'SESSION_INVALID'});
            return res.json({success: true, user});
        } catch {
            return res.status(503).json({success: false, code: 'AUTH_SERVICE_UNAVAILABLE'});
        }
    });
    router.post('/logout', async (req, res) => {
        const token = bearerToken(req.get('authorization'));
        if (!token) return res.status(400).json({success: false, code: 'AUTHENTICATION_REQUIRED'});
        try {
            await service.logout(token);
            return res.json({success: true});
        } catch {
            return res.status(503).json({success: false, code: 'AUTH_SERVICE_UNAVAILABLE'});
        }
    });
    return router;
}

function bearerToken(header) {
    const match = typeof header === 'string' && /^Bearer ([A-Za-z0-9_-]{40,128})$/.exec(header);
    return match ? match[1] : null;
}

module.exports = {createMysqlAuthRouter, bearerToken};
