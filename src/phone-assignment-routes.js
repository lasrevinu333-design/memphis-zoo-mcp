function clip(value, max = 500) { return String(value ?? '').trim().slice(0, max); }
function uuidOrNull(value) {
  const normalized = String(value || '').trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized) ? normalized : null;
}
function fail(res, error, fallback) {
  const status = Number(error?.status || error?.statusCode || 500);
  res.status(status >= 400 && status <= 599 ? status : 500).json({ ok: false, error: clip(error?.message || fallback, 1000) });
}

export function installPhoneAssignmentRoutes(app, { db, requireCustodial } = {}) {
  if (!app || app.__phoneAssignmentRoutesInstalled) return;
  Object.defineProperty(app, '__phoneAssignmentRoutesInstalled', { value: true });
  if (!db || typeof requireCustodial !== 'function') return;

  app.get('/leadership-api/phone-assignments', requireCustodial, async (_req, res) => {
    try {
      const [devicesResult, employeesResult, sessionsResult] = await Promise.all([
        db.from('devices')
          .select('id,device_id,device_name,active,assigned_employee_id,last_seen_at,updated_at')
          .eq('active', true)
          .like('device_id', 'KIOSK_%')
          .order('device_id', { ascending: true }),
        db.from('employees')
          .select('id,employee_code,display_name,active,role,updated_at')
          .like('employee_code', 'EMP%')
          .order('display_name', { ascending: true }),
        db.from('sessions')
          .select('device_id,status,started_at,ended_at')
          .is('ended_at', null),
      ]);
      for (const result of [devicesResult, employeesResult, sessionsResult]) if (result.error) throw result.error;

      const employeesById = new Map((employeesResult.data || []).map((employee) => [String(employee.id), employee]));
      const activeDevices = (devicesResult.data || []).filter((device) => /^KIOSK_(?:0[2-9]|10)$/.test(String(device.device_id || '').toUpperCase()));
      const assignedDeviceByEmployee = new Map();
      for (const device of activeDevices) if (device.assigned_employee_id) assignedDeviceByEmployee.set(String(device.assigned_employee_id), device.device_id);
      const openSessionByDevicePk = new Map();
      for (const session of sessionsResult.data || []) {
        if (!['closed', 'cancelled', 'completed', 'finished'].includes(String(session.status || '').toLowerCase())) {
          openSessionByDevicePk.set(String(session.device_id), session);
        }
      }
      const devices = activeDevices.map((device) => {
        const employee = employeesById.get(String(device.assigned_employee_id || '')) || null;
        const openSession = openSessionByDevicePk.get(String(device.id)) || null;
        return {
          id: device.id,
          device_id: device.device_id,
          device_name: device.device_name,
          assigned_employee_id: device.assigned_employee_id || null,
          employee_name: employee?.display_name || null,
          employee_code: employee?.employee_code || null,
          employee_active: employee?.active === true,
          last_seen_at: device.last_seen_at || null,
          updated_at: device.updated_at || null,
          open_session: openSession ? { status: openSession.status, started_at: openSession.started_at } : null,
        };
      });
      const employees = (employeesResult.data || []).filter((employee) => employee.active === true).map((employee) => ({
        ...employee,
        assigned_device_id: assignedDeviceByEmployee.get(String(employee.id)) || null,
      }));
      const nextNumber = (employeesResult.data || []).reduce((maximum, employee) => {
        const match = String(employee.employee_code || '').match(/^EMP(\d+)$/i);
        return match ? Math.max(maximum, Number(match[1])) : maximum;
      }, 0) + 1;

      res.json({ ok: true, data: {
        devices,
        employees,
        next_employee_code: `EMP${String(nextNumber).padStart(3, '0')}`,
        generated_at: new Date().toISOString(),
      } });
    } catch (error) { fail(res, error, 'Phone assignments could not be loaded.'); }
  });

  app.post('/leadership-api/phone-assignments/:deviceId', requireCustodial, async (req, res) => {
    try {
      const pathDevice = String(req.params?.deviceId || '').trim();
      const deviceIdentifier = pathDevice.toLowerCase() === 'unassigned' ? null : pathDevice;
      if (deviceIdentifier && !/^KIOSK_(?:0[2-9]|10)$/i.test(deviceIdentifier)) {
        return res.status(400).json({ ok: false, error: 'A valid employee kiosk ID is required.' });
      }
      const operationId = uuidOrNull(req.body?.operation_id || req.body?.operationId);
      if (!operationId) return res.status(422).json({ ok: false, error: 'A valid operation_id is required.' });
      const employeeId = uuidOrNull(req.body?.employee_id || req.body?.employeeId);
      const expectedCurrentEmployeeId = uuidOrNull(req.body?.expected_current_employee_id || req.body?.expectedCurrentEmployeeId);
      const newEmployeeName = clip(req.body?.new_employee_name || req.body?.newEmployeeName, 160);
      if (employeeId && newEmployeeName) return res.status(422).json({ ok: false, error: 'Choose an existing employee or create a new employee, not both.' });
      if (!deviceIdentifier && !newEmployeeName) return res.status(422).json({ ok: false, error: 'A new employee name is required when no phone is selected.' });

      const result = await db.rpc('ops_reassign_employee_phone', {
        p_operation_id: operationId,
        p_device_identifier: deviceIdentifier,
        p_employee_id: employeeId,
        p_new_employee_name: newEmployeeName || null,
        p_expected_current_employee_id: expectedCurrentEmployeeId,
        p_deactivate_previous: req.body?.deactivate_previous === true || req.body?.deactivatePrevious === true,
        p_manager_id: uuidOrNull(req.memphisAuth?.manager_id),
      });
      if (result.error) throw result.error;
      res.json({ ok: true, data: result.data || {} });
    } catch (error) { fail(res, error, 'Phone assignment could not be changed.'); }
  });
}
