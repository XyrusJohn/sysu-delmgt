const express = require('express');
const {verifyToken} = require('../middleware/auth');
const {validatePodGroupRequest, validatePodRequest} = require('../services/podProgress');

const podService = () => require('../services/mysqlPodService').getMysqlPodService();
const validShipmentId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value);
const validObdNumber = value => typeof value === 'string' && /^[-A-Za-z0-9_. ]{1,100}$/.test(value);
const safeFailure = (res, error, fallback) => res.status(error.status || 503).json({
    success: false,
    message: [400, 403, 404, 409].includes(error.status) ? error.message : fallback,
});

const STAFF_POD_ROLES = new Set(['fleet_manager', 'admin', 'super_admin']);

function createPodRouter({authenticate = verifyToken, getPodService = () => podService()} = {}) {
  const router = express.Router();

router.get('/:shipmentId/:obdNumber', authenticate, async (req, res) => {
    const role = req.userProfile?.role;
    if (role !== 'driver' && !STAFF_POD_ROLES.has(role)) {
        return res.status(403).json({success: false, message: 'Account not authorized'});
    }
    const {shipmentId, obdNumber} = req.params;
    if (!validShipmentId(shipmentId) || !validObdNumber(obdNumber)) {
        return res.status(400).json({success: false, message: 'Invalid shipment or OBD'});
    }
    try {
        const service = getPodService();
        const pod = role === 'driver'
            ? await service.get(shipmentId, obdNumber, req.user.uid)
            : await service.getForStaff(shipmentId, obdNumber);
        return res.json({success: true, data: pod});
    } catch (error) { return safeFailure(res, error, 'POD unavailable'); }
});

router.post('/:shipmentId/group', authenticate, async (req, res) => {
    if (req.userProfile.role !== 'driver') return res.status(403).json({success: false, message: 'Driver account required'});
    try {
        const {shipmentId} = req.params;
        if (!validShipmentId(shipmentId)) return res.status(400).json({success: false, message: 'Invalid shipment'});
        const input = validatePodGroupRequest(req.body, Date.now());
        const result = await getPodService().saveGroup({dispatchKey: shipmentId, driverId: req.user.uid, input});
        req.app.get('io')?.to('staff:tracking').emit('pod_updated', {shipmentDocId: shipmentId,
            driverId: req.user.uid, source: 'driver_app'});
        return res.json({success: true, ...result});
    } catch (error) { return safeFailure(res, error, 'Unable to save POD group. Please retry.'); }
});

router.post('/:shipmentId/:obdNumber', authenticate, async (req, res) => {
    if (req.userProfile.role !== 'driver') return res.status(403).json({success: false, message: 'Driver account required'});
    try {
        const {shipmentId, obdNumber} = req.params;
        if (!validShipmentId(shipmentId) || !validObdNumber(obdNumber)) {
            return res.status(400).json({success: false, message: 'Invalid shipment or OBD'});
        }
        const input = validatePodRequest(req.body, Date.now());
        const result = await getPodService().saveSingle({dispatchKey: shipmentId, obdNumber,
            driverId: req.user.uid, input});
        req.app.get('io')?.to('staff:tracking').emit('pod_updated', {shipmentDocId: shipmentId,
            driverId: req.user.uid, source: 'driver_app'});
        return res.json({success: true, ...result});
    } catch (error) { return safeFailure(res, error, 'Unable to save POD. Please retry.'); }
});

  return router;
}

module.exports = createPodRouter();
module.exports.createPodRouter = createPodRouter;
